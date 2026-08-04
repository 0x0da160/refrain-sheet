// SPDX-License-Identifier: MIT
import type { DelimiterId } from '../core/byte-csv-parser';
import type { BorderSide } from '../core/cell-style';
import type { CellRange } from '../core/clipboard';
import { type CsvExportOptions } from '../core/csv-export';
import { type EncodingId } from '../core/encoding';
import { type ColumnFilter } from '../core/filter';
import { isFormula } from '../core/formula';
import { RsfDocument } from '../core/rsf-document';
import { type SortKey } from '../core/sort';
import type { CompiledQuery, SearchScope } from '../core/search';
import {
  KEEP_SAVE_OPTIONS,
  type NcrCellReport,
  type SaveOptions,
  type UnrepresentableCell,
} from '../core/serializer';
import { type ValidationSummary } from '../core/validation';
import { AppState, type Selection, type SelectionKind, type Tab } from './app-state';
import { pickFiles, type OpenedFile } from './file-access';
import { setLocale, t, type LocaleId } from './i18n';
import {
  DEFAULT_SHEET_ZOOM,
  getEditHints,
  getMaxFileSize,
  nextZoomLevel,
  setEditHints,
  setMaxFileSize,
} from './settings';
import { setSheetFont, type SheetFontId } from './sheet-font';
import { setTheme, type ThemeChoice } from './theme';
import { FileIoCommands } from './commands/file-io';
import { FilterCommands } from './commands/filter';
import { FormatCommands } from './commands/format';
import { SortCommands } from './commands/sort';
import { WorksheetCommands } from './commands/worksheets';
import { PasteFillCommands, type FlashFillPreview } from './commands/paste-fill';
import { RangeOpsCommands, type ReplaceAllReport } from './commands/range-ops';
import { LARGE_OP_CELLS } from './commands/shared';

export { LARGE_OP_CELLS };
export type { FlashFillPreview, ReplaceAllReport };

/**
 * Why a CSV document needs converting to an RSF spreadsheet document.
 * `command` is the explicit `Convert to RSF…` menu command (which opens a new
 * tab); the others are implicit conversions triggered by an edit that a
 * byte-preserving CSV cannot represent (they convert the current tab in place).
 */
export type ConvertReason = 'formula' | 'paste' | 'structure' | 'fill' | 'command';

/** The summary shown before a range move replaces existing destination cells. */
export interface RangeMoveConfirmInput {
  /** Destination rectangle in A1 notation ("C4:E9"). */
  target: string;
  /** Non-empty destination cells that would be replaced. */
  overwriteCount: number;
  /** Cells being moved. */
  movedCells: number;
}

/** The summary shown before a workbook-wide Replace All mutates anything. */
export interface WorkbookReplaceConfirmInput {
  /** Worksheets that contain at least one match. */
  sheets: number;
  /** Cells that contain at least one match. */
  cells: number;
  /** Total replacements that would be made. */
  matches: number;
  /** Worksheets in the workbook (context for "3 of 12"). */
  totalSheets: number;
}

/**
 * Everything the filter dialog needs to edit one column's criteria. The
 * command layer prepares it (including the bounded distinct-value list,
 * enumerated in time slices for large ranges) so the dialog itself stays a
 * pure presentation surface.
 */
export interface FilterDialogInput {
  /** Absolute document column index being edited. */
  col: number;
  /** Column letter (A, B, …) for labels. */
  colLetter: string;
  /** The column's header text (empty when the range has no header row). */
  header: string;
  /** Human-readable A1 range of the filter, e.g. "A1:D200". */
  rangeLabel: string;
  /** Whether the range's first row is treated as a header. */
  headerRow: boolean;
  /** True when a filter already exists (its range/header are then fixed). */
  hasActiveFilter: boolean;
  /** Existing criteria for this column, or null. */
  existing: ColumnFilter | null;
  /** Count of *other* columns that also carry criteria. */
  otherColumns: number;
  /** Bounded, sorted list of distinct displayed values in the data rows. */
  values: string[];
  /** True when the column holds more distinct values than `values` lists. */
  valuesTruncated: boolean;
}

/** What the filter dialog resolved to (null = cancelled, nothing changes). */
export type FilterDialogResult =
  | { action: 'apply'; headerRow: boolean; column: ColumnFilter | null }
  | { action: 'clearColumn' }
  | { action: 'clearAll' };

/**
 * Everything the sort dialog needs to edit the sheet's compound sort keys.
 * The command layer prepares it (range detection, per-column header labels)
 * so the dialog itself stays a pure presentation surface — mirrors
 * `FilterDialogInput`.
 */
export interface SortDialogInput {
  /** Human-readable A1 range of the sort, e.g. "A1:D200". */
  rangeLabel: string;
  /** Whether the range's first row is treated as a header (never reordered). */
  headerRow: boolean;
  /** Every column of the range, for the key column pickers. */
  columns: Array<{ col: number; letter: string; header: string }>;
  /** The active sort's current keys (empty when nothing is sorted yet). */
  existingKeys: SortKey[];
  /** True when a sort already exists (its range is then fixed). */
  hasActiveSort: boolean;
}

/** What the sort dialog resolved to (null = cancelled, nothing changes). */
export type SortDialogResult = { action: 'apply'; headerRow: boolean; keys: SortKey[] } | { action: 'clear' };

/** What the Text/Background Color dialog resolved to (null = cancelled, nothing changes). */
export type ColorDialogResult = { action: 'apply'; color: string } | { action: 'clear' };

/** What the Borders dialog resolved to (null = cancelled, nothing changes). */
export type BordersDialogResult = {
  action: 'apply';
  sides: Partial<Record<BorderSide, string | null>>;
};

/**
 * The UI surface the command layer talks to. Menu items, context menus,
 * keyboard shortcuts, and drag-and-drop all execute the same commands; the
 * commands drive dialogs and notifications only through this port, which
 * keeps the layer unit-testable without a DOM.
 */
