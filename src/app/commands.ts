// SPDX-License-Identifier: MIT
import type { DelimiterId } from '../core/byte-csv-parser';
import type { CellRange } from '../core/clipboard';
import { getRsfCodec, initCsvEngine } from '../core/csv-engine';
import {
  buildCsvExportBytes,
  newCsvExportScan,
  scanCsvExportRow,
  type CsvExportOptions,
  type CsvExportScan,
} from '../core/csv-export';
import { detectEncoding, type EncodingId } from '../core/encoding';
import { inferLinearSeries, seriesValueAt } from '../core/fill-series';
import {
  filterDataTop,
  rowMatchesFilter,
  validateFilter,
  MAX_FILTER_ROWS,
  MAX_FILTER_VALUES,
  type ColumnFilter,
  type SheetFilter,
} from '../core/filter';
import {
  flashFillRow,
  inferFlashFillCandidates,
  type FlashFillExample,
  type FlashFillOp,
} from '../core/flash-fill';
import {
  cellLabel,
  columnLabel,
  isFormula,
  isValidSheetName,
  MAX_SHEET_NAME_LENGTH,
  shiftFormulaRefs,
} from '../core/formula';
import type { CellChange, HistoryEntry, Operation } from '../core/history';
import { LosslessDocument } from '../core/lossless-document';
import {
  MAX_WORKSHEETS,
  RsfDocument,
  RSF_EXTENSION,
  RSF_LEGACY_EXTENSION,
  NEW_DOC_ROWS,
  NEW_DOC_COLS,
  type RsfParseError,
} from '../core/rsf-document';
import type { Worksheet } from '../core/worksheet';
import { forEachIndexSliced } from '../core/scheduler';
import { replaceAllInValue, type CompiledQuery } from '../core/search';
import {
  serializeDocument,
  KEEP_SAVE_OPTIONS,
  type NcrCellReport,
  type SaveOptions,
  type UnrepresentableCell,
} from '../core/serializer';
import { validateDocument, type ValidationSummary } from '../core/validation';
import { AppState, defaultSheetName, type Selection, type Tab } from './app-state';
import {
  pickFiles,
  readFileObject,
  requestSaveHandle,
  saveBytes,
  saveBytesAs,
  type OpenedFile,
  type SaveOutcome,
} from './file-access';
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

/**
 * Why a CSV document needs converting to an RSF spreadsheet document.
 * `command` is the explicit `Convert to RSF…` menu command (which opens a new
 * tab); the others are implicit conversions triggered by an edit that a
 * byte-preserving CSV cannot represent (they convert the current tab in place).
 */
export type ConvertReason = 'formula' | 'paste' | 'structure' | 'fill' | 'command';

/** Everything the Flash Fill preview dialog shows before anything is applied. */
export interface FlashFillPreview {
  /** Localized, human-readable description of the inferred operation. */
  description: string;
  /** Affected cell range in A1 notation (e.g. "C2:C120"). */
  range: string;
  /** Number of cells the fill would change. */
  changeCount: number;
  /** How many of those cells are currently non-empty (would be overwritten). */
  overwriteCount: number;
  /** Bounded before/after sample of the proposed changes. */
  sample: Array<{ cell: string; before: string; after: string }>;
}

/**
 * Flash Fill never looks beyond this many rows around the selection, so the
 * contiguous-block detection stays bounded on very large sheets.
 */
export const FLASH_FILL_MAX_BLOCK_ROWS = 100_000;

/** Bounded number of before/after rows shown in the Flash Fill preview. */
export const FLASH_FILL_SAMPLE_SIZE = 8;

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
  confirm(title: string, message: string, okLabel: string, cancelLabel: string): Promise<boolean>;
  showMessage(title: string, message: string): Promise<void>;
  notify(text: string, kind: 'info' | 'warn' | 'error'): void;
  openFindBar(replaceMode: boolean): void;
  findNext(direction: 1 | -1): void;
  showAbout(): void;
  /** Open the offline formula & function help panel. */
  showFormulaHelp(): void;
  /** Edit local settings; returns the chosen maximum file size in bytes, or null when cancelled. */
  chooseSettings(currentMaxFileSize: number): Promise<number | null>;
  /**
   * Show or hide the busy/loading indicator. `label` is already-localized
   * text describing the current operation; `null` hides the indicator.
   */
  setBusy(label: string | null): void;
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
  | 'edit.paste'
  | 'edit.insertCopiedCells'
  | 'edit.insertCopiedRows'
  | 'edit.insertCopiedCols'
  | 'edit.selectAll'
  | 'edit.revertCell'
  | 'edit.revertAll'
  | 'edit.fillDown'
  | 'edit.flashFill'
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
  | 'sheet.exportCsv'
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
  | 'lang.en'
  | 'lang.ja'
  | 'tab.next'
  | 'tab.prev'
  | 'tab.moveLeft'
  | 'tab.moveRight'
  | 'tab.moveFirst'
  | 'tab.moveLast'
  | 'help.about';

const CSV_LIKE_EXTENSIONS = ['.csv', '.tsv', '.txt', RSF_EXTENSION, RSF_LEGACY_EXTENSION];

/**
 * Cell-count threshold above which an operation counts as "large": its
 * read/prepare phase runs in cooperative time slices behind the progress
 * indicator (with a percentage), and the atomic apply is wrapped in the busy
 * state. Below the threshold operations complete imperceptibly fast and run
 * synchronously.
 */
export const LARGE_OP_CELLS = 20_000;

/**
 * Whole-number progress percentage for loading labels. Uses floor so 100% is
 * never shown while work remains — a label only reads 100% after the
 * operation has actually completed.
 */
function pct(done: number, total: number): number {
  return total > 0 ? Math.min(100, Math.floor((done / total) * 100)) : 0;
}

export class Commands {
  /** Set by main.ts so menu Copy/Paste can go through the clipboard controller. */
  clipboardActions: {
    copy: () => Promise<void>;
    paste: () => Promise<void>;
    /** The most recently copied range (internal clipboard, else parsed system text). */
    getCopied: () => Promise<{ matrix: string[][]; origin: Selection | null } | null>;
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
  ) {}

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
      case 'sheet.insertRowAbove':
      case 'sheet.insertRowBelow':
      case 'sheet.deleteRows':
      case 'sheet.insertColLeft':
      case 'sheet.insertColRight':
      case 'sheet.deleteCols':
      case 'sheet.autoFitCols':
        return tab !== null && tab.selection !== null;
      case 'edit.selectAll':
        return tab !== null;
      case 'edit.undo':
        return tab !== null && tab.history.canUndo;
      case 'edit.redo':
        return tab !== null && tab.history.canRedo;
      // The Insert Copied … commands, Flash Fill, and Filter stay clickable
      // on a CSV tab: running one explains that the operation needs an RSF
      // spreadsheet document (and Insert warns when nothing has been copied).
      case 'edit.copy':
      case 'edit.paste':
      case 'edit.fillDown':
      case 'edit.flashFill':
      case 'edit.insertCopiedCells':
      case 'edit.insertCopiedRows':
      case 'edit.insertCopiedCols':
      case 'sheet.filter':
        return tab?.selection != null;
      case 'sheet.filterClear':
        return tab !== null && tab.doc.kind === 'rsf' && tab.doc.filter !== null;
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
      case 'sheet.exportCsv':
        if (tab) await this.exportCsv(tab);
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
        this.ui.showAbout();
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
  setBusy(label: string | null): void {
    this.ui.setBusy(label);
  }

