// SPDX-License-Identifier: MIT
import { isCsv, isWorkbook } from '../../core/editor-document';
import type { CellStyle } from '../../core/workbook/cell-style';
import type { CellRange } from '../../core/clipboard';
import type { CellValidation } from '../../core/workbook/data-validation';
import { isFormula } from '../../core/formula';
import type { TextRun } from '../../core/workbook/rich-text';
import type { RsfDocument } from '../../core/workbook/rsf-document';
import type { CompiledQuery, SearchScope } from '../../core/search';
import type { SaveOptions } from '../../core/csv/serializer';
import type { AppState, Selection, SelectionKind, Tab } from '../state';
import type { OpenedFile } from '../file-access';
import { t } from '../i18n';
import { nextZoomLevel } from '../settings';
import { CommentCommands } from './comment';
import { ConditionalFormatCommands } from './conditional-format';
import { ValidationCommands } from './data-validation';
import { FileIoCommands } from './file-io';
import { DriveIoCommands } from './drive-io';
import { isSignedIn as driveIsSignedIn } from '../drive/auth';
import { FilterCommands } from './filter';
import { FormatCommands } from './format';
import { SortCommands } from './sort';
import { WorksheetCommands } from './worksheets';
import { SqlCommands, type SqlRunOutcome } from './sql';
import { DiffCommands } from './diff';
import type { FlashFillPreview } from './fill';
import { PasteFillCommands } from './paste-fill';
import { RangeOpsCommands, type ReplaceAllReport } from './range-ops';
import { isGridSurface, LARGE_OP_CELLS } from './shared';
import type { ColumnMenuInput, ConvertReason, UiPort } from '../ui-port';

export { isGridSurface, LARGE_OP_CELLS };

/**
 * `true` only in the offline production build (`vite build`, not `--mode
 * hosted`), injected by vite.config.ts. Gating the Drive wiring on this
 * compile-time constant lets the bundler drop the whole Google Drive client
 * (and every Google endpoint URL) from the offline artifact, instead of
 * shipping it inert; `scripts/check/dist.mjs` asserts the result. `false` in
 * dev, tests, and the hosted build, where `driveConfigured()` still decides
 * at runtime.
 */
declare const __OFFLINE_BUILD__: boolean;
export type { FlashFillPreview, ReplaceAllReport, SqlRunOutcome };
export type * from '../ui-port';

import { commandSpec, type CommandId } from './catalog';
import type { CommandContext, CommandParts } from './catalog/types';

export type { CommandId } from './catalog';
export { COMMAND_IDS } from './catalog';

/**
 * The command layer's facade: every user-visible action is a `CommandId`
 * looked up in the command catalog (`./catalog/`), which owns each command's
 * enablement, disabled reason, and behavior; the feature controllers it
 * composes (`FileIoCommands`, `FilterCommands`, …) hold the flows. UI
 * surfaces call `run`/`isEnabled` or one of the public methods below.
 */
export class Commands {
  /** Set by main.ts so menu Copy/Paste can go through the clipboard controller. */
  clipboardActions: {
    cut: () => Promise<void>;
    copy: () => Promise<void>;
    /** Render the selection's actual on-screen appearance to a PNG and write it to the system clipboard. */
    copyScreenshot: () => Promise<void>;
    /** Write the selection to the system clipboard as a GitHub-Flavored Markdown table. */
    copyAsMarkdown: () => Promise<void>;
    paste: () => Promise<void>;
    /** Paste only the copied cells' calculated values (no formulas, no formatting). */
    pasteValues: () => Promise<void>;
    /** Paste only the copied cells' formatting (values untouched). */
    pasteFormats: () => Promise<void>;
    /** The most recently copied range (internal clipboard, else parsed system text). */
    getCopied: () => Promise<{ matrix: string[][]; origin: Selection | null } | null>;
    /** The kind of the most recently copied selection in the internal clipboard, or null. Synchronous, for isEnabled(). */
    copiedKind: () => SelectionKind | null;
  } | null = null;

