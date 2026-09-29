// SPDX-License-Identifier: MIT
import { formatValue, type FormulaValue } from '../formula';
import type { SpillAnchor } from '../formula/spill';
import { formatCellNumber } from './cell-number-format';
import type { CellStyle } from './cell-style';
import type { CellConditionalFormat, ConditionalFormatStyle } from './conditional-format';
import { validationListsEqual, type CellValidation } from './data-validation';
import { objectListsEqual, type SheetObject } from './sheet-objects';
import { ImageStore } from './sheet-images';
import { followCharts } from './sheet-charts';
import { DEFAULT_DISPLAY_LANGUAGE, type DisplayLanguageId } from './display-language';
import type { SheetFilter } from './filter';
import { RecalcEngine } from './recalc-engine';
import type { SheetFolder, SheetOrganization } from './sheet-folders';
import { SheetRegistry } from './sheet-registry';
import type { SheetSort } from './sort';
import { isValidTimeZone, localTimeZone } from './timezone';
import { Worksheet } from './worksheet';

/**
 * A spreadsheet workbook in memory: its worksheets, their cells and cell-level
 * annotations, and the evaluation of their formulas. `RsfDocument` extends it
 * with everything that belongs to the saved `.rsf` file.
 *
 * The workbook owns evaluation, because a formula may reference another
 * worksheet (`Sheet1!A1`): the memo and the in-progress set are workbook-wide
 * (see `RecalcEngine`), which is what makes results consistent across
 * worksheets and circular references detectable *across* worksheet
 * boundaries. Any mutation, in any worksheet, invalidates the whole memo —
 * cross-sheet dependencies mean a change anywhere can affect a formula
 * anywhere, so results are recomputed lazily on next access.
 *
 * The single-worksheet editing surface (`rowCount`, `getValue`, `setCell`, …)
 * delegates to the **active** worksheet, so every existing UI, command, and
 * history path operates on the active worksheet without knowing about
 * workbooks. Operations that must target a specific worksheet — undo/redo of an
 * edit made on another sheet, cross-sheet formula rewrites — use the explicit
 * `…On(sheetId, …)` forms.
 */
export class Workbook {
  /** The worksheets, the active one, and name lookup. */
  protected readonly registry: SheetRegistry;

  protected revision = 0;
  private savedRevision = 0;

  /**
   * The workbook's IANA timezone (workbook-level, like {@link delimiter}),
   * read by `TODAY()` and `NOW()`. A new workbook defaults to the browser's
   * local timezone; a loaded workbook uses its stored value, or `"UTC"` when
   * none is stored (every file saved before this setting existed), which is
   * the exact behavior those files already had. Change it with
   * {@link setTimezone}, not by writing this field directly, so volatile
   * functions recalculate.
   */
  protected timezoneId: string;

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
  protected displayLanguageId: DisplayLanguageId;

  /**
   * Formula evaluation, the workbook-wide memo, spill placement, the
   * volatile-function clock, and conditional-format statistics. Every
   * mutation invalidates all of it (see {@link touch}).
   */
  private readonly engine = new RecalcEngine(this);

  /**
   * `timezone` defaults to the browser's local zone, which is what every
   * *new* workbook should get; a loaded file passes its stored value (see
   * `RsfDocument`).
   */
  protected constructor(
    sheets: Worksheet[],
    timezone: string = localTimeZone(),
    displayLanguage: DisplayLanguageId = DEFAULT_DISPLAY_LANGUAGE,
  ) {
    this.registry = new SheetRegistry(sheets);
    this.timezoneId = timezone;
    this.displayLanguageId = displayLanguage;
  }

  // ----- Worksheets -----

  /** The workbook's worksheets, in display order (read-only view). */
  get sheets(): readonly Worksheet[] {
    return this.registry.sheets;
  }

  get sheetCount(): number {
    return this.registry.sheets.length;
  }

  get activeSheet(): Worksheet {
    return this.registry.active;
  }

  get activeSheetId(): string {
    return this.activeSheet.id;
  }

  sheetById(id: string): Worksheet | null {
    return this.registry.byId(id);
  }

  /** Resolve a worksheet by display name, case-insensitively (the uniqueness policy). */
  sheetByName(name: string): Worksheet | null {
    return this.registry.byName(name);
  }