export interface UiPort {
  confirmValidation(name: string, summary: ValidationSummary): Promise<boolean>;
  confirmUnsaved(names: string[]): Promise<'save' | 'discard' | 'cancel'>;
  chooseSaveOptions(tab: Tab, downloadNote: string | null): Promise<SaveOptions | null>;
  confirmUnrepresentable(encodingLabel: string, cells: UnrepresentableCell[]): Promise<boolean>;
  notifyNcr(reports: NcrCellReport[]): Promise<void>;
  confirmUndecodableEdit(cells: Array<{ row: number; col: number }>): Promise<boolean>;
  chooseReopen(tab: Tab): Promise<{ encoding: EncodingId; delimiter: DelimiterId } | null>;
  /** Explain and confirm the explicit CSV -> RSF conversion. */
  confirmConvert(reason: ConvertReason, name: string): Promise<boolean>;
  /** Explain that a spreadsheet document is saved as .rsf (per-tab, once). */
  explainRsfSave(name: string): Promise<boolean>;
  /**
   * The RSF Save dialog: pick the container's compression method. `available`
   * lists only methods writable in the current build; `current` is preselected.
   * Resolves with the chosen method id, or null when cancelled.
   */
  chooseRsfSave(
    name: string,
    current: number,
    available: number[],
    downloadNote: string | null,
  ): Promise<number | null>;
  /**
   * The CSV export options dialog: explains the lossy conversion and lets the
   * user choose encoding, line endings, and BOM behavior. Resolving with
   * options *is* the explicit confirmation; null cancels the export.
   */
  chooseExportCsv(name: string): Promise<CsvExportOptions | null>;
  /** Choose the shift direction for Insert Copied Cells… (null cancels). */
  chooseInsertShift(rows: number, cols: number): Promise<'right' | 'down' | null>;
  /**
   * The accessible Flash Fill preview: the inferred operation, affected
   * range, a bounded before/after sample, and the change/overwrite counts.
   * Resolving true is the explicit confirmation to apply; false cancels and
   * leaves the document untouched.
   */
  confirmFlashFill(preview: FlashFillPreview): Promise<boolean>;
  /**
   * The accessible filter dialog for one column: conditions, AND/OR join,
   * the bounded searchable value list, and the header-row setting. Resolves
   * with the chosen action, or null when cancelled (nothing changes).
   */
  chooseFilter(input: FilterDialogInput): Promise<FilterDialogResult | null>;
  /**
   * The accessible sort dialog: compound sort keys (column + direction) and
   * the header-row setting. Resolves with the chosen action, or null when
   * cancelled (nothing changes).
   */
  chooseSort(input: SortDialogInput): Promise<SortDialogResult | null>;
  /**
   * Ask for a worksheet name when adding, renaming, or duplicating. `validate`
   * returns an already-localized error message for an unacceptable name (empty,
   * too long, duplicate, or containing a character the formula/file syntax
   * reserves) or null when it is acceptable, so the dialog can report the
   * problem inline instead of silently refusing. Resolves with the trimmed
   * name, or null when cancelled.
   */
  promptSheetName(
    mode: 'add' | 'rename' | 'duplicate',
    current: string,
    validate: (name: string) => string | null,
  ): Promise<string | null>;
  /**
   * Confirm deleting a worksheet that holds content, a filter, or non-default
   * display settings. `referenceCount` is how many formulas elsewhere in the
   * workbook point at it and will become #REF!, so the warning is truthful.
   */
  confirmDeleteSheet(name: string, referenceCount: number): Promise<boolean>;
  /**
   * Choose which worksheet a multi-worksheet workbook exports to CSV. CSV holds
   * exactly one worksheet, so the choice is always explicit — the export never
   * silently takes the active worksheet. Resolves with the worksheet id, or
   * null when cancelled.
   */
  chooseExportSheet(sheets: Array<{ id: string; name: string }>, currentId: string): Promise<string | null>;
  /**
   * Explain and confirm the lossy XLSX export: calculated values only, no
   * formulas or formatting. Unlike CSV, every worksheet is included, so there
   * is no worksheet picker. Resolving true is the explicit confirmation to
   * proceed; false cancels and leaves the document untouched.
   */
  confirmExportXlsx(name: string): Promise<boolean>;
  confirm(title: string, message: string, okLabel: string, cancelLabel: string): Promise<boolean>;
  showMessage(title: string, message: string): Promise<void>;
  notify(text: string, kind: 'info' | 'warn' | 'error'): void;
  openFindBar(replaceMode: boolean): void;
  findNext(direction: 1 | -1): void;
  /** Open the About dialog, or its independent Keyboard Shortcuts dialog. */
  showAbout(section?: 'about' | 'shortcuts'): void;
  /** Open the offline formula & function help panel. */
  showFormulaHelp(): void;
  /**
   * Confirm a workbook-wide Replace All before anything is mutated. Returns
   * false to cancel, which must leave every worksheet untouched.
   */
  confirmReplaceAllWorkbook(input: WorkbookReplaceConfirmInput): Promise<boolean>;
  /**
   * Confirm a range move that would replace non-empty destination cells.
   * Cancel is the default; nothing is mutated until this resolves true.
   */
  confirmRangeMoveOverwrite(input: RangeMoveConfirmInput): Promise<boolean>;
  /**
   * Ask for a destination for "Move Selected Cells…" — the keyboard-equivalent
   * of dragging the selection. Returns the top-left destination cell in A1
   * notation, or null when cancelled. `validate` returns a localized error for
   * an unusable entry, or null when it is acceptable.
   */
  promptMoveTarget(
    source: string,
    suggestion: string,
    validate: (text: string) => string | null,
  ): Promise<string | null>;
  /** Edit local settings; returns the chosen maximum file size in bytes, or null when cancelled. */
  chooseSettings(currentMaxFileSize: number): Promise<number | null>;
  /**
   * The workbook Timezone… dialog: pick an IANA zone from every zone the
   * runtime knows, with `current` preselected. Resolves with the chosen zone
   * name, or null when cancelled (nothing changes).
   */
  chooseTimezone(current: string): Promise<string | null>;
  /**
   * The workbook Display language… dialog: pick `en` or `ja`, with `current`
   * preselected. Resolves with the chosen language, or null when cancelled
   * (nothing changes).
   */
  chooseDisplayLanguage(current: LocaleId): Promise<LocaleId | null>;
  /**
   * The Text Color dialog: a color picker preselected from `current` (null
   * when the selection has none, or is mixed). Resolves with the chosen
   * color, `'clear'` to remove it, or null when cancelled (nothing changes).
   */
  chooseTextColor(current: string | null): Promise<ColorDialogResult | null>;
  /** The Background Color dialog — see {@link chooseTextColor}. */
  chooseBackgroundColor(current: string | null): Promise<ColorDialogResult | null>;
  /**
   * The Borders dialog: which of the four sides carry a border (from
   * `current`) and their shared color. Resolves with every side's next state
   * (a color to set it, `null` to clear it), or null when cancelled.
   */
  chooseBorders(current: Partial<Record<BorderSide, string>>): Promise<BordersDialogResult | null>;
  /**
   * Show or hide the busy/loading indicator. `label` is already-localized
   * text describing the current operation; `null` hides the indicator.
   * `progress` is a real completion percentage (0-100) when the caller has
   * one to report — it shows a determinate progress bar in place of the
   * indeterminate spinner. Omit it when no honest percentage exists.
   */
  setBusy(label: string | null, progress?: number | null): void;
}

