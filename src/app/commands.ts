// SPDX-License-Identifier: MIT
import type { CellRange } from '../core/clipboard';
import { DEFAULT_CSV_EXPORT_OPTIONS, encodeCsvExport } from '../core/csv-export';
import type { CellValidation } from '../core/data-validation';
import type { DiffResult } from '../core/diff-engine';
import { cellLabel, columnLabel, isFormula, parseRef } from '../core/formula';
import type { RsfDocument } from '../core/rsf-document';
import type { CompiledQuery, SearchScope } from '../core/search';
import { KEEP_SAVE_OPTIONS, type SaveOptions } from '../core/serializer';
import type { AppState, Selection, SelectionKind, Tab } from './app-state';
import { fileSystemAccessAvailable, pickFiles, saveBytesAs, type OpenedFile } from './file-access';
import { getLocale, setLocale, t, type LocaleId } from './i18n';
import {
  DEFAULT_SHEET_ZOOM,
  getAutoFitOnOpen,
  getEditHints,
  getMaxFileSize,
  nextZoomLevel,
  setAutoFitOnOpen,
  setEditHints,
  setMaxFileSize,
} from './settings';
import { setSheetFont, type SheetFontId } from './sheet-font';
import { setTheme, type ThemeChoice } from './theme';
import { CommentCommands } from './commands/comment';
import { ConditionalFormatCommands } from './commands/conditional-format';
import { ValidationCommands } from './commands/data-validation';
import { FileIoCommands } from './commands/file-io';
import { DriveIoCommands } from './commands/drive-io';
import { isSignedIn as driveIsSignedIn } from './drive/auth';
import { FilterCommands } from './commands/filter';
import { FormatCommands } from './commands/format';
import { SortCommands } from './commands/sort';
import { WorksheetCommands } from './commands/worksheets';
import { SqlCommands, type SqlRunOutcome } from './commands/sql';
import { DiffCommands } from './commands/diff';
import { PasteFillCommands, type FlashFillPreview } from './commands/paste-fill';
import { RangeOpsCommands, type ReplaceAllReport } from './commands/range-ops';
import { isGridSurface, LARGE_OP_CELLS } from './commands/shared';
import type { ConvertReason, UiPort } from './ui-port';

export { isGridSurface, LARGE_OP_CELLS };

/**
 * `true` only in the offline production build (`vite build`, not `--mode
 * hosted`), injected by vite.config.ts. Gating the Drive wiring on this
 * compile-time constant lets the bundler drop the whole Google Drive client
 * (and every Google endpoint URL) from the offline artifact, instead of
 * shipping it inert; `scripts/check-dist.mjs` asserts the result. `false` in
 * dev, tests, and the hosted build, where `driveConfigured()` still decides
 * at runtime.
 */
declare const __OFFLINE_BUILD__: boolean;
export type { FlashFillPreview, ReplaceAllReport, SqlRunOutcome };
export type * from './ui-port';