  /** 0-based position of a worksheet, or -1. */
  sheetIndex(id: string): number {
    return this.registry.indexOf(id);
  }

  /**
   * Activate a worksheet. Purely a view change: like zoom and column widths it
   * is recorded in the container on the next save but never marks the workbook
   * dirty on its own, so simply looking at another worksheet does not make the
   * file appear edited.
   */
  setActiveSheetId(id: string): boolean {
    return this.registry.setActive(id);
  }

  /** True when `name` is free (case-insensitively), ignoring `exceptId`. */
  isSheetNameAvailable(name: string, exceptId?: string): boolean {
    return this.registry.isNameAvailable(name, exceptId);
  }

  /**
   * `desired` if free, otherwise the first available `desired (2)`,
   * `desired (3)`, … so a generated name never collides.
   */
  uniqueSheetName(desired: string, exceptId?: string): string {
    return this.registry.uniqueName(desired, exceptId);
  }

  /** Build (but do not insert) a new empty worksheet shaped like the active one. */
  createWorksheet(name: string, rows?: number, cols?: number): Worksheet {
    const active = this.activeSheet;
    return this.besideActive(
      Worksheet.empty(this.registry.mintId(), name, rows ?? active.rowCount, cols ?? active.columnCount),
    );
  }

  /** Build (but do not insert) a new worksheet holding these row-major values. */
  createWorksheetFromValues(name: string, rows: string[][], columnCount: number): Worksheet {
    return this.besideActive(Worksheet.fromValues(this.registry.mintId(), name, rows, columnCount));
  }

  /** Build (but do not insert) a new worksheet holding one empty Markdown document. */
  createMarkdownWorksheet(name: string): Worksheet {
    return this.besideActive(Worksheet.markdown(this.registry.mintId(), name, ''));
  }

  /** Build (but do not insert) a new worksheet holding one empty JSON document. */
  createJsonWorksheet(name: string): Worksheet {
    return this.besideActive(Worksheet.json(this.registry.mintId(), name, ''));
  }

  /** Build (but do not insert) a new worksheet holding one empty YAML document. */
  createYamlWorksheet(name: string): Worksheet {
    return this.besideActive(Worksheet.yaml(this.registry.mintId(), name, ''));
  }

  /** Build (but do not insert) a new worksheet holding one empty plain-text document. */
  createTextWorksheet(name: string): Worksheet {
    return this.besideActive(Worksheet.text(this.registry.mintId(), name, ''));
  }

  /** A new worksheet goes in next to the active one, so it joins the active one's folder. */
  private besideActive(sheet: Worksheet): Worksheet {
    sheet.folderId = this.activeSheet.folderId;
    return sheet;
  }

  /** Build (but do not insert) a deep copy of a worksheet under a new name. */
  duplicateWorksheet(id: string, name: string): Worksheet | null {
    const source = this.sheetById(id);
    return source ? source.clone(this.registry.mintId(), name) : null;
  }

  /**
   * Build (but do not insert) an *empty* copy of a worksheet, to be filled in
   * row by row. Used by the time-sliced duplication of large worksheets, which
   * can then be cancelled without ever touching the workbook.
   */
  duplicateWorksheetShell(id: string, name: string): Worksheet | null {
    const source = this.sheetById(id);
    return source ? source.cloneShell(this.registry.mintId(), name) : null;
  }

  /** Insert an existing worksheet object at `index` (atomic; undo inserts it back). */
  insertSheetAt(index: number, sheet: Worksheet): boolean {
    return this.touchIf(this.registry.insertAt(index, sheet));
  }

  /**
   * Remove a worksheet and return it (for undo). A workbook always keeps at
   * least one worksheet, so removing the last one is refused.
   */
  removeSheet(id: string): { sheet: Worksheet; index: number } | null {
    const removed = this.registry.remove(id);
    this.touchIf(removed !== null);
    return removed;
  }

  /** Rename a worksheet. The identifier — and everything keyed by it — is untouched. */
  renameSheet(id: string, name: string): boolean {
    const sheet = this.sheetById(id);
    if (!sheet || sheet.name === name) {
      return false;
    }
    sheet.name = name;
    return this.touchIf(true);
  }