  /**
   * Yield to the browser so a just-shown busy indicator actually paints
   * before a synchronous, CPU-heavy step (parsing, serializing) blocks the
   * main thread. Two animation frames guarantee a paint has occurred; falls
   * back to a macrotask where rAF is unavailable (tests, workers).
   */
  private nextPaint(): Promise<void> {
    const raf = (globalThis as { requestAnimationFrame?: (cb: () => void) => void }).requestAnimationFrame;
    if (typeof raf === 'function') {
      return new Promise((resolve) => raf(() => raf(() => resolve())));
    }
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  /**
   * Run a heavy operation behind the busy indicator. The label is shown, the
   * UI is given a chance to paint it, the work runs, and the indicator is
   * always cleared afterwards (even on error).
   */
  private async withBusy<T>(label: string, work: () => T | Promise<T>): Promise<T> {
    this.ui.setBusy(label);
    await this.nextPaint();
    try {
      return await work();
    } finally {
      this.ui.setBusy(null);
    }
  }

  /** Open picked or dropped files. Every entry point (menu, shortcut, drop) funnels through here. */
  async openFiles(files: OpenedFile[], opts: { confirmNonCsv: boolean }): Promise<void> {
    for (const file of files) {
      await this.openFile(file, opts);
    }
  }

  async openDroppedFiles(fileList: File[], handles: Array<FileSystemFileHandle | null>): Promise<void> {
    const files: OpenedFile[] = [];
    const maxSize = getMaxFileSize();
    for (let i = 0; i < fileList.length; i++) {
      try {
        files.push(await readFileObject(fileList[i], handles[i] ?? null, maxSize));
      } catch (err) {
        this.ui.notify(
          t('notify.openFailed', {
            name: fileList[i].name,
            error: err instanceof Error ? err.message : String(err),
          }),
          'error',
        );
      }
    }
    await this.openFiles(files, { confirmNonCsv: true });
  }

  private async openFile(file: OpenedFile, opts: { confirmNonCsv: boolean }): Promise<void> {
    if (file.tooLarge || file.size > getMaxFileSize()) {
      await this.ui.showMessage(
        t('dialog.tooLarge.title'),
        t('dialog.tooLarge.message', {
          name: file.name,
          size: Math.ceil(file.size / (1024 * 1024)),
          limit: Math.round(getMaxFileSize() / (1024 * 1024)),
        }),
      );
      return;
    }

    const lowerName = file.name.toLowerCase();
    if (lowerName.endsWith(RSF_EXTENSION) || lowerName.endsWith(RSF_LEGACY_EXTENSION)) {
      await this.openRsfFile(file);
      return;
    }

    if (opts.confirmNonCsv) {
      const lower = file.name.toLowerCase();
      if (!CSV_LIKE_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
        const open = await this.ui.confirm(
          t('dialog.nonCsv.title'),
          t('dialog.nonCsv.message', { name: file.name }),
          t('dialog.nonCsv.open'),
          t('dialog.nonCsv.cancel'),
        );
        if (!open) {
          return;
        }
      }
    }

    const existing = await this.findExistingTab(file);
    if (existing) {
      this.state.activateTab(existing.id);
      this.ui.notify(t('notify.sameFile', { name: file.name }), 'info');
      return;
    }

    const detection = detectEncoding(file.bytes);
    if (detection.unsupportedCandidate) {
      await this.ui.showMessage(
        t('dialog.unsupported.title'),
        t('dialog.unsupported.message', {
          name: file.name,
          candidate: detection.unsupportedCandidate,
          encoding: t(`encoding.${detection.encoding}`),
        }),
      );
    } else if (detection.uncertain) {
      await this.ui.showMessage(
        t('dialog.unsupported.title'),
        t('dialog.uncertain.message', { name: file.name }),
      );
    }

    let doc: LosslessDocument;
    try {
      doc = await this.withBusy(t('loading.opening', { name: file.name }), async () => {
        // The embedded WASM engine initializes in the background at startup;
        // parsing waits for it here (idempotent, usually already resolved) so
        // the first open still uses the fast engine.
        await initCsvEngine();
        return LosslessDocument.fromBytes(file.bytes);
      });
    } catch (err) {
      this.ui.notify(
        t('notify.openFailed', { name: file.name, error: err instanceof Error ? err.message : String(err) }),
        'error',
      );
      return;
    }

    if (doc.diagnostics.length > 0) {
      const openAnyway = await this.ui.confirmValidation(file.name, validateDocument(doc));
      if (!openAnyway) {
        return;
      }
    }

    this.state.addTab(file.name, doc, file.handle);
  }

  private async openRsfFile(file: OpenedFile): Promise<void> {
    const result = await this.withBusy(t('loading.opening', { name: file.name }), async () => {
      await initCsvEngine(); // reading DEFLATE-compressed containers needs the WASM codec
      return RsfDocument.fromBytes(file.bytes, file.name);
    });
    if (!result.ok) {
      const reasonKey: Record<RsfParseError, string> = {
        'bad-magic': 'dialog.rsfInvalid.badMagic',
        'bad-version': 'dialog.rsfInvalid.badVersion',
        'bad-shape': 'dialog.rsfInvalid.badShape',
        checksum: 'dialog.rsfInvalid.checksum',
        'unsupported-compression': 'dialog.rsfInvalid.compression',
        'too-large': 'dialog.rsfInvalid.tooLarge',
      };
      await this.ui.showMessage(
        t('dialog.rsfInvalid.title'),
        t('dialog.rsfInvalid.message', { name: file.name, reason: t(reasonKey[result.error]) }),
      );
      return;
    }
    // A legacy `.rcsv` file opens as a migration: rename to `.rsf`, drop the
    // original handle (a `.rcsv` handle must not be overwritten with `.rsf`
    // bytes), and mark it unsaved so the next Save writes a fresh `.rsf` file.
    // The original `.rcsv` on disk is never modified.
    const isLegacy = file.name.toLowerCase().endsWith(RSF_LEGACY_EXTENSION);
    const name = isLegacy ? `${file.name.slice(0, -RSF_LEGACY_EXTENSION.length)}${RSF_EXTENSION}` : file.name;
    const tab = this.state.addTab(name, result.doc, isLegacy ? null : file.handle);
    tab.rsfSaveExplained = true; // opened as a spreadsheet file; no explanation needed
    if (result.doc.filterDropped) {
      // The container carried filter metadata that failed validation; it was
      // ignored (never guessed at) and the sheet itself loaded normally.
      this.ui.notify(t('notify.filterDropped', { name }), 'warn');
    }
    if (isLegacy) {
      result.doc.markUnsaved();
      this.state.emit('doc');
      this.ui.notify(t('notify.rsfMigrated', { name }), 'info');
    }
  }

  private async findExistingTab(file: OpenedFile): Promise<Tab | null> {
    if (file.handle) {
      for (const tab of this.state.tabs) {
        if (!tab.handle) continue;
        try {
          if (await file.handle.isSameEntry(tab.handle)) {
            return tab;
          }
        } catch {
          // isSameEntry can fail across contexts; fall through to the heuristic.
        }
      }
    }
    return this.state.findTabForFile(file.name, file.bytes);
  }

  private async reopen(tab: Tab): Promise<void> {
    if (tab.doc.kind !== 'csv') {
      return;
    }
    // The reopen dialog itself warns that unsaved edits are discarded.
    const choice = await this.ui.chooseReopen(tab);
    if (!choice) {
      return;
    }
    const doc = tab.doc.reinterpret(choice);
    this.state.setBaseline(tab, doc);
    if (doc.diagnostics.length > 0) {
      await this.ui.confirmValidation(tab.name, validateDocument(doc));
    }
  }

  private async saveWithOptions(tab: Tab): Promise<void> {
    if (tab.doc.kind === 'rsf') {
      await this.saveRsfWithOptions(tab);
      return;
    }
    if (tab.doc.kind !== 'csv') {
      return;
    }
    const willDownload = tab.handle ? null : t('save.downloadNote', { name: tab.name });
    const options = await this.ui.chooseSaveOptions(tab, willDownload);
    if (!options) {
      return;
    }
    await this.save(tab, options);
  }

  /**
   * The RSF Save dialog: choose the container's compression method and save.
   * The active codec's writable methods are offered (Zstandard recommended and
   * preselected for new documents; an existing document preselects its own
   * method). A plain Ctrl+S save always reuses the document's current method,
   * so the method never changes silently — only this dialog changes it.
   */
  private async saveRsfWithOptions(tab: Tab): Promise<void> {
    const doc = tab.doc;
    if (doc.kind !== 'rsf') {
      return;
    }
    // Normalize the extension first (sync) so the picker suggests the right name.
    if (!tab.name.toLowerCase().endsWith(RSF_EXTENSION)) {
      tab.name = `${tab.name}${RSF_EXTENSION}`;
    }
    // A document with no associated file needs a destination. Open the save
    // picker NOW — synchronously, before the async engine init, the
    // compression dialog, and the compression itself — so the browser's user
    // activation (required by showSaveFilePicker) is still valid. Only the
    // call must be in the gesture; awaiting the result immediately is fine.
    // When the File System Access API is unavailable this resolves to null and
    // the completed bytes are downloaded instead.
    let handle = tab.handle;
    if (!handle) {
      try {
        handle = await requestSaveHandle(tab.name, 'rsf');
      } catch (err) {
        // Picker cancelled: no compression change, no save, no association.
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        this.ui.notify(
          t('notify.saveFailed', { error: err instanceof Error ? err.message : String(err) }),
          'error',
        );
        return;
      }
    }
    // The codec only reports its real writable methods once the WASM engine is
    // instantiated; without it, only the uncompressed store method is offered.
    await initCsvEngine();
    const codec = getRsfCodec();
    const available = codec.writableMethods();
    const current = doc.compression ?? codec.defaultMethod();
    const willDownload = handle ? null : t('save.downloadNote', { name: tab.name });
    const method = await this.ui.chooseRsfSave(tab.name, current, available, willDownload);
    if (method === null) {
      return;
    }
    doc.setCompression(method);
    // The dialog already committed to saving as .rsf, so the write path below
    // should not show the one-time explanation again.
    tab.rsfSaveExplained = true;
    await this.encodeAndWriteRsf(tab, handle);
  }

  /**
   * Save a tab. CSV: a normal save (all options "keep") with no edits writes
   * the originally loaded bytes verbatim; with edits, only edited field
   * ranges are reserialized. RSF: the document is saved in the versioned
   * .rsf JSON format (never silently into the original .csv).
   * Returns true when the file was actually saved.
   */
  async save(tab: Tab, options: SaveOptions): Promise<boolean> {
    if (tab.doc.kind === 'rsf') {
      return this.saveRsf(tab);
    }
    if (tab.doc.isDirty) {
      const undecodableEdits = tab.doc.listEditedUndecodable();
      if (undecodableEdits.length > 0) {
        const proceed = await this.ui.confirmUndecodableEdit(undecodableEdits);
        if (!proceed) {
          return false;
        }
      }
    }

    let result = serializeDocument(tab.doc, options, false);
    let ncrReports: NcrCellReport[] = [];
    if (!result.ok) {
      const targetEncoding = options.encoding === 'keep' ? tab.doc.encoding : options.encoding;
      const proceed = await this.ui.confirmUnrepresentable(
        t(`encoding.${targetEncoding}`),
        result.unrepresentable,
      );
      if (!proceed) {
        return false;
      }
      result = serializeDocument(tab.doc, options, true);
      if (!result.ok) {
        this.ui.notify(t('notify.saveFailed', { error: 'serialization' }), 'error');
        return false;
      }
      ncrReports = result.ncrReplacements;
    }

    let outcome: SaveOutcome;
    try {
      outcome = await saveBytes(this.dom, tab.name, result.bytes, tab.handle);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return false;
      }
      this.ui.notify(
        t('notify.saveFailed', { error: err instanceof Error ? err.message : String(err) }),
        'error',
      );
      return false;
    }

    if (outcome.fellBack) {
      this.ui.notify(t('notify.permissionDenied'), 'warn');
    }
    if (outcome.mode === 'overwrite') {
      this.ui.notify(t('notify.savedOverwrite'), 'info');
    } else {
      this.ui.notify(t('notify.savedDownload', { name: outcome.downloadName ?? tab.name }), 'info');
    }

    if (ncrReports.length > 0) {
      await this.ui.notifyNcr(ncrReports);
    }

    // The saved byte sequence becomes the new baseline and history is cleared.
    const encoding = options.encoding === 'keep' ? tab.doc.encoding : options.encoding;
    const baseline = LosslessDocument.fromBytes(result.bytes, { encoding, delimiter: tab.doc.delimiter });
    this.state.setBaseline(tab, baseline);
    return true;
  }