export type CommandId =
  | 'file.new'
  | 'file.newCsv'
  | 'file.open'
  | 'file.openRecent'
  | 'file.reopen'
  | 'file.toggleProtect'
  | 'file.save'
  | 'file.saveOptions'
  | 'file.closeTab'
  | 'drive.open'
  | 'drive.save'
  | 'drive.saveAs'
  | 'drive.signOut'
  | 'edit.undo'
  | 'edit.redo'
  | 'edit.copy'
  | 'edit.copyScreenshot'
  | 'edit.copyAsMarkdown'
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
  | 'search.goToCell'
  | 'sheet.convert'
  | 'sheet.insertRowAbove'
  | 'sheet.insertRowBelow'
  | 'sheet.deleteRows'
  | 'sheet.insertColLeft'
  | 'sheet.insertColRight'
  | 'sheet.deleteCols'
  | 'sheet.addRow'
  | 'sheet.addColumn'
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
  | 'format.numberFormat'
  | 'format.conditionalFormatting'
  | 'format.clear'
  | 'sheet.recalculate'
  | 'sheet.timezone'
  | 'sheet.displayLanguage'
  | 'sheet.versionHistory'
  | 'sheet.clearVersionHistory'
  | 'sheet.exportCsv'
  | 'sheet.exportXlsx'
  | 'sheet.exportJson'
  | 'data.runSqlQuery'
  | 'data.compareDiff'
  | 'data.validation'
  | 'data.comment'
  // Worksheets inside the active RSF workbook (distinct from the application
  // document tabs, whose commands are the `tab.*` ids below).
  | 'worksheet.add'
  | 'worksheet.addMarkdown'
  | 'worksheet.addJson'
  | 'worksheet.addYaml'
  | 'worksheet.addText'
  | 'worksheet.rename'
  | 'worksheet.duplicate'
  | 'worksheet.delete'
  | 'worksheet.moveLeft'
  | 'worksheet.moveRight'
  | 'worksheet.moveFirst'
  | 'worksheet.moveLast'
  | 'worksheet.next'
  | 'worksheet.prev'
  | 'worksheet.toggleLock'
  | 'view.wrap'
  | 'view.stickyFirstRow'
  | 'view.stickyFirstColumn'
  | 'view.commentsPanel'
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
  | 'view.autoFitOnOpen'
  | 'view.sheetFont.bizUd'
  | 'view.sheetFont.ms'
  | 'view.sheetFont.msUi'
  | 'view.sheetFont.notoSansJp'
  | 'view.sheetFont.meiryoUi'
  | 'view.sheetFont.yuGothicUi'
  | 'view.theme.system'
  | 'view.theme.light'
  | 'view.theme.dark'
  | 'view.theme.hybrid'
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
    /** Render the selection's actual on-screen appearance to a PNG and write it to the system clipboard. */
    copyScreenshot: () => Promise<void>;
    /** Write the selection to the system clipboard as a GitHub-Flavored Markdown table. */
    copyAsMarkdown: () => Promise<void>;
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
    /** Auto-fit every column of `tab` — used for the "auto-fit on open" preference. */
    autoFitAllColumns: (tab: Tab) => Promise<void>;
    /** Select a cell and scroll it into view ("Go to Cell…"). */
    goToCell: (row: number, col: number) => void;
  } | null = null;

  /** Set by main.ts so the View menu can show/hide the comments panel. */
  panelActions: {
    /** Show/hide the right-side cell comments panel. */
    toggleComments: () => void;
  } | null = null;

  constructor(
    private readonly state: AppState,
    private readonly ui: UiPort,
    private readonly dom: Document,
  ) {
    this.fileIo = new FileIoCommands(state, ui, dom, () => this.gridActions);
    this.driveIo = __OFFLINE_BUILD__ ? null : new DriveIoCommands(state, ui, this.fileIo);
    this.filter = new FilterCommands(state, ui, (tab, reason) => this.ensureRsf(tab, reason));
    this.sort = new SortCommands(state, ui, (tab, reason) => this.ensureRsf(tab, reason));
    this.validation = new ValidationCommands(state, ui, (tab, reason) => this.ensureRsf(tab, reason));
    this.conditionalFormat = new ConditionalFormatCommands(state, ui, (tab, reason) =>
      this.ensureRsf(tab, reason),
    );
    this.comment = new CommentCommands(state, ui, (tab, reason) => this.ensureRsf(tab, reason));
    this.worksheets = new WorksheetCommands(state, ui, (tab, reason) => this.ensureRsf(tab, reason));
    this.pasteFill = new PasteFillCommands(
      state,
      ui,
      (tab, reason) => this.ensureRsf(tab, reason),
      () => this.clipboardActions?.getCopied() ?? Promise.resolve(null),
    );
    this.rangeOps = new RangeOpsCommands(state, ui, (tab, reason) => this.ensureRsf(tab, reason));
    this.format = new FormatCommands(state, ui);
    this.sql = new SqlCommands();
    this.diff = new DiffCommands();
  }

  /** File I/O, save/export, and CSV↔RSF conversion — see `FileIoCommands`. */
  private readonly fileIo: FileIoCommands;

  /** Google Drive sync — see `DriveIoCommands`. Compiled out of the offline build. */
  private readonly driveIo: DriveIoCommands | null;

  /**
   * Whether Google Drive sync exists in this build at all. False for the
   * offline build, which hides every Drive entry point.
   */
  driveAvailable(): boolean {
    return this.driveIo?.available() ?? false;
  }

  /** Whether a Google access token is currently held (drives the menu label). */
  driveSignedIn(): boolean {
    return !__OFFLINE_BUILD__ && driveIsSignedIn();
  }

  /** Filter dialog flow, apply/clear, and hidden-row queries — see `FilterCommands`. */
  private readonly filter: FilterCommands;

  /** Sort dialog flow and apply/clear — see `SortCommands`. */
  private readonly sort: SortCommands;

  /** Data-validation dialog flow and apply/clear — see `ValidationCommands`. */
  private readonly validation: ValidationCommands;

  /** Conditional-formatting dialog flow and apply/clear — see `ConditionalFormatCommands`. */
  private readonly conditionalFormat: ConditionalFormatCommands;

  /** Cell-comment dialog flow and apply/clear — see `CommentCommands`. */
  private readonly comment: CommentCommands;

  /** Worksheet lifecycle and row/column structural commands — see `WorksheetCommands`. */
  private readonly worksheets: WorksheetCommands;

  /** Paste, Insert Copied …, Fill Down / drag-fill, and Flash Fill — see `PasteFillCommands`. */
  private readonly pasteFill: PasteFillCommands;

  /** Range move and find/replace-all (single sheet and workbook-wide) — see `RangeOpsCommands`. */
  private readonly rangeOps: RangeOpsCommands;

  /** Cell/range visual formatting (bold/italic/underline, colors, borders) — see `FormatCommands`. */
  private readonly format: FormatCommands;

  /** Local, read-only SQL analysis over one worksheet/CSV table — see `SqlCommands`. */
  private readonly sql: SqlCommands;

  /** Local, read-only two-tab compare — see `DiffCommands`. */
  private readonly diff: DiffCommands;

  /** True when the command currently makes sense (drives menu-item enabled state). */
  isEnabled(id: CommandId): boolean {
    const tab = this.state.activeTab;
    switch (id) {
      case 'file.save':
      case 'file.closeTab':
      case 'file.toggleProtect':
      case 'search.find':
      case 'search.replace':
      case 'search.findNext':
      case 'search.findPrev':
      case 'search.goToCell':
      case 'data.runSqlQuery':
        return tab !== null;
      case 'data.compareDiff':
        // A second open tab is required to pick a baseline against.
        return tab !== null && this.state.tabs.length >= 2;
      case 'file.saveOptions':
        // CSV: encoding/EOL/BOM options. RSF: the compression selector.
        return tab !== null;
      case 'file.openRecent':
        // Only the File System Access API gives the app a file it can reopen.
        return fileSystemAccessAvailable();
      case 'drive.open':
        return this.driveAvailable();
      case 'drive.save':
      case 'drive.saveAs':
        return this.driveAvailable() && tab !== null;
      case 'drive.signOut':
        return this.driveAvailable() && this.driveSignedIn();
      case 'file.reopen':
      case 'sheet.convert':
        return tab !== null && tab.doc.kind === 'csv';
      case 'sheet.exportCsv':
        return tab !== null && tab.doc.kind === 'rsf';
      // Unlike CSV (already the format for a CSV-kind tab), no tab kind is
      // already an .xlsx or .json file, so both kinds can export to either.
      case 'sheet.exportXlsx':
      case 'sheet.exportJson':
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
      // Appends at the very end of the sheet, so — unlike the selection-relative
      // insert commands above — no selection is required to run it.
      case 'sheet.addRow':
      case 'sheet.addColumn':
        return tab !== null;
      case 'sheet.autoFitCols':
        return tab !== null && tab.selection !== null && isGridSurface(tab);
      case 'edit.selectAll':
        return tab !== null;
      case 'edit.undo':
        return tab !== null && tab.history.canUndo;
      case 'edit.redo':
        return tab !== null && tab.history.canRedo;
      // Flash Fill, Move Range, and Filter stay clickable on a CSV tab:
      // running one explains that the operation needs an RSF spreadsheet
      // document and offers to convert right there (see `ensureRsf`).
      case 'edit.copy':
      case 'edit.copyAsMarkdown':
      case 'edit.paste':
      case 'edit.fillDown':
      case 'edit.flashFill':
      case 'edit.moveRange':
      case 'sheet.filter':
      case 'sheet.sort':
      case 'data.validation':
      case 'format.conditionalFormatting':
      case 'data.comment':
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
      case 'format.numberFormat':
      case 'format.clear':
        return tab !== null && tab.doc.kind === 'rsf' && tab.selection != null;
      // The async Clipboard API's image write has inconsistent browser
      // support (including on file://), so the item is hidden/disabled
      // outright there rather than failing at run time.
      case 'edit.copyScreenshot':
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
      case 'sheet.versionHistory':
        // Version history is an RSF-only, per-file setting; a plain CSV has
        // no container to record snapshots in.
        return tab !== null && tab.doc.kind === 'rsf';
      case 'sheet.clearVersionHistory':
        return tab !== null && tab.doc.kind === 'rsf' && tab.doc.history.length > 0;
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
      case 'worksheet.addMarkdown':
      case 'worksheet.addJson':
      case 'worksheet.addYaml':
      case 'worksheet.addText':
      case 'worksheet.rename':
      case 'worksheet.duplicate':
      case 'worksheet.toggleLock':
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
    const tab = this.state.activeTab;
    switch (id) {
      case 'format.bold':
      case 'format.italic':
      case 'format.underline':
      case 'format.textColor':
      case 'format.backgroundColor':
      case 'format.borders':
      case 'format.numberFormat':
      case 'format.clear':
        return tab !== null && tab.doc.kind !== 'rsf' ? t('menu.format.csvOnlyTooltip') : null;
      default:
        return null;
    }
  }

  async run(id: CommandId): Promise<void> {
    const tab = this.state.activeTab;
    switch (id) {
      case 'file.new':
        this.newDocument();
        return;
      case 'file.newCsv':
        this.newCsvDocument();
        return;
      case 'file.openRecent':
        await this.fileIo.openRecent();
        return;
      case 'file.open': {
        const files = await pickFiles(this.dom, getMaxFileSize());
        await this.openFiles(files, { confirmNonCsv: false });
        return;
      }
      case 'file.reopen':
        if (tab) await this.reopen(tab);
        return;
      case 'file.toggleProtect':
        if (tab) this.state.setReadOnly(tab, !tab.readOnly);
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
      case 'drive.open':
        await this.driveIo?.open();
        return;
      case 'drive.save':
        if (tab) await this.driveIo?.save(tab);
        return;
      case 'drive.saveAs':
        if (tab) await this.driveIo?.saveAs(tab);
        return;
      case 'drive.signOut':
        this.driveIo?.signOut();
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
      case 'edit.copyScreenshot':
        await this.clipboardActions?.copyScreenshot();
        return;
      case 'edit.copyAsMarkdown':
        await this.clipboardActions?.copyAsMarkdown();
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
      case 'search.goToCell':
        if (tab) await this.promptAndGoToCell(tab);
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
      case 'sheet.addRow':
        if (tab) await this.appendAxis(tab, 'row');
        return;
      case 'sheet.addColumn':
        if (tab) await this.appendAxis(tab, 'col');
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
      case 'format.numberFormat':
        if (tab) await this.promptNumberFormat(tab);
        return;
      case 'format.conditionalFormatting':
        if (tab) await this.conditionalFormatDialog(tab);
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
      case 'sheet.versionHistory':
        if (tab && tab.doc.kind === 'rsf') {
          const doc = tab.doc;
          const choice = await this.ui.chooseVersionHistory(
            doc.historyEnabled,
            doc.historyMaxOverride,
            doc.history,
          );
          if (!choice) {
            return;
          }
          if (choice.kind === 'restore') {
            const snapshot = doc.history[choice.index];
            if (!snapshot) {
              return;
            }
            const when = new Date(snapshot.timestamp).toLocaleString(
              getLocale() === 'ja' ? 'ja-JP' : 'en-US',
            );
            const ok = await this.ui.confirm(
              t('dialog.restoreVersion.title'),
              t('dialog.restoreVersion.message', { when }),
              t('dialog.restoreVersion.ok'),
              t('dialog.restoreVersion.cancel'),
            );
            if (!ok) {
              return;
            }
            // A restore is a deliberate revert, not an edit: it is not itself
            // undoable, and the tab's existing undo/redo entries describe
            // edits to the content this call just replaced, so they are
            // cleared rather than left to (mis)apply against the restored
            // content.
            if (doc.restoreFromSnapshot(choice.index)) {
              tab.history.clear();
              this.state.emit('doc');
              this.state.emit('tabs');
              this.ui.notify(t('notify.versionRestored'), 'info');
            } else {
              this.ui.notify(t('notify.versionRestoreFailed'), 'error');
            }
            return;
          }
          // choice.kind === 'save'
          const enabledChanged = choice.enabled !== doc.historyEnabled;
          const maxChanged = choice.maxOverride !== doc.historyMaxOverride;
          if (!enabledChanged && !maxChanged) {
            return;
          }
          // Like the lock flag, these are persisted in the saved container but
          // change no cell input, so they mark the document dirty without
          // touching the evaluation memo.
          if (enabledChanged) {
            doc.setHistoryEnabled(choice.enabled);
          }
          if (maxChanged) {
            doc.setHistoryMaxOverride(choice.maxOverride);
          }
          this.state.emit('doc');
          this.ui.notify(
            t(
              enabledChanged
                ? choice.enabled
                  ? 'notify.versionHistoryEnabled'
                  : 'notify.versionHistoryDisabled'
                : 'notify.versionHistoryMaxUpdated',
            ),
            'info',
          );
        }
        return;
      case 'sheet.clearVersionHistory':
        if (tab && tab.doc.kind === 'rsf' && tab.doc.history.length > 0) {
          const ok = await this.ui.confirm(
            t('dialog.clearVersionHistory.title'),
            t('dialog.clearVersionHistory.message', { n: tab.doc.history.length }),
            t('dialog.delete.ok'),
            t('dialog.delete.cancel'),
          );
          if (ok) {
            tab.doc.clearHistory();
            this.state.emit('doc');
            this.ui.notify(t('notify.versionHistoryCleared'), 'info');
          }
        }
        return;
      case 'sheet.exportCsv':
        if (tab) await this.exportCsv(tab);
        return;
      case 'sheet.exportXlsx':
        if (tab) await this.exportXlsx(tab);
        return;
      case 'sheet.exportJson':
        if (tab) await this.exportJson(tab);
        return;
      case 'data.runSqlQuery':
        if (tab) await this.showSqlQuery(tab);
        return;
      case 'data.compareDiff':
        if (tab) await this.showDiff(tab);
        return;
      case 'data.validation':
        if (tab) await this.validationDialog(tab);
        return;
      case 'data.comment':
        if (tab) await this.commentDialog(tab);
        return;
      case 'view.wrap':
        this.state.setWrapCells(!this.state.wrapCells);
        return;
      case 'view.stickyFirstRow':
        this.state.setStickyFirstRow(!this.state.stickyFirstRow);
        return;
      case 'view.stickyFirstColumn':
        this.state.setStickyFirstColumn(!this.state.stickyFirstColumn);
        return;
      case 'view.commentsPanel':
        this.panelActions?.toggleComments();
        // Pure UI-visibility toggle (like view.editHints above): re-emit so
        // the View menu checkbox reflects the new open/closed state.
        this.state.emit('view');
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
      case 'view.autoFitOnOpen':
        setAutoFitOnOpen(!getAutoFitOnOpen());
        // Pure preference toggle (like view.editHints above); it only takes
        // effect on the next file open, but re-emit so the menu checkbox
        // reflects the new state immediately.
        this.state.emit('view');
        return;
      case 'view.sheetFont.bizUd':
      case 'view.sheetFont.ms':
      case 'view.sheetFont.msUi':
      case 'view.sheetFont.notoSansJp':
      case 'view.sheetFont.meiryoUi':
      case 'view.sheetFont.yuGothicUi': {
        const fonts: Record<typeof id, SheetFontId> = {
          'view.sheetFont.bizUd': 'biz-ud',
          'view.sheetFont.ms': 'ms',
          'view.sheetFont.msUi': 'ms-ui',
          'view.sheetFont.notoSansJp': 'noto-sans-jp',
          'view.sheetFont.meiryoUi': 'meiryo-ui',
          'view.sheetFont.yuGothicUi': 'yu-gothic-ui',
        };
        setSheetFont(fonts[id]);
        // Applying the font is pure CSS; re-emit so the menu checkmark and the
        // grid (which measures with the active font) refresh.
        this.state.emit('view');
        return;
      }
      case 'view.theme.system':
      case 'view.theme.light':
      case 'view.theme.dark':
      case 'view.theme.hybrid': {
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
      case 'worksheet.addMarkdown':
        if (tab) await this.addMarkdownWorksheet(tab);
        return;
      case 'worksheet.addJson':
        if (tab) await this.addJsonWorksheet(tab);
        return;
      case 'worksheet.addYaml':
        if (tab) await this.addYamlWorksheet(tab);
        return;
      case 'worksheet.addText':
        if (tab) await this.addTextWorksheet(tab);
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
      case 'worksheet.toggleLock':
        if (tab && tab.doc.kind === 'rsf') {
          this.state.setSheetLocked(tab, tab.doc.activeSheetId, !tab.doc.activeSheet.locked);
        }
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
    if (tab.drive && this.driveIo?.available()) {
      return this.driveIo.save(tab);
    }
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

  /**
   * Explicit, confirmed lossy JSON export. See `FileIoCommands.exportJson`
   * for the full behavior contract.
   */
  async exportJson(tab: Tab): Promise<boolean> {
    return this.fileIo.exportJson(tab);
  }

  /**
   * Data > Run SQL Query…: open the local, read-only SQL query panel. See
   * `src/core/sql-engine.ts` for the query engine and its documented scope.
   */
  private async showSqlQuery(tab: Tab): Promise<void> {
    return this.ui.showSqlQuery({
      sources: this.sql.listSources(tab),
      runQuery: (sourceId, query) => this.sql.runQuery(tab, sourceId, query),
      columns: (sourceId) => this.sql.listColumns(tab, sourceId),
    });
  }

  /**
   * Data > Compare / Diff…: open the local, read-only two-tab compare panel.
   * See `src/core/diff-engine.ts` for the engine and its documented scope.
   */
  private async showDiff(tab: Tab): Promise<void> {
    return this.ui.showDiff({
      currentTabName: tab.name,
      currentColumns: this.diff.listColumns(tab),
      tabs: this.diff.listComparableTabs(this.state, tab),
      columnsForTab: (tabId) => {
        const other = this.state.tabs.find((t) => t.id === tabId);
        return other ? this.diff.listColumns(other) : [];
      },
      runDiff: (baselineTabId, options) => {
        // The dialog is modal, so the tab list cannot change while it is open.
        const baselineTab = this.state.tabs.find((t) => t.id === baselineTabId)!;
        return this.diff.runDiff(baselineTab, tab, options);
      },
      exportCsv: (result) => this.exportDiffCsv(tab, result),
    });
  }

  /** Export the shown diff rows as a plain UTF-8 CSV download (never the source documents). */
  private async exportDiffCsv(tab: Tab, result: DiffResult): Promise<boolean> {
    const rows = this.diff.buildDiffCsvRows(result);
    const encoded = encodeCsvExport(rows, ',', DEFAULT_CSV_EXPORT_OPTIONS);
    if (!encoded.ok) {
      return false; // unreachable for UTF-8, kept for type-safety with encodeCsvExport's signature
    }
    const base = tab.name.replace(/\.(rsf|rcsv|csv)$/i, '');
    try {
      await saveBytesAs(this.dom, `${base}-diff.csv`, encoded.bytes, 'csv');
      return true;
    } catch (err) {
      // A cancelled save picker (AbortError) is a silent no-op, matching every
      // other save/export flow's contract; anything else is reported.
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
   * File > New CSV: create a blank, byte-preserving CSV document in a new
   * active tab (#396) — the CSV counterpart of `newDocument`'s blank RSF
   * spreadsheet. See `FileIoCommands.newCsvDocument` for the full behavior
   * contract.
   */
  newCsvDocument(): Tab {
    return this.fileIo.newCsvDocument();
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

  private async addMarkdownWorksheet(tab: Tab): Promise<void> {
    return this.worksheets.addMarkdownWorksheet(tab);
  }

  private async addJsonWorksheet(tab: Tab): Promise<void> {
    return this.worksheets.addJsonWorksheet(tab);
  }

  private async addYamlWorksheet(tab: Tab): Promise<void> {
    return this.worksheets.addYamlWorksheet(tab);
  }

  private async addTextWorksheet(tab: Tab): Promise<void> {
    return this.worksheets.addTextWorksheet(tab);
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

  private async appendAxis(tab: Tab, axis: 'row' | 'col'): Promise<void> {
    return this.worksheets.appendAxis(tab, axis);
  }

  /**
   * Paste a rectangular matrix as one atomic, undoable operation. See
   * `PasteFillCommands.applyPaste` for the full behavior contract.
   */
  async applyPaste(tab: Tab, matrix: string[][], origin: Selection | null): Promise<boolean> {
    return this.pasteFill.applyPaste(tab, matrix, origin);
  }

  /**
   * Edit > Insert Copied > Insert Copied Cells…. See
   * `PasteFillCommands.insertCopiedCells` for the full behavior contract.
   */
  async insertCopiedCells(tab: Tab): Promise<boolean> {
    return this.pasteFill.insertCopiedCells(tab);
  }

  /**
   * Edit > Insert Copied > Insert Copied Rows / Insert Copied Columns. See
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
   * Sheet > Filter & Sort > Filter… (also the column-header filter buttons
   * and the context menu): open the filter dialog and apply the result as
   * one atomic, undoable operation. See `FilterCommands.filterDialog` for
   * the full behavior contract.
   */
  async filterDialog(tab: Tab, targetCol?: number): Promise<boolean> {
    return this.filter.filterDialog(tab, targetCol);
  }

  /** Sheet > Filter & Sort > Clear All Filters: every row becomes visible again (undoable). See `FilterCommands.clearAllFilters`. */
  clearAllFilters(tab: Tab): boolean {
    return this.filter.clearAllFilters(tab);
  }

  // ----- Sorting (RSF spreadsheet documents only; view-only, unsaved) -----

  /** The active tab's sort display order, or null when unsorted. See `SortCommands.sortOrder`. */
  sortOrder(tab: Tab): number[] | null {
    return this.sort.sortOrder(tab);
  }

  /**
   * Sheet > Filter & Sort > Sort…: open the sort dialog and apply the
   * result. See `SortCommands.sortDialog` for the full behavior contract.
   */
  async sortDialog(tab: Tab): Promise<boolean> {
    return this.sort.sortDialog(tab);
  }

  /** Sheet > Filter & Sort > Clear Sort: rows return to document order. See `SortCommands.clearSort`. */
  clearSort(tab: Tab): boolean {
    return this.sort.clearSort(tab);
  }

  // ----- Data validation (RSF spreadsheet documents only; view-only, unsaved) -----

  /** The rule applying to one cell on the active worksheet, or null. See `ValidationCommands.validationAt`. */
  validationAt(tab: Tab, row: number, col: number): CellValidation | null {
    return this.validation.validationAt(tab, row, col);
  }

  /**
   * Data > Data Validation…: open the dialog for the selected range and
   * apply the result. See `ValidationCommands.validationDialog` for the full
   * behavior contract.
   */
  async validationDialog(tab: Tab): Promise<boolean> {
    return this.validation.validationDialog(tab);
  }

  // ----- Conditional formatting (RSF spreadsheet documents only; view-only, unsaved) -----

  /**
   * Format > Conditional Formatting…: open the dialog for the selected range
   * and apply the result. See `ConditionalFormatCommands.conditionalFormatDialog`
   * for the full behavior contract.
   */
  async conditionalFormatDialog(tab: Tab): Promise<boolean> {
    return this.conditionalFormat.conditionalFormatDialog(tab);
  }

  // ----- Cell comments (RSF spreadsheet documents only) -----

  /** The comment on one cell of the active worksheet, or null. See `CommentCommands.commentAt`. */
  commentAt(tab: Tab, row: number, col: number): string | null {
    return this.comment.commentAt(tab, row, col);
  }

  /** Set (or clear, with `null`) one cell's comment, undoably. See `CommentCommands.setComment`. */
  setComment(tab: Tab, row: number, col: number, text: string | null): boolean {
    return this.comment.setComment(tab, row, col, text);
  }

  /**
   * Data > Cell Comment…: open the dialog for the active cell and apply the
   * result. See `CommentCommands.commentDialog` for the full behavior
   * contract.
   */
  async commentDialog(tab: Tab): Promise<boolean> {
    return this.comment.commentDialog(tab);
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
   * "Go to Cell…": jump the selection straight to any cell reference (e.g.
   * "B12"), the keyboard/menu equivalent of Excel's Name Box or Ctrl+G.
   * Unlike Move Selected Cells, this only moves the selection — it works on
   * CSV tabs too, and nothing is written to the document, so it needs no
   * history entry.
   */
  private async promptAndGoToCell(tab: Tab): Promise<void> {
    const doc = tab.doc;
    const validate = (text: string): string | null => {
      const at = parseRef(text.trim());
      if (!at) {
        return t('goToCell.error.invalid');
      }
      if (at.row >= doc.rowCount || at.col >= doc.columnCount) {
        return t('goToCell.error.outOfBounds', {
          rows: doc.rowCount,
          cols: columnLabel(doc.columnCount - 1),
        });
      }
      return null;
    };
    const current = this.state.selectedRange(tab);
    const suggestion = current ? cellLabel(current.top, current.left) : 'A1';
    const answer = await this.ui.promptGoToCell(suggestion, validate);
    if (answer === null) {
      return;
    }
    const at = parseRef(answer.trim());
    if (!at || validate(answer) !== null || tab.doc !== doc) {
      return;
    }
    this.gridActions?.goToCell(at.row, at.col);
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

  /** Open the Number Format dialog and apply the choice. See `FormatCommands.promptNumberFormat`. */
  async promptNumberFormat(tab: Tab): Promise<boolean> {
    return this.format.promptNumberFormat(tab);
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
