// SPDX-License-Identifier: MIT
import type { DelimiterId } from './byte-csv-parser';
import {
  evaluateAst,
  evaluateAstArray,
  errorValue,
  formatValue,
  isFormula,
  literalToValue,
  sheetNameKey,
  type EvalContext,
  type FormulaValue,
} from './formula';
import {
  buildSpillMap,
  canSpill,
  cellKey,
  EMPTY_SPILL_MAP,
  isEmptySpillMap,
  type SpillAnchor,
  type SpillMap,
} from './spill';
import type { ValueGrid } from './formula-value';
import type { SheetFilter } from './filter';
import {
  decodeRsfWorkbook,
  encodeRsfWorkbook,
  MAX_RSF_SHEETS,
  type RsfDecodeError,
  type RsfWorkbookData,
  type RsfWorksheetData,
} from './rsf-codec';
import { Worksheet } from './worksheet';
import { APP_NAME, APP_VERSION } from '../app/version';
import type { LosslessDocument } from './lossless-document';
import { DEFAULT_TIMEZONE, isValidTimeZone, localTimeZone, timeZoneOffsetMs } from './timezone';
import { DEFAULT_DISPLAY_LANGUAGE, isValidDisplayLanguage, type DisplayLanguageId } from './display-language';

/**
 * Refrain Sheet Format (`.rsf`): a documented, versioned, binary container for
 * spreadsheet **workbooks**. A workbook holds one or more worksheets, each with
 * its own grid, formulas, row/column structure, filter, and display settings.
 * CSV cannot store formulas, multiple worksheets, or structural editing intent
 * without breaking the original-file preservation guarantee, so spreadsheet
 * documents are saved as `.rsf` instead.
 *
 * The container is a compact binary format (magic bytes, header, CRC-32
 * checksum, compressed body) defined in `rsf-codec.ts` and documented in
 * `docs/rsf-format.md`. It holds pure data — no executable code, macros,
 * external references, or network URLs — and parsing is strict (magic,
 * version, checksum, shape, and bounds are validated) and never executes
 * anything.
 *
 * **Compatibility.** A workbook holding a single worksheet is written in the
 * original single-sheet container (version 3), so files that do not use
 * multi-worksheet features stay readable by older releases; only a workbook
 * with two or more worksheets is written in the workbook container (version 4),
 * which older releases reject safely with an unsupported-version message.
 * Existing single-sheet `.rsf` files — and legacy `.rcsv` files — load as
 * one-worksheet workbooks.
 */
export const RSF_EXTENSION = '.rsf';
/** Legacy extension read as an import; migrated documents are saved as `.rsf`. */
export const RSF_LEGACY_EXTENSION = '.rcsv';

/**
 * Default dimensions of a blank spreadsheet created by File > New: a small
 * but usable grid (documented in the README). The virtualized grid keeps this
 * cheap, and rows/columns can be inserted or deleted afterwards.
 */
export const NEW_DOC_ROWS = 100;
export const NEW_DOC_COLS = 26;

/**
 * Fallback name for the first worksheet. The application passes a localized
 * name (`Sheet1` / `シート1`); this constant only applies when a caller
 * supplies none, keeping the core layer free of i18n dependencies.
 */
export const DEFAULT_SHEET_NAME = 'Sheet1';

/** Maximum number of worksheets a workbook may hold (mirrors the container bound). */
export const MAX_WORKSHEETS = MAX_RSF_SHEETS;

/** Failure reasons when loading a `.rsf` (or legacy `.rcsv`) container (see `rsf-codec.ts`). */
export type RsfParseError = RsfDecodeError;

export type RsfLoadResult = { ok: true; doc: RsfDocument } | { ok: false; error: RsfParseError };

/**
 * A spreadsheet workbook. Unlike LosslessDocument there is no byte-level
 * baseline: the cell inputs are the document.
 *
 * The workbook owns evaluation, because a formula may reference another
 * worksheet (`Sheet1!A1`): the memo and the in-progress set are workbook-wide,
 * which is what makes results consistent across worksheets and circular
 * references detectable *across* worksheet boundaries. Any mutation, in any
 * worksheet, invalidates the whole memo — cross-sheet dependencies mean a
 * change anywhere can affect a formula anywhere, so results are recomputed
 * lazily on next access.
 *
 * The single-worksheet editing surface (`rowCount`, `getValue`, `setCell`, …)
 * delegates to the **active** worksheet, so every existing UI, command, and
 * history path operates on the active worksheet without knowing about
 * workbooks. Operations that must target a specific worksheet — undo/redo of an
 * edit made on another sheet, cross-sheet formula rewrites — use the explicit
 * `…On(sheetId, …)` forms.
 */
export class RsfDocument {
  readonly kind = 'rsf' as const;
  /** Workbook (file) name. */
  name: string;
  /** Delimiter used as the default for CSV export (workbook-level). */
  delimiter: DelimiterId;

  private sheetList: Worksheet[];
  private activeId: string;
  private nextSheetSeq = 1;

  private revision = 0;
  private savedRevision = 0;

  /** Stable workbook identifier, preserved across saves. */
  readonly docId: string;
  /** Creation / last-update timestamps (ms since epoch). */
  createdAt: number;
  updatedAt: number;

  /**
   * The workbook's IANA timezone (workbook-level, like {@link delimiter}),
   * read by `TODAY()` and `NOW()`. A new workbook defaults to the browser's
   * local timezone; a loaded workbook uses its stored value, or `"UTC"` when
   * none is stored (every file saved before this setting existed), which is
   * the exact behavior those files already had. Change it with
   * {@link setTimezone}, not by writing this field directly, so volatile
   * functions recalculate.
   */
  private timezoneId: string;