  /**
   * Save a spreadsheet document as .rsf (with a one-time explanation).
   *
   * The save picker MUST be opened synchronously from the triggering user
   * gesture: `showSaveFilePicker` requires a live user activation, which is
   * lost across the `await`ed explanation dialog and the `await`ed
   * compression. So the destination handle is acquired first (before any
   * await), and only then does the async explanation + compression + write
   * run. An existing associated handle overwrites directly with no picker; a
   * new/Save-As document opens the picker; a build without the File System
   * Access API downloads the finished bytes.
   */
  private async saveRsf(tab: Tab): Promise<boolean> {
    if (tab.doc.kind !== 'rsf') {
      return false;
    }
    // Normalize the extension first (sync) so the picker suggests the .rsf name.
    if (!tab.name.toLowerCase().endsWith(RSF_EXTENSION)) {
      tab.name = `${tab.name}${RSF_EXTENSION}`;
    }
    // Acquire the destination up front, inside the user gesture. `handle` is
    // null when the File System Access API is unavailable (the finished bytes
    // are then downloaded); the picker call itself must precede every await.
    let handle = tab.handle;
    if (!handle) {
      try {
        handle = await requestSaveHandle(tab.name, 'rsf');
      } catch (err) {
        // Picker cancelled: nothing is saved, the file association is
        // untouched, the document stays dirty, and no success is reported.
        if (err instanceof DOMException && err.name === 'AbortError') {
          return false;
        }
        this.ui.notify(
          t('notify.saveFailed', { error: err instanceof Error ? err.message : String(err) }),
          'error',
        );
        return false;
      }
    }
    // One-time explanation that a spreadsheet is written in the .rsf format.
    if (!tab.rsfSaveExplained) {
      const proceed = await this.ui.explainRsfSave(tab.name);
      if (!proceed) {
        return false;
      }
      tab.rsfSaveExplained = true;
    }
    return this.encodeAndWriteRsf(tab, handle);
  }