  /** Set by main.ts so commands can drive grid-only operations (measurement needs the DOM). */
  gridActions: {
    /** Auto-fit every column intersecting the current selection. */
    autoFitSelectedColumns: () => Promise<void>;
    /** Auto-fit every column of `tab` — used for the "auto-fit on open" preference. */
    autoFitAllColumns: (tab: Tab) => Promise<void>;
    /** Select a cell and scroll it into view ("Go to Cell…"). */
    goToCell: (row: number, col: number) => void;
  } | null = null;

  /** Set by main.ts so the View menu can open the comments panel. */
  panelActions: {
    /** Open the cell comments panel (only its header × closes it). */
    openComments: () => void;
  } | null = null;

  /**
   * The feature controllers this facade composes. Every one that may need
   * the explicit CSV → RSF conversion shares {@link ensureRsf}, so the
   * conversion is always offered the same way.
   */
  private readonly parts: CommandParts;

  constructor(
    private readonly state: AppState,
    private readonly ui: UiPort,
    private readonly dom: Document,
  ) {
    const ensureRsf = (tab: Tab, reason: ConvertReason) => this.ensureRsf(tab, reason);
    const fileIo = new FileIoCommands(state, ui, dom, () => this.gridActions);
    const sort = new SortCommands(state, ui, ensureRsf);
    this.parts = {
      fileIo,
      drive: __OFFLINE_BUILD__ ? null : new DriveIoCommands(state, ui, fileIo),
      sort,
      filter: new FilterCommands(state, ui, ensureRsf, sort),
      validation: new ValidationCommands(state, ui, ensureRsf),
      conditionalFormat: new ConditionalFormatCommands(state, ui, ensureRsf),
      comment: new CommentCommands(state, ui, ensureRsf),
      worksheets: new WorksheetCommands(state, ui, ensureRsf),
      pasteFill: new PasteFillCommands(
        state,
        ui,
        ensureRsf,
        () => this.clipboardActions?.getCopied() ?? Promise.resolve(null),
      ),
      rangeOps: new RangeOpsCommands(state, ui, ensureRsf),
      format: new FormatCommands(state, ui),
      sql: new SqlCommands(),
      diff: new DiffCommands(),
    };
  }

  /**
   * Whether Google Drive sync exists in this build at all. False for the
   * offline build, which hides every Drive entry point.
   */
  driveAvailable(): boolean {
    return this.parts.drive?.available() ?? false;
  }

  /** Whether a Google access token is currently held (drives the menu label). */
  driveSignedIn(): boolean {
    return !__OFFLINE_BUILD__ && driveIsSignedIn();
  }

  /** True when the command currently makes sense (drives menu-item enabled state). */
  isEnabled(id: CommandId): boolean {
    return commandSpec(id).enabled?.(this.context()) ?? true;
  }

  /**
   * A localized explanation for why `id` is currently disabled, or null when
   * it is enabled or the reason is already self-evident from context (no
   * selection, no open tab). Surfaced as a tooltip so a genuinely non-obvious
   * disable rule — Format is RSF-only, with no dialog of its own to explain
   * that like Filter/Sort have — is not silent. See `isEnabled`.
   */
  disabledReason(id: CommandId): string | null {
    if (this.isEnabled(id)) {
      return null;
    }
    return commandSpec(id).disabledReason?.(this.context()) ?? null;
  }

  async run(id: CommandId): Promise<void> {
    await commandSpec(id).run(this.context());
  }

  /** What a catalog entry sees: this facade, its parts, and the active tab right now. */
  private context(): CommandContext {
    return {
      commands: this,
      parts: this.parts,
      state: this.state,
      ui: this.ui,
      dom: this.dom,
      tab: this.state.activeTab,
    };
  }

  /** Surface a localized notification (used by UI surfaces without direct port access). */
  notify(text: string, kind: 'info' | 'warn' | 'error' = 'info'): void {
    this.ui.notify(text, kind);
  }

  /**
   * Show/update or clear the busy indicator (used by UI surfaces that run
   * their own sliced work, e.g. the grid's multi-column auto-fit). Always
   * pass `null` when the operation ends, succeeds or not.
   */
  setBusy(label: string | null, progress?: number | null): void {
    this.ui.setBusy(label, progress);
  }

  /** Open picked or dropped files. Every entry point (menu, shortcut, drop) funnels through here. */
  async openFiles(files: OpenedFile[], opts: { confirmNonCsv: boolean }): Promise<void> {
    return this.parts.fileIo.openFiles(files, opts);
  }