  /**
   * The workbook's stored display language (workbook-level, like
   * {@link timezoneId}), read by `TEXT()`'s `ddd`/`dddd` weekday-name tokens
   * (see `display-language.ts`). A new workbook defaults to whatever the
   * caller passes at creation (the application's own current UI language, so
   * a freshly created file matches what its author was looking at); a loaded
   * workbook uses its stored value, or {@link DEFAULT_DISPLAY_LANGUAGE} when
   * none is stored or the stored value is unrecognized (every file saved
   * before this setting existed). Change it with {@link setDisplayLanguage},
   * not by writing this field directly, so cached `TEXT()` results
   * recalculate.
   */
  private displayLanguageId: DisplayLanguageId;

  /**
   * Compression method for the next `.rsf` save (an `RSF_COMPRESSION_*` id),
   * or `undefined` to use the active codec's default (Zstandard). Set from the
   * container on load so a normal save preserves the file's method, and by the
   * Save dialog when the user picks a different one.
   */
  private compressionMethod: number | undefined;

  /**
   * True when this workbook was read from a single-worksheet container
   * (version 3, or a legacy `.rcsv`). Purely informational: the workbook is
   * saved back in the single-sheet container while it still holds one
   * worksheet, and migrates to the workbook container as soon as a second
   * worksheet is added.
   */
  loadedAsSingleSheet = false;

  /**
   * Workbook-wide evaluation memo, keyed by worksheet id + cell. Cleared by
   * every mutation (see {@link touch}) because a cross-sheet reference means a
   * change in one worksheet can invalidate a formula in another.
   */
  private memo = new Map<string, FormulaValue>();
  /** Cells currently being evaluated; a re-entry is a circular reference. */
  private readonly inProgress = new Set<string>();
  /** Per-worksheet evaluation contexts, rebuilt after any mutation. */
  private evalContexts = new Map<string, EvalContext>();
  /** Worksheet lookup by name key, rebuilt after any structural change. */
  private nameIndex: Map<string, Worksheet> | null = null;

  /**
   * Per-worksheet dynamic-array spill maps, rebuilt lazily after any mutation.
   * Null means "not built yet"; see {@link spillFor}. Derived spill values are
   * never stored in a worksheet and never written to a `.rsf` file — they are
   * recomputed from the anchor formulas, which is what makes undo/redo,
   * structural edits, and persistence need no spill-specific handling.
   */
  private spillMaps: Map<string, SpillMap> | null = null;
  /**
   * True while the spill maps are being built. Derived-cell lookups read as
   * blank during that window, which is the documented rule that a
   * dynamic-array formula cannot see another spill's output — and is what
   * makes the build terminate.
   */
  private buildingSpill = false;

  /**
   * The clock every volatile function (`TODAY`, `NOW`) in this workbook reads,
   * fixed so that all of them agree within one recalculation.
   *
   * It advances at exactly three moments: when the workbook is created or
   * loaded, on any mutation (which invalidates the memo anyway), and when
   * {@link recalculate} is called explicitly. There is deliberately **no
   * background timer**: an idle workbook never recalculates on its own, so a
   * left-open tab cannot burn CPU or make a document appear to change by
   * itself.
   */
  private clockMs = Date.now();

  /**
   * `timezone` defaults to the browser's local zone, which is what every
   * *new* workbook (blank, converted, or built from values) should get. The
   * one caller loading an *existing* file (`fromBytes`) passes the stored
   * value explicitly instead — falling back to `"UTC"`, not the local zone,
   * so a file saved before this setting existed keeps its exact original
   * behavior rather than picking up whatever machine happens to reopen it.
   */
  private constructor(
    name: string,
    delimiter: DelimiterId,
    sheets: Worksheet[],
    docId?: string,
    timezone: string = localTimeZone(),
    displayLanguage: DisplayLanguageId = DEFAULT_DISPLAY_LANGUAGE,
  ) {
    this.name = name;
    this.delimiter = delimiter;
    this.sheetList = sheets;
    this.activeId = sheets[0].id;
    this.docId = docId ?? `wb-${Math.random().toString(36).slice(2, 10)}`;
    const now = Date.now();
    this.createdAt = now;
    this.updatedAt = now;
    this.nextSheetSeq = sheets.length + 1;
    this.timezoneId = timezone;
    this.displayLanguageId = displayLanguage;
  }

  // ----- Construction -----

  /** Create a workbook from the current values of a CSV document (explicit conversion). */
  static fromLossless(
    doc: LosslessDocument,
    name: string,
    sheetName = DEFAULT_SHEET_NAME,
    displayLanguage: DisplayLanguageId = DEFAULT_DISPLAY_LANGUAGE,
  ): RsfDocument {
    const columnCount = Math.max(1, doc.columnCount);
    const rows: string[][] = [];
    for (let r = 0; r < doc.rowCount; r++) {
      const row = new Array<string>(columnCount).fill('');
      const fieldCount = doc.fieldCount(r);
      for (let c = 0; c < fieldCount; c++) {
        row[c] = doc.getValue(r, c);
      }
      rows.push(row);
    }
    return new RsfDocument(
      name,
      doc.delimiter,
      [Worksheet.fromValues('s1', sheetName, rows, columnCount)],
      undefined,
      localTimeZone(),
      displayLanguage,
    );
  }

