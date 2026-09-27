// SPDX-License-Identifier: MIT
import type { NotifyPort, FileDialogsPort } from '../ui-port';
import { isCsv, isWorkbook } from '../../core/editor-document';
import { initCsvEngine } from '../../core/csv/csv-engine';
import { forEachIndexSliced } from '../../core/scheduler';
import { LosslessDocument } from '../../core/csv/lossless-document';
import { RsfDocument, RSF_EXTENSION, NEW_DOC_ROWS, NEW_DOC_COLS } from '../../core/workbook/rsf-document';
import {
  serializeDocument,
  KEEP_SAVE_OPTIONS,
  type NcrCellReport,
  type SaveOptions,
} from '../../core/csv/serializer';
import type { AppState, Tab } from '../state';
import { defaultSheetName } from '../state/defaults';
import { decidedBySheet, resolveWrap, resolveZoom } from '../state/view-layers';
import { requestSaveHandle, saveBytes, type OpenedFile } from '../file-access';
import { recordRecentFile } from '../recent-files';
import { getLocale, t } from '../i18n';
import { getSuppressHistoryCapWarning } from '../settings';
import type { ConvertReason } from '../commands';
import {
  CSV_EXTENSION,
  LARGE_OP_CELLS,
  nextPaint,
  pct,
  warnProtectedAndOfferUnlock,
  withBusy,
  withBusyIfLarge,
} from './shared';
import { FileOpening } from './file-open';
import { FileExporting } from './file-export';

/** The subset of `Commands.gridActions` file I/O needs to auto-fit a newly opened tab. */
interface GridAutoFitPort {
  autoFitAllColumns(tab: Tab): Promise<void>;
}

/**
 * File I/O and CSV/RSF conversion: opening, saving, exporting, closing tabs,
 * and converting a CSV document to the RSF spreadsheet format. Extracted
 * from `Commands` as a cohesive slice (see issue #68) — `Commands` still
 * exposes the same public methods, delegating to an instance of this class.
 */
export class FileIoCommands {
  /** Blank-document counter so each File > New tab gets a distinct default name. */
  private newDocCount = 0;
  /** Blank-document counter so each File > New CSV tab gets a distinct default name. */
  private newCsvDocCount = 0;
  /** Opening files: picked, dropped, recent, reopened, and every supported format. */
  readonly opening: FileOpening;

  /** The explicit, confirmed lossy exports: CSV, XLSX, JSON. */
  readonly exporting: FileExporting;

  constructor(
    readonly state: AppState,
    readonly ui: NotifyPort & FileDialogsPort,
    readonly dom: Document,
    readonly gridActions: () => GridAutoFitPort | null,
  ) {
    this.opening = new FileOpening(this);
    this.exporting = new FileExporting(this);
  }

  /** Open picked or dropped files. Every entry point (menu, shortcut, drop) funnels through here. */
  openFiles(files: OpenedFile[], opts: { confirmNonCsv: boolean }): Promise<void> {
    return this.opening.openFiles(files, opts);
  }

  /**
   * File > Open Recent…: lists the recently opened files and opens the one
   * picked, asking the browser for read permission again first (a stored
   * handle loses it when the page reloads). A file that has since been
   * moved or deleted is reported and dropped from the list. The dialog can
   * also clear the whole list.
   */
  openRecent(): Promise<void> {
    return this.opening.openRecent();
  }

  openDroppedFiles(fileList: File[], handles: Array<FileSystemFileHandle | null>): Promise<void> {
    return this.opening.openDroppedFiles(fileList, handles);
  }

  reopen(tab: Tab): Promise<void> {
    return this.opening.reopen(tab);
  }

