// SPDX-License-Identifier: MIT
import type { DelimiterId } from '../core/byte-csv-parser';
import type { CellRange } from '../core/clipboard';
import { initCsvEngine } from '../core/csv-engine';
import {
  buildCsvExportBytes,
  newCsvExportScan,
  scanCsvExportRow,
  type CsvExportOptions,
  type CsvExportScan,
} from '../core/csv-export';
import { detectEncoding, type EncodingId } from '../core/encoding';
import { isFormula, shiftFormulaRefs } from '../core/formula';
import type { CellChange, HistoryEntry, Operation } from '../core/history';
import { LosslessDocument } from '../core/lossless-document';
import {
  RcsvDocument,
  RCSV_EXTENSION,
  NEW_DOC_ROWS,
  NEW_DOC_COLS,
  type RcsvParseError,
} from '../core/rcsv-document';
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
import { AppState, type Selection, type Tab } from './app-state';
import {
  pickFiles,
  readFileObject,
  saveBytes,
  saveBytesAs,
  type OpenedFile,
  type SaveOutcome,
} from './file-access';
import { setLocale, t, type LocaleId } from './i18n';
import { getMaxFileSize, setMaxFileSize } from './settings';
import { setSheetFont, type SheetFontId } from './sheet-font';

/**
 * Why a CSV document needs converting to an RCSV spreadsheet document.
 * `command` is the explicit `Convert to RCSV…` menu command (which opens a new
 * tab); the others are implicit conversions triggered by an edit that a
 * byte-preserving CSV cannot represent (they convert the current tab in place).
 */
export type ConvertReason = 'formula' | 'paste' | 'structure' | 'fill' | 'command';

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
  /** Explain and confirm the explicit CSV -> RCSV conversion. */
  confirmConvert(reason: ConvertReason, name: string): Promise<boolean>;
  /** Explain that a spreadsheet document is saved as .rcsv (per-tab, once). */
  explainRcsvSave(name: string): Promise<boolean>;
  /**
   * The CSV export options dialog: explains the lossy conversion and lets the
   * user choose encoding, line endings, and BOM behavior. Resolving with
   * options *is* the explicit confirmation; null cancels the export.
   */
  chooseExportCsv(name: string): Promise<CsvExportOptions | null>;
  /** Choose the shift direction for Insert Copied Cells… (null cancels). */
  chooseInsertShift(rows: number, cols: number): Promise<'right' | 'down' | null>;
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
  | 'edit.revertCell'
  | 'edit.revertAll'
  | 'edit.fillDown'
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
  | 'sheet.exportCsv'
  | 'view.wrap'
  | 'view.stickyFirstRow'
  | 'view.sheetFont.bizUd'
  | 'view.sheetFont.ms'
  | 'view.sheetFont.msUi'
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

const CSV_LIKE_EXTENSIONS = ['.csv', '.tsv', '.txt', RCSV_EXTENSION];