  /**
   * Create a workbook from prebuilt row-major values. Used by the time-sliced
   * CSV→RSF conversion, which collects the rows incrementally (with progress)
   * instead of one long synchronous loop; the result is identical to
   * {@link fromLossless}.
   */
  static fromValues(
    name: string,
    delimiter: DelimiterId,
    rows: string[][],
    columnCount: number,
    sheetName = DEFAULT_SHEET_NAME,
    displayLanguage: DisplayLanguageId = DEFAULT_DISPLAY_LANGUAGE,
  ): RsfDocument {
    return new RsfDocument(
      name,
      delimiter,
      [Worksheet.fromValues('s1', sheetName, rows, columnCount)],
      undefined,
      localTimeZone(),
      displayLanguage,
    );
  }

  static empty(
    name: string,
    rows = 1,
    cols = 1,
    sheetName = DEFAULT_SHEET_NAME,
    displayLanguage: DisplayLanguageId = DEFAULT_DISPLAY_LANGUAGE,
  ): RsfDocument {
    return new RsfDocument(
      name,
      ',',
      [Worksheet.empty('s1', sheetName, rows, cols)],
      undefined,
      localTimeZone(),
      displayLanguage,
    );
  }

  /**
   * A blank workbook for File > New: one worksheet, marked unsaved from
   * creation (there is no file on disk yet), so the tab shows a dirty
   * indicator and closing it prompts to save.
   */
  static blank(
    name: string,
    rows = NEW_DOC_ROWS,
    cols = NEW_DOC_COLS,
    sheetName = DEFAULT_SHEET_NAME,
    displayLanguage: DisplayLanguageId = DEFAULT_DISPLAY_LANGUAGE,
  ): RsfDocument {
    const doc = RsfDocument.empty(name, rows, cols, sheetName, displayLanguage);
    doc.markUnsaved();
    return doc;
  }

  /** Parse and strictly validate binary `.rsf` (or legacy `.rcsv`) bytes. Never executes anything. */
  static fromBytes(bytes: Uint8Array, name: string): RsfLoadResult {
    const decoded = decodeRsfWorkbook(bytes);
    if (!decoded.ok) {
      return { ok: false, error: decoded.error };
    }
    const data = decoded.data;
    const sheets = data.sheets.map((entry) => RsfDocument.buildWorksheet(entry));
    const timezone =
      data.timezone !== undefined && isValidTimeZone(data.timezone) ? data.timezone : DEFAULT_TIMEZONE;
    const displayLanguage =
      data.displayLanguage !== undefined && isValidDisplayLanguage(data.displayLanguage)
        ? data.displayLanguage
        : DEFAULT_DISPLAY_LANGUAGE;
    const doc = new RsfDocument(name, data.delimiter, sheets, data.docId, timezone, displayLanguage);
    doc.compressionMethod = data.compression;
    doc.loadedAsSingleSheet = data.legacySingleSheet === true;
    if (data.createdAt !== undefined) {
      doc.createdAt = data.createdAt;
    }
    if (data.updatedAt !== undefined) {
      doc.updatedAt = data.updatedAt;
    }
    // Restore the saved active worksheet when it still exists; otherwise fall
    // back safely to the first worksheet.
    const active = data.activeSheetId && sheets.find((s) => s.id === data.activeSheetId);
    doc.activeId = active ? active.id : sheets[0].id;
    doc.nextSheetSeq = sheets.length + 1;
    return { ok: true, doc };
  }

  /** Materialize one decoded worksheet record (already validated by the codec). */
  private static buildWorksheet(entry: RsfWorksheetData): Worksheet {
    const rows: string[][] = [];
    for (let r = 0; r < entry.rowCount; r++) {
      rows.push(new Array<string>(entry.columnCount).fill(''));
    }
    for (const [r, c, input] of entry.cells) {
      rows[r][c] = input;
    }
    const sheet = new Worksheet(entry.id, entry.name, rows, entry.columnCount);
    if (entry.display) {
      sheet.displayZoom = entry.display.zoom;
      for (const [col, width] of entry.display.colWidths ?? []) {
        sheet.displayColWidths[col] = width;
      }
      if (entry.display.wrap) {
        sheet.displayWrap = true;
      }
    }
    sheet.filter = entry.filter ?? null;
    sheet.filterDropped = entry.filterDropped === true;
    return sheet;
  }

  // ----- Worksheets -----

  /** The workbook's worksheets, in display order (read-only view). */
  get sheets(): readonly Worksheet[] {
    return this.sheetList;
  }

  get sheetCount(): number {
    return this.sheetList.length;
  }

  get activeSheet(): Worksheet {
    return this.sheetList.find((s) => s.id === this.activeId) ?? this.sheetList[0];
  }

  get activeSheetId(): string {
    return this.activeSheet.id;
  }

  sheetById(id: string): Worksheet | null {
    return this.sheetList.find((s) => s.id === id) ?? null;
  }

  /** Resolve a worksheet by display name, case-insensitively (the uniqueness policy). */
  sheetByName(name: string): Worksheet | null {
    if (!this.nameIndex) {
      this.nameIndex = new Map();
      for (const sheet of this.sheetList) {
        this.nameIndex.set(sheetNameKey(sheet.name), sheet);
      }
    }
    return this.nameIndex.get(sheetNameKey(name)) ?? null;
  }

  /** 0-based position of a worksheet, or -1. */
  sheetIndex(id: string): number {
    return this.sheetList.findIndex((s) => s.id === id);
  }

  /**
   * Activate a worksheet. Purely a view change: like zoom and column widths it
   * is recorded in the container on the next save but never marks the workbook
   * dirty on its own, so simply looking at another worksheet does not make the
   * file appear edited.
   */
  setActiveSheetId(id: string): boolean {
    if (this.activeId === id || !this.sheetList.some((s) => s.id === id)) {
      return false;
    }
    this.activeId = id;
    return true;
  }