export type CommandId =
  | 'file.new'
  | 'file.open'
  | 'file.reopen'
  | 'file.save'
  | 'file.saveOptions'
  | 'file.closeTab'
  | 'edit.undo'
  | 'edit.redo'
  | 'edit.copy'
  | 'edit.copyAsImage'
  | 'edit.paste'
  | 'edit.insertCopiedCells'
  | 'edit.insertCopiedRows'
  | 'edit.insertCopiedCols'
  | 'edit.selectAll'
  | 'edit.revertCell'
  | 'edit.revertAll'
  | 'edit.fillDown'
  | 'edit.flashFill'
  | 'edit.moveRange'
  | 'search.find'
  | 'search.replace'
  | 'search.findNext'
  | 'search.findPrev'
  | 'sheet.convert'
  | 'sheet.insertRowAbove'
  | 'sheet.insertRowBelow'
  | 'sheet.deleteRows'
  | 'sheet.insertColLeft'
  | 'sheet.insertColRight'
  | 'sheet.deleteCols'
  | 'sheet.autoFitCols'
  | 'sheet.filter'
  | 'sheet.filterClear'
  | 'sheet.sort'
  | 'sheet.sortClear'
  | 'format.bold'
  | 'format.italic'
  | 'format.underline'
  | 'format.textColor'
  | 'format.backgroundColor'
  | 'format.borders'
  | 'format.clear'
  | 'sheet.recalculate'
  | 'sheet.timezone'
  | 'sheet.displayLanguage'
  | 'sheet.exportCsv'
  | 'sheet.exportXlsx'
  // Worksheets inside the active RSF workbook (distinct from the application
  // document tabs, whose commands are the `tab.*` ids below).
  | 'worksheet.add'
  | 'worksheet.rename'
  | 'worksheet.duplicate'
  | 'worksheet.delete'
  | 'worksheet.moveLeft'
  | 'worksheet.moveRight'
  | 'worksheet.moveFirst'
  | 'worksheet.moveLast'
  | 'worksheet.next'
  | 'worksheet.prev'
  | 'view.wrap'
  | 'view.stickyFirstRow'
  | 'view.zoom.in'
  | 'view.zoom.out'
  | 'view.zoom.50'
  | 'view.zoom.75'
  | 'view.zoom.90'
  | 'view.zoom.100'
  | 'view.zoom.110'
  | 'view.zoom.125'
  | 'view.zoom.150'
  | 'view.zoom.200'
  | 'view.zoom.reset'
  | 'view.editHints'
  | 'view.sheetFont.bizUd'
  | 'view.sheetFont.ms'
  | 'view.sheetFont.msUi'
  | 'view.theme.system'
  | 'view.theme.light'
  | 'view.theme.dark'
  | 'app.settings'
  | 'help.formula'
  | 'help.shortcuts'
  | 'lang.en'
  | 'lang.ja'
  | 'tab.next'
  | 'tab.prev'
  | 'tab.moveLeft'
  | 'tab.moveRight'
  | 'tab.moveFirst'
  | 'tab.moveLast'
  | 'help.about';

export class Commands {
  /** Set by main.ts so menu Copy/Paste can go through the clipboard controller. */
  clipboardActions: {
    copy: () => Promise<void>;
    /** Render the selection to a PNG and write it to the system clipboard. */
    copyAsImage: () => Promise<void>;
    paste: () => Promise<void>;
    /** The most recently copied range (internal clipboard, else parsed system text). */
    getCopied: () => Promise<{ matrix: string[][]; origin: Selection | null } | null>;
    /** The kind of the most recently copied selection in the internal clipboard, or null. Synchronous, for isEnabled(). */
    copiedKind: () => SelectionKind | null;
  } | null = null;

  /** Set by main.ts so commands can drive grid-only operations (measurement needs the DOM). */
  gridActions: {
    /** Auto-fit every column intersecting the current selection. */
    autoFitSelectedColumns: () => Promise<void>;
  } | null = null;