  async openDroppedFiles(fileList: File[], handles: Array<FileSystemFileHandle | null>): Promise<void> {
    return this.parts.fileIo.openDroppedFiles(fileList, handles);
  }

  /**
   * Save a tab. A tab associated with a Google Drive file (see `Tab.drive`)
   * overwrites that same Drive file instead, so Ctrl+S / File > Save keeps
   * updating the file the user opened or saved from Drive rather than
   * falling back to a local save. Any Drive failure is reported by
   * `DriveIoCommands` itself and does not fall back to a local save.
   *
   * Otherwise: CSV: a normal save (all options "keep") with no edits writes
   * the originally loaded bytes verbatim; with edits, only edited field
   * ranges are reserialized. RSF: the document is saved in the versioned
   * .rsf JSON format (never silently into the original .csv).
   * Returns true when the file was actually saved.
   */
  async save(tab: Tab, options: SaveOptions): Promise<boolean> {
    if (tab.drive && this.parts.drive?.available()) {
      return this.parts.drive.save(tab);
    }
    return this.parts.fileIo.save(tab, options);
  }

  /**
   * Explicit, confirmed lossy CSV export of an RSF document. See
   * `FileIoCommands.exportCsv` for the full behavior contract.
   */
  async exportCsv(tab: Tab): Promise<boolean> {
    return this.parts.fileIo.exportCsv(tab);
  }

  /**
   * Explicit, confirmed lossy XLSX export. See `FileIoCommands.exportXlsx`
   * for the full behavior contract.
   */
  async exportXlsx(tab: Tab): Promise<boolean> {
    return this.parts.fileIo.exportXlsx(tab);
  }

  /**
   * Explicit, confirmed lossy JSON export. See `FileIoCommands.exportJson`
   * for the full behavior contract.
   */
  async exportJson(tab: Tab): Promise<boolean> {
    return this.parts.fileIo.exportJson(tab);
  }

  async closeTab(tab: Tab): Promise<void> {
    return this.parts.fileIo.closeTab(tab);
  }

  /**
   * Ensure the tab holds an RSF spreadsheet document, asking for the
   * explicit conversion when it is still CSV. Never converts silently.
   */
  async ensureRsf(tab: Tab, reason: ConvertReason): Promise<RsfDocument | null> {
    return this.parts.fileIo.ensureRsf(tab, reason);
  }

  /**
   * File > New: create a blank spreadsheet document in a new active tab. See
   * `FileIoCommands.newDocument` for the full behavior contract.
   */
  newDocument(): Tab {
    return this.parts.fileIo.newDocument();
  }

  /**
   * File > New CSV: create a blank, byte-preserving CSV document in a new
   * active tab (#396) — the CSV counterpart of `newDocument`'s blank RSF
   * spreadsheet. See `FileIoCommands.newCsvDocument` for the full behavior
   * contract.
   */
  newCsvDocument(): Tab {
    return this.parts.fileIo.newCsvDocument();
  }

  /**
   * Commit a cell edit from the grid or formula bar. Entering a formula
   * (`=...`) into a CSV document offers the explicit RSF conversion; if
   * declined, the text is kept as a plain literal value.
   *
   * `runs` is the cell's rich text from the cell editor (null clears it);
   * when left out, formatted parts carry over through the edit (see
   * `FormatCommands.styleForEdit`).
   */
  async commitCellEdit(
    tab: Tab,
    row: number,
    col: number,
    value: string,
    runs?: TextRun[] | null,
  ): Promise<boolean> {
    if (isCsv(tab.doc) && isFormula(value)) {
      await this.ensureRsf(tab, 'formula');
    }
    const styled = this.parts.format.styleForEdit(tab, row, col, value, runs);
    if (styled) {
      return this.parts.format.editCellWithStyle(tab, row, col, value, styled.before, styled.after);
    }
    return this.state.editCell(tab, row, col, value);
  }

  /**
   * Paste a rectangular matrix as one atomic, undoable operation. See
   * `PasteFillCommands.applyPaste` for the full behavior contract.
   */
  async applyPaste(tab: Tab, matrix: string[][], origin: Selection | null): Promise<boolean> {
    return this.parts.pasteFill.applyPaste(tab, matrix, origin);
  }