  /** True when `name` is free (case-insensitively), ignoring `exceptId`. */
  isSheetNameAvailable(name: string, exceptId?: string): boolean {
    const key = sheetNameKey(name);
    return !this.sheetList.some((s) => s.id !== exceptId && sheetNameKey(s.name) === key);
  }

  /**
   * `desired` if free, otherwise the first available `desired (2)`,
   * `desired (3)`, … so a generated name never collides.
   */
  uniqueSheetName(desired: string, exceptId?: string): string {
    const base = desired.trim() || DEFAULT_SHEET_NAME;
    if (this.isSheetNameAvailable(base, exceptId)) {
      return base;
    }
    for (let n = 2; n <= MAX_WORKSHEETS + 2; n++) {
      const candidate = `${base} (${n})`;
      if (this.isSheetNameAvailable(candidate, exceptId)) {
        return candidate;
      }
    }
    return `${base} (${Date.now()})`;
  }

  /** Mint an identifier that no current worksheet uses. */
  private mintSheetId(): string {
    for (;;) {
      const id = `s${this.nextSheetSeq++}`;
      if (!this.sheetList.some((s) => s.id === id)) {
        return id;
      }
    }
  }

  /** Build (but do not insert) a new empty worksheet shaped like the active one. */
  createWorksheet(name: string, rows?: number, cols?: number): Worksheet {
    const active = this.activeSheet;
    return Worksheet.empty(this.mintSheetId(), name, rows ?? active.rowCount, cols ?? active.columnCount);
  }

  /** Build (but do not insert) a deep copy of a worksheet under a new name. */
  duplicateWorksheet(id: string, name: string): Worksheet | null {
    const source = this.sheetById(id);
    return source ? source.clone(this.mintSheetId(), name) : null;
  }

  /**
   * Build (but do not insert) an *empty* copy of a worksheet, to be filled in
   * row by row. Used by the time-sliced duplication of large worksheets, which
   * can then be cancelled without ever touching the workbook.
   */
  duplicateWorksheetShell(id: string, name: string): Worksheet | null {
    const source = this.sheetById(id);
    return source ? source.cloneShell(this.mintSheetId(), name) : null;
  }

  /** Insert an existing worksheet object at `index` (atomic; undo inserts it back). */
  insertSheetAt(index: number, sheet: Worksheet): boolean {
    if (this.sheetList.length >= MAX_WORKSHEETS || this.sheetById(sheet.id)) {
      return false;
    }
    const at = Math.max(0, Math.min(this.sheetList.length, index));
    this.sheetList.splice(at, 0, sheet);
    this.touch();
    return true;
  }

  /**
   * Remove a worksheet and return it (for undo). A workbook always keeps at
   * least one worksheet, so removing the last one is refused.
   */
  removeSheet(id: string): { sheet: Worksheet; index: number } | null {
    if (this.sheetList.length <= 1) {
      return null;
    }
    const index = this.sheetIndex(id);
    if (index < 0) {
      return null;
    }
    const [sheet] = this.sheetList.splice(index, 1);
    if (this.activeId === id) {
      // Activate the neighbour that takes the removed worksheet's place.
      this.activeId = this.sheetList[Math.min(index, this.sheetList.length - 1)].id;
    }
    this.touch();
    return { sheet, index };
  }

  /** Rename a worksheet. The identifier — and everything keyed by it — is untouched. */
  renameSheet(id: string, name: string): boolean {
    const sheet = this.sheetById(id);
    if (!sheet || sheet.name === name) {
      return false;
    }
    sheet.name = name;
    this.touch();
    return true;
  }

  /** Move a worksheet to a new position in the strip. */
  moveSheet(id: string, toIndex: number): boolean {
    const from = this.sheetIndex(id);
    if (from < 0) {
      return false;
    }
    const to = Math.max(0, Math.min(this.sheetList.length - 1, toIndex));
    if (from === to) {
      return false;
    }
    const [sheet] = this.sheetList.splice(from, 1);
    this.sheetList.splice(to, 0, sheet);
    this.touch();
    return true;
  }

  // ----- Compression / persistence settings -----

  /** The compression method the next save will write (`undefined` → codec default). */
  get compression(): number | undefined {
    return this.compressionMethod;
  }

  /**
   * Choose the compression method for the next save (from the RSF Save
   * dialog). Rewriting the container with a different method changes no logical
   * content, so this does not mark the document dirty on its own.
   */
  setCompression(method: number): void {
    this.compressionMethod = method;
  }

  /** The workbook's stored IANA timezone, read by `TODAY()`/`NOW()` (Sheet > Timezone…). */
  get timezone(): string {
    return this.timezoneId;
  }

  /**
   * Change the workbook's timezone and recompute every cached formula result
   * against it — the same invalidation {@link recalculate} does, since a
   * timezone change is exactly the kind of thing that moves what `TODAY()`
   * and `NOW()` report. An unresolvable zone name (or the current value) is a
   * no-op. Like {@link setCompression}, this changes no cell input, so it
   * does not mark the document dirty; the new value is written into the
   * container on the next save.
   */
  setTimezone(timeZone: string): void {
    if (timeZone === this.timezoneId || !isValidTimeZone(timeZone)) {
      return;
    }
    this.timezoneId = timeZone;
    this.recalculate();
  }

  /** The workbook's stored display language, read by `TEXT()`'s `ddd`/`dddd` tokens (Sheet > Display language…). */
  get displayLanguage(): DisplayLanguageId {
    return this.displayLanguageId;
  }

