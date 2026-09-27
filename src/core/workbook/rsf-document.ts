// SPDX-License-Identifier: MIT
import type { DelimiterId } from '../csv/byte-csv-parser';
import type { LosslessDocument } from '../csv/lossless-document';
import { formatValue, isValidSheetName, sheetNameKey } from '../formula';
import { APP_NAME, APP_VERSION } from '../app-identity';
import { isEmptyGridLook, type GridLookLayer } from '../grid-look';
import { DEFAULT_DISPLAY_LANGUAGE, isValidDisplayLanguage, type DisplayLanguageId } from './display-language';
import {
  decodeRsfHistorySnapshot,
  decodeRsfWorkbook,
  encodeRsfWorkbook,
  type RsfDecodeError,
  type RsfHistorySnapshot,
  type RsfWorkbookData,
} from './rsf-codec';
import { DEFAULT_SHEET_NAME, MAX_WORKSHEETS } from './sheet-registry';
import { DEFAULT_TIMEZONE, isValidTimeZone, localTimeZone } from './timezone';
import { VersionHistory } from './version-history';
import { Workbook } from './workbook';
import { Worksheet } from './worksheet';
import { valuesToCsvText, worksheetFromData, worksheetToData } from './worksheet-data';

export { MAX_WORKSHEETS } from './sheet-registry';

/**
 * Refrain Sheet Format (`.rsf`): a documented, versioned, binary container for
 * spreadsheet **workbooks**. A workbook holds one or more worksheets, each with
 * its own grid, formulas, row/column structure, filter, and display settings.
 * CSV cannot store formulas, multiple worksheets, or structural editing intent
 * without breaking the original-file preservation guarantee, so spreadsheet
 * documents are saved as `.rsf` instead.
 *
 * The file is a JSON document compressed with Zstandard, defined in
 * `rsf-codec.ts` and documented in `knowledge/formats/rsf/index.md`. It holds
 * pure data — no executable code, macros, external references, or network
 * URLs — and parsing is strict (identifier, version, checksum, shape, and
 * bounds are validated) and never executes anything. Files in the binary
 * format earlier releases wrote (`.rsf` before this format, and `.rcsv`) are
 * no longer read; they are rejected with a clear message.
 */
export const RSF_EXTENSION = '.rsf';
/** The extension earlier releases used; such files are recognized only to explain they no longer open. */
export const RSF_LEGACY_EXTENSION = '.rcsv';

/**
 * Default dimensions of a blank spreadsheet created by File > New: a small
 * but usable grid (documented in the README). The virtualized grid keeps this
 * cheap, and rows/columns can be inserted or deleted afterwards.
 */
export const NEW_DOC_ROWS = 100;
export const NEW_DOC_COLS = 26;

/** Failure reasons when loading a `.rsf` file (see `rsf-codec.ts`). */
export type RsfParseError = RsfDecodeError;

export type RsfLoadResult = { ok: true; doc: RsfDocument } | { ok: false; error: RsfParseError };

/**
 * A workbook as a saved `.rsf` file: the {@link Workbook} plus its file
 * identity (name, `docId`, timestamps), the CSV-export delimiter, version
 * history, per-file settings, and (de)serialization. Unlike LosslessDocument
 * there is no byte-level baseline: the cell inputs are the document.
 */
export class RsfDocument extends Workbook {
  readonly kind = 'rsf' as const;
  /** Workbook (file) name. */
  name: string;
  /** Delimiter used as the default for CSV export (workbook-level). */
  delimiter: DelimiterId;

  /** Stable workbook identifier, preserved across saves. */
  readonly docId: string;
  /** Creation / last-update timestamps (ms since epoch). */
  createdAt: number;
  updatedAt: number;

  /**
   * Version history (Sheet ▸ File Version History…): whether it is recorded,
   * the retained snapshots, and the per-file cap. Persisted in the container.
   */
  private versions = new VersionHistory();

  /**
   * Whether the JSON/YAML worksheet editors auto-format their source on
   * commit for this file (the auto-format checkbox in their toolbars), a
   * per-file setting defaulting to `false`. Never automatic unless
   * explicitly turned on — see issue #529's "never automatic" decision,
   * which is about the default, not a ban on ever offering it. See
   * {@link setAutoFormatSource}.
   */
  private autoFormatSourceFlag = false;