  /**
   * Serialize + compress the RSF document behind the busy indicator, then
   * write the completed bytes to `handle` (an already-acquired destination:
   * an existing association or a freshly-picked file). When `handle` is null
   * the File System Access API was unavailable and the bytes are downloaded.
   *
   * Serialization compresses the body and computes the checksum; the busy
   * indicator is shown so a large sheet never appears to freeze. Large sheets
   * collect their cells in cooperative time slices (phase 1, with a
   * percentage) before the compression phase (phase 2, labeled — compression
   * happens inside the codec, so no honest percentage exists for it). A
   * cancelled encode (the tab changed while yielding) writes nothing, leaves
   * the in-memory document intact, and returns false. The write is atomic
   * (createWritable → write → close); a download never reports an overwrite.
   */
  private async encodeAndWriteRsf(tab: Tab, handle: FileSystemFileHandle | null): Promise<boolean> {
    const doc = tab.doc;
    if (doc.kind !== 'rsf') {
      return false;
    }
    // Record the tab's live view state (zoom, overridden column widths) so
    // the container persists it; presentational only, never dirties the doc.
    doc.setDisplaySettings(tab.zoom, tab.colWidths);
    const bytes = await this.withBusy(t('loading.savingRsf', { name: tab.name }), async () => {
      await initCsvEngine(); // compression runs in the WASM codec when available
      // The whole workbook is serialized, not just the active worksheet.
      let totalCells = 0;
      for (const sheet of doc.sheets) {
        totalCells += sheet.rowCount * sheet.columnCount;
      }
      if (totalCells <= LARGE_OP_CELLS) {
        return doc.toBytes();
      }
      // One sliced scan across every worksheet's rows, so the percentage
      // describes the whole save rather than one worksheet of it.
      const perSheet: Array<Array<[number, number, string]>> = doc.sheets.map(() => []);
      const completed = await forEachIndexSliced(doc.totalRows, (i) => doc.collectFlatRow(i, perSheet), {
        onProgress: (done, total) =>
          this.ui.setBusy(t('loading.savingSerialize', { name: tab.name, pct: pct(done, total) })),
        shouldStop: () => tab.doc !== doc,
      });
      if (!completed || tab.doc !== doc) {
        return null;
      }
      this.ui.setBusy(t('loading.savingCompress', { name: tab.name }));
      await this.nextPaint();
      return doc.toBytesFromSheetCells(perSheet);
    });
    if (bytes === null) {
      return false;
    }
    let outcome: SaveOutcome;
    try {
      // The handle was already acquired inside the gesture; `saveBytes`
      // overwrites through it or, with no handle, produces a download.
      outcome = await saveBytes(this.dom, tab.name, bytes, handle);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return false;
      }
      this.ui.notify(
        t('notify.saveFailed', { error: err instanceof Error ? err.message : String(err) }),
        'error',
      );
      return false;
    }
    if (outcome.fellBack) {
      this.ui.notify(t('notify.permissionDenied'), 'warn');
    }
    // Associate the destination only after a successful overwrite so a
    // cancelled/failed save never mutates the tab's file association.
    if (outcome.handle) {
      tab.handle = outcome.handle;
    }
    if (outcome.mode === 'overwrite') {
      this.ui.notify(t('notify.savedOverwrite'), 'info');
    } else {
      this.ui.notify(t('notify.savedDownload', { name: outcome.downloadName ?? tab.name }), 'info');
    }
    this.state.markTabSaved(tab);
    this.state.emit('tabs');
    return true;
  }

  /**
   * Explicit, confirmed lossy CSV export of an RSF document. The options
   * dialog (encoding, line endings, BOM) doubles as the confirmation; the
   * displayed values are then validated against the chosen encoding in a
   * time-sliced scan behind the progress indicator. Unrepresentable
   * characters cancel the export by default — continuing uses the documented
   * numeric-character-reference replacement and reports the affected cells.
   * Nothing in this flow ever mutates the source document or marks it saved.
   */
  async exportCsv(tab: Tab): Promise<boolean> {
    if (tab.doc.kind !== 'rsf') {
      return false;
    }
    const doc = tab.doc;
    // CSV holds exactly one worksheet. A multi-worksheet workbook therefore
    // requires an explicit choice — the export never silently takes the active
    // worksheet — and the dialog states that only that worksheet is written and
    // that formulas become their calculated values.
    let sheetId = doc.activeSheetId;
    if (doc.sheetCount > 1) {
      const chosen = await this.ui.chooseExportSheet(
        doc.sheets.map((s) => ({ id: s.id, name: s.name })),
        doc.activeSheetId,
      );
      if (chosen === null || tab.doc !== doc) {
        return false;
      }
      sheetId = chosen;
    }
    const sheet = doc.sheetById(sheetId);
    if (!sheet) {
      return false;
    }
    const options = await this.ui.chooseExportCsv(tab.name);
    if (!options || tab.doc !== doc) {
      return false;
    }
    const base = tab.name.replace(/\.(rsf|rcsv)$/i, '');
    // A multi-worksheet workbook names the exported worksheet in the file name
    // so several exports from one workbook do not collide.
    const name = (doc.sheetCount > 1 ? `${base}-${sheet.name}` : base) + '.csv';
    const label = t('loading.exporting', { name });

    // Sliced, read-only scan of the chosen worksheet's displayed (calculated)
    // values. Aborts — producing nothing — if the tab's document changes.
    const scanValues = async (allowNcr: boolean): Promise<CsvExportScan | null> => {
      const scan = newCsvExportScan();
      const completed = await forEachIndexSliced(
        sheet.rowCount,
        (r) => {
          const values: string[] = [];
          for (let c = 0; c < sheet.columnCount; c++) {
            values.push(doc.getSheetDisplayValue(sheetId, r, c));
          }
          scanCsvExportRow(scan, r, values, options.encoding, allowNcr);
        },
        {
          onProgress: (done, total) => this.ui.setBusy(`${label} (${pct(done, total)}%)`),
          shouldStop: () => tab.doc !== doc,
        },
      );
      return completed && tab.doc === doc ? scan : null;
    };

    let scan = await this.withBusy(label, () => scanValues(false));
    if (!scan) {
      return false;
    }
    let ncrReports: NcrCellReport[] = [];
    if (scan.unrepresentable.length > 0) {
      const proceed = await this.ui.confirmUnrepresentable(
        t(`encoding.${options.encoding}`),
        scan.unrepresentable,
      );
      if (!proceed) {
        return false; // cancel by default; the document is untouched
      }
      scan = await this.withBusy(label, () => scanValues(true));
      if (!scan) {
        return false;
      }
      ncrReports = scan.ncrReplacements;
    }
    const rows = scan.rows;
    const bytes = await this.withBusy(label, () => buildCsvExportBytes(rows, doc.delimiter, options));
    try {
      const outcome = await saveBytesAs(this.dom, name, bytes, 'csv');
      this.ui.notify(
        outcome.mode === 'overwrite'
          ? t('notify.exportedCsv', { name })
          : t('notify.exportedCsvDownload', { name: outcome.downloadName ?? name }),
        'info',
      );
      if (ncrReports.length > 0) {
        await this.ui.notifyNcr(ncrReports);
      }
      return true;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return false;
      }
      this.ui.notify(
        t('notify.saveFailed', { error: err instanceof Error ? err.message : String(err) }),
        'error',
      );
      return false;
    }
  }

  async closeTab(tab: Tab): Promise<void> {
    if (tab.doc.isDirty) {
      const choice = await this.ui.confirmUnsaved([tab.name]);
      if (choice === 'cancel') {
        return;
      }
      if (choice === 'save') {
        const saved = await this.save(tab, KEEP_SAVE_OPTIONS);
        if (!saved) {
          return;
        }
      }
    }
    this.state.closeTab(tab.id);
  }

  /**
   * Ensure the tab holds an RSF spreadsheet document, asking for the
   * explicit conversion when it is still CSV. Never converts silently.
   */
  async ensureRsf(tab: Tab, reason: ConvertReason): Promise<RsfDocument | null> {
    if (tab.doc.kind === 'rsf') {
      return tab.doc;
    }
    const ok = await this.ui.confirmConvert(reason, tab.name);
    if (!ok) {
      return null;
    }
    // Large documents build the converted copy in cooperative time slices
    // behind a percentage progress label; the in-place swap is then atomic.
    // If the scan aborts (the tab changed meanwhile) nothing is modified.
    let prebuilt: RsfDocument | undefined;
    if (tab.doc.rowCount * Math.max(1, tab.doc.columnCount) > LARGE_OP_CELLS) {
      const label = t('loading.converting', { name: tab.name });
      const built = await this.withBusy(label, () => this.buildRsfSliced(tab, label));
      if (!built) {
        return null;
      }
      prebuilt = built;
    }
    const doc = this.state.convertToRsf(tab, prebuilt);
    if (doc) {
      this.ui.notify(t('notify.converted', { name: tab.name }), 'info');
    }
    return doc;
  }

  /**
   * Collect a CSV document's current values and build the equivalent RSF
   * document. Large documents are scanned in cooperative time slices with a
   * percentage progress label so the conversion never blocks the main thread;
   * small ones convert synchronously. Returns null when the sliced scan was
   * abandoned because the tab's document changed while yielding — nothing has
   * been created or modified in that case.
   */
  private async buildRsfSliced(tab: Tab, label: string): Promise<RsfDocument | null> {
    const doc = tab.doc;
    if (doc.kind !== 'csv') {
      return null;
    }
    const columnCount = Math.max(1, doc.columnCount);
    if (doc.rowCount * columnCount <= LARGE_OP_CELLS) {
      return RsfDocument.fromLossless(doc, tab.name, defaultSheetName());
    }
    const rows: string[][] = [];
    const completed = await forEachIndexSliced(
      doc.rowCount,
      (r) => {
        const row = new Array<string>(columnCount).fill('');
        const fieldCount = doc.fieldCount(r);
        for (let c = 0; c < fieldCount; c++) {
          row[c] = doc.getValue(r, c);
        }
        rows.push(row);
      },
      {
        onProgress: (done, total) =>
          this.ui.setBusy(
            `${label} (${pct(done, total)}% — ${t('loading.rowsOf', { done: done.toLocaleString('en-US'), total: total.toLocaleString('en-US') })})`,
          ),
        shouldStop: () => tab.doc !== doc,
      },
    );
    if (!completed || tab.doc !== doc) {
      return null;
    }
    return RsfDocument.fromValues(tab.name, doc.delimiter, rows, columnCount, defaultSheetName());
  }

  /** Blank-document counter so each File > New tab gets a distinct default name. */
  private newDocCount = 0;

  /**
   * File > New: create a blank spreadsheet document in a new active tab. New
   * documents are RSF because a blank spreadsheet may gain formulas,
   * structural edits, metadata, and user-defined dimensions that a plain CSV
   * cannot hold. The document starts unsaved (marked dirty) and is saved as
   * `.rsf`; its filename and location are chosen on the first save. Creating
   * it never mutates any other open document.
   */
  newDocument(): Tab {
    this.newDocCount += 1;
    const suffix = this.newDocCount > 1 ? `-${this.newDocCount}` : '';
    const name = `${t('untitled.new')}${suffix}${RSF_EXTENSION}`;
    const doc = RsfDocument.blank(name, NEW_DOC_ROWS, NEW_DOC_COLS, defaultSheetName());
    return this.state.addTab(name, doc, null);
  }

  /**
   * The explicit `Convert to RSF…` command. Unlike the implicit conversions
   * (which convert the current tab in place when an edit requires it), this
   * creates a *new* RSF tab from the CSV's current (edited) values and leaves
   * the source CSV tab — and the original file on disk — untouched. The heavy
   * conversion runs behind the loading indicator.
   */
  private async convertCommand(tab: Tab): Promise<void> {
    if (tab.doc.kind !== 'csv') {
      return;
    }
    const ok = await this.ui.confirmConvert('command', tab.name);
    if (!ok) {
      return;
    }
    // The value collection runs in time slices with percentage progress for
    // large documents; small ones build synchronously behind the indicator.
    const label = t('loading.converting', { name: tab.name });
    const built = await this.withBusy(label, () => this.buildRsfSliced(tab, label));
    if (!built) {
      return;
    }
    const doc = this.state.convertToRsfNewTab(tab, built);
    if (doc) {
      this.ui.notify(t('notify.convertedNewTab', { name: doc.name }), 'info');
    }
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

  /**
   * Validate a proposed worksheet name against the documented policy —
   * non-empty after trimming, within {@link MAX_SHEET_NAME_LENGTH}, free of
   * characters the formula and file syntax reserve, and unique
   * case-insensitively — returning an already-localized message or null.
   */
  private validateSheetName(doc: RsfDocument, name: string, exceptId?: string): string | null {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      return t('sheet.error.empty');
    }
    if (trimmed.length > MAX_SHEET_NAME_LENGTH) {
      return t('sheet.error.tooLong', { max: MAX_SHEET_NAME_LENGTH });
    }
    if (!isValidSheetName(trimmed)) {
      return t('sheet.error.chars');
    }
    if (!doc.isSheetNameAvailable(trimmed, exceptId)) {
      return t('sheet.error.duplicate', { name: trimmed });
    }
    return null;
  }

  /** True when the workbook can still take another worksheet (warns when not). */
  private canAddWorksheet(doc: RsfDocument): boolean {
    if (doc.sheetCount < MAX_WORKSHEETS) {
      return true;
    }
    this.ui.notify(t('notify.sheetLimit', { max: MAX_WORKSHEETS }), 'warn');
    return false;
  }

  /** Add a new empty worksheet after the active one and activate it. */
  private async addWorksheet(tab: Tab): Promise<void> {
    const doc = tab.doc;
    if (doc.kind !== 'rsf' || !this.canAddWorksheet(doc)) {
      return;
    }
    const suggested = doc.uniqueSheetName(t('sheet.defaultName', { n: doc.sheetCount + 1 }));
    const name = await this.ui.promptSheetName('add', suggested, (candidate) =>
      this.validateSheetName(doc, candidate),
    );
    if (name === null || tab.doc !== doc) {
      return;
    }
    const sheet = this.state.addSheet(tab, name.trim());
    if (sheet) {
      this.ui.notify(t('notify.sheetAdded', { name: sheet.name }), 'info');
    }
  }

  /** Rename the active worksheet, updating cross-sheet formulas workbook-wide. */
  private async renameWorksheet(tab: Tab): Promise<void> {
    const doc = tab.doc;
    if (doc.kind !== 'rsf') {
      return;
    }
    const sheet = doc.activeSheet;
    const before = sheet.name;
    const name = await this.ui.promptSheetName('rename', before, (candidate) =>
      this.validateSheetName(doc, candidate, sheet.id),
    );
    if (name === null || tab.doc !== doc) {
      return;
    }
    if (this.state.renameSheet(tab, sheet.id, name.trim())) {
      this.ui.notify(t('notify.sheetRenamed', { before, after: name.trim() }), 'info');
    }
  }

  /**
   * Duplicate the active worksheet. Large worksheets are copied in cooperative
   * time slices behind a percentage progress label; the copy is built to the
   * side and only inserted once it is complete, so cancelling (or a tab
   * change) leaves the workbook exactly as it was.
   */
  private async duplicateWorksheet(tab: Tab): Promise<void> {
    const doc = tab.doc;
    if (doc.kind !== 'rsf' || !this.canAddWorksheet(doc)) {
      return;
    }
    const source = doc.activeSheet;
    const suggested = doc.uniqueSheetName(t('sheet.copyName', { name: source.name }));
    const name = await this.ui.promptSheetName('duplicate', suggested, (candidate) =>
      this.validateSheetName(doc, candidate),
    );
    if (name === null || tab.doc !== doc) {
      return;
    }
    const finalName = name.trim();
    let prebuilt: Worksheet | undefined;
    if (source.rowCount * source.columnCount > LARGE_OP_CELLS) {
      const label = t('loading.duplicatingSheet', { name: source.name });
      const built = await this.withBusy(label, async () => {
        const shell = doc.duplicateWorksheetShell(source.id, finalName);
        if (!shell) {
          return null;
        }
        const completed = await forEachIndexSliced(source.rowCount, (r) => source.copyRowInto(r, shell), {
          onProgress: (done, total) => this.ui.setBusy(`${label} (${pct(done, total)}%)`),
          shouldStop: () => tab.doc !== doc,
        });
        // An abandoned copy is simply discarded: nothing was inserted.
        return completed && tab.doc === doc ? shell : null;
      });
      if (!built) {
        return;
      }
      prebuilt = built;
    }
    const copy = this.state.duplicateSheet(tab, source.id, finalName, prebuilt);
    if (copy) {
      this.ui.notify(t('notify.sheetDuplicated', { name: copy.name }), 'info');
    }
  }

  /**
   * Delete the active worksheet. A workbook always keeps at least one
   * worksheet. Deletion is confirmed whenever the worksheet holds meaningful
   * content — cell data, a filter, or non-default display settings — or when
   * formulas elsewhere reference it, and the confirmation states how many
   * formulas will become #REF!.
   */
  private async deleteWorksheet(tab: Tab): Promise<void> {
    const doc = tab.doc;
    if (doc.kind !== 'rsf') {
      return;
    }
    if (doc.sheetCount <= 1) {
      this.ui.notify(t('notify.cannotDeleteLastSheet'), 'warn');
      return;
    }
    const sheet = doc.activeSheet;
    const references = this.state.countReferencesToSheet(doc, sheet.id);
    const meaningful =
      sheet.hasAnyContent() ||
      sheet.filter !== null ||
      sheet.displayZoom !== undefined ||
      sheet.displayColWidths.some((w) => w > 0) ||
      references > 0;
    if (meaningful) {
      const ok = await this.ui.confirmDeleteSheet(sheet.name, references);
      if (!ok || tab.doc !== doc) {
        return;
      }
    }
    if (this.state.deleteSheet(tab, sheet.id)) {
      this.ui.notify(t('notify.sheetDeleted', { name: sheet.name }), 'info');
    }
  }

  /** Move the active worksheet within the workbook's worksheet order. */
  private moveActiveWorksheet(tab: Tab, id: CommandId): void {
    const doc = tab.doc;
    if (doc.kind !== 'rsf') {
      return;
    }
    const from = doc.sheetIndex(doc.activeSheetId);
    const last = doc.sheetCount - 1;
    const to =
      id === 'worksheet.moveLeft'
        ? from - 1
        : id === 'worksheet.moveRight'
          ? from + 1
          : id === 'worksheet.moveFirst'
            ? 0
            : last;
    if (this.state.moveSheet(tab, doc.activeSheetId, to)) {
      this.ui.notify(
        t('notify.sheetMoved', {
          name: doc.activeSheet.name,
          pos: doc.sheetIndex(doc.activeSheetId) + 1,
          total: doc.sheetCount,
        }),
        'info',
      );
    }
  }

  /** Activate the next/previous worksheet, wrapping around. */
  private cycleWorksheet(tab: Tab, offset: number): void {
    const doc = tab.doc;
    if (doc.kind !== 'rsf' || doc.sheetCount < 2) {
      return;
    }
    const index = doc.sheetIndex(doc.activeSheetId);
    const next = doc.sheets[(index + offset + doc.sheetCount) % doc.sheetCount];
    this.state.setActiveSheet(tab, next.id);
  }

  /** Row/column structural commands, driven by the selected range. */
  private async runSheetOp(tab: Tab, id: CommandId): Promise<void> {
    const range = this.state.selectedRange(tab);
    if (!range) {
      return;
    }
    const doc = await this.ensureRsf(tab, 'structure');
    if (!doc) {
      return;
    }
    const clampedRange = this.state.selectedRange(tab) ?? range;
    const rows = clampedRange.bottom - clampedRange.top + 1;
    const cols = clampedRange.right - clampedRange.left + 1;
    // Structural row/column changes clear an active filter atomically (its
    // stored range would otherwise drift against the moved rows — documented
    // behavior; Undo restores structure and filter together). The user is
    // told when that happened.
    const hadFilter = doc.filter !== null;
    const done = (applied: boolean): void => {
      if (applied && hadFilter && doc.filter === null) {
        this.ui.notify(t('notify.filterClearedByStructure'), 'info');
      }
    };
    switch (id) {
      case 'sheet.insertRowAbove':
        done(this.state.insertRows(tab, clampedRange.top, rows));
        return;
      case 'sheet.insertRowBelow':
        done(this.state.insertRows(tab, clampedRange.bottom + 1, rows));
        return;
      case 'sheet.deleteRows': {
        if (rows >= doc.rowCount) {
          this.ui.notify(t('notify.cannotDeleteAll'), 'warn');
          return;
        }
        if (this.state.hasContent(tab, 'row', clampedRange.top, rows)) {
          const ok = await this.ui.confirm(
            t('dialog.deleteRows.title'),
            t('dialog.deleteRows.message', { n: rows }),
            t('dialog.delete.ok'),
            t('dialog.delete.cancel'),
          );
          if (!ok) {
            return;
          }
        }
        done(this.state.deleteRows(tab, clampedRange.top, rows));
        return;
      }
      case 'sheet.insertColLeft':
        done(this.state.insertCols(tab, clampedRange.left, cols));
        return;
      case 'sheet.insertColRight':
        done(this.state.insertCols(tab, clampedRange.right + 1, cols));
        return;
      case 'sheet.deleteCols': {
        if (cols >= doc.columnCount) {
          this.ui.notify(t('notify.cannotDeleteAll'), 'warn');
          return;
        }
        if (this.state.hasContent(tab, 'col', clampedRange.left, cols)) {
          const ok = await this.ui.confirm(
            t('dialog.deleteCols.title'),
            t('dialog.deleteCols.message', { n: cols }),
            t('dialog.delete.ok'),
            t('dialog.delete.cancel'),
          );
          if (!ok) {
            return;
          }
        }
        done(this.state.deleteCols(tab, clampedRange.left, cols));
        return;
      }
    }
  }

  /**
   * Paste a rectangular matrix as one atomic, undoable operation, preserving
   * the copied shape. Normally the paste starts at the active cell. When a
   * larger destination range is selected and each of its dimensions is an
   * exact multiple of the source's, the source pattern repeats to fill the
   * whole selected destination (documented behavior; otherwise the range is
   * pasted once at the active cell). For byte-preserving CSV documents the
   * paste must fit inside the existing cells; pastes that would change the
   * row/column structure require the explicit RSF conversion. `origin` is
   * set for app-internal pastes so relative formula references adjust like a
   * conventional spreadsheet (per tiled offset when the pattern repeats).
   */
  async applyPaste(tab: Tab, matrix: string[][], origin: Selection | null): Promise<boolean> {
    if (!tab.selection || matrix.length === 0 || matrix[0].length === 0) {
      return false;
    }
    const srcH = matrix.length;
    const srcW = matrix[0].length;
    // Pattern-repeat: fill a larger selected destination when its dimensions
    // are exact multiples of the source's. The paste then anchors at the
    // destination's top-left corner.
    let at = tab.selection;
    let height = srcH;
    let width = srcW;
    const dest = this.state.selectedRange(tab);
    if (dest) {
      const destRows = dest.bottom - dest.top + 1;
      const destCols = dest.right - dest.left + 1;
      if (
        (destRows > srcH || destCols > srcW) &&
        destRows % srcH === 0 &&
        destCols % srcW === 0 &&
        destRows >= srcH &&
        destCols >= srcW
      ) {
        at = { row: dest.top, col: dest.left };
        height = destRows;
        width = destCols;
      }
    }
    const containsFormula = matrix.some((row) => row.some((v) => isFormula(v)));

    if (tab.doc.kind === 'csv') {
      const doc = tab.doc;
      let fits = at.row + height <= doc.rowCount;
      if (fits) {
        for (let i = 0; i < height && fits; i++) {
          if (at.col + width > doc.fieldCount(at.row + i)) {
            fits = false;
          }
        }
      }
      if (!fits || containsFormula) {
        const converted = await this.ensureRsf(tab, !fits ? 'paste' : 'formula');
        if (!converted) {
          if (!fits) {
            return false;
          }
          // Formula paste declined: paste as plain literals below.
        }
      }
    }

    // Rows hidden by an active filter are never modified by a paste: the
    // change list skips them (documented, notified below when it happens).
    const hidden = this.state.hiddenRows(tab);

    // Small pastes apply synchronously; large ones build their change list in
    // cooperative time slices behind a percentage progress label (the mutation
    // itself is then applied atomically, so an abandoned scan changes nothing).
    if (height * width <= LARGE_OP_CELLS) {
      return this.applyPasteNow(tab, matrix, origin, at, height, width, hidden);
    }
    const doc = tab.doc;
    const totalCells = height * width;
    return this.withBusy(t('loading.pasting'), async () => {
      const changes: CellChange[] = [];
      const completed = await forEachIndexSliced(
        height,
        (i) => this.buildPasteRowChanges(doc, matrix, origin, at, width, i, changes, hidden),
        {
          onProgress: (done, total) =>
            this.ui.setBusy(
              t('loading.pastingCells', {
                done: (done * width).toLocaleString('en-US'),
                total: totalCells.toLocaleString('en-US'),
                pct: pct(done, total),
              }),
            ),
          shouldStop: () => tab.doc !== doc,
        },
      );
      if (!completed || tab.doc !== doc) {
        return false;
      }
      return this.applyPasteChanges(tab, at, height, width, changes, hidden);
    });
  }

  /** Build and push the paste entry (synchronous, atomic; small pastes). */
  private applyPasteNow(
    tab: Tab,
    matrix: string[][],
    origin: Selection | null,
    at: Selection,
    height: number,
    width: number,
    hidden: Set<number> | null,
  ): boolean {
    const changes: CellChange[] = [];
    for (let i = 0; i < height; i++) {
      this.buildPasteRowChanges(tab.doc, matrix, origin, at, width, i, changes, hidden);
    }
    return this.applyPasteChanges(tab, at, height, width, changes, hidden);
  }

  /** Collect the changes for one destination row of a (possibly tiled) paste. */
  private buildPasteRowChanges(
    doc: Tab['doc'],
    matrix: string[][],
    origin: Selection | null,
    at: Selection,
    width: number,
    i: number,
    changes: CellChange[],
    hidden: Set<number> | null = null,
  ): void {
    const srcH = matrix.length;
    const srcW = matrix[0].length;
    const row = at.row + i;
    if (hidden?.has(row)) {
      return; // filtered-out rows are never modified by a paste
    }
    if (doc.kind === 'csv') {
      for (let j = 0; j < width; j++) {
        const col = at.col + j;
        const value = matrix[i % srcH][j % srcW];
        const current = doc.getValue(row, col);
        if (value === current) {
          continue;
        }
        const before = doc.isEdited(row, col) ? current : null;
        const after = value === doc.getOriginalValue(row, col) ? null : value;
        changes.push({ row, col, before, after });
      }
      return;
    }
    for (let j = 0; j < width; j++) {
      const col = at.col + j;
      let value = matrix[i % srcH][j % srcW];
      if (origin && isFormula(value)) {
        // Each cell shifts by its offset from its own tiled source cell.
        const deltaRow = row - (origin.row + (i % srcH));
        const deltaCol = col - (origin.col + (j % srcW));
        if (deltaRow !== 0 || deltaCol !== 0) {
          value = shiftFormulaRefs(value, deltaRow, deltaCol);
        }
      }
      const before = doc.getValue(row, col);
      if (before === value) {
        continue;
      }
      changes.push({ row, col, before, after: value });
    }
  }

  /** Apply prepared paste changes atomically (CSV bulk edit / RSF entry with grid growth). */
  private applyPasteChanges(
    tab: Tab,
    at: Selection,
    height: number,
    width: number,
    changes: CellChange[],
    hidden: Set<number> | null = null,
  ): boolean {
    const doc = tab.doc;
    let applied: boolean;
    if (doc.kind === 'csv') {
      applied = this.state.bulkEdit(tab, changes, 'history.paste');
    } else {
      // RSF: the grid may grow to fit the paste (atomically undoable).
      const needRows = Math.max(0, at.row + height - doc.rowCount);
      const needCols = Math.max(0, at.col + width - doc.columnCount);
      const ops: Operation[] = [];
      if (needRows > 0) {
        ops.push({
          type: 'rows',
          action: 'insert',
          index: doc.rowCount,
          count: needRows,
          data: Array.from({ length: needRows }, () => []),
        });
      }
      if (needCols > 0) {
        ops.push({
          type: 'cols',
          action: 'insert',
          index: doc.columnCount,
          count: needCols,
          data: Array.from({ length: needCols }, () => []),
        });
      }
      ops.push({ type: 'cells', changes });
      const entry: HistoryEntry = { label: 'history.paste', ops };
      applied = this.state.pushEntry(tab, entry);
    }
    if (applied) {
      this.state.setSelection(tab, at, { row: at.row + height - 1, col: at.col + width - 1 });
      this.notifyHiddenRowsSkipped(at.row, at.row + height - 1, hidden);
    }
    return applied;
  }

  /** Tell the user when an operation left filtered-out (hidden) rows untouched. */
  private notifyHiddenRowsSkipped(top: number, bottom: number, hidden: Set<number> | null): void {
    if (!hidden || hidden.size === 0) {
      return;
    }
    let skipped = 0;
    for (let r = top; r <= bottom; r++) {
      if (hidden.has(r)) {
        skipped += 1;
      }
    }
    if (skipped > 0) {
      this.ui.notify(t('notify.hiddenRowsSkipped', { n: skipped }), 'info');
    }
  }

  /**
   * Edit > Insert Copied Cells…: insert the most recently copied range at the
   * selection, shifting existing cells right (whole columns) or down (whole
   * rows). Structural insertion is a spreadsheet operation, so a plain CSV
   * document requires the explicit RSF conversion first (the confirmation
   * dialog explains why); declining leaves the document untouched.
   */
  async insertCopiedCells(tab: Tab): Promise<boolean> {
    if (!tab.selection) {
      return false;
    }
    const copied = await this.clipboardActions?.getCopied();
    if (!copied || copied.matrix.length === 0 || copied.matrix[0].length === 0) {
      this.ui.notify(t('notify.nothingToInsert'), 'warn');
      return false;
    }
    const direction = await this.ui.chooseInsertShift(copied.matrix.length, copied.matrix[0].length);
    if (!direction) {
      return false;
    }
    const doc = await this.ensureRsf(tab, 'structure');
    if (!doc) {
      return false;
    }
    const at = tab.selection;
    if (!at) {
      return false;
    }
    const prepared = await this.prepareCopiedMatrix(tab, copied, at, 'loading.insertCells');
    if (!prepared) {
      return false;
    }
    const large = copied.matrix.length * copied.matrix[0].length > LARGE_OP_CELLS;
    const hadFilter = doc.filter !== null;
    const run = (): boolean =>
      this.state.insertCopiedCells(tab, at, prepared.matrix, direction, prepared.origin);
    const applied = large ? await this.withBusy(t('loading.inserting'), run) : run();
    if (applied && hadFilter && doc.filter === null) {
      this.ui.notify(t('notify.filterClearedByStructure'), 'info');
    }
    return applied;
  }

  /**
   * Edit > Insert Copied Rows / Insert Copied Columns. The documented,
   * user-visible rule (also stated by the completion notification): copied
   * rows are inserted as whole rows **above** the selection's top row; copied
   * columns are inserted as whole columns **to the left of** the selection's
   * left column. Copied cells keep their source columns (rows) when the copy
   * origin is known — i.e. for in-app copies; a system-clipboard range of
   * unknown origin starts at column A (row 1). Existing rows/columns shift
   * without data loss; formula references adjust exactly like Insert
   * Rows/Columns, and relative references inside the inserted formulas shift
   * by their offset from the copied location. Structural insertion is a
   * spreadsheet operation, so a plain CSV document asks for the explicit RSF
   * conversion first; declining (or an aborted preparation) leaves the
   * document untouched. The whole insertion is one atomic, undoable entry,
   * and large ranges run behind the percentage progress indicator.
   */
  async insertCopiedAxis(tab: Tab, axis: 'rows' | 'cols'): Promise<boolean> {
    if (!tab.selection) {
      return false;
    }
    const copied = await this.clipboardActions?.getCopied();
    if (!copied || copied.matrix.length === 0 || copied.matrix[0].length === 0) {
      this.ui.notify(t('notify.nothingToInsert'), 'warn');
      return false;
    }
    const doc = await this.ensureRsf(tab, 'structure');
    if (!doc) {
      return false;
    }
    const range = this.state.selectedRange(tab);
    if (!range) {
      return false;
    }
    const at: Selection =
      axis === 'rows'
        ? { row: range.top, col: copied.origin?.col ?? 0 }
        : { row: copied.origin?.row ?? 0, col: range.left };
    const prepared = await this.prepareCopiedMatrix(
      tab,
      copied,
      at,
      axis === 'rows' ? 'loading.insertRows' : 'loading.insertCols',
    );
    if (!prepared) {
      return false;
    }
    const height = copied.matrix.length;
    const width = copied.matrix[0].length;
    const direction = axis === 'rows' ? ('down' as const) : ('right' as const);
    const large = height * width > LARGE_OP_CELLS;
    const hadFilter = doc.filter !== null;
    const run = (): boolean =>
      this.state.insertCopiedCells(tab, at, prepared.matrix, direction, prepared.origin);
    const applied = large ? await this.withBusy(t('loading.inserting'), run) : run();
    if (applied && hadFilter && doc.filter === null) {
      this.ui.notify(t('notify.filterClearedByStructure'), 'info');
    }
    if (applied) {
      this.ui.notify(
        axis === 'rows'
          ? t('notify.insertedRows', { n: height, row: at.row + 1 })
          : t('notify.insertedCols', { n: width, col: columnLabel(at.col) }),
        'info',
      );
    }
    return applied;
  }

  /**
   * Prepare the matrix an Insert Copied … operation actually inserts.
   * Relative references in copied formulas shift by the offset from the copy
   * origin: small ranges are shifted synchronously inside the atomic state
   * operation, while large ranges are pre-shifted here in cooperative time
   * slices behind a percentage progress label and then inserted atomically
   * (returned with `origin: null` because they are already shifted). Returns
   * null when the preparation was abandoned because the tab's document
   * changed while yielding — nothing has been modified in that case.
   */
  private async prepareCopiedMatrix(
    tab: Tab,
    copied: { matrix: string[][]; origin: Selection | null },
    at: Selection,
    labelKey: string,
  ): Promise<{ matrix: string[][]; origin: Selection | null } | null> {
    const { matrix, origin } = copied;
    const height = matrix.length;
    const width = matrix[0].length;
    if (height * width <= LARGE_OP_CELLS) {
      return copied;
    }
    const doc = tab.doc;
    const deltaRow = origin ? at.row - origin.row : 0;
    const deltaCol = origin ? at.col - origin.col : 0;
    const totalCells = height * width;
    const shifted: string[][] = new Array<string[]>(height);
    const completed = await this.withBusy(
      t(labelKey, { done: 0, total: totalCells.toLocaleString('en-US'), pct: 0 }),
      () =>
        forEachIndexSliced(
          height,
          (i) => {
            const out = matrix[i].slice();
            if (origin && (deltaRow !== 0 || deltaCol !== 0)) {
              for (let j = 0; j < out.length; j++) {
                if (isFormula(out[j])) {
                  out[j] = shiftFormulaRefs(out[j], deltaRow, deltaCol);
                }
              }
            }
            shifted[i] = out;
          },
          {
            onProgress: (done, total) =>
              this.ui.setBusy(
                t(labelKey, {
                  done: (done * width).toLocaleString('en-US'),
                  total: totalCells.toLocaleString('en-US'),
                  pct: pct(done, total),
                }),
              ),
            shouldStop: () => tab.doc !== doc,
          },
        ),
    );
    if (!completed || tab.doc !== doc) {
      return null;
    }
    return { matrix: shifted, origin: null };
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
   * below it (within the selection). Requires a selection spanning at least
   * two rows.
   */
  async fillDown(tab: Tab): Promise<boolean> {
    const range = this.state.selectedRange(tab);
    if (!range || range.bottom <= range.top) {
      return false;
    }
    const source: CellRange = {
      top: range.top,
      bottom: range.top,
      left: range.left,
      right: range.right,
    };
    return this.applyFill(tab, source, range);
  }

  /**
   * Fill a source range into a destination range that extends it downward
   * and/or rightward. The source pattern tiles into the destination; relative
   * formula references are adjusted by each cell's offset from its tiled
   * source cell. Filling is a spreadsheet-only operation, so a plain CSV must
   * be explicitly converted to RSF first (it modifies multiple cells and may
   * extend the grid). The whole fill — including any grid growth — is one
   * atomic, undoable operation. Absolute/mixed `$` reference components stay
   * fixed while relative components shift (handled by `shiftFormulaRefs`).
   *
   * **Numeric series (AutoFill):** a purely vertical (or purely horizontal)
   * fill whose seed lane holds **two or more** numeric values forming an
   * arithmetic progression continues that series in the fill direction
   * (`1, 2, 3` → `4, 5, 6`; `2, 4` → `6, 8`; `10, 7` → `4, 1`), per column
   * (or per row) independently, at the seeds' own decimal precision.
   * Documented fallbacks: a single seed copies its value; formulas always
   * use reference translation (never series inference); non-numeric, mixed,
   * or non-linear seeds keep the plain tiling behavior — ambiguity is never
   * guessed at. Rows hidden by an active filter are never modified (the
   * series continues across them so the visible sequence stays consecutive).
   */
  async applyFill(tab: Tab, source: CellRange, dest: CellRange): Promise<boolean> {
    if (
      dest.top !== source.top ||
      dest.left !== source.left ||
      dest.bottom < source.bottom ||
      dest.right < source.right
    ) {
      return false;
    }
    if (dest.bottom === source.bottom && dest.right === source.right) {
      return false; // nothing to fill
    }
    const doc = await this.ensureRsf(tab, 'fill');
    if (!doc) {
      return false;
    }

    const srcH = source.bottom - source.top + 1;
    const srcW = source.right - source.left + 1;
    const srcValues: string[][] = [];
    for (let r = source.top; r <= source.bottom; r++) {
      const row: string[] = [];
      for (let c = source.left; c <= source.right; c++) {
        row.push(doc.getValue(r, c));
      }
      srcValues.push(row);
    }

    const ops: Operation[] = [];
    const needRows = Math.max(0, dest.bottom + 1 - doc.rowCount);
    const needCols = Math.max(0, dest.right + 1 - doc.columnCount);
    if (needRows > 0) {
      ops.push({
        type: 'rows',
        action: 'insert',
        index: doc.rowCount,
        count: needRows,
        data: Array.from({ length: needRows }, () => []),
      });
    }
    if (needCols > 0) {
      ops.push({
        type: 'cols',
        action: 'insert',
        index: doc.columnCount,
        count: needCols,
        data: Array.from({ length: needCols }, () => []),
      });
    }

    // Numeric-series inference per lane. Only single-axis fills continue
    // series; a fill extending both down and right always tiles.
    const vertical = dest.right === source.right && dest.bottom > source.bottom;
    const horizontal = dest.bottom === source.bottom && dest.right > source.right;
    const colSeries = new Map<number, ReturnType<typeof inferLinearSeries>>();
    const rowSeries = new Map<number, ReturnType<typeof inferLinearSeries>>();
    if (vertical && srcH >= 2) {
      for (let j = 0; j < srcW; j++) {
        colSeries.set(source.left + j, inferLinearSeries(srcValues.map((rowVals) => rowVals[j])));
      }
    } else if (horizontal && srcW >= 2) {
      for (let i = 0; i < srcH; i++) {
        rowSeries.set(source.top + i, inferLinearSeries(srcValues[i]));
      }
    }

    const hidden = this.state.hiddenRows(tab);
    const changes: CellChange[] = [];
    // Series step counter for vertical fills: advances only on visible
    // destination rows, so the visible sequence is consecutive.
    let verticalK = 0;
    for (let r = dest.top; r <= dest.bottom; r++) {
      const rowHidden = hidden?.has(r) === true;
      if (vertical && r > source.bottom && !rowHidden) {
        verticalK += 1;
      }
      if (rowHidden) {
        continue; // filtered-out rows are never modified by a fill
      }
      for (let c = dest.left; c <= dest.right; c++) {
        if (r <= source.bottom && c <= source.right) {
          continue; // the source block itself is unchanged
        }
        const si = (r - source.top) % srcH;
        const sj = (c - source.left) % srcW;
        const srcRow = source.top + si;
        const srcCol = source.left + sj;
        let value = srcValues[si][sj];
        const series = vertical ? colSeries.get(c) : horizontal ? rowSeries.get(r) : null;
        if (series) {
          value = seriesValueAt(series, vertical ? verticalK : c - source.right);
        } else if (isFormula(value) && (r !== srcRow || c !== srcCol)) {
          value = shiftFormulaRefs(value, r - srcRow, c - srcCol);
        }
        const before = doc.getValue(r, c);
        if (before === value) {
          continue;
        }
        changes.push({ row: r, col: c, before, after: value });
      }
    }
    ops.push({ type: 'cells', changes });
    const entry: HistoryEntry = { label: 'history.fill', ops };
    const applied = this.state.pushEntry(tab, entry);
    if (applied) {
      this.state.setSelection(tab, { row: dest.top, col: dest.left }, { row: dest.bottom, col: dest.right });
      this.notifyHiddenRowsSkipped(dest.top, dest.bottom, hidden);
    }
    return applied;
  }

  /**
   * Flash Fill: infer a deterministic text transformation of nearby source
   * columns from the examples the user already typed into the target column,
   * preview it, and — only after explicit confirmation — apply it as one
   * atomic, undoable operation. RSF-only: on a plain CSV document a localized
   * message explains that structural multi-cell operations require the
   * explicit conversion to RSF, and nothing is changed. The candidate
   * agreement scan runs in cooperative time slices with honest progress for
   * large blocks; cancellation (preview rejection, tab/document change while
   * yielding, no reliable pattern) always leaves the document untouched.
   * Non-empty target cells below the examples are never overwritten silently:
   * any overwrite is counted, called out in the preview, and requires the
   * same explicit confirmation.
   */
  async flashFill(tab: Tab): Promise<boolean> {
    if (!tab.selection) {
      return false;
    }
    if (tab.doc.kind !== 'rsf') {
      await this.ui.showMessage(t('dialog.flashFill.title'), t('dialog.flashFill.csvOnly'));
      return false;
    }
    const doc = tab.doc;
    const targetCol = tab.selection.col;
    const cols = doc.columnCount;

    // Target rows: an explicitly selected multi-row range, otherwise the
    // contiguous block of data rows around the selection (bounded).
    const rowHasData = (r: number): boolean => {
      for (let c = 0; c < cols; c++) {
        if (doc.getValue(r, c) !== '') {
          return true;
        }
      }
      return false;
    };
    const range = this.state.selectedRange(tab);
    let top: number;
    let bottom: number;
    if (range && range.bottom > range.top) {
      top = range.top;
      bottom = range.bottom;
    } else {
      top = tab.selection.row;
      bottom = tab.selection.row;
      while (top > 0 && bottom - top < FLASH_FILL_MAX_BLOCK_ROWS && rowHasData(top - 1)) {
        top -= 1;
      }
      while (
        bottom < doc.rowCount - 1 &&
        bottom - top < FLASH_FILL_MAX_BLOCK_ROWS &&
        rowHasData(bottom + 1)
      ) {
        bottom += 1;
      }
    }

    // Examples: the leading run of non-empty target cells; sources: every
    // other column with data in the block.
    const examples: FlashFillExample[] = [];
    let firstFill = top;
    while (firstFill <= bottom && doc.getValue(firstFill, targetCol) !== '') {
      examples.push({ row: firstFill, value: doc.getValue(firstFill, targetCol) });
      firstFill += 1;
    }
    if (examples.length === 0) {
      await this.ui.showMessage(t('dialog.flashFill.title'), t('dialog.flashFill.noExamples'));
      return false;
    }
    if (firstFill > bottom) {
      await this.ui.showMessage(t('dialog.flashFill.title'), t('dialog.flashFill.nothing'));
      return false;
    }
    const sourceCols: number[] = [];
    for (let c = 0; c < cols; c++) {
      if (c === targetCol) {
        continue;
      }
      for (let r = top; r <= bottom; r++) {
        if (doc.getValue(r, c) !== '') {
          sourceCols.push(c);
          break;
        }
      }
    }
    if (sourceCols.length === 0) {
      await this.ui.showMessage(t('dialog.flashFill.title'), t('dialog.flashFill.noSources'));
      return false;
    }

    const candidates = inferFlashFillCandidates(examples, sourceCols, (r, c) => doc.getValue(r, c));
    if (candidates.length === 0) {
      await this.ui.showMessage(t('dialog.flashFill.title'), t('dialog.flashFill.noPattern'));
      return false;
    }

    // Agreement scan over the fill rows (read-only, sliced for large blocks;
    // aborts without touching anything when the document changes meanwhile).
    const changes: CellChange[] = [];
    let overwriteCount = 0;
    let conflict: { a: string; b: string } | null = null;
    const label = t('loading.flashFill');
    const rowCount = bottom - firstFill + 1;
    const hiddenRows = this.state.hiddenRows(tab);
    const scanRow = (i: number): void => {
      if (conflict) {
        return;
      }
      const row = firstFill + i;
      if (hiddenRows?.has(row)) {
        return; // filtered-out rows are never modified by Flash Fill
      }
      const outcome = flashFillRow(candidates, (c) => doc.getValue(row, c));
      if (outcome.kind === 'conflict') {
        conflict = { a: outcome.a ?? '', b: outcome.b ?? '' };
        return;
      }
      const value = outcome.value;
      if (value === null) {
        return; // no usable source data in this row — leave it untouched
      }
      const before = doc.getValue(row, targetCol);
      if (before === value) {
        return;
      }
      if (before !== '') {
        overwriteCount += 1;
      }
      changes.push({ row, col: targetCol, before, after: value });
    };
    if (rowCount > LARGE_OP_CELLS) {
      const completed = await this.withBusy(label, () =>
        forEachIndexSliced(rowCount, scanRow, {
          onProgress: (done, total) => this.ui.setBusy(`${label} (${pct(done, total)}%)`),
          shouldStop: () => tab.doc !== doc || conflict !== null,
        }),
      );
      if ((!completed && !conflict) || tab.doc !== doc) {
        return false;
      }
    } else {
      for (let i = 0; i < rowCount; i++) {
        scanRow(i);
      }
    }
    if (conflict) {
      const c = conflict as { a: string; b: string };
      await this.ui.showMessage(
        t('dialog.flashFill.title'),
        t('dialog.flashFill.ambiguous', { a: c.a || '(empty)', b: c.b || '(empty)' }),
      );
      return false;
    }
    if (changes.length === 0) {
      await this.ui.showMessage(t('dialog.flashFill.title'), t('dialog.flashFill.nothing'));
      return false;
    }

    // Accessible preview + explicit confirmation. Nothing is applied yet.
    const first = changes[0];
    const last = changes[changes.length - 1];
    const preview: FlashFillPreview = {
      description: describeFlashFillOp(candidates[0]),
      range: `${cellLabel(first.row, targetCol)}:${cellLabel(last.row, targetCol)}`,
      changeCount: changes.length,
      overwriteCount,
      sample: changes.slice(0, FLASH_FILL_SAMPLE_SIZE).map((ch) => ({
        cell: cellLabel(ch.row, ch.col),
        before: ch.before ?? '',
        after: ch.after ?? '',
      })),
    };
    const confirmed = await this.ui.confirmFlashFill(preview);
    if (!confirmed || tab.doc !== doc) {
      return false; // rejected preview (or replaced document): unchanged
    }
    const applied = this.state.bulkEdit(tab, changes, 'history.flashFill');
    if (applied) {
      this.ui.notify(t('notify.flashFilled', { n: changes.length }), 'info');
    }
    return applied;
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

  /** The active filter's hidden-row set for a tab (null when unfiltered). */
  hiddenRows(tab: Tab): Set<number> | null {
    return this.state.hiddenRows(tab);
  }

  /**
   * Sheet > Filter… (also the column-header filter buttons and the context
   * menu): open the filter dialog for `targetCol` (default: the active
   * cell's column) and apply the result as one atomic, undoable operation.
   *
   * RSF-only: on a plain CSV document a localized message explains that
   * filtering requires the explicit conversion to RSF, and nothing changes.
   * The filter range is the existing filter's range when one is active;
   * otherwise the selected rectangle (when more than one cell is selected)
   * or the detected contiguous data block around the active cell, with the
   * first row treated as a header by default — the dialog shows this
   * assumption and lets the user change it before applying. Value
   * enumeration and hidden-row evaluation run in time slices with honest
   * progress for large ranges; cancellation (dialog, document change while
   * yielding) never applies a partial filter.
   */
  async filterDialog(tab: Tab, targetCol?: number): Promise<boolean> {
    if (!tab.selection) {
      return false;
    }
    if (tab.doc.kind !== 'rsf') {
      await this.ui.showMessage(t('dialog.filter.title'), t('dialog.filter.csvOnly'));
      return false;
    }
    const doc = tab.doc;
    const existing = doc.filter;

    // The filtered rectangle. An active filter fixes it (clear all filters
    // to choose a new range); otherwise it derives from the selection.
    let top: number;
    let left: number;
    let bottom: number;
    let right: number;
    let headerRow: boolean;
    if (existing) {
      ({ top, left, bottom, right, headerRow } = existing);
    } else {
      const sel = this.state.selectedRange(tab);
      headerRow = true;
      if (sel && (sel.bottom > sel.top || sel.right > sel.left)) {
        ({ top, left, bottom, right } = sel);
      } else {
        // Detect the contiguous block of data rows around the active cell
        // (bounded), spanning every sheet column.
        const rowHasData = (r: number): boolean => {
          for (let c = 0; c < doc.columnCount; c++) {
            if (doc.getValue(r, c) !== '') {
              return true;
            }
          }
          return false;
        };
        top = tab.selection.row;
        bottom = tab.selection.row;
        while (top > 0 && bottom - top < MAX_FILTER_ROWS - 1 && rowHasData(top - 1)) {
          top -= 1;
        }
        while (bottom < doc.rowCount - 1 && bottom - top < MAX_FILTER_ROWS - 1 && rowHasData(bottom + 1)) {
          bottom += 1;
        }
        left = 0;
        right = doc.columnCount - 1;
        if (!rowHasData(top)) {
          await this.ui.showMessage(t('dialog.filter.title'), t('dialog.filter.noData'));
          return false;
        }
      }
      // Enforce the documented range bound up front so a within-bounds
      // filter always persists and restores identically.
      bottom = Math.min(bottom, top + MAX_FILTER_ROWS - 1);
    }
    const col = Math.max(left, Math.min(right, targetCol ?? tab.selection.col));

    // Bounded distinct displayed values of the column's data rows (sliced
    // with progress for large ranges; aborts without changes if the document
    // is replaced while yielding).
    const dataTop = headerRow ? Math.min(top + 1, bottom) : top;
    const scanRows = bottom - dataTop + 1;
    const distinct = new Set<string>();
    let valuesTruncated = false;
    const collectRow = (i: number): void => {
      const value = doc.getDisplayValue(dataTop + i, col);
      if (distinct.has(value)) {
        return;
      }
      if (distinct.size >= MAX_FILTER_VALUES) {
        valuesTruncated = true; // the list stays bounded; the dialog says so
        return;
      }
      distinct.add(value);
    };
    if (scanRows > LARGE_OP_CELLS) {
      const label = t('loading.filterValues');
      const completed = await this.withBusy(label, () =>
        forEachIndexSliced(scanRows, collectRow, {
          onProgress: (done, total) => this.ui.setBusy(`${label} (${pct(done, total)}%)`),
          shouldStop: () => tab.doc !== doc,
        }),
      );
      if (!completed || tab.doc !== doc) {
        return false;
      }
    } else {
      for (let i = 0; i < scanRows; i++) {
        collectRow(i);
      }
    }
    const values = [...distinct].sort();

    const input: FilterDialogInput = {
      col,
      colLetter: columnLabel(col),
      header: headerRow ? doc.getDisplayValue(top, col) : '',
      rangeLabel: `${cellLabel(top, left)}:${cellLabel(bottom, right)}`,
      headerRow,
      hasActiveFilter: existing !== null,
      existing: existing?.columns.find((c) => c.col === col) ?? null,
      otherColumns: existing ? existing.columns.filter((c) => c.col !== col).length : 0,
      values,
      valuesTruncated,
    };
    const result = await this.ui.chooseFilter(input);
    if (!result || tab.doc !== doc) {
      return false; // cancelled (or replaced document): nothing changes
    }
    if (result.action === 'clearAll') {
      return this.clearAllFilters(tab);
    }

    // Build the new filter state from the dialog result.
    const keptColumns = (existing?.columns ?? []).filter((c) => c.col !== col);
    const newHeaderRow = result.action === 'apply' ? result.headerRow : headerRow;
    const newColumn = result.action === 'apply' ? result.column : null;
    const columns = [...keptColumns, ...(newColumn ? [newColumn] : [])].sort((a, b) => a.col - b.col);
    if (columns.length === 0) {
      // No criteria left anywhere: the filter as a whole is cleared.
      return this.clearAllFilters(tab);
    }
    const filter = validateFilter(
      { top, left, bottom, right, headerRow: newHeaderRow, columns },
      doc.rowCount,
      doc.columnCount,
    );
    if (!filter) {
      // Out-of-bounds criteria (should be prevented by the dialog's own
      // bounds) are refused rather than partially applied.
      await this.ui.showMessage(t('dialog.filter.title'), t('dialog.filter.invalid'));
      return false;
    }
    return this.applyFilter(tab, filter);
  }

  /**
   * Evaluate `filter` (time-sliced with progress for large ranges) and apply
   * it as one atomic, undoable history entry. Aborts — changing nothing — if
   * the document is replaced while yielding.
   */
  private async applyFilter(tab: Tab, filter: SheetFilter): Promise<boolean> {
    const doc = tab.doc;
    if (doc.kind !== 'rsf') {
      return false;
    }
    const dataTop = filterDataTop(filter);
    const rows = filter.bottom - dataTop + 1;
    const hidden = new Set<number>();
    const evaluateRow = (i: number): void => {
      const row = dataTop + i;
      if (!rowMatchesFilter(filter, row, (r, c) => doc.getDisplayValue(r, c))) {
        hidden.add(row);
      }
    };
    if (rows > LARGE_OP_CELLS) {
      const label = t('loading.filtering');
      const completed = await this.withBusy(label, () =>
        forEachIndexSliced(rows, evaluateRow, {
          onProgress: (done, total) => this.ui.setBusy(`${label} (${pct(done, total)}%)`),
          shouldStop: () => tab.doc !== doc,
        }),
      );
      if (!completed || tab.doc !== doc) {
        return false;
      }
    } else {
      for (let i = 0; i < rows; i++) {
        evaluateRow(i);
      }
    }
    // Seed the snapshot before the atomic apply so the grid never recomputes.
    this.state.seedHiddenRows(filter, hidden);
    const applied = this.state.setFilter(tab, filter);
    if (applied) {
      this.moveSelectionOffHiddenRow(tab);
      this.ui.notify(t('notify.filtered', { shown: rows - hidden.size, total: rows }), 'info');
    }
    return applied;
  }

  /** Sheet > Clear All Filters: every row becomes visible again (undoable). */
  clearAllFilters(tab: Tab): boolean {
    const applied = this.state.setFilter(tab, null);
    if (applied) {
      this.ui.notify(t('notify.filterCleared'), 'info');
    }
    return applied;
  }

  /**
   * After a filter (re)application, move a selection whose active cell ended
   * up on a hidden row to the nearest visible row, so keyboard navigation
   * and editing always continue from something the user can see.
   */
  private moveSelectionOffHiddenRow(tab: Tab): void {
    const sel = tab.selection;
    const hidden = this.state.hiddenRows(tab);
    if (!sel || !hidden || !hidden.has(sel.row)) {
      return;
    }
    let row = sel.row;
    while (row < tab.doc.rowCount && hidden.has(row)) {
      row += 1;
    }
    if (row >= tab.doc.rowCount) {
      row = sel.row;
      while (row >= 0 && hidden.has(row)) {
        row -= 1;
      }
    }
    if (row >= 0 && row < tab.doc.rowCount) {
      this.state.setSelection(tab, { row, col: sel.col }, null);
    }
  }

  /** Clear every cell in the selected range as one undoable operation.
   *  Rows hidden by an active filter are never modified (documented). */
  clearRange(tab: Tab): boolean {
    const range = this.state.selectedRange(tab);
    if (!range) {
      return false;
    }
    const doc = tab.doc;
    const hidden = this.state.hiddenRows(tab);
    const changes: CellChange[] = [];
    for (let r = range.top; r <= range.bottom; r++) {
      if (hidden?.has(r)) {
        continue;
      }
      const cols = Math.min(range.right + 1, doc.fieldCount(r));
      for (let c = range.left; c < cols; c++) {
        const current = doc.getValue(r, c);
        if (current === '') {
          continue;
        }
        if (doc.kind === 'csv') {
          const before = doc.isEdited(r, c) ? current : null;
          const after = doc.getOriginalValue(r, c) === '' ? null : '';
          changes.push({ row: r, col: c, before, after });
        } else {
          changes.push({ row: r, col: c, before: current, after: '' });
        }
      }
    }
    return this.state.bulkEdit(tab, changes, 'history.clearRange');
  }

  /**
   * Replace every match in the active tab as one atomic, singly-undoable
   * operation. The read-only scan for matching cells runs in time slices
   * behind a progress-reporting loading indicator, so a huge document never
   * blocks input or appears frozen. The mutation itself is then built from
   * the *current* cell values and applied synchronously in one `bulkEdit`, so
   * there is never a partially-replaced document — not even if the tab
   * changed while the scan was yielding (the scan aborts instead).
   */
  async replaceAll(query: CompiledQuery, replacement: string): Promise<{ count: number; cells: number }> {
    const tab = this.state.activeTab;
    if (!tab || !query.ok) {
      return { count: 0, cells: 0 };
    }
    const doc = tab.doc;
    const label = t('loading.replacing');
    return this.withBusy(label, async () => {
      // Phase 1 (sliced, read-only): find the cells containing matches.
      const hits: Array<{ row: number; col: number }> = [];
      const completed = await forEachIndexSliced(
        doc.rowCount,
        (r) => {
          const fieldCount = doc.fieldCount(r);
          for (let c = 0; c < fieldCount; c++) {
            if (replaceAllInValue(doc.getValue(r, c), query, replacement).count > 0) {
              hits.push({ row: r, col: c });
            }
          }
        },
        {
          onProgress: (done, total) => this.ui.setBusy(`${label} (${pct(done, total)}%)`),
          // The document was replaced or the tab closed while yielding: abort
          // without touching anything.
          shouldStop: () => tab.doc !== doc,
        },
      );
      if (!completed || tab.doc !== doc) {
        return { count: 0, cells: 0 };
      }
      // Phase 2 (synchronous, atomic): rebuild each change from the current
      // value and apply them as one undoable entry.
      const changes: CellChange[] = [];
      let count = 0;
      for (const { row, col } of hits) {
        const current = doc.getValue(row, col);
        const replaced = replaceAllInValue(current, query, replacement);
        if (replaced.count === 0) {
          continue;
        }
        if (doc.kind === 'csv') {
          const before = doc.isEdited(row, col) ? current : null;
          const after = replaced.value === doc.getOriginalValue(row, col) ? null : replaced.value;
          changes.push({ row, col, before, after });
        } else {
          changes.push({ row, col, before: current, after: replaced.value });
        }
        count += replaced.count;
      }
      const applied = this.state.bulkEdit(tab, changes, 'history.replaceAll');
      return { count: applied ? count : 0, cells: applied ? changes.length : 0 };
    });
  }
}

/**
 * Localized, human-readable description of an inferred Flash Fill operation
 * (shown in the preview dialog so the user knows exactly what would run).
 */
export function describeFlashFillOp(op: FlashFillOp): string {
  const casing = (c: 'none' | 'upper' | 'lower'): string =>
    c === 'none' ? '' : t(c === 'upper' ? 'flashFill.casing.upper' : 'flashFill.casing.lower');
  switch (op.kind) {
    case 'copy':
      return t('flashFill.op.copy', { col: columnLabel(op.col) }) + casing(op.casing);
    case 'concat': {
      const parts = op.parts.map((p) => (p.type === 'col' ? columnLabel(p.col) : `"${p.text}"`)).join(' + ');
      return t('flashFill.op.concat', { parts });
    }
    case 'split':
      return (
        t(op.fromEnd ? 'flashFill.op.splitEnd' : 'flashFill.op.split', {
          n: op.index + 1,
          col: columnLabel(op.col),
          sep: op.sep,
        }) + casing(op.casing)
      );
    case 'affix':
      return (
        t(op.side === 'prefix' ? 'flashFill.op.prefix' : 'flashFill.op.suffix', {
          n: op.length,
          col: columnLabel(op.col),
        }) + casing(op.casing)
      );
  }
}