  /**
   * Change the workbook's display language and recompute every cached
   * formula result against it — the same invalidation {@link recalculate}
   * does, since a language change is exactly the kind of thing that moves
   * what `TEXT()`'s `ddd`/`dddd` tokens report. The current value is a no-op.
   * Like {@link setTimezone}, this changes no cell input, so it does not mark
   * the document dirty; the new value is written into the container on the
   * next save.
   */
  setDisplayLanguage(language: DisplayLanguageId): void {
    if (language === this.displayLanguageId) {
      return;
    }
    this.displayLanguageId = language;
    this.recalculate();
  }

  /**
   * Record the active worksheet's current view state to persist with the next
   * save (called by the save path with the tab's live zoom / column widths).
   * Presentational only — never marks the document dirty.
   */
  setDisplaySettings(zoom: number | undefined, colWidths: number[], wrap?: boolean): void {
    const sheet = this.activeSheet;
    sheet.displayZoom = zoom;
    sheet.displayColWidths = colWidths.slice();
    if (wrap !== undefined) {
      sheet.displayWrap = wrap;
    }
  }

  /** The active worksheet's persisted zoom (presentational). */
  get displayZoom(): number | undefined {
    return this.activeSheet.displayZoom;
  }

  set displayZoom(zoom: number | undefined) {
    this.activeSheet.displayZoom = zoom;
  }

  /** The active worksheet's persisted column widths (presentational). */
  get displayColWidths(): number[] {
    return this.activeSheet.displayColWidths;
  }

  set displayColWidths(widths: number[]) {
    this.activeSheet.displayColWidths = widths;
  }

  /**
   * The active worksheet's persisted "wrap long rows" state (presentational).
   * `undefined` means the file stores none, and the application-level
   * preference applies.
   */
  get displayWrap(): boolean | undefined {
    return this.activeSheet.displayWrap;
  }

  set displayWrap(wrap: boolean | undefined) {
    this.activeSheet.displayWrap = wrap;
  }

  /** Set a specific worksheet's persisted wrap state (undo/redo, cross-sheet). */
  setDisplayWrapOn(sheetId: string | undefined, wrap: boolean | undefined): void {
    const sheet = sheetId === undefined ? this.activeSheet : this.sheetById(sheetId);
    if (sheet) {
      sheet.displayWrap = wrap;
    }
  }

  // ----- Serialization -----

  /** Serialize the whole workbook to the versioned binary `.rsf` container. */
  toBytes(): Uint8Array {
    return this.toBytesFromSheetCells(this.sheetList.map((sheet) => sheet.collectCells()));
  }

  /**
   * Append row `r`'s non-empty cells to `cells` for the active worksheet.
   * Splitting the collection per row lets the save path run it in cooperative
   * time slices (with progress) for large sheets.
   */
  collectRowCells(r: number, cells: Array<[number, number, string]>): void {
    this.activeSheet.collectRowCells(r, cells);
  }

  /**
   * Encode a prepared sparse cell list for a single-worksheet workbook.
   * Retained for the sliced save path of one-worksheet documents; workbooks
   * with several worksheets use {@link toBytesFromSheetCells}.
   */
  toBytesFromCells(cells: Array<[number, number, string]>): Uint8Array {
    if (this.sheetList.length === 1) {
      return this.toBytesFromSheetCells([cells]);
    }
    const perSheet = this.sheetList.map((sheet) =>
      sheet.id === this.activeSheetId ? cells : sheet.collectCells(),
    );
    return this.toBytesFromSheetCells(perSheet);
  }

  /** Total rows across every worksheet (the unit of the sliced save scan). */
  get totalRows(): number {
    let total = 0;
    for (const sheet of this.sheetList) {
      total += sheet.rowCount;
    }
    return total;
  }

  /**
   * Map a flat row index (0 … {@link totalRows} - 1) onto the worksheet that
   * owns it and append that row's non-empty cells to `perSheet[sheetIndex]`.
   * This lets the save path scan a whole workbook in cooperative time slices
   * with one honest progress percentage.
   */
  /**
   * Map a flat row index (0 … {@link totalRows} - 1) onto the worksheet that
   * owns it and its row within that worksheet, or null when out of range.
   * Lets a workbook-wide scan run as one time-sliced loop with one honest
   * progress percentage, without materializing a plan array per row.
   */
  locateFlatRow(flatIndex: number): { sheet: Worksheet; row: number } | null {
    let remaining = flatIndex;
    for (const sheet of this.sheetList) {
      if (remaining < sheet.rowCount) {
        return { sheet, row: remaining };
      }
      remaining -= sheet.rowCount;
    }
    return null;
  }

  collectFlatRow(flatIndex: number, perSheet: Array<Array<[number, number, string]>>): void {
    let remaining = flatIndex;
    for (let s = 0; s < this.sheetList.length; s++) {
      const sheet = this.sheetList[s];
      if (remaining < sheet.rowCount) {
        sheet.collectRowCells(remaining, perSheet[s]);
        return;
      }
      remaining -= sheet.rowCount;
    }
  }