  /** File > Save with Options…: CSV only (an `.rsf` file has no options to choose). */
  async saveWithOptions(tab: Tab): Promise<void> {
    if (!isCsv(tab.doc)) {
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
   * ranges are reserialized. RSF: the document is saved in the versioned
   * .rsf JSON format (never silently into the original .csv).
   * Returns true when the file was actually saved.
   */
  async save(tab: Tab, options: SaveOptions): Promise<boolean> {
    if (isWorkbook(tab.doc)) {
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
        this.ui.notify(t('notify.saveFailedUnrepresentable', { name: tab.name }), 'error');
        return false;
      }
      ncrReports = result.ncrReplacements;
    }

    const written = await this.runSaveStep(tab.name, () =>
      saveBytes(this.dom, tab.name, result.bytes, tab.handle),
    );
    if (!written.ok) {
      return false;
    }
    const outcome = written.value;
    // A real save (however it landed) ends the "brand-new, never-saved CSV"
    // exception (#479): further structural edits go through the normal
    // explicit RSF conversion again.
    tab.neverSaved = false;

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
    if (!isWorkbook(tab.doc)) {
      return false;
    }
    // Acquire the destination up front, inside the user gesture. `handle` is
    // null when the File System Access API is unavailable (the finished bytes
    // are then downloaded); the picker call itself must precede every await.
    // Picker cancelled: nothing is saved, the file association is untouched,
    // the document stays dirty, and no success is reported.
    const acquired = await this.acquireRsfHandle(tab);
    if (!acquired.ok) {
      return false;
    }
    const handle = acquired.handle;
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
    const bytes = await this.encodeRsfBytes(tab);
    if (bytes === null) {
      return false;
    }
    return this.writeRsfBytes(tab, bytes, handle);
  }

  /**
   * Serialize + compress the RSF document behind the busy indicator and return
   * the finished bytes, or null when the encode was cancelled (the tab changed
   * while yielding). Split out of {@link encodeAndWriteRsf} so a destination
   * that is not a file handle — a Drive upload — can reuse the same encode.
   */
  private async encodeRsfBytes(tab: Tab): Promise<Uint8Array | null> {
    const doc = tab.doc;
    if (!isWorkbook(doc)) {
      return null;
    }
    // Warn before the save actually happens when it will drop the oldest
    // recorded version-history snapshot (the retained cap has been reached)
    // — the one-time "don't show again" preference lives in `app/settings.ts`
    // (browser-local, never written into the file). Declining aborts the
    // save entirely, exactly like cancelling the destination picker above.
    if (doc.willDropOldestOnNextSave && !getSuppressHistoryCapWarning()) {
      const max = doc.effectiveHistoryMax;
      if (max !== null) {
        const proceed = await this.ui.confirmHistoryCapExceeded(tab.name, max);
        if (!proceed) {
          return null;
        }
      }
    }
    // Record the tab's live view state (zoom, overridden column widths) so
    // the container persists it; presentational only, never dirties the doc.
    // Zoom/wrap inherited from the file or browser level are not copied into
    // the worksheet, so it keeps following that level.
    doc.setDisplaySettings(
      decidedBySheet(resolveZoom(doc).source) ? tab.zoom : doc.displayZoom,
      tab.colWidths,
      decidedBySheet(resolveWrap(doc).source) ? tab.wrapCells : undefined,
    );
    // The whole workbook is serialized, not just the active worksheet.
    let totalCells = 0;
    for (const sheet of doc.sheets) {
      totalCells += sheet.rowCount * sheet.columnCount;
    }
    const large = totalCells > LARGE_OP_CELLS;
    const bytes = await withBusyIfLarge(
      large,
      this.ui,
      t('loading.savingRsf', { name: tab.name }),
      async () => {
        await initCsvEngine(); // compression runs in the WASM codec when available
        if (!large) {
          return doc.toBytes();
        }
        // One sliced scan across every worksheet's rows, so the percentage
        // describes the whole save rather than one worksheet of it.
        const perSheet: Array<Array<[number, number, string]>> = doc.sheets.map(() => []);
        const completed = await forEachIndexSliced(doc.totalRows, (i) => doc.collectFlatRow(i, perSheet), {
          onProgress: (done, total) =>
            this.ui.setBusy(
              t('loading.savingSerialize', { name: tab.name, pct: pct(done, total) }),
              pct(done, total),
            ),
          shouldStop: () => tab.doc !== doc,
        });
        if (!completed || tab.doc !== doc) {
          return null;
        }
        this.ui.setBusy(t('loading.savingCompress', { name: tab.name }));
        await nextPaint();
        return doc.toBytesFromSheetCells(perSheet);
      },
    );
    return bytes;
  }

  /** Write already-encoded RSF bytes to an acquired handle (or download them). */
  private async writeRsfBytes(
    tab: Tab,
    bytes: Uint8Array,
    handle: FileSystemFileHandle | null,
  ): Promise<boolean> {
    // The handle was already acquired inside the gesture; `saveBytes`
    // overwrites through it or, with no handle, produces a download.
    const written = await this.runSaveStep(tab.name, () => saveBytes(this.dom, tab.name, bytes, handle));
    if (!written.ok) {
      return false;
    }
    const outcome = written.value;
    if (outcome.fellBack) {
      this.ui.notify(t('notify.permissionDenied'), 'warn');
    }
    // Associate the destination only after a successful overwrite so a
    // cancelled/failed save never mutates the tab's file association.
    if (outcome.handle) {
      tab.handle = outcome.handle;
      // The picker lets the user type a different file name; the tab follows it.
      this.state.adoptSavedName(tab, outcome.handle.name);
      if (outcome.mode === 'overwrite') {
        await recordRecentFile(outcome.handle, tab.name);
      }
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
   * Encode the tab for upload to an external destination (Google Drive),
   * returning the bytes and the MIME type to send. Uses exactly the same
   * encoders as a local save — an RSF document keeps its container, a CSV
   * document keeps its original encoding, delimiter, and quoting — so a
   * round-trip through Drive preserves the same bytes a local save would
   * produce. Returns null when the user declined an unrepresentable-character
   * prompt or the encode was cancelled.
   */
  async encodeForUpload(tab: Tab): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
    if (isWorkbook(tab.doc)) {
      const bytes = await this.encodeRsfBytes(tab);
      return bytes === null ? null : { bytes, mimeType: 'application/octet-stream' };
    }
    let result = serializeDocument(tab.doc, KEEP_SAVE_OPTIONS, false);
    if (!result.ok) {
      const proceed = await this.ui.confirmUnrepresentable(
        t(`encoding.${tab.doc.encoding}`),
        result.unrepresentable,
      );
      if (!proceed) {
        return null;
      }
      result = serializeDocument(tab.doc, KEEP_SAVE_OPTIONS, true);
      if (!result.ok) {
        return null;
      }
    }
    return { bytes: result.bytes, mimeType: 'text/csv' };
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
  exportCsv(tab: Tab): Promise<boolean> {
    return this.exporting.exportCsv(tab);
  }

  /**
   * Explicit, confirmed lossy XLSX export. Unlike CSV (which holds only one
   * worksheet, forcing `chooseExportSheet`), XLSX natively holds several, so
   * an RSF workbook exports every worksheet, in tab order; a CSV-kind tab —
   * which always has exactly one sheet — exports as a single-sheet workbook.
   * Cells carry only their calculated/display values, matching CSV export's
   * documented conversion. Nothing in this flow ever mutates the source
   * document or marks it saved.
   */
  exportXlsx(tab: Tab): Promise<boolean> {
    return this.exporting.exportXlsx(tab);
  }

  /**
   * Explicit, confirmed lossy JSON export. Unlike XLSX (which natively holds
   * every worksheet), a plain JSON document has no worksheet concept, so —
   * like CSV export — an RSF workbook with more than one worksheet requires
   * an explicit choice (`chooseExportSheet`) rather than exporting every
   * worksheet. The chosen worksheet's first row supplies the JSON object
   * field names; every following row becomes one record (see
   * `buildJsonExport`). Cells carry only their calculated/display values.
   * Nothing in this flow ever mutates the source document or marks it saved.
   */
  exportJson(tab: Tab): Promise<boolean> {
    return this.exporting.exportJson(tab);
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
    if (isWorkbook(tab.doc)) {
      return tab.doc;
    }
    // Unprotecting here goes straight on to the conversion prompt, so the
    // action that needed RSF is not lost.
    if (tab.readOnly && !(await warnProtectedAndOfferUnlock(this.ui, this.state, tab, 'book'))) {
      return null;
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
      const built = await withBusy(this.ui, label, () => this.buildRsfSliced(tab, label));
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
    if (!isCsv(doc)) {
      return null;
    }
    const columnCount = Math.max(1, doc.columnCount);
    if (doc.rowCount * columnCount <= LARGE_OP_CELLS) {
      return RsfDocument.fromLossless(doc, tab.name, defaultSheetName(), getLocale());
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
            pct(done, total),
          ),
        shouldStop: () => tab.doc !== doc,
      },
    );
    if (!completed || tab.doc !== doc) {
      return null;
    }
    return RsfDocument.fromValues(
      tab.name,
      doc.delimiter,
      rows,
      columnCount,
      defaultSheetName(),
      getLocale(),
    );
  }

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
    const doc = RsfDocument.blank(name, NEW_DOC_ROWS, NEW_DOC_COLS, defaultSheetName(), getLocale());
    return this.state.addTab(name, doc, null);
  }

  /**
   * File > New CSV: create a blank, byte-preserving CSV document in a new
   * active tab (#396) — the CSV counterpart of `newDocument`'s blank RSF
   * spreadsheet. The starting content is a single blank line (one empty
   * row/column) rather than zero bytes: a genuinely empty (0-row) document
   * renders no selectable cell at all (see `Grid.refresh`'s `grid.empty`
   * state), which would leave a freshly created tab with no way to select a
   * cell, paste, or insert a row — a dead end for a command whose whole
   * point is to start editing. Unlike `newDocument`'s RSF workbook, the tab
   * is not force-marked dirty: `LosslessDocument.isDirty` tracks actual
   * edits, so an untouched new CSV closes silently, exactly like opening a
   * real file and not touching it. Its filename and location are chosen on
   * the first save (as `.csv`). Creating it never mutates any other open
   * document.
   */
  newCsvDocument(): Tab {
    this.newCsvDocCount += 1;
    const suffix = this.newCsvDocCount > 1 ? `-${this.newCsvDocCount}` : '';
    const name = `${t('untitled.new')}${suffix}${CSV_EXTENSION}`;
    const doc = LosslessDocument.fromBytes(new TextEncoder().encode('\n'));
    const tab = this.state.addTab(name, doc, null);
    // Until the first save there is no on-disk byte layout to protect, so
    // row/column structural edits are allowed directly on this CSV document
    // (#479) — see `Tab.neverSaved` and `StructuralOpsState`.
    tab.neverSaved = true;
    return tab;
  }

  /**
   * The explicit `Convert to RSF…` command. Unlike the implicit conversions
   * (which convert the current tab in place when an edit requires it), this
   * creates a *new* RSF tab from the CSV's current (edited) values and leaves
   * the source CSV tab — and the original file on disk — untouched. The heavy
   * conversion runs behind the loading indicator.
   */
  async convertCommand(tab: Tab): Promise<void> {
    if (!isCsv(tab.doc)) {
      return;
    }
    const ok = await this.ui.confirmConvert('command', tab.name);
    if (!ok) {
      return;
    }
    // The value collection runs in time slices with percentage progress for
    // large documents; small ones build synchronously behind the indicator.
    const label = t('loading.converting', { name: tab.name });
    const built = await withBusy(this.ui, label, () => this.buildRsfSliced(tab, label));
    if (!built) {
      return;
    }
    const doc = this.state.convertToRsfNewTab(tab, built);
    if (doc) {
      this.ui.notify(t('notify.convertedNewTab', { name: doc.name }), 'info');
    }
  }

  /**
   * Run one step of a save/export flow (acquiring a picker handle or
   * writing the finished bytes), classifying a thrown error the way every
   * save/export path must: a cancelled picker (`AbortError`) is a silent
   * stop, anything else is reported via `notify.saveFailed`, naming the file. Either way the
   * caller gets `ok: false` and must stop without saving — the two cases
   * are never distinguished further because both already leave the
   * document and disk untouched.
   */
  async runSaveStep<T>(
    name: string,
    work: () => Promise<T>,
  ): Promise<{ ok: true; value: T } | { ok: false }> {
    try {
      return { ok: true, value: await work() };
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return { ok: false };
      }
      this.ui.notify(
        t('notify.saveFailed', { name, error: err instanceof Error ? err.message : String(err) }),
        'error',
      );
      return { ok: false };
    }
  }

  /**
   * Normalize a tab's name to the `.rsf` extension (sync, so a save picker
   * shown immediately after suggests the right name) and acquire a save
   * destination: the tab's existing handle, or a freshly requested one. A
   * `null` handle is a legitimate outcome (the File System Access API is
   * unavailable; the caller downloads instead) — only `ok: false` means the
   * caller must stop.
   */
  private async acquireRsfHandle(
    tab: Tab,
  ): Promise<{ ok: true; handle: FileSystemFileHandle | null } | { ok: false }> {
    if (!tab.name.toLowerCase().endsWith(RSF_EXTENSION)) {
      tab.name = `${tab.name}${RSF_EXTENSION}`;
    }
    if (tab.handle) {
      return { ok: true, handle: tab.handle };
    }
    const acquired = await this.runSaveStep(tab.name, () => requestSaveHandle(tab.name, 'rsf'));
    return acquired.ok ? { ok: true, handle: acquired.value } : acquired;
  }
}