  /**
   * File-level display settings: when set, they apply to every worksheet that
   * does not set its own `displayZoom` / `displayWrap` (the worksheet wins, see
   * `settings-cascade.ts`); `undefined` means the file specifies none.
   * Presentational like the worksheet's: persisted with the next save, never
   * marks the document dirty, and kept (not reverted) by a history restore.
   */
  fileZoom: number | undefined;
  fileWrap: boolean | undefined;
  /** File-level spreadsheet font id; the worksheet's own wins, like zoom and wrap. */
  fileFont: string | undefined;
  /** File-level grid look (bands, gridlines, highlights); the worksheet's own keys win. */
  fileLook: GridLookLayer = {};

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
    super(sheets, timezone, displayLanguage);
    this.name = name;
    this.delimiter = delimiter;
    this.docId = docId ?? `wb-${Math.random().toString(36).slice(2, 10)}`;
    const now = Date.now();
    this.createdAt = now;
    this.updatedAt = now;
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
    return RsfDocument.fromValues(name, doc.delimiter, rows, columnCount, sheetName, displayLanguage);
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

  /**
   * Create a multi-worksheet workbook from prebuilt per-sheet row-major
   * values, one worksheet per input sheet, in order. Used by `.xlsx` import,
   * where a workbook natively holds several sheets (unlike CSV, which
   * {@link fromValues} builds as a single sheet). Names are sanitized and
   * de-duplicated exactly like {@link uniqueSheetName}, since an untrusted
   * `.xlsx` file could carry invalid or duplicate sheet names.
   */
  static fromSheetValues(
    name: string,
    sheets: { name: string; rows: string[][]; columnCount: number }[],
    displayLanguage: DisplayLanguageId = DEFAULT_DISPLAY_LANGUAGE,
  ): RsfDocument {
    const taken = new Set<string>();
    const worksheets = sheets.slice(0, MAX_WORKSHEETS).map((sheet, i) => {
      const base = isValidSheetName(sheet.name) ? sheet.name.trim() : `Sheet${i + 1}`;
      let candidate = base;
      for (let n = 2; taken.has(sheetNameKey(candidate)); n++) {
        candidate = `${base} (${n})`;
      }
      taken.add(sheetNameKey(candidate));
      return Worksheet.fromValues(`s${i + 1}`, candidate, sheet.rows, sheet.columnCount);
    });
    return new RsfDocument(name, ',', worksheets, undefined, localTimeZone(), displayLanguage);
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

  /** Parse and strictly validate `.rsf` bytes. Never executes anything. */
  static fromBytes(bytes: Uint8Array, name: string): RsfLoadResult {
    const decoded = decodeRsfWorkbook(bytes);
    if (!decoded.ok) {
      return { ok: false, error: decoded.error };
    }
    return { ok: true, doc: RsfDocument.fromWorkbookData(decoded.data, name) };
  }

  /**
   * Materialize a document from already-decoded workbook data — the tail of
   * `fromBytes` (everything after `decodeRsfWorkbook` succeeds), extracted so
   * a second caller can build a document from data that didn't come from a
   * file's own bytes. Used by the version-history preview
   * (`src/ui/dialogs/version-preview.ts`), which decodes a retained snapshot
   * via `decodeRsfHistorySnapshot` rather than opening a file.
   */
  static fromWorkbookData(data: RsfWorkbookData, name: string): RsfDocument {
    const sheets = data.sheets.map(worksheetFromData);
    const timezone =
      data.timezone !== undefined && isValidTimeZone(data.timezone) ? data.timezone : DEFAULT_TIMEZONE;
    const displayLanguage =
      data.displayLanguage !== undefined && isValidDisplayLanguage(data.displayLanguage)
        ? data.displayLanguage
        : DEFAULT_DISPLAY_LANGUAGE;
    const doc = new RsfDocument(name, data.delimiter, sheets, data.docId, timezone, displayLanguage);
    doc.versions = new VersionHistory(
      data.historyEnabled ?? true,
      data.history ?? [],
      data.historyMaxOverride,
    );
    doc.autoFormatSourceFlag = data.autoFormatSource ?? false;
    doc.fileZoom = data.display?.zoom;
    doc.fileWrap = data.display?.wrap;
    doc.fileFont = data.display?.font;
    doc.fileLook = { ...data.display?.look };
    if (data.createdAt !== undefined) {
      doc.createdAt = data.createdAt;
    }
    if (data.updatedAt !== undefined) {
      doc.updatedAt = data.updatedAt;
    }
    doc.registry.replaceAll(sheets, data.activeSheetId);
    return doc;
  }

  // ----- Persistence settings -----
  //
  // Version history (Sheet ▸ File Version History…) is documented on
  // `VersionHistory`. Every setting here is persisted in the saved container
  // but changes no cell input, so a change marks the document dirty without
  // invalidating the evaluation memo.

  /** Whether version history is recorded for this document (default `true`). */
  get historyEnabled(): boolean {
    return this.versions.enabled;
  }

  /**
   * This document's past snapshots (oldest first). Each entry's `bytes` are
   * opaque to callers: restore content with {@link restoreFromSnapshot}.
   */
  get history(): readonly RsfHistorySnapshot[] {
    return this.versions.list;
  }

  /** Turn recording on or off; existing snapshots are kept (see {@link clearHistory}). */
  setHistoryEnabled(enabled: boolean): void {
    this.bumpIf(this.versions.setEnabled(enabled));
  }

  /** Discard every recorded snapshot (the "Clear History" action). */
  clearHistory(): void {
    this.bumpIf(this.versions.clear());
  }

  /** The per-file cap override: `undefined` = default, `null` = unlimited, or a number. */
  get historyMaxOverride(): number | null | undefined {
    return this.versions.maxOverride;
  }

  /** The retained-snapshot cap the next save enforces (`null` = unlimited). */
  get effectiveHistoryMax(): number | null {
    return this.versions.effectiveMax;
  }

  /**
   * True when the next successful save will drop the oldest snapshot — the
   * trigger for the pre-save confirmation (see `FileIoCommands.encodeRsfBytes`).
   */
  get willDropOldestOnNextSave(): boolean {
    return this.versions.willDropOldestOnNextSave;
  }

  /** Change the cap override (a number is clamped into `[1, MAX_RSF_HISTORY_SNAPSHOTS]`). */
  setHistoryMaxOverride(value: number | null | undefined): void {
    this.bumpIf(this.versions.setMaxOverride(value));
  }

  /**
   * Whether the JSON/YAML worksheet editors auto-format their source on
   * commit for this file, a per-file setting defaulting to `false`. See
   * {@link setAutoFormatSource}.
   */
  get autoFormatSource(): boolean {
    return this.autoFormatSourceFlag;
  }

  /**
   * Turn auto-format-on-commit on or off for this file's JSON/YAML worksheet
   * editors. Like {@link setHistoryEnabled}, this is persisted in the saved
   * container but changes no cell input, so it marks the document dirty
   * without invalidating the evaluation memo.
   */
  setAutoFormatSource(enabled: boolean): void {
    if (this.bumpIf(enabled !== this.autoFormatSourceFlag)) {
      this.autoFormatSourceFlag = enabled;
    }
  }

  /**
   * Replace this workbook's structural and cell content with a past snapshot
   * (Sheet ▸ File Version History…'s "Restore" action). This file's own
   * settings — history retention (enabled state, cap override),
   * auto-format-on-commit, file-level display settings and `docId` — are kept as
   * they are now, not reverted to what they were at snapshot time; only
   * content (worksheets, cells, styles, comments, filters, locks, delimiter,
   * timezone, display language) is replaced.
   *
   * Not wired into the undo/redo stack: like reopening a file with different
   * encoding options, this is a deliberate, explicitly confirmed revert
   * rather than an editing operation, and the caller clears the tab's
   * undo/redo history (see `Commands`'s `sheet.versionHistory` handling)
   * since its entries describe edits to content this call just replaced.
   * Returns false without changing anything when `index` is out of range or
   * the snapshot's bytes fail to decode.
   */
  restoreFromSnapshot(index: number): boolean {
    const snapshot = this.versions.list[index];
    if (!snapshot) {
      return false;
    }
    const decoded = decodeRsfHistorySnapshot(snapshot);
    if (!decoded.ok) {
      return false;
    }
    const data = decoded.data;
    const sheets = data.sheets.map(worksheetFromData);
    if (sheets.length === 0) {
      return false;
    }
    this.registry.replaceAll(sheets, data.activeSheetId);
    this.delimiter = data.delimiter;
    if (data.timezone !== undefined && isValidTimeZone(data.timezone)) {
      this.timezoneId = data.timezone;
    }
    if (data.displayLanguage !== undefined && isValidDisplayLanguage(data.displayLanguage)) {
      this.displayLanguageId = data.displayLanguage;
    }
    this.touch();
    return true;
  }

  // ----- Serialization -----

  /** Serialize the whole workbook to a `.rsf` file (Zstandard-compressed JSON). */
  toBytes(): Uint8Array {
    return this.toBytesFromSheetCells(this.sheets.map((sheet) => sheet.collectCells()));
  }

  /**
   * Append row `r`'s non-empty cells to `cells` for the active worksheet.
   * Splitting the collection per row lets the save path run it in cooperative
   * time slices (with progress) for large sheets.
   */
  collectRowCells(r: number, cells: Array<[number, number, string]>): void {
    this.activeSheet.collectRowCells(r, cells);
  }

  /** Total rows across every worksheet (the unit of the sliced save scan). */
  get totalRows(): number {
    let total = 0;
    for (const sheet of this.sheets) {
      total += sheet.rowCount;
    }
    return total;
  }

  /**
   * Map a flat row index (0 … {@link totalRows} - 1) onto the worksheet that
   * owns it and its row within that worksheet, or null when out of range.
   * Lets a workbook-wide scan run as one time-sliced loop with one honest
   * progress percentage, without materializing a plan array per row.
   */
  locateFlatRow(flatIndex: number): { sheet: Worksheet; row: number } | null {
    let remaining = flatIndex;
    for (const sheet of this.sheets) {
      if (remaining < sheet.rowCount) {
        return { sheet, row: remaining };
      }
      remaining -= sheet.rowCount;
    }
    return null;
  }

  /**
   * Append the non-empty cells of flat row `flatIndex` (see {@link locateFlatRow})
   * to `perSheet[sheetIndex]`, so the save path can scan a whole workbook in
   * cooperative time slices with one honest progress percentage.
   */
  collectFlatRow(flatIndex: number, perSheet: Array<Array<[number, number, string]>>): void {
    let remaining = flatIndex;
    for (let s = 0; s < this.sheets.length; s++) {
      const sheet = this.sheets[s];
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
    const sheets = this.sheets.map((sheet, index) =>
      worksheetToData(sheet, perSheet[index] ?? sheet.collectCells()),
    );
    const content: RsfWorkbookData = {
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
    // Version history: while enabled, every successful save appends one
    // snapshot of exactly the content being saved (see `VersionHistory.record`).
    this.versions.record(content, this.updatedAt);
    const payload: RsfWorkbookData = {
      ...content,
      historyEnabled: this.versions.enabled,
      history: [...this.versions.list],
      historyMaxOverride: this.versions.maxOverride,
      autoFormatSource: this.autoFormatSourceFlag,
    };
    if (
      this.fileZoom !== undefined ||
      this.fileWrap !== undefined ||
      this.fileFont !== undefined ||
      !isEmptyGridLook(this.fileLook)
    ) {
      payload.display = {
        ...(this.fileZoom !== undefined ? { zoom: this.fileZoom } : {}),
        ...(this.fileWrap !== undefined ? { wrap: this.fileWrap } : {}),
        ...(this.fileFont !== undefined ? { font: this.fileFont } : {}),
        ...(!isEmptyGridLook(this.fileLook) ? { look: { ...this.fileLook } } : {}),
      };
    }
    return encodeRsfWorkbook(payload);
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
    return valuesToCsvText(sheet.rowCount, sheet.columnCount, delimiter, (r, c) =>
      formatValue(this.evaluateInSheet(sheet, r, c)),
    );
  }
}