  /** Set or clear (`undefined`) a worksheet's tab color. Nothing else changes. */
  setTabColor(id: string, color: string | undefined): boolean {
    const sheet = this.sheetById(id);
    if (!sheet || sheet.tabColor === color) {
      return false;
    }
    sheet.tabColor = color;
    return this.touchIf(true);
  }

  /** Move a worksheet to a new position in the strip. */
  moveSheet(id: string, toIndex: number): boolean {
    return this.touchIf(this.registry.move(id, toIndex));
  }

  // ----- Sheet folders (sheet-folders.ts) -----

  /** The folders, in the order they were created. Change them with {@link applyOrganization}. */
  protected folderList: SheetFolder[] = [];
  private nextFolderSeq = 1;

  get folders(): readonly SheetFolder[] {
    return this.folderList;
  }

  /** A folder id no folder uses yet. */
  mintFolderId(): string {
    for (;;) {
      const id = `f${this.nextFolderSeq++}`;
      if (!this.folderList.some((folder) => folder.id === id)) {
        return id;
      }
    }
  }

  /** A copy of the folders, the worksheet order, and each worksheet's folder. */
  organization(): SheetOrganization {
    const folderOf: Record<string, string | undefined> = {};
    for (const sheet of this.sheets) {
      folderOf[sheet.id] = sheet.folderId;
    }
    return {
      folders: this.folderList.map((folder) => ({ ...folder })),
      order: this.sheets.map((sheet) => sheet.id),
      folderOf,
    };
  }