export class Commands {
  /** Set by main.ts so menu Copy/Paste can go through the clipboard controller. */
  clipboardActions: {
    copy: () => Promise<void>;
    paste: () => Promise<void>;
    /** The most recently copied range (internal clipboard, else parsed system text). */
    getCopied: () => Promise<{ matrix: string[][]; origin: Selection | null } | null>;
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
      case 'file.reopen':
      case 'sheet.convert':
        return tab !== null && tab.doc.kind === 'csv';
      case 'sheet.exportCsv':
        return tab !== null && tab.doc.kind === 'rcsv';
      case 'sheet.insertRowAbove':
      case 'sheet.insertRowBelow':
      case 'sheet.deleteRows':
      case 'sheet.insertColLeft':
      case 'sheet.insertColRight':
      case 'sheet.deleteCols':
        return tab !== null && tab.selection !== null;
      case 'edit.undo':
        return tab !== null && tab.history.canUndo;
      case 'edit.redo':
        return tab !== null && tab.history.canRedo;
      // Insert Copied Cells stays clickable on a CSV tab: running it explains
      // that the structural insertion needs the explicit RCSV conversion.
      case 'edit.copy':
      case 'edit.paste':
      case 'edit.fillDown':
      case 'edit.insertCopiedCells':
        return tab?.selection != null;
      case 'edit.revertCell':
        return (
          tab?.selection != null &&
          tab.doc.kind === 'csv' &&
          tab.doc.isEdited(tab.selection.row, tab.selection.col)
        );
      case 'edit.revertAll':
        return tab !== null && tab.doc.kind === 'csv' && tab.doc.isDirty;
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
      case 'edit.revertCell':
        if (tab?.selection) this.state.revertCell(tab, tab.selection.row, tab.selection.col);
        return;
      case 'edit.revertAll':
        if (tab && this.state.revertAll(tab)) this.ui.notify(t('notify.reverted'), 'info');
        return;
      case 'edit.fillDown':
        if (tab) await this.fillDown(tab);
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
      case 'sheet.exportCsv':
        if (tab) await this.exportCsv(tab);
        return;
      case 'view.wrap':
        this.state.setWrapCells(!this.state.wrapCells);
        return;
      case 'view.stickyFirstRow':
        this.state.setStickyFirstRow(!this.state.stickyFirstRow);
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

    if (file.name.toLowerCase().endsWith(RCSV_EXTENSION)) {
      await this.openRcsvFile(file);
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

  private async openRcsvFile(file: OpenedFile): Promise<void> {
    const result = await this.withBusy(t('loading.opening', { name: file.name }), async () => {
      await initCsvEngine(); // reading DEFLATE-compressed containers needs the WASM codec
      return RcsvDocument.fromBytes(file.bytes, file.name);
    });
    if (!result.ok) {
      const reasonKey: Record<RcsvParseError, string> = {
        'bad-magic': 'dialog.rcsvInvalid.badMagic',
        'bad-version': 'dialog.rcsvInvalid.badVersion',
        'bad-shape': 'dialog.rcsvInvalid.badShape',
        checksum: 'dialog.rcsvInvalid.checksum',
        'unsupported-compression': 'dialog.rcsvInvalid.compression',
        'too-large': 'dialog.rcsvInvalid.tooLarge',
      };
      await this.ui.showMessage(
        t('dialog.rcsvInvalid.title'),
        t('dialog.rcsvInvalid.message', { name: file.name, reason: t(reasonKey[result.error]) }),
      );
      return;
    }
    const tab = this.state.addTab(file.name, result.doc, file.handle);
    tab.rcsvSaveExplained = true; // opened as .rcsv; no explanation needed
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
   * Save a tab. CSV: a normal save (all options "keep") with no edits writes
   * the originally loaded bytes verbatim; with edits, only edited field
   * ranges are reserialized. RCSV: the document is saved in the versioned
   * .rcsv JSON format (never silently into the original .csv).
   * Returns true when the file was actually saved.
   */
  async save(tab: Tab, options: SaveOptions): Promise<boolean> {
    if (tab.doc.kind === 'rcsv') {
      return this.saveRcsv(tab);
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

  /** Save a spreadsheet document as .rcsv (with a one-time explanation). */
  private async saveRcsv(tab: Tab): Promise<boolean> {
    if (tab.doc.kind !== 'rcsv') {
      return false;
    }
    if (!tab.rcsvSaveExplained) {
      const proceed = await this.ui.explainRcsvSave(tab.name);
      if (!proceed) {
        return false;
      }
      tab.rcsvSaveExplained = true;
    }
    if (!tab.name.toLowerCase().endsWith(RCSV_EXTENSION)) {
      tab.name = `${tab.name}${RCSV_EXTENSION}`;
    }
    // Serialization compresses the body and computes the checksum; show the
    // busy indicator so a large sheet never appears to freeze.
    const doc = tab.doc;
    const bytes = await this.withBusy(t('loading.savingRcsv', { name: tab.name }), async () => {
      await initCsvEngine(); // compression runs in the WASM codec when available
      return doc.toBytes();
    });
    let outcome: SaveOutcome;
    try {
      outcome = tab.handle
        ? await saveBytes(this.dom, tab.name, bytes, tab.handle)
        : await saveBytesAs(this.dom, tab.name, bytes, 'rcsv');
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
   * Explicit, confirmed lossy CSV export of an RCSV document. The options
   * dialog (encoding, line endings, BOM) doubles as the confirmation; the
   * displayed values are then validated against the chosen encoding in a
   * time-sliced scan behind the progress indicator. Unrepresentable
   * characters cancel the export by default — continuing uses the documented
   * numeric-character-reference replacement and reports the affected cells.
   * Nothing in this flow ever mutates the source document or marks it saved.
   */
  async exportCsv(tab: Tab): Promise<boolean> {
    if (tab.doc.kind !== 'rcsv') {
      return false;
    }
    const options = await this.ui.chooseExportCsv(tab.name);
    if (!options) {
      return false;
    }
    const name = tab.name.replace(/\.rcsv$/i, '') + '.csv';
    const doc = tab.doc;
    const label = t('loading.exporting', { name });

    // Sliced, read-only scan of the displayed (calculated) values. Aborts —
    // producing nothing — if the tab's document changes while yielding.
    const scanValues = async (allowNcr: boolean): Promise<CsvExportScan | null> => {
      const scan = newCsvExportScan();
      const completed = await forEachIndexSliced(
        doc.rowCount,
        (r) => {
          const values: string[] = [];
          for (let c = 0; c < doc.columnCount; c++) {
            values.push(doc.getDisplayValue(r, c));
          }
          scanCsvExportRow(scan, r, values, options.encoding, allowNcr);
        },
        {
          onProgress: (done, total) => this.ui.setBusy(`${label} (${Math.round((done / total) * 100)}%)`),
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
   * Ensure the tab holds an RCSV spreadsheet document, asking for the
   * explicit conversion when it is still CSV. Never converts silently.
   */
  async ensureRcsv(tab: Tab, reason: ConvertReason): Promise<RcsvDocument | null> {
    if (tab.doc.kind === 'rcsv') {
      return tab.doc;
    }
    const ok = await this.ui.confirmConvert(reason, tab.name);
    if (!ok) {
      return null;
    }
    const doc = this.state.convertToRcsv(tab);
    if (doc) {
      this.ui.notify(t('notify.converted', { name: tab.name }), 'info');
    }
    return doc;
  }

  /** Blank-document counter so each File > New tab gets a distinct default name. */
  private newDocCount = 0;

  /**
   * File > New: create a blank spreadsheet document in a new active tab. New
   * documents are RCSV because a blank spreadsheet may gain formulas,
   * structural edits, metadata, and user-defined dimensions that a plain CSV
   * cannot hold. The document starts unsaved (marked dirty) and is saved as
   * `.rcsv`; its filename and location are chosen on the first save. Creating
   * it never mutates any other open document.
   */
  newDocument(): Tab {
    this.newDocCount += 1;
    const suffix = this.newDocCount > 1 ? `-${this.newDocCount}` : '';
    const name = `${t('untitled.new')}${suffix}${RCSV_EXTENSION}`;
    const doc = RcsvDocument.blank(name, NEW_DOC_ROWS, NEW_DOC_COLS);
    return this.state.addTab(name, doc, null);
  }

  /**
   * The explicit `Convert to RCSV…` command. Unlike the implicit conversions
   * (which convert the current tab in place when an edit requires it), this
   * creates a *new* RCSV tab from the CSV's current (edited) values and leaves
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
    const doc = await this.withBusy(t('loading.converting', { name: tab.name }), () =>
      this.state.convertToRcsvNewTab(tab),
    );
    if (doc) {
      this.ui.notify(t('notify.convertedNewTab', { name: doc.name }), 'info');
    }
  }

  /**
   * Commit a cell edit from the grid or formula bar. Entering a formula
   * (`=...`) into a CSV document offers the explicit RCSV conversion; if
   * declined, the text is kept as a plain literal value.
   */
  async commitCellEdit(tab: Tab, row: number, col: number, value: string): Promise<boolean> {
    if (tab.doc.kind === 'csv' && isFormula(value)) {
      await this.ensureRcsv(tab, 'formula');
    }
    return this.state.editCell(tab, row, col, value);
  }

  /** Row/column structural commands, driven by the selected range. */
  private async runSheetOp(tab: Tab, id: CommandId): Promise<void> {
    const range = this.state.selectedRange(tab);
    if (!range) {
      return;
    }
    const doc = await this.ensureRcsv(tab, 'structure');
    if (!doc) {
      return;
    }
    const clampedRange = this.state.selectedRange(tab) ?? range;
    const rows = clampedRange.bottom - clampedRange.top + 1;
    const cols = clampedRange.right - clampedRange.left + 1;
    switch (id) {
      case 'sheet.insertRowAbove':
        this.state.insertRows(tab, clampedRange.top, rows);
        return;
      case 'sheet.insertRowBelow':
        this.state.insertRows(tab, clampedRange.bottom + 1, rows);
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
        this.state.deleteRows(tab, clampedRange.top, rows);
        return;
      }
      case 'sheet.insertColLeft':
        this.state.insertCols(tab, clampedRange.left, cols);
        return;
      case 'sheet.insertColRight':
        this.state.insertCols(tab, clampedRange.right + 1, cols);
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
        this.state.deleteCols(tab, clampedRange.left, cols);
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
   * row/column structure require the explicit RCSV conversion. `origin` is
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
        const converted = await this.ensureRcsv(tab, !fits ? 'paste' : 'formula');
        if (!converted) {
          if (!fits) {
            return false;
          }
          // Formula paste declined: paste as plain literals below.
        }
      }
    }

    // Large pastes run behind the loading indicator so the UI shows progress
    // feedback instead of appearing frozen while changes are prepared.
    const large = height * width > 20_000;
    const run = (): boolean => this.applyPasteNow(tab, matrix, origin, at, height, width);
    return large ? this.withBusy(t('loading.pasting'), run) : run();
  }

  /** Build and push the paste entry (synchronous, atomic). */
  private applyPasteNow(
    tab: Tab,
    matrix: string[][],
    origin: Selection | null,
    at: Selection,
    height: number,
    width: number,
  ): boolean {
    const srcH = matrix.length;
    const srcW = matrix[0].length;
    const doc = tab.doc;
    if (doc.kind === 'csv') {
      const changes: CellChange[] = [];
      for (let i = 0; i < height; i++) {
        for (let j = 0; j < width; j++) {
          const row = at.row + i;
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
      }
      const applied = this.state.bulkEdit(tab, changes, 'history.paste');
      if (applied) {
        this.state.setSelection(tab, at, { row: at.row + height - 1, col: at.col + width - 1 });
      }
      return applied;
    }

    // RCSV: the grid may grow to fit the paste (atomically undoable).
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
    const changes: CellChange[] = [];
    for (let i = 0; i < height; i++) {
      for (let j = 0; j < width; j++) {
        const row = at.row + i;
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
    ops.push({ type: 'cells', changes });
    const entry: HistoryEntry = { label: 'history.paste', ops };
    const applied = this.state.pushEntry(tab, entry);
    if (applied) {
      this.state.setSelection(tab, at, { row: at.row + height - 1, col: at.col + width - 1 });
    }
    return applied;
  }

  /**
   * Edit > Insert Copied Cells…: insert the most recently copied range at the
   * selection, shifting existing cells right (whole columns) or down (whole
   * rows). Structural insertion is a spreadsheet operation, so a plain CSV
   * document requires the explicit RCSV conversion first (the confirmation
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
    const doc = await this.ensureRcsv(tab, 'structure');
    if (!doc) {
      return false;
    }
    const at = tab.selection;
    if (!at) {
      return false;
    }
    const large = copied.matrix.length * copied.matrix[0].length > 20_000;
    const run = (): boolean => this.state.insertCopiedCells(tab, at, copied.matrix, direction, copied.origin);
    return large ? this.withBusy(t('loading.inserting'), run) : run();
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
   * be explicitly converted to RCSV first (it modifies multiple cells and may
   * extend the grid). The whole fill — including any grid growth — is one
   * atomic, undoable operation. Absolute/mixed `$` references are not
   * supported by the formula engine; such formulas already evaluate to
   * #ERROR!, so no `$` adjustment is attempted.
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
    const doc = await this.ensureRcsv(tab, 'fill');
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

    const changes: CellChange[] = [];
    for (let r = dest.top; r <= dest.bottom; r++) {
      for (let c = dest.left; c <= dest.right; c++) {
        if (r <= source.bottom && c <= source.right) {
          continue; // the source block itself is unchanged
        }
        const si = (r - source.top) % srcH;
        const sj = (c - source.left) % srcW;
        const srcRow = source.top + si;
        const srcCol = source.left + sj;
        let value = srcValues[si][sj];
        if (isFormula(value) && (r !== srcRow || c !== srcCol)) {
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
    }
    return applied;
  }

  /** Clear every cell in the selected range as one undoable operation. */
  clearRange(tab: Tab): boolean {
    const range = this.state.selectedRange(tab);
    if (!range) {
      return false;
    }
    const doc = tab.doc;
    const changes: CellChange[] = [];
    for (let r = range.top; r <= range.bottom; r++) {
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
          onProgress: (done, total) => this.ui.setBusy(`${label} (${Math.round((done / total) * 100)}%)`),
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