  /** Paste Formatting. See `FormatCommands.pasteStyles` for the full behavior contract. */
  pasteStyles(tab: Tab, styles: ReadonlyArray<ReadonlyArray<CellStyle | null>>): boolean {
    return this.parts.format.pasteStyles(tab, styles);
  }

  /**
   * Edit > Insert Copied > Insert Copied Cells…. See
   * `PasteFillCommands.insertCopiedCells` for the full behavior contract.
   */
  async insertCopiedCells(tab: Tab): Promise<boolean> {
    return this.parts.pasteFill.insertCopiedCells(tab);
  }

  /**
   * Edit > Insert Copied > Insert Copied Rows / Insert Copied Columns. See
   * `PasteFillCommands.insertCopiedAxis` for the full behavior contract.
   */
  async insertCopiedAxis(tab: Tab, axis: 'rows' | 'cols'): Promise<boolean> {
    return this.parts.pasteFill.insertCopiedAxis(tab, axis);
  }

  /**
   * Edit > Select All Cells: select the used range of the active document
   * (for a blank RSF document this is its whole logical grid). The
   * virtualized grid renders the selection only on the cells it has
   * materialized — no DOM is created for off-screen cells — and selection
   * statistics for very large selections fill in from a background scan with
   * a visible "Calculating…" state. An empty CSV document has no cells to
   * select; a notification says so instead of leaving silent dead air.
   */
  selectAllCells(tab: Tab): boolean {
    const rows = tab.doc.rowCount;
    const cols = tab.doc.columnCount;
    if (rows === 0 || cols === 0) {
      this.ui.notify(t('notify.selectAllEmpty'), 'info');
      return false;
    }
    this.state.setSelection(tab, { row: 0, col: 0 }, { row: rows - 1, col: cols - 1 });
    return true;
  }

  /**
   * Fill Down: the top row of the current selection is copied into the rows
   * below it. See `PasteFillCommands.fillDown` for the full behavior contract.
   */
  async fillDown(tab: Tab): Promise<boolean> {
    return this.parts.pasteFill.fillDown(tab);
  }

  /**
   * Fill a source range into a destination range that extends it downward
   * and/or rightward. See `PasteFillCommands.applyFill` for the full behavior
   * contract, including the numeric-series (AutoFill) rules.
   */
  async applyFill(tab: Tab, source: CellRange, dest: CellRange): Promise<boolean> {
    return this.parts.pasteFill.applyFill(tab, source, dest);
  }

  /**
   * Flash Fill: infer a deterministic text transformation from typed
   * examples, preview it, and apply it after explicit confirmation. See
   * `PasteFillCommands.flashFill` for the full behavior contract.
   */
  async flashFill(tab: Tab): Promise<boolean> {
    return this.parts.pasteFill.flashFill(tab);
  }

  /** Whether the app is shown full screen (View > Full Screen). */
  isFullscreen(): boolean {
    return this.dom.fullscreenElement !== null;
  }

  /**
   * Zoom the spreadsheet one preset step in/out (shared with the menu
   * presets; used by the keyboard shortcuts and Ctrl/Cmd + mouse wheel).
   * Clamped at the smallest/largest preset. Never touches browser zoom, CSV
   * bytes, or document content.
   */
  zoomStep(tab: Tab, direction: 1 | -1): void {
    this.state.setTabZoom(tab, nextZoomLevel(tab.zoom, direction));
  }

  // ----- Filtering (RSF spreadsheet documents only) -----

  /** The active filter's hidden-row set for a tab (null when unfiltered). See `FilterCommands.hiddenRows`. */
  hiddenRows(tab: Tab): Set<number> | null {
    return this.parts.filter.hiddenRows(tab);
  }

  /**
   * Sheet > Filter & Sort > Filter… (also the column-header filter buttons
   * and the context menu): open the filter dialog and apply the result as
   * one atomic, undoable operation. See `FilterCommands.filterDialog` for
   * the full behavior contract.
   */
  async filterDialog(tab: Tab, targetCol?: number): Promise<boolean> {
    return this.parts.filter.filterDialog(tab, targetCol);
  }