  constructor(
    private readonly state: AppState,
    private readonly ui: UiPort,
    private readonly dom: Document,
  ) {
    this.fileIo = new FileIoCommands(state, ui, dom);
    this.filter = new FilterCommands(state, ui);
    this.sort = new SortCommands(state, ui);
    this.worksheets = new WorksheetCommands(state, ui, (tab, reason) => this.ensureRsf(tab, reason));
    this.pasteFill = new PasteFillCommands(
      state,
      ui,
      (tab, reason) => this.ensureRsf(tab, reason),
      () => this.clipboardActions?.getCopied() ?? Promise.resolve(null),
    );
    this.rangeOps = new RangeOpsCommands(state, ui);
    this.format = new FormatCommands(state, ui);
  }

  /** File I/O, save/export, and CSV↔RSF conversion — see `FileIoCommands`. */
  private readonly fileIo: FileIoCommands;

  /** Filter dialog flow, apply/clear, and hidden-row queries — see `FilterCommands`. */
  private readonly filter: FilterCommands;

  /** Sort dialog flow and apply/clear — see `SortCommands`. */
  private readonly sort: SortCommands;

  /** Worksheet lifecycle and row/column structural commands — see `WorksheetCommands`. */
  private readonly worksheets: WorksheetCommands;

  /** Paste, Insert Copied …, Fill Down / drag-fill, and Flash Fill — see `PasteFillCommands`. */
  private readonly pasteFill: PasteFillCommands;

  /** Range move and find/replace-all (single sheet and workbook-wide) — see `RangeOpsCommands`. */
  private readonly rangeOps: RangeOpsCommands;

  /** Cell/range visual formatting (bold/italic/underline, colors, borders) — see `FormatCommands`. */
  private readonly format: FormatCommands;

  /** True when the command currently makes sense (drives menu-item enabled state). */
  isEnabled(id: CommandId): boolean {
    const tab = this.state.activeTab;
    switch (id) {
      case 'file.save':
      case 'file.closeTab':
      case 'search.find':
      case 'search.replace':
      case 'search.findNext':
      case 'search.findPrev':
        return tab !== null;
      case 'file.saveOptions':
        // CSV: encoding/EOL/BOM options. RSF: the compression selector.
        return tab !== null;
      case 'file.reopen':
      case 'sheet.convert':
        return tab !== null && tab.doc.kind === 'csv';
      case 'sheet.exportCsv':
        return tab !== null && tab.doc.kind === 'rsf';
      // Unlike CSV (already the format for a CSV-kind tab), no tab kind is
      // already an .xlsx file, so both kinds can export to it.
      case 'sheet.exportXlsx':
        return tab !== null;
      // Row insert/delete is meaningless while a whole-column selection is
      // active: there is no well-defined row to insert/delete around.
      case 'sheet.insertRowAbove':
      case 'sheet.insertRowBelow':
      case 'sheet.deleteRows':
        return tab !== null && tab.selection !== null && tab.selectionKind !== 'col';
      // Column insert/delete is meaningless while a whole-row selection is
      // active: there is no well-defined column to insert/delete around.
      case 'sheet.insertColLeft':
      case 'sheet.insertColRight':
      case 'sheet.deleteCols':
        return tab !== null && tab.selection !== null && tab.selectionKind !== 'row';
      case 'sheet.autoFitCols':
        return tab !== null && tab.selection !== null;
      case 'edit.selectAll':
        return tab !== null;
      case 'edit.undo':
        return tab !== null && tab.history.canUndo;
      case 'edit.redo':
        return tab !== null && tab.history.canRedo;
      // Flash Fill, Move Range, and Filter stay clickable on a CSV tab:
      // running one explains that the operation needs an RSF spreadsheet
      // document.
      case 'edit.copy':
      case 'edit.paste':
      case 'edit.fillDown':
      case 'edit.flashFill':
      case 'edit.moveRange':
      case 'sheet.filter':
      case 'sheet.sort':
        return tab?.selection != null;
      // Formatting is RSF-only, like sort/filter above, but (unlike them)
      // there is no dialog to run and explain the required conversion from —
      // toggling Bold on a CSV tab would just silently do nothing — so it is
      // disabled outright instead.
      case 'format.bold':
      case 'format.italic':
      case 'format.underline':
      case 'format.textColor':
      case 'format.backgroundColor':
      case 'format.borders':
      case 'format.clear':
        return tab !== null && tab.doc.kind === 'rsf' && tab.selection != null;
      // The async Clipboard API's image write has inconsistent browser
      // support (including on file://), so the item is hidden/disabled
      // outright there rather than failing at run time.
      case 'edit.copyAsImage':
        return (
          tab?.selection != null &&
          typeof ClipboardItem !== 'undefined' &&
          typeof navigator.clipboard?.write === 'function'
        );
      // The Insert Copied … commands additionally require a compatible kind
      // in the internal (in-app) clipboard: Cells accepts any copied kind;
      // Rows/Columns require a matching whole-row/whole-column copy. Nothing
      // copied yet (or a copy of the wrong kind) disables the item outright,
      // rather than relying on the run-time notify.nothingToInsert warning.
      case 'edit.insertCopiedCells': {
        const kind = this.clipboardActions?.copiedKind() ?? null;
        return tab?.selection != null && kind !== null;
      }
      case 'edit.insertCopiedRows': {
        const kind = this.clipboardActions?.copiedKind() ?? null;
        return tab?.selection != null && kind === 'row';
      }
      case 'edit.insertCopiedCols': {
        const kind = this.clipboardActions?.copiedKind() ?? null;
        return tab?.selection != null && kind === 'col';
      }
      case 'sheet.filterClear':
        return tab !== null && tab.doc.kind === 'rsf' && tab.doc.filter !== null;
      case 'sheet.sortClear':
        return tab !== null && tab.doc.kind === 'rsf' && tab.doc.sort !== null;
      case 'sheet.recalculate':
        // Only spreadsheet documents evaluate anything; a plain CSV has no
        // formulas and therefore nothing to recalculate.
        return tab !== null && tab.doc.kind === 'rsf';
      case 'sheet.timezone':
        // The timezone only affects TODAY()/NOW(), which only a spreadsheet
        // document evaluates.
        return tab !== null && tab.doc.kind === 'rsf';
      case 'sheet.displayLanguage':
        // The display language only affects TEXT()'s ddd/dddd tokens, which
        // only a spreadsheet document evaluates.
        return tab !== null && tab.doc.kind === 'rsf';
      case 'edit.revertCell':
        return (
          tab?.selection != null &&
          tab.doc.kind === 'csv' &&
          tab.doc.isEdited(tab.selection.row, tab.selection.col)
        );
      case 'edit.revertAll':
        return tab !== null && tab.doc.kind === 'csv' && tab.doc.isDirty;
      case 'view.zoom.50':
      case 'view.zoom.75':
      case 'view.zoom.90':
      case 'view.zoom.100':
      case 'view.zoom.110':
      case 'view.zoom.125':
      case 'view.zoom.150':
      case 'view.zoom.200':
      case 'view.zoom.reset':
      case 'view.zoom.in':
      case 'view.zoom.out':
        // Zoom applies to the active spreadsheet area; without a document
        // there is nothing to zoom.
        return tab !== null;
      // Worksheet commands need an RSF workbook: plain CSV is a single-sheet,
      // byte-preserving document (the UI explains that instead of hiding them).
      case 'worksheet.add':
      case 'worksheet.rename':
      case 'worksheet.duplicate':
        return tab !== null && tab.doc.kind === 'rsf';
      case 'worksheet.delete':
        // A workbook always keeps at least one worksheet.
        return tab !== null && tab.doc.kind === 'rsf' && tab.doc.sheetCount > 1;
      case 'worksheet.next':
      case 'worksheet.prev':
        return tab !== null && tab.doc.kind === 'rsf' && tab.doc.sheetCount > 1;
      case 'worksheet.moveLeft':
      case 'worksheet.moveFirst':
        return tab !== null && tab.doc.kind === 'rsf' && tab.doc.sheetIndex(tab.doc.activeSheetId) > 0;
      case 'worksheet.moveRight':
      case 'worksheet.moveLast':
        return (
          tab !== null &&
          tab.doc.kind === 'rsf' &&
          tab.doc.sheetIndex(tab.doc.activeSheetId) < tab.doc.sheetCount - 1
        );
      case 'tab.next':
      case 'tab.prev':
        return this.state.tabs.length > 1;
      case 'tab.moveLeft':
      case 'tab.moveFirst':
        return tab !== null && this.state.tabIndex(tab.id) > 0;
      case 'tab.moveRight':
      case 'tab.moveLast':
        return tab !== null && this.state.tabIndex(tab.id) < this.state.tabs.length - 1;
      default:
        return true;
    }
  }