  /** Encode the workbook from per-worksheet prepared cell lists (compresses). */
  toBytesFromSheetCells(perSheet: Array<Array<[number, number, string]>>): Uint8Array {
    this.updatedAt = Date.now();
    const sheets: RsfWorksheetData[] = this.sheetList.map((sheet, index) => {
      const colWidths: Array<[number, number]> = [];
      for (let c = 0; c < sheet.displayColWidths.length && c < sheet.columnCount; c++) {
        const w = sheet.displayColWidths[c];
        if (w && w > 0) {
          colWidths.push([c, w]);
        }
      }
      const entry: RsfWorksheetData = {
        id: sheet.id,
        name: sheet.name,
        rowCount: sheet.rowCount,
        columnCount: sheet.columnCount,
        cells: perSheet[index] ?? sheet.collectCells(),
      };
      if (sheet.displayZoom !== undefined || colWidths.length > 0 || sheet.displayWrap === true) {
        entry.display = {
          ...(sheet.displayZoom !== undefined ? { zoom: sheet.displayZoom } : {}),
          ...(colWidths.length > 0 ? { colWidths } : {}),
          ...(sheet.displayWrap === true ? { wrap: true } : {}),
        };
      }
      if (sheet.filter !== null) {
        entry.filter = sheet.filter;
      }
      return entry;
    });
    const payload: RsfWorkbookData = {
      delimiter: this.delimiter,
      // Record the creating/updating application (single source of truth).
      appName: APP_NAME,
      appVersion: APP_VERSION,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      docId: this.docId,
      activeSheetId: this.activeSheetId,
      timezone: this.timezoneId,
      displayLanguage: this.displayLanguageId,
      sheets,
    };
    return encodeRsfWorkbook(payload, this.compressionMethod);
  }

  // ----- Common document surface (shared with LosslessDocument) -----

  get rowCount(): number {
    return this.activeSheet.rowCount;
  }

  get columnCount(): number {
    return this.activeSheet.columnCount;
  }

  fieldCount(row: number): number {
    return this.activeSheet.fieldCount(row);
  }

  /** The raw input of a cell on the active worksheet (formula source for formula cells). */
  getValue(row: number, col: number): string {
    return this.activeSheet.getValue(row, col);
  }

  /** The computed display value (formula results, error codes, or the literal). */
  getDisplayValue(row: number, col: number): string {
    return formatValue(this.evaluateCell(row, col));
  }

  /** The computed display value of a cell on a specific worksheet. */
  getSheetDisplayValue(sheetId: string, row: number, col: number): string {
    const sheet = this.sheetById(sheetId);
    return sheet ? formatValue(this.evaluateInSheet(sheet, row, col)) : '';
  }

  isFormulaCell(row: number, col: number): boolean {
    return this.activeSheet.isFormulaCell(row, col);
  }

  /** Count of formula cells on the active worksheet. */
  countFormulaCells(): number {
    return this.activeSheet.countFormulaCells();
  }

  /** Count of formula cells across every worksheet. */
  countWorkbookFormulaCells(): number {
    let total = 0;
    for (const sheet of this.sheetList) {
      total += sheet.countFormulaCells();
    }
    return total;
  }

  /** Formula cells of the active worksheet as [row, col, source]. */
  listFormulaCells(): Array<{ row: number; col: number; src: string }> {
    return this.activeSheet.listFormulaCells();
  }

  get isDirty(): boolean {
    return this.revision !== this.savedRevision;
  }

  markSaved(): void {
    this.savedRevision = this.revision;
  }

  /**
   * Mark the workbook as never-saved, so {@link isDirty} is true until the
   * first successful save. Used for File > New and for a fresh in-memory
   * CSV→RSF conversion, neither of which yet exists on disk.
   */
  markUnsaved(): void {
    // A sentinel that no real revision equals keeps the document dirty.
    this.savedRevision = -1;
  }

  /** RSF documents have no byte-level baseline; nothing is "edited vs original". */
  isEdited(_row: number, _col: number): boolean {
    return false;
  }

  // ----- Filter state -----

  /** The active worksheet's filter. */
  get filter(): SheetFilter | null {
    return this.activeSheet.filter;
  }

  /** True when any loaded worksheet dropped an invalid stored filter. */
  get filterDropped(): boolean {
    return this.sheetList.some((sheet) => sheet.filterDropped);
  }

  /**
   * Set a worksheet's filter state (called by the history layer, so applying
   * and clearing filters are ordinary undoable operations). Cell data, formula
   * results, and the evaluation cache are untouched — a filter only hides rows
   * visually — but the workbook is marked as having unsaved changes because the
   * filter is persisted in the saved container.
   */
  setFilterStateOn(sheetId: string | undefined, filter: SheetFilter | null): void {
    const sheet = this.resolveSheet(sheetId);
    if (sheet.filter === filter) {
      return;
    }
    sheet.filter = filter;
    // Bump the revision without invalidating the memo: no cell value can have
    // changed, so recalculation would be pure waste.
    this.revision += 1;
  }

  setFilterState(filter: SheetFilter | null): void {
    this.setFilterStateOn(undefined, filter);
  }

  // ----- Mutators (called through the atomic operation layer) -----

  private resolveSheet(sheetId: string | undefined): Worksheet {
    return (sheetId !== undefined ? this.sheetById(sheetId) : null) ?? this.activeSheet;
  }

  setCellOn(sheetId: string | undefined, row: number, col: number, input: string): void {
    if (this.resolveSheet(sheetId).setCell(row, col, input)) {
      this.touch();
    }
  }

  setCell(row: number, col: number, input: string): void {
    this.setCellOn(undefined, row, col, input);
  }

  insertRowsOn(sheetId: string | undefined, index: number, rows: string[][]): void {
    this.resolveSheet(sheetId).insertRows(index, rows);
    this.touch();
  }

  insertRows(index: number, rows: string[][]): void {
    this.insertRowsOn(undefined, index, rows);
  }

  deleteRowsOn(sheetId: string | undefined, index: number, count: number): string[][] {
    const removed = this.resolveSheet(sheetId).deleteRows(index, count);
    this.touch();
    return removed;
  }