  /** Sheet > Filter & Sort > Clear All Filters: every row becomes visible again (undoable). See `FilterCommands.clearAllFilters`. */
  clearAllFilters(tab: Tab): boolean {
    return this.parts.filter.clearAllFilters(tab);
  }

  /**
   * Sheet > Filter & Sort > Filter & Sort from Headers: add or remove the
   * header row's filter buttons. See `FilterCommands.toggleHeaderFilter`.
   */
  async toggleHeaderFilter(tab: Tab): Promise<boolean> {
    return this.parts.filter.toggleHeaderFilter(tab);
  }

  /** Whether the active tab's sheet shows filter buttons (has a filter range). */
  hasFilter(tab: Tab | null): boolean {
    return tab !== null && isWorkbook(tab.doc) && tab.doc.filter !== null;
  }

  /**
   * A header cell's filter button: open the column menu (sort, value
   * checklist) beside `anchor`. See `FilterCommands.columnMenu`.
   */
  async columnMenu(tab: Tab, col: number, anchor: ColumnMenuInput['anchor']): Promise<boolean> {
    return this.parts.filter.columnMenu(tab, col, anchor);
  }

  // ----- Sorting (RSF spreadsheet documents only; view-only, unsaved) -----

  /** The active tab's sort display order, or null when unsorted. See `SortCommands.sortOrder`. */
  sortOrder(tab: Tab): number[] | null {
    return this.parts.sort.sortOrder(tab);
  }

  /**
   * Sheet > Filter & Sort > Sort…: open the sort dialog and apply the
   * result. See `SortCommands.sortDialog` for the full behavior contract.
   */
  async sortDialog(tab: Tab): Promise<boolean> {
    return this.parts.sort.sortDialog(tab);
  }

  /** Sheet > Filter & Sort > Clear Sort: rows return to document order. See `SortCommands.clearSort`. */
  clearSort(tab: Tab): boolean {
    return this.parts.sort.clearSort(tab);
  }

  // ----- Data validation (RSF spreadsheet documents only; view-only, unsaved) -----

  /** The rule applying to one cell on the active worksheet, or null. See `ValidationCommands.validationAt`. */
  validationAt(tab: Tab, row: number, col: number): CellValidation | null {
    return this.parts.validation.validationAt(tab, row, col);
  }

  /**
   * Data > Data Validation…: open the dialog for the selected range and
   * apply the result. See `ValidationCommands.validationDialog` for the full
   * behavior contract.
   */
  async validationDialog(tab: Tab): Promise<boolean> {
    return this.parts.validation.validationDialog(tab);
  }

  // ----- Conditional formatting (RSF spreadsheet documents only; view-only, unsaved) -----

  /**
   * Format > Conditional Formatting…: open the dialog for the selected range
   * and apply the result. See `ConditionalFormatCommands.conditionalFormatDialog`
   * for the full behavior contract.
   */
  async conditionalFormatDialog(tab: Tab): Promise<boolean> {
    return this.parts.conditionalFormat.conditionalFormatDialog(tab);
  }

  // ----- Cell comments (RSF spreadsheet documents only) -----

  /** The comment on one cell of the active worksheet, or null. See `CommentCommands.commentAt`. */
  commentAt(tab: Tab, row: number, col: number): string | null {
    return this.parts.comment.commentAt(tab, row, col);
  }

  /** Set (or clear, with `null`) one cell's comment, undoably. See `CommentCommands.setComment`. */
  setComment(tab: Tab, row: number, col: number, text: string | null): boolean {
    return this.parts.comment.setComment(tab, row, col, text);
  }

  /**
   * Data > Cell Comment…: open the dialog for the active cell and apply the
   * result. See `CommentCommands.commentDialog` for the full behavior
   * contract.
   */
  async commentDialog(tab: Tab): Promise<boolean> {
    return this.parts.comment.commentDialog(tab);
  }

  /** Clear every cell in the selected range as one undoable operation. See
   *  `RangeOpsCommands.clearRange` for the full behavior contract. */
  clearRange(tab: Tab): boolean {
    return this.parts.rangeOps.clearRange(tab);
  }

  // ----- Moving a selected range (RSF worksheets only) -----