  async run(id: CommandId): Promise<void> {
    const tab = this.state.activeTab;
    switch (id) {
      case 'file.new':
        this.newDocument();
        return;
      case 'file.open': {
        const files = await pickFiles(this.dom, getMaxFileSize());
        await this.openFiles(files, { confirmNonCsv: false });
        return;
      }
      case 'file.reopen':
        if (tab) await this.reopen(tab);
        return;
      case 'file.save':
        if (tab) await this.save(tab, KEEP_SAVE_OPTIONS);
        return;
      case 'file.saveOptions':
        if (tab) await this.saveWithOptions(tab);
        return;
      case 'file.closeTab':
        if (tab) await this.closeTab(tab);
        return;
      case 'edit.undo':
        if (tab) this.state.undo(tab);
        return;
      case 'edit.redo':
        if (tab) this.state.redo(tab);
        return;
      case 'edit.copy':
        await this.clipboardActions?.copy();
        return;
      case 'edit.copyAsImage':
        await this.clipboardActions?.copyAsImage();
        return;
      case 'edit.paste':
        await this.clipboardActions?.paste();
        return;
      case 'edit.insertCopiedCells':
        if (tab) await this.insertCopiedCells(tab);
        return;
      case 'edit.insertCopiedRows':
        if (tab) await this.insertCopiedAxis(tab, 'rows');
        return;
      case 'edit.insertCopiedCols':
        if (tab) await this.insertCopiedAxis(tab, 'cols');
        return;
      case 'edit.selectAll':
        if (tab) this.selectAllCells(tab);
        return;
      case 'edit.revertCell':
        if (tab?.selection) this.state.revertCell(tab, tab.selection.row, tab.selection.col);
        return;
      case 'edit.revertAll':
        if (tab && this.state.revertAll(tab)) this.ui.notify(t('notify.reverted'), 'info');
        return;
      case 'edit.fillDown':
        if (tab) await this.fillDown(tab);
        return;
      case 'edit.flashFill':
        if (tab) await this.flashFill(tab);
        return;
      case 'edit.moveRange':
        if (tab) await this.promptAndMoveRange(tab);
        return;
      case 'search.find':
        this.ui.openFindBar(false);
        return;
      case 'search.replace':
        this.ui.openFindBar(true);
        return;
      case 'search.findNext':
        this.ui.findNext(1);
        return;
      case 'search.findPrev':
        this.ui.findNext(-1);
        return;
      case 'sheet.convert':
        if (tab) await this.convertCommand(tab);
        return;
      case 'sheet.insertRowAbove':
      case 'sheet.insertRowBelow':
      case 'sheet.deleteRows':
      case 'sheet.insertColLeft':
      case 'sheet.insertColRight':
      case 'sheet.deleteCols':
        if (tab) await this.runSheetOp(tab, id);
        return;
      case 'sheet.autoFitCols':
        await this.gridActions?.autoFitSelectedColumns();
        return;
      case 'sheet.filter':
        if (tab) await this.filterDialog(tab);
        return;
      case 'sheet.filterClear':
        if (tab) this.clearAllFilters(tab);
        return;
      case 'sheet.sort':
        if (tab) await this.sortDialog(tab);
        return;
      case 'sheet.sortClear':
        if (tab) this.clearSort(tab);
        return;
      case 'format.bold':
        if (tab) this.toggleBold(tab);
        return;
      case 'format.italic':
        if (tab) this.toggleItalic(tab);
        return;
      case 'format.underline':
        if (tab) this.toggleUnderline(tab);
        return;
      case 'format.textColor':
        if (tab) await this.promptTextColor(tab);
        return;
      case 'format.backgroundColor':
        if (tab) await this.promptBackgroundColor(tab);
        return;
      case 'format.borders':
        if (tab) await this.promptBorders(tab);
        return;
      case 'format.clear':
        if (tab) this.clearFormatting(tab);
        return;
      case 'sheet.recalculate':
        // Drops every cached result and advances the clock the volatile
        // functions read. It changes no cell input, so the document does not
        // become dirty and nothing is pushed onto the undo history.
        if (tab && tab.doc.kind === 'rsf') {
          tab.doc.recalculate();
          this.state.emit('doc');
          this.ui.notify(t('notify.recalculated'), 'info');
        }
        return;
      case 'sheet.timezone':
        if (tab && tab.doc.kind === 'rsf') {
          const chosen = await this.ui.chooseTimezone(tab.doc.timezone);
          // Like Recalculate, this changes no cell input: no history entry,
          // no dirty flag. setTimezone() itself invalidates every cached
          // result so TODAY()/NOW() reflect the new zone immediately.
          if (chosen !== null) {
            tab.doc.setTimezone(chosen);
            this.state.emit('doc');
            this.ui.notify(t('notify.timezoneChanged', { timezone: tab.doc.timezone }), 'info');
          }
        }
        return;
      case 'sheet.displayLanguage':
        if (tab && tab.doc.kind === 'rsf') {
          const chosen = await this.ui.chooseDisplayLanguage(tab.doc.displayLanguage);
          // Like Timezone, this changes no cell input: no history entry, no
          // dirty flag. setDisplayLanguage() itself invalidates every cached
          // result so TEXT()'s ddd/dddd tokens reflect the new language
          // immediately.
          if (chosen !== null) {
            tab.doc.setDisplayLanguage(chosen);
            this.state.emit('doc');
            this.ui.notify(
              t('notify.displayLanguageChanged', { language: t(`language.${tab.doc.displayLanguage}`) }),
              'info',
            );
          }
        }
        return;
      case 'sheet.exportCsv':
        if (tab) await this.exportCsv(tab);
        return;
      case 'sheet.exportXlsx':
        if (tab) await this.exportXlsx(tab);
        return;
      case 'view.wrap':
        this.state.setWrapCells(!this.state.wrapCells);
        return;
      case 'view.stickyFirstRow':
        this.state.setStickyFirstRow(!this.state.stickyFirstRow);
        return;
      case 'view.zoom.50':
      case 'view.zoom.75':
      case 'view.zoom.90':
      case 'view.zoom.100':
      case 'view.zoom.110':
      case 'view.zoom.125':
      case 'view.zoom.150':
      case 'view.zoom.200':
        // Application-level zoom, never the browser's page zoom (whose
        // shortcuts are deliberately not intercepted).
        if (tab) this.state.setTabZoom(tab, Number(id.slice('view.zoom.'.length)));
        return;
      case 'view.zoom.reset':
        if (tab) this.state.setTabZoom(tab, DEFAULT_SHEET_ZOOM);
        return;
      case 'view.zoom.in':
      case 'view.zoom.out':
        // Step through the shared zoom presets (same state as the menu and
        // Ctrl/Cmd + mouse wheel; browser zoom is never touched).
        if (tab) this.zoomStep(tab, id === 'view.zoom.in' ? 1 : -1);
        return;
      case 'view.editHints':
        setEditHints(!getEditHints());
        // Pure preference toggle; re-emit so menus and editors refresh.
        this.state.emit('view');
        return;
      case 'view.sheetFont.bizUd':
      case 'view.sheetFont.ms':
      case 'view.sheetFont.msUi': {
        const fonts: Record<typeof id, SheetFontId> = {
          'view.sheetFont.bizUd': 'biz-ud',
          'view.sheetFont.ms': 'ms',
          'view.sheetFont.msUi': 'ms-ui',
        };
        setSheetFont(fonts[id]);
        // Applying the font is pure CSS; re-emit so the menu checkmark and the
        // grid (which measures with the active font) refresh.
        this.state.emit('view');
        return;
      }
      case 'view.theme.system':
      case 'view.theme.light':
      case 'view.theme.dark': {
        setTheme(id.slice('view.theme.'.length) as ThemeChoice);
        // Applying the theme is pure CSS (data-theme attribute); re-emit so the
        // menu checkmark refreshes. Document bytes are never touched.
        this.state.emit('view');
        return;
      }
      case 'app.settings': {
        const chosen = await this.ui.chooseSettings(getMaxFileSize());
        if (chosen !== null) {
          const applied = setMaxFileSize(chosen);
          this.ui.notify(t('notify.settingsSaved', { size: Math.round(applied / (1024 * 1024)) }), 'info');
        }
        return;
      }
      case 'lang.en':
      case 'lang.ja':
        setLocale(id.slice(5) as LocaleId);
        return;
      case 'worksheet.add':
        if (tab) await this.addWorksheet(tab);
        return;
      case 'worksheet.rename':
        if (tab) await this.renameWorksheet(tab);
        return;
      case 'worksheet.duplicate':
        if (tab) await this.duplicateWorksheet(tab);
        return;
      case 'worksheet.delete':
        if (tab) await this.deleteWorksheet(tab);
        return;
      case 'worksheet.moveLeft':
      case 'worksheet.moveRight':
      case 'worksheet.moveFirst':
      case 'worksheet.moveLast':
        if (tab) this.moveActiveWorksheet(tab, id);
        return;
      case 'worksheet.next':
      case 'worksheet.prev':
        if (tab) this.cycleWorksheet(tab, id === 'worksheet.next' ? 1 : -1);
        return;
      case 'tab.next':
        this.state.cycleTab(1);
        return;
      case 'tab.prev':
        this.state.cycleTab(-1);
        return;
      case 'tab.moveLeft':
      case 'tab.moveRight':
      case 'tab.moveFirst':
      case 'tab.moveLast':
        if (tab) this.moveActiveTab(tab, id);
        return;
      case 'help.about':
        this.ui.showAbout('about');
        return;
      case 'help.shortcuts':
        this.ui.showAbout('shortcuts');
        return;
      case 'help.formula':
        this.ui.showFormulaHelp();
        return;
    }
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
    return this.fileIo.openFiles(files, opts);
  }