  deleteRows(index: number, count: number): string[][] {
    return this.deleteRowsOn(undefined, index, count);
  }

  insertColsOn(sheetId: string | undefined, index: number, colsData: string[][]): void {
    this.resolveSheet(sheetId).insertCols(index, colsData);
    this.touch();
  }

  insertCols(index: number, colsData: string[][]): void {
    this.insertColsOn(undefined, index, colsData);
  }

  deleteColsOn(sheetId: string | undefined, index: number, count: number): string[][] {
    const removed = this.resolveSheet(sheetId).deleteCols(index, count);
    this.touch();
    return removed;
  }

  deleteCols(index: number, count: number): string[][] {
    return this.deleteColsOn(undefined, index, count);
  }

  /** Grow the active worksheet to at least the given size (used by paste expansion). */
  ensureSize(rows: number, cols: number): void {
    if (this.activeSheet.ensureSize(rows, cols)) {
      this.touch();
    }
  }

  // ----- Evaluation -----

  /**
   * Evaluate a cell on the active worksheet. Formula results are memoized
   * until the next mutation; circular references — including ones that travel
   * through another worksheet — resolve to #CYCLE! instead of recursing
   * forever.
   */
  evaluateCell(row: number, col: number): FormulaValue {
    return this.evaluateInSheet(this.activeSheet, row, col);
  }

  /** Evaluate a cell on a specific worksheet of this workbook. */
  evaluateInSheet(sheet: Worksheet, row: number, col: number): FormulaValue {
    if (!sheet.contains(row, col)) {
      // References outside the worksheet behave like empty cells.
      return { type: 'empty' };
    }
    const input = sheet.getValue(row, col);
    if (!isFormula(input)) {
      if (input === '') {
        // An empty cell may be carrying a dynamic array's derived value.
        const spill = this.spillFor(sheet);
        if (spill.derived.size > 0) {
          const anchorKey = spill.derived.get(cellKey(row, col));
          if (anchorKey !== undefined) {
            const anchor = spill.anchors.get(anchorKey);
            if (anchor) {
              return anchor.grid.cells[row - anchor.row][col - anchor.col];
            }
          }
        }
      }
      return literalToValue(input);
    }
    // A formula that produced an array reads its result from the spill map,
    // which already holds it: re-evaluating here could disagree with what the
    // derived cells show.
    const spill = this.spillFor(sheet);
    if (!isEmptySpillMap(spill)) {
      const key = cellKey(row, col);
      if (spill.blocked.has(key)) {
        return errorValue('#SPILL!');
      }
      const anchor = spill.anchors.get(key);
      if (anchor) {
        return anchor.grid.cells[0][0];
      }
    }
    const key = `${sheet.id}|${row},${col}`;
    const cached = this.memo.get(key);
    if (cached) {
      return cached;
    }
    if (this.inProgress.has(key)) {
      return errorValue('#CYCLE!');
    }
    const compiled = sheet.compiled(row, col, input);
    let result: FormulaValue;
    if (!compiled.parsed.ok) {
      result = errorValue(compiled.parsed.code);
    } else {
      this.inProgress.add(key);
      try {
        result = evaluateAst(compiled.parsed.ast, this.contextFor(sheet));
      } finally {
        this.inProgress.delete(key);
      }
    }
    this.memo.set(key, result);
    return result;
  }

  /**
   * The evaluation context for one worksheet: unqualified references resolve
   * against it, and worksheet-qualified references resolve by name through the
   * workbook — sharing this workbook's memo and in-progress set, which is what
   * makes cross-worksheet cycles detectable.
   */
  private contextFor(sheet: Worksheet): EvalContext {
    const existing = this.evalContexts.get(sheet.id);
    if (existing) {
      return existing;
    }
    const ctx: EvalContext = {
      getCell: (r, c) => this.evaluateInSheet(sheet, r, c),
      rowCount: sheet.rowCount,
      columnCount: sheet.columnCount,
      getSheetCell: (name, r, c) => {
        const target = this.sheetByName(name);
        return target ? this.evaluateInSheet(target, r, c) : errorValue('#REF!');
      },
      getSheetBounds: (name) => {
        const target = this.sheetByName(name);
        return target ? { rowCount: target.rowCount, columnCount: target.columnCount } : null;
      },
      // Shifted by the workbook's own timezone offset (0 for UTC) before it
      // ever reaches formula-date.ts, which does pure UTC math on whatever
      // instant it is handed — see that module's "Timezone policy".
      nowMs: this.clockMs + timeZoneOffsetMs(this.clockMs, this.timezoneId),
      displayLanguage: this.displayLanguageId,
    };
    this.evalContexts.set(sheet.id, ctx);
    return ctx;
  }

  // ----- Dynamic arrays (spill) -----

  /**
   * The spill map of a worksheet, built on first use after a mutation.
   *
   * While a build is in progress this returns the empty map, which implements
   * the documented rule that a dynamic-array formula reads other spills'
   * derived cells as blank — and, more importantly, is what stops the build
   * from re-entering itself.
   */
  private spillFor(sheet: Worksheet): SpillMap {
    if (this.buildingSpill) {
      return EMPTY_SPILL_MAP;
    }
    if (!this.spillMaps) {
      this.buildSpillMaps();
    }
    return this.spillMaps?.get(sheet.id) ?? EMPTY_SPILL_MAP;
  }