  /**
   * "Move Selected Cells…": the keyboard-equivalent of dragging the selection.
   * See `RangeOpsCommands.promptAndMoveRange` for the full behavior contract.
   */
  async promptAndMoveRange(tab: Tab): Promise<boolean> {
    return this.parts.rangeOps.promptAndMoveRange(tab);
  }

  /**
   * Move the selected rectangle by (deltaRow, deltaCol) as one atomic,
   * singly-undoable operation. See `RangeOpsCommands.moveRange` for the full
   * behavior contract.
   */
  async moveRange(tab: Tab, source: CellRange, deltaRow: number, deltaCol: number): Promise<boolean> {
    return this.parts.rangeOps.moveRange(tab, source, deltaRow, deltaCol);
  }

  /**
   * Move `count` whole rows/columns starting at `from` to the boundary `to`
   * (in the current layout) — dragging a row/column header's grip. A reorder
   * that keeps values, styles, comments, widths, and formula references with
   * the moved cells; one undo step. The moved rows/columns stay selected.
   */
  moveAxis(tab: Tab, axis: 'row' | 'col', from: number, count: number, to: number): boolean {
    const doc = tab.doc;
    if (!isWorkbook(doc)) {
      this.ui.notify(t('move.csvOnly'), 'warn');
      return false;
    }
    if (!this.state.moveAxis(tab, axis, from, count, to)) {
      return false;
    }
    const start = to > from ? to - count : to;
    const end = start + count - 1;
    if (axis === 'row') {
      const lastCol = Math.max(0, doc.columnCount - 1);
      this.state.setSelection(tab, { row: end, col: 0 }, { row: start, col: lastCol }, 'row');
    } else {
      const lastRow = Math.max(0, doc.rowCount - 1);
      this.state.setSelection(tab, { row: 0, col: end }, { row: lastRow, col: start }, 'col');
    }
    return true;
  }

  /**
   * Replace every match in the active tab (or workbook-wide) as one atomic,
   * singly-undoable operation. See `RangeOpsCommands.replaceAll` for the full
   * behavior contract.
   */
  async replaceAll(
    query: CompiledQuery,
    replacement: string,
    scope: SearchScope = 'sheet',
  ): Promise<ReplaceAllReport> {
    return this.parts.rangeOps.replaceAll(query, replacement, scope);
  }

  // ----- Cell/range formatting (RSF worksheets only) -----

  /** Toggle Bold on the selection. See `FormatCommands.toggleBold` for the full behavior contract. */
  toggleBold(tab: Tab): boolean {
    return this.parts.format.toggleBold(tab);
  }

  /** Toggle Italic on the selection. See `FormatCommands.toggleItalic`. */
  toggleItalic(tab: Tab): boolean {
    return this.parts.format.toggleItalic(tab);
  }

  /** Toggle Underline on the selection. See `FormatCommands.toggleUnderline`. */
  toggleUnderline(tab: Tab): boolean {
    return this.parts.format.toggleUnderline(tab);
  }

  /** Open the Text Color dialog and apply the choice. See `FormatCommands.promptTextColor`. */
  async promptTextColor(tab: Tab): Promise<boolean> {
    return this.parts.format.promptTextColor(tab);
  }

  /** Open the Background Color dialog and apply the choice. See `FormatCommands.promptBackgroundColor`. */
  async promptBackgroundColor(tab: Tab): Promise<boolean> {
    return this.parts.format.promptBackgroundColor(tab);
  }

  /** Open the Borders dialog and apply the choice. See `FormatCommands.promptBorders`. */
  async promptBorders(tab: Tab): Promise<boolean> {
    return this.parts.format.promptBorders(tab);
  }

  /** Open the Number Format dialog and apply the choice. See `FormatCommands.promptNumberFormat`. */
  async promptNumberFormat(tab: Tab): Promise<boolean> {
    return this.parts.format.promptNumberFormat(tab);
  }

  /** Remove every style property from the selection. See `FormatCommands.clearFormatting`. */
  clearFormatting(tab: Tab): boolean {
    return this.parts.format.clearFormatting(tab);
  }

  /** Whether Bold/Italic/Underline is "on" for the whole selection. See `FormatCommands.isActive`. */
  isFormatActive(tab: Tab, key: 'bold' | 'italic' | 'underline'): boolean {
    return this.parts.format.isActive(tab, key);
  }
}