  async openDroppedFiles(fileList: File[], handles: Array<FileSystemFileHandle | null>): Promise<void> {
    return this.fileIo.openDroppedFiles(fileList, handles);
  }

  private async reopen(tab: Tab): Promise<void> {
    return this.fileIo.reopen(tab);
  }

  private async saveWithOptions(tab: Tab): Promise<void> {
    return this.fileIo.saveWithOptions(tab);
  }

  /**
   * Save a tab. CSV: a normal save (all options "keep") with no edits writes
   * the originally loaded bytes verbatim; with edits, only edited field
   * ranges are reserialized. RSF: the document is saved in the versioned
   * .rsf JSON format (never silently into the original .csv).
   * Returns true when the file was actually saved.
   */
  async save(tab: Tab, options: SaveOptions): Promise<boolean> {
    return this.fileIo.save(tab, options);
  }

  /**
   * Explicit, confirmed lossy CSV export of an RSF document. See
   * `FileIoCommands.exportCsv` for the full behavior contract.
   */
  async exportCsv(tab: Tab): Promise<boolean> {
    return this.fileIo.exportCsv(tab);
  }

  /**
   * Explicit, confirmed lossy XLSX export. See `FileIoCommands.exportXlsx`
   * for the full behavior contract.
   */
  async exportXlsx(tab: Tab): Promise<boolean> {
    return this.fileIo.exportXlsx(tab);
  }