  /**
   * Replace the folders, the worksheet order, and the folder of every
   * worksheet `org` lists (one undoable step swaps whole snapshots). A
   * worksheet `org` does not list — one removed and not yet re-inserted —
   * keeps what it has.
   */
  applyOrganization(org: SheetOrganization): void {
    this.folderList = org.folders.map((folder) => ({ ...folder }));
    this.registry.reorder(org.order);
    for (const sheet of this.sheets) {
      if (Object.prototype.hasOwnProperty.call(org.folderOf, sheet.id)) {
        sheet.folderId = org.folderOf[sheet.id];
      }
    }
    this.touchIf(true);
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
   * no-op. This changes no cell input, so it
   * does not mark the document dirty; the new value is written into the
   * container on the next save.
   */
  setTimezone(timeZone: string): void {
    if (timeZone === this.timezoneId || !isValidTimeZone(timeZone)) {
      return;
    }
    this.timezoneId = timeZone;
    this.engine.recalculate();
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
    this.engine.recalculate();
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

  /**
   * The computed display value (formula results, error codes, or the
   * literal), rendered through the cell's `numberFormat` when it has one and
   * the result is a number — see `cell-number-format.ts`. Every other value
   * kind, and cells with no number format, render exactly as `formatValue`
   * always has.
   */
  getDisplayValue(row: number, col: number): string {
    return this.displayText(this.evaluateCell(row, col), this.activeSheet.getStyle(row, col));
  }

  /** The computed display value of a cell on a specific worksheet. See {@link getDisplayValue}. */
  getSheetDisplayValue(sheetId: string, row: number, col: number): string {
    const sheet = this.sheetById(sheetId);
    return sheet ? this.displayText(this.evaluateInSheet(sheet, row, col), sheet.getStyle(row, col)) : '';
  }

  private displayText(value: FormulaValue, style: CellStyle | null): string {
    if (value.type === 'number' && style?.numberFormat) {
      return formatCellNumber(value.value, style.numberFormat);
    }
    return formatValue(value);
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
    for (const sheet of this.sheets) {
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
    return this.sheets.some((sheet) => sheet.filterDropped);
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
    if (this.bumpIf(sheet.filter !== filter)) {
      sheet.filter = filter;
    }
  }

  setFilterState(filter: SheetFilter | null): void {
    this.setFilterStateOn(undefined, filter);
  }

  // ----- Worksheet lock -----

  /**
   * Set a worksheet's lock state (Sheet ▸ Lock Sheet, or its tab context
   * menu). A plain, non-cryptographic protection flag — no password — that
   * blocks that worksheet's own cell edits and structural changes; every
   * other worksheet in the workbook stays editable. Cell data, formula
   * results, and the evaluation cache are untouched, but the workbook is
   * marked as having unsaved changes because the flag is persisted in the
   * saved container, exactly like {@link setFilterStateOn}.
   */
  setLockedOn(sheetId: string | undefined, locked: boolean): void {
    const sheet = this.resolveSheet(sheetId);
    if (this.bumpIf(sheet.locked !== locked)) {
      sheet.locked = locked;
    }
  }

  // ----- Cell styles -----

  /** The active worksheet's style for one cell, or `null` when it carries none. */
  getStyle(row: number, col: number): CellStyle | null {
    return this.activeSheet.getStyle(row, col);
  }

  /** A specific worksheet's style for one cell (undo/redo, cross-sheet). */
  getStyleOn(sheetId: string | undefined, row: number, col: number): CellStyle | null {
    return this.resolveSheet(sheetId).getStyle(row, col);
  }

  /**
   * Set one worksheet's cell style (called by the history layer, so applying
   * and clearing cell formatting are ordinary undoable operations). Cell
   * data, formula results, and the evaluation cache are untouched — a style
   * is purely presentational — but the workbook is marked as having unsaved
   * changes because styles are persisted in the saved container.
   */
  setCellStyleOn(sheetId: string | undefined, row: number, col: number, style: CellStyle | null): void {
    this.bumpIf(this.resolveSheet(sheetId).setStyle(row, col, style));
  }

  // ----- Conditional formatting (session-only view state; never persisted) -----

  /** The active worksheet's conditional-formatting rules, in application order. */
  get conditionalFormats(): readonly CellConditionalFormat[] {
    return this.activeSheet.conditionalFormats;
  }

  /**
   * The background/text color a conditional-formatting rule paints on one
   * cell of the active worksheet, from its *computed* value, or null when no
   * rule applies (see `RecalcEngine.conditionalFormatStyle`).
   */
  getConditionalFormatStyle(row: number, col: number): ConditionalFormatStyle | null {
    return this.engine.conditionalFormatStyle(this.activeSheet, row, col);
  }

  /** {@link getConditionalFormatStyle} on a specific worksheet (printing every sheet). */
  getConditionalFormatStyleOn(sheetId: string, row: number, col: number): ConditionalFormatStyle | null {
    const sheet = this.sheetById(sheetId);
    return sheet ? this.engine.conditionalFormatStyle(sheet, row, col) : null;
  }

  // ----- Sort state (session-only view state; never persisted) -----

  /** The active worksheet's sort. */
  get sort(): SheetSort | null {
    return this.activeSheet.sort;
  }

  // ----- Data validation -----

  /** The active worksheet's data-validation rules. */
  get validations(): readonly CellValidation[] {
    return this.activeSheet.validations;
  }

  /** Replace a worksheet's rules (persisted, so this marks the workbook changed). */
  setValidationsOn(sheetId: string | undefined, rules: readonly CellValidation[]): void {
    const sheet = this.resolveSheet(sheetId);
    if (this.bumpIf(!validationListsEqual(sheet.validations, rules))) {
      sheet.validations = rules.slice();
    }
  }

  // ----- Objects (shapes and images) -----

  /** The pictures image objects show (every sheet's; see `sheet-images.ts`). */
  readonly images = new ImageStore();

  /** The active worksheet's objects, bottom to top. */
  get objects(): readonly SheetObject[] {
    return this.activeSheet.objects;
  }

  /** Replace a worksheet's objects (persisted, so this marks the workbook changed). */
  setObjectsOn(sheetId: string | undefined, objects: readonly SheetObject[]): void {
    const sheet = this.resolveSheet(sheetId);
    if (this.bumpIf(!objectListsEqual(sheet.objects, objects))) {
      sheet.objects = objects.slice();
    }
  }

  // ----- Cell comments -----

  /** The active worksheet's comment for one cell, or `null` when it carries none. */
  getComment(row: number, col: number): string | null {
    return this.activeSheet.getComment(row, col);
  }

  /** A specific worksheet's comment for one cell (undo/redo, cross-sheet). */
  getCommentOn(sheetId: string | undefined, row: number, col: number): string | null {
    return this.resolveSheet(sheetId).getComment(row, col);
  }

  /**
   * Set one worksheet's cell comment (called by the history layer, so
   * setting and clearing a comment are ordinary undoable operations). Cell
   * data, formula results, and the evaluation cache are untouched — a
   * comment is purely an annotation — but the workbook is marked as having
   * unsaved changes because comments are persisted in the saved container.
   */
  setCommentOn(sheetId: string | undefined, row: number, col: number, text: string | null): void {
    this.bumpIf(this.resolveSheet(sheetId).setComment(row, col, text));
  }

  // ----- Mutators (called through the atomic operation layer) -----

  protected resolveSheet(sheetId: string | undefined): Worksheet {
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
    followCharts(this.sheets, this.resolveSheet(sheetId), 'row', 'insert', index, rows.length);
    this.touch();
  }

  insertRows(index: number, rows: string[][]): void {
    this.insertRowsOn(undefined, index, rows);
  }

  deleteRowsOn(sheetId: string | undefined, index: number, count: number): string[][] {
    const removed = this.resolveSheet(sheetId).deleteRows(index, count);
    followCharts(this.sheets, this.resolveSheet(sheetId), 'row', 'delete', index, count);
    this.touch();
    return removed;
  }

  deleteRows(index: number, count: number): string[][] {
    return this.deleteRowsOn(undefined, index, count);
  }

  insertColsOn(sheetId: string | undefined, index: number, colsData: string[][]): void {
    this.resolveSheet(sheetId).insertCols(index, colsData);
    followCharts(this.sheets, this.resolveSheet(sheetId), 'col', 'insert', index, colsData.length);
    this.touch();
  }

  insertCols(index: number, colsData: string[][]): void {
    this.insertColsOn(undefined, index, colsData);
  }

  deleteColsOn(sheetId: string | undefined, index: number, count: number): string[][] {
    const removed = this.resolveSheet(sheetId).deleteCols(index, count);
    followCharts(this.sheets, this.resolveSheet(sheetId), 'col', 'delete', index, count);
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
    return this.engine.evaluate(sheet, row, col);
  }

  // ----- Dynamic arrays (spill) -----

  /** The spill anchor covering a cell, whether the cell is the anchor or derived. */
  spillAnchorAt(sheetId: string | undefined, row: number, col: number): SpillAnchor | null {
    return this.engine.spillAnchorAt(this.resolveSheet(sheetId), row, col);
  }

  /**
   * True when a cell holds a *derived* dynamic-array value — part of a spill
   * but not its anchor. Writing to such a cell is refused by the command
   * layer; the anchor is what the user edits or clears.
   */
  isSpillDerivedCell(sheetId: string | undefined, row: number, col: number): boolean {
    return this.engine.isSpillDerivedCell(this.resolveSheet(sheetId), row, col);
  }

  /** True when the worksheet has any dynamic array at all (placed or blocked). */
  hasSpills(sheetId?: string): boolean {
    return this.engine.hasSpills(this.resolveSheet(sheetId));
  }

  /**
   * Recompute everything, advancing the clock the volatile functions read.
   *
   * This is the *explicit* recalculation path (Data > Recalculate). Because no
   * timer exists, it is the only way a `TODAY()` in an untouched workbook
   * changes without an edit.
   */
  recalculate(): void {
    this.engine.recalculate();
  }

  /** The revision counter (bumped by every change), for {@link RecalcEngine}'s caches. */
  get revisionCounter(): number {
    return this.revision;
  }

  /**
   * Record a mutation: bump the revision and drop every cached evaluation.
   * The whole workbook memo is cleared because a worksheet-qualified reference
   * means a change in one worksheet can invalidate a formula in another.
   */
  protected touch(): void {
    this.revision += 1;
    this.registry.invalidateNames();
    this.engine.invalidate();
  }

  /**
   * Record a change that no cell value depends on (a filter, lock, style,
   * comment, or file setting): bump the revision — the document is dirty —
   * without invalidating the memo, since recalculation would be pure waste.
   * Returns `changed`.
   */
  protected bumpIf(changed: boolean): boolean {
    if (changed) {
      this.revision += 1;
    }
    return changed;
  }

  /** {@link touch} when `changed`; returns `changed`. */
  private touchIf(changed: boolean): boolean {
    if (changed) {
      this.touch();
    }
    return changed;
  }
}
