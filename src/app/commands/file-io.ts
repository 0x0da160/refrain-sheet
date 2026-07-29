// SPDX-License-Identifier: MIT
import { getRsfCodec, initCsvEngine } from '../../core/csv-engine';
import {
  buildCsvExportBytes,
  newCsvExportScan,
  scanCsvExportRow,
  type CsvExportScan,
} from '../../core/csv-export';
import { detectEncoding } from '../../core/encoding';
import { forEachIndexSliced } from '../../core/scheduler';
import { LosslessDocument } from '../../core/lossless-document';
import {
  RsfDocument,
  RSF_EXTENSION,
  RSF_LEGACY_EXTENSION,
  NEW_DOC_ROWS,
  NEW_DOC_COLS,
  type RsfParseError,
} from '../../core/rsf-document';
import {
  serializeDocument,
  KEEP_SAVE_OPTIONS,
  type NcrCellReport,
  type SaveOptions,
} from '../../core/serializer';
import { validateDocument } from '../../core/validation';
import { parseXlsxWorkbook, type XlsxImportError } from '../../core/xlsx-import';
import { buildXlsxExport, type XlsxSheetInput } from '../../core/xlsx-export';
import { AppState, defaultSheetName, type Tab } from '../app-state';
import { readFileObject, requestSaveHandle, saveBytes, saveBytesAs, type OpenedFile } from '../file-access';
import { getLocale, t } from '../i18n';
import { getMaxFileSize } from '../settings';
import type { ConvertReason, UiPort } from '../commands';
import { LARGE_OP_CELLS, nextPaint, pct, withBusy } from './shared';

const CSV_LIKE_EXTENSIONS = ['.csv', '.tsv', '.txt', RSF_EXTENSION, RSF_LEGACY_EXTENSION];
const XLSX_EXTENSION = '.xlsx';

/**
 * File I/O and CSV/RSF conversion: opening, saving, exporting, closing tabs,
 * and converting a CSV document to the RSF spreadsheet format. Extracted
 * from `Commands` as a cohesive slice (see issue #68) — `Commands` still
 * exposes the same public methods, delegating to an instance of this class.
 */
export class FileIoCommands {
  /** Blank-document counter so each File > New tab gets a distinct default name. */
  private newDocCount = 0;

  constructor(
    private readonly state: AppState,
    private readonly ui: UiPort,
    private readonly dom: Document,
  ) {}

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