  async closeTab(tab: Tab): Promise<void> {
    return this.fileIo.closeTab(tab);
  }

  /**
   * Ensure the tab holds an RSF spreadsheet document, asking for the
   * explicit conversion when it is still CSV. Never converts silently.
   */
  async ensureRsf(tab: Tab, reason: ConvertReason): Promise<RsfDocument | null> {
    return this.fileIo.ensureRsf(tab, reason);
  }

  /**
   * File > New: create a blank spreadsheet document in a new active tab. See
   * `FileIoCommands.newDocument` for the full behavior contract.
   */
  newDocument(): Tab {
    return this.fileIo.newDocument();
  }

  /**
   * The explicit `Convert to RSF…` command. See `FileIoCommands.convertCommand`
   * for the full behavior contract.
   */
  private async convertCommand(tab: Tab): Promise<void> {
    return this.fileIo.convertCommand(tab);
  }

  /**
   * Commit a cell edit from the grid or formula bar. Entering a formula
   * (`=...`) into a CSV document offers the explicit RSF conversion; if
   * declined, the text is kept as a plain literal value.
   */
  async commitCellEdit(tab: Tab, row: number, col: number, value: string): Promise<boolean> {
    if (tab.doc.kind === 'csv' && isFormula(value)) {
      await this.ensureRsf(tab, 'formula');
    }
    return this.state.editCell(tab, row, col, value);
  }

  // ----- Worksheets (inside an RSF workbook) -----
  // See `WorksheetCommands` for the full behavior contract of each method below.

  private async addWorksheet(tab: Tab): Promise<void> {
    return this.worksheets.addWorksheet(tab);
  }

  private async renameWorksheet(tab: Tab): Promise<void> {
    return this.worksheets.renameWorksheet(tab);
  }

  private async duplicateWorksheet(tab: Tab): Promise<void> {
    return this.worksheets.duplicateWorksheet(tab);
  }

  private async deleteWorksheet(tab: Tab): Promise<void> {
    return this.worksheets.deleteWorksheet(tab);
  }

  private moveActiveWorksheet(tab: Tab, id: CommandId): void {
    this.worksheets.moveActiveWorksheet(tab, id);
  }

  private cycleWorksheet(tab: Tab, offset: number): void {
    this.worksheets.cycleWorksheet(tab, offset);
  }

  private async runSheetOp(tab: Tab, id: CommandId): Promise<void> {
    return this.worksheets.runSheetOp(tab, id);
  }

  /**
   * Paste a rectangular matrix as one atomic, undoable operation. See
   * `PasteFillCommands.applyPaste` for the full behavior contract.
   */
  async applyPaste(tab: Tab, matrix: string[][], origin: Selection | null): Promise<boolean> {
    return this.pasteFill.applyPaste(tab, matrix, origin);
  }

  /**
   * Edit > Insert Copied Cells…. See `PasteFillCommands.insertCopiedCells`
   * for the full behavior contract.
   */
  async insertCopiedCells(tab: Tab): Promise<boolean> {
    return this.pasteFill.insertCopiedCells(tab);
  }