  /**
   * Evaluate every array formula in the workbook and place the results.
   *
   * Anchors are evaluated first, all of them, and only then placed, so the
   * outcome cannot depend on the order two spills happen to appear in.
   * Afterwards the memo is dropped: entries computed during the build saw no
   * spill map, and every ordinary formula must see the finished one.
   */
  private buildSpillMaps(): void {
    this.buildingSpill = true;
    const maps = new Map<string, SpillMap>();
    try {
      for (const sheet of this.sheetList) {
        maps.set(
          sheet.id,
          buildSpillMap({
            rowCount: sheet.rowCount,
            columnCount: sheet.columnCount,
            getValue: (r, c) => sheet.getValue(r, c),
            listArrayResults: () => this.evaluateArrayFormulas(sheet),
          }),
        );
      }
    } finally {
      this.buildingSpill = false;
    }
    this.memo = new Map();
    this.spillMaps = maps;
  }

  /**
   * The array results of one worksheet's formulas, in row-major order.
   *
   * {@link canSpill} rejects any formula that cannot possibly return an array
   * before it is evaluated, so a worksheet of ordinary formulas costs one
   * cheap AST walk each and no evaluation at all.
   */
  private evaluateArrayFormulas(
    sheet: Worksheet,
  ): Array<{ row: number; col: number; grid: ValueGrid | null }> {
    const out: Array<{ row: number; col: number; grid: ValueGrid | null }> = [];
    for (const { row, col, src } of sheet.listFormulaCells()) {
      const compiled = sheet.compiled(row, col, src);
      if (!compiled.parsed.ok || !canSpill(compiled.parsed.ast)) {
        continue;
      }
      // The same in-progress guard ordinary evaluation uses, so a self-
      // referential array formula resolves to #CYCLE! instead of recursing.
      const key = `${sheet.id}|${row},${col}`;
      if (this.inProgress.has(key)) {
        continue;
      }
      this.inProgress.add(key);
      try {
        const { grid } = evaluateAstArray(compiled.parsed.ast, this.contextFor(sheet));
        out.push({ row, col, grid });
      } finally {
        this.inProgress.delete(key);
      }
    }
    return out;
  }

  /** The spill anchor covering a cell, whether the cell is the anchor or derived. */
  spillAnchorAt(sheetId: string | undefined, row: number, col: number): SpillAnchor | null {
    const sheet = this.resolveSheet(sheetId);
    const spill = this.spillFor(sheet);
    const key = cellKey(row, col);
    const direct = spill.anchors.get(key);
    if (direct) {
      return direct;
    }
    const anchorKey = spill.derived.get(key);
    return anchorKey === undefined ? null : (spill.anchors.get(anchorKey) ?? null);
  }

  /**
   * True when a cell holds a *derived* dynamic-array value — part of a spill
   * but not its anchor. Writing to such a cell is refused by the command
   * layer; the anchor is what the user edits or clears.
   */
  isSpillDerivedCell(sheetId: string | undefined, row: number, col: number): boolean {
    const sheet = this.resolveSheet(sheetId);
    return this.spillFor(sheet).derived.has(cellKey(row, col));
  }

  /** True when the worksheet has any dynamic array at all (placed or blocked). */
  hasSpills(sheetId?: string): boolean {
    return !isEmptySpillMap(this.spillFor(this.resolveSheet(sheetId)));
  }

  /**
   * Recompute everything, advancing the clock the volatile functions read.
   *
   * This is the *explicit* recalculation path (Data > Recalculate). Because no
   * timer exists, it is the only way a `TODAY()` in an untouched workbook
   * changes without an edit.
   */
  recalculate(): void {
    this.clockMs = Date.now();
    this.memo = new Map();
    this.evalContexts = new Map();
    this.spillMaps = null;
  }

  /**
   * Export the active worksheet's computed values as CSV text (lossy: formulas
   * become their calculated values; spreadsheet metadata, the other worksheets,
   * and the original byte layout are not preserved).
   */
  exportCsv(delimiter: DelimiterId = this.delimiter): string {
    return this.exportSheetCsv(this.activeSheetId, delimiter);
  }

  /**
   * Export one worksheet's computed values as CSV text. CSV holds exactly one
   * worksheet, so a multi-worksheet workbook must name the worksheet to export
   * (the command layer requires an explicit choice). Fields are quoted only
   * when needed; LF terminators.
   */
  exportSheetCsv(sheetId: string, delimiter: DelimiterId = this.delimiter): string {
    const sheet = this.sheetById(sheetId);
    if (!sheet) {
      return '';
    }
    const lines: string[] = [];
    for (let r = 0; r < sheet.rowCount; r++) {
      const parts: string[] = [];
      for (let c = 0; c < sheet.columnCount; c++) {
        let text = formatValue(this.evaluateInSheet(sheet, r, c));
        if (text.includes(delimiter) || text.includes('"') || text.includes('\r') || text.includes('\n')) {
          text = `"${text.replace(/"/g, '""')}"`;
        }
        parts.push(text);
      }
      lines.push(parts.join(delimiter));
    }
    return lines.join('\n') + '\n';
  }

  /**
   * Record a mutation: bump the revision and drop every cached evaluation.
   * The whole workbook memo is cleared because a worksheet-qualified reference
   * means a change in one worksheet can invalidate a formula in another.
   */
  private touch(): void {
    this.revision += 1;
    this.memo = new Map();
    this.evalContexts = new Map();
    this.nameIndex = null;
    // Dropped, not rebuilt: the next evaluation rebuilds it lazily, so a burst
    // of edits costs one spill rebuild rather than one per edit.
    this.spillMaps = null;
    // A mutation is a recalculation event, so volatile functions advance here.
    this.clockMs = Date.now();
  }
}