    if (lowerName.endsWith(XLSX_EXTENSION)) {
      await this.openXlsxFile(file);
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
      doc = await withBusy(this.ui, t('loading.opening', { name: file.name }), async () => {
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
    const result = await withBusy(this.ui, t('loading.opening', { name: file.name }), async () => {
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

  /**
   * Import a `.xlsx` workbook: always a new `.rsf` tab, never a matching
   * handle, since an `.xlsx` file is never the save target for the resulting
   * document (mirrors the legacy `.rcsv` migration above). Only calculated
   * display values are read — no formulas, styles, or column widths —
   * matching the documented lossy scope of `.xlsx` export.
   */
  private async openXlsxFile(file: OpenedFile): Promise<void> {
    const result = await withBusy(this.ui, t('loading.opening', { name: file.name }), async () => {
      await initCsvEngine(); // reading DEFLATE-compressed ZIP entries needs the WASM codec
      return parseXlsxWorkbook(file.bytes);
    });
    if (!result.ok) {
      const reasonKey: Record<XlsxImportError, string> = {
        'not-a-zip': 'dialog.xlsxInvalid.notAZip',
        'missing-workbook': 'dialog.xlsxInvalid.missingWorkbook',
        'no-sheets': 'dialog.xlsxInvalid.noSheets',
        'corrupt-entry': 'dialog.xlsxInvalid.corruptEntry',
        'too-large': 'dialog.xlsxInvalid.tooLarge',
      };
      await this.ui.showMessage(
        t('dialog.xlsxInvalid.title'),
        t('dialog.xlsxInvalid.message', { name: file.name, reason: t(reasonKey[result.error]) }),
      );
      return;
    }
    const name = `${file.name.slice(0, -XLSX_EXTENSION.length)}${RSF_EXTENSION}`;
    const doc = RsfDocument.fromSheetValues(name, result.sheets, getLocale());
    doc.markUnsaved();
    const tab = this.state.addTab(name, doc, null);
    tab.rsfSaveExplained = true; // opened as a spreadsheet file; no explanation needed
    this.ui.notify(t('notify.xlsxImported', { name }), 'info');
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

  async reopen(tab: Tab): Promise<void> {
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

  async saveWithOptions(tab: Tab): Promise<void> {
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
    // Acquire the destination NOW — synchronously up to the picker call,
    // before the async engine init, the compression dialog, and the
    // compression itself — so the browser's user activation (required by
    // showSaveFilePicker) is still valid. Picker cancelled: no compression
    // change, no save, no association.
    const acquired = await this.acquireRsfHandle(tab);
    if (!acquired.ok) {
      return;
    }
    const handle = acquired.handle;
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

    const written = await this.runSaveStep(() => saveBytes(this.dom, tab.name, result.bytes, tab.handle));
    if (!written.ok) {
      return false;
    }
    const outcome = written.value;

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
    const doc = tab.doc;
    if (doc.kind !== 'rsf') {
      return false;
    }
    // Record the tab's live view state (zoom, overridden column widths) so
    // the container persists it; presentational only, never dirties the doc.
    doc.setDisplaySettings(tab.zoom, tab.colWidths, tab.wrapCells);
    const bytes = await withBusy(this.ui, t('loading.savingRsf', { name: tab.name }), async () => {
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
      await nextPaint();
      return doc.toBytesFromSheetCells(perSheet);
    });
    if (bytes === null) {
      return false;
    }
    // The handle was already acquired inside the gesture; `saveBytes`
    // overwrites through it or, with no handle, produces a download.
    const written = await this.runSaveStep(() => saveBytes(this.dom, tab.name, bytes, handle));
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

    let scan = await withBusy(this.ui, label, () => scanValues(false));
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
      scan = await withBusy(this.ui, label, () => scanValues(true));
      if (!scan) {
        return false;
      }
      ncrReports = scan.ncrReplacements;
    }
    const rows = scan.rows;
    const bytes = await withBusy(this.ui, label, () => buildCsvExportBytes(rows, doc.delimiter, options));
    const written = await this.runSaveStep(() => saveBytesAs(this.dom, name, bytes, 'csv'));
    if (!written.ok) {
      return false;
    }
    const outcome = written.value;
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
  async exportXlsx(tab: Tab): Promise<boolean> {
    const doc = tab.doc;
    const confirmed = await this.ui.confirmExportXlsx(tab.name);
    if (!confirmed || tab.doc !== doc) {
      return false;
    }
    const base = tab.name.replace(/\.(rsf|rcsv|csv|tsv|txt)$/i, '');
    const name = `${base}.xlsx`;
    const label = t('loading.exporting', { name });

    const plans =
      doc.kind === 'rsf'
        ? doc.sheets.map((s) => ({
            name: s.name,
            rowCount: s.rowCount,
            columnCount: s.columnCount,
            getValue: (r: number, c: number) => doc.getSheetDisplayValue(s.id, r, c),
          }))
        : [
            {
              name: base,
              rowCount: doc.rowCount,
              columnCount: doc.columnCount,
              getValue: (r: number, c: number) => doc.getDisplayValue(r, c),
            },
          ];
    const totalRows = plans.reduce((sum, p) => sum + p.rowCount, 0);

    // Sliced, read-only scan of every planned worksheet's displayed
    // (calculated) values. Aborts — producing nothing — if the tab's
    // document changes.
    const scanSheets = async (): Promise<XlsxSheetInput[] | null> => {
      const sheets: XlsxSheetInput[] = [];
      let doneRows = 0;
      for (const plan of plans) {
        const rows: string[][] = [];
        const completed = await forEachIndexSliced(
          plan.rowCount,
          (r) => {
            const values: string[] = [];
            for (let c = 0; c < plan.columnCount; c++) {
              values.push(plan.getValue(r, c));
            }
            rows.push(values);
          },
          {
            onProgress: (done) => this.ui.setBusy(`${label} (${pct(doneRows + done, totalRows)}%)`),
            shouldStop: () => tab.doc !== doc,
          },
        );
        if (!completed || tab.doc !== doc) {
          return null;
        }
        doneRows += plan.rowCount;
        sheets.push({ name: plan.name, rows });
      }
      return sheets;
    };

    const sheets = await withBusy(this.ui, label, scanSheets);
    if (!sheets) {
      return false;
    }
    const bytes = await withBusy(this.ui, label, () => buildXlsxExport(sheets));
    const written = await this.runSaveStep(() => saveBytesAs(this.dom, name, bytes, 'xlsx'));
    if (!written.ok) {
      return false;
    }
    const outcome = written.value;
    this.ui.notify(
      outcome.mode === 'overwrite'
        ? t('notify.exportedXlsx', { name })
        : t('notify.exportedXlsxDownload', { name: outcome.downloadName ?? name }),
      'info',
    );
    return true;
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
    if (doc.kind !== 'csv') {
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
   * The explicit `Convert to RSF…` command. Unlike the implicit conversions
   * (which convert the current tab in place when an edit requires it), this
   * creates a *new* RSF tab from the CSV's current (edited) values and leaves
   * the source CSV tab — and the original file on disk — untouched. The heavy
   * conversion runs behind the loading indicator.
   */
  async convertCommand(tab: Tab): Promise<void> {
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
   * stop, anything else is reported via `notify.saveFailed`. Either way the
   * caller gets `ok: false` and must stop without saving — the two cases
   * are never distinguished further because both already leave the
   * document and disk untouched.
   */
  private async runSaveStep<T>(work: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> {
    try {
      return { ok: true, value: await work() };
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return { ok: false };
      }
      this.ui.notify(
        t('notify.saveFailed', { error: err instanceof Error ? err.message : String(err) }),
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
    const acquired = await this.runSaveStep(() => requestSaveHandle(tab.name, 'rsf'));
    return acquired.ok ? { ok: true, handle: acquired.value } : acquired;
  }
}