  /**
   * Edit > Insert Copied Rows / Insert Copied Columns. See
   * `PasteFillCommands.insertCopiedAxis` for the full behavior contract.
   */
  async insertCopiedAxis(tab: Tab, axis: 'rows' | 'cols'): Promise<boolean> {
    return this.pasteFill.insertCopiedAxis(tab, axis);
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

  /** Move the active tab (menu/keyboard path; announced via the status toast). */
  private moveActiveTab(tab: Tab, id: CommandId): void {
    const index = this.state.tabIndex(tab.id);
    const target =
      id === 'tab.moveFirst'
        ? 0
        : id === 'tab.moveLast'
          ? this.state.tabs.length - 1
          : id === 'tab.moveLeft'
            ? index - 1
            : index + 1;
    if (this.state.moveTab(tab.id, target)) {
      this.ui.notify(
        t('notify.tabMoved', {
          name: tab.name,
          pos: this.state.tabIndex(tab.id) + 1,
          total: this.state.tabs.length,
        }),
        'info',
      );
    }
  }

  /**
   * Fill Down: the top row of the current selection is copied into the rows
   * below it. See `PasteFillCommands.fillDown` for the full behavior contract.
   */
  async fillDown(tab: Tab): Promise<boolean> {
    return this.pasteFill.fillDown(tab);
  }

  /**
   * Fill a source range into a destination range that extends it downward
   * and/or rightward. See `PasteFillCommands.applyFill` for the full behavior
   * contract, including the numeric-series (AutoFill) rules.
   */
  async applyFill(tab: Tab, source: CellRange, dest: CellRange): Promise<boolean> {
    return this.pasteFill.applyFill(tab, source, dest);
  }

  /**
   * Flash Fill: infer a deterministic text transformation from typed
   * examples, preview it, and apply it after explicit confirmation. See
   * `PasteFillCommands.flashFill` for the full behavior contract.
   */
  async flashFill(tab: Tab): Promise<boolean> {
    return this.pasteFill.flashFill(tab);
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
    return this.filter.hiddenRows(tab);
  }

  /**
   * Sheet > Filter… (also the column-header filter buttons and the context
   * menu): open the filter dialog and apply the result as one atomic,
   * undoable operation. See `FilterCommands.filterDialog` for the full
   * behavior contract.
   */
  async filterDialog(tab: Tab, targetCol?: number): Promise<boolean> {
    return this.filter.filterDialog(tab, targetCol);
  }

  /** Sheet > Clear All Filters: every row becomes visible again (undoable). See `FilterCommands.clearAllFilters`. */
  clearAllFilters(tab: Tab): boolean {
    return this.filter.clearAllFilters(tab);
  }

  // ----- Sorting (RSF spreadsheet documents only; view-only, unsaved) -----

  /** The active tab's sort display order, or null when unsorted. See `SortCommands.sortOrder`. */
  sortOrder(tab: Tab): number[] | null {
    return this.sort.sortOrder(tab);
  }

  /**
   * Sheet > Sort…: open the sort dialog and apply the result. See
   * `SortCommands.sortDialog` for the full behavior contract.
   */
  async sortDialog(tab: Tab): Promise<boolean> {
    return this.sort.sortDialog(tab);
  }

  /** Sheet > Clear Sort: rows return to document order. See `SortCommands.clearSort`. */
  clearSort(tab: Tab): boolean {
    return this.sort.clearSort(tab);
  }

  /** Clear every cell in the selected range as one undoable operation. See
   *  `RangeOpsCommands.clearRange` for the full behavior contract. */
  clearRange(tab: Tab): boolean {
    return this.rangeOps.clearRange(tab);
  }

  // ----- Moving a selected range (RSF worksheets only) -----

  /**
   * "Move Selected Cells…": the keyboard-equivalent of dragging the selection.
   * See `RangeOpsCommands.promptAndMoveRange` for the full behavior contract.
   */
  async promptAndMoveRange(tab: Tab): Promise<boolean> {
    return this.rangeOps.promptAndMoveRange(tab);
  }

  /**
   * Move the selected rectangle by (deltaRow, deltaCol) as one atomic,
   * singly-undoable operation. See `RangeOpsCommands.moveRange` for the full
   * behavior contract.
   */
  async moveRange(tab: Tab, source: CellRange, deltaRow: number, deltaCol: number): Promise<boolean> {
    return this.rangeOps.moveRange(tab, source, deltaRow, deltaCol);
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
    return this.rangeOps.replaceAll(query, replacement, scope);
  }

  // ----- Cell/range formatting (RSF worksheets only) -----

  /** Toggle Bold on the selection. See `FormatCommands.toggleBold` for the full behavior contract. */
  toggleBold(tab: Tab): boolean {
    return this.format.toggleBold(tab);
  }

  /** Toggle Italic on the selection. See `FormatCommands.toggleItalic`. */
  toggleItalic(tab: Tab): boolean {
    return this.format.toggleItalic(tab);
  }

  /** Toggle Underline on the selection. See `FormatCommands.toggleUnderline`. */
  toggleUnderline(tab: Tab): boolean {
    return this.format.toggleUnderline(tab);
  }

  /** Open the Text Color dialog and apply the choice. See `FormatCommands.promptTextColor`. */
  async promptTextColor(tab: Tab): Promise<boolean> {
    return this.format.promptTextColor(tab);
  }

  /** Open the Background Color dialog and apply the choice. See `FormatCommands.promptBackgroundColor`. */
  async promptBackgroundColor(tab: Tab): Promise<boolean> {
    return this.format.promptBackgroundColor(tab);
  }

  /** Open the Borders dialog and apply the choice. See `FormatCommands.promptBorders`. */
  async promptBorders(tab: Tab): Promise<boolean> {
    return this.format.promptBorders(tab);
  }

  /** Remove every style property from the selection. See `FormatCommands.clearFormatting`. */
  clearFormatting(tab: Tab): boolean {
    return this.format.clearFormatting(tab);
  }

  /** Whether Bold/Italic/Underline is "on" for the whole selection. See `FormatCommands.isActive`. */
  isFormatActive(tab: Tab, key: 'bold' | 'italic' | 'underline'): boolean {
    return this.format.isActive(tab, key);
  }
}
