// SPDX-License-Identifier: MIT
/**
 * Opening files — picked, dropped, recent, and reopened with other options —
 * and turning each supported format (CSV-like text, .rsf, .xlsx, and the
 * Markdown/JSON/YAML/text files that open in an editor) into a tab. Validation problems are shown before anything opens; a file already
 * open in another tab is activated instead of opened twice.
 */
import { isMinimalEdition } from '../edition';
import { isCsv, isWorkbook } from '../../core/editor-document';
import { initCsvEngine } from '../../core/csv/csv-engine';
import { detectEncoding, type EncodingDetection } from '../../core/csv/encoding';
import {
  decodeTextFile,
  textFileBaseName,
  textFileKindOf,
  type TextFileKind,
} from '../../core/interchange/text-file';
import { isValidSheetName } from '../../core/formula';
import { LosslessDocument } from '../../core/csv/lossless-document';
import {
  MAX_WORKSHEETS,
  RsfDocument,
  RSF_EXTENSION,
  RSF_LEGACY_EXTENSION,
  type RsfParseError,
} from '../../core/workbook/rsf-document';
import { validateDocument } from '../../core/csv/validation';
import { parseXlsxWorkbook, type XlsxImportError } from '../../core/interchange/xlsx-import';
import { parseJsonWorkbook, type JsonImportError } from '../../core/interchange/json-import';
import type { Tab } from '../state';
import { defaultSheetName } from '../state/defaults';
import { readFileObject, type OpenedFile } from '../file-access';
import { isOpenInAnotherTab } from '../open-elsewhere';
import {
  clearRecentFiles,
  ensureReadPermission,
  listRecentFiles,
  recordRecentFile,
  removeRecentFile,
} from '../recent-files';
import { getLocale, t } from '../i18n';
import { getAutoFitOnOpen, getMaxFileSize } from '../settings';
import { isGridSurface, LARGE_OPEN_BYTES, withBusyIfLarge } from './shared';

import type { FileIoCommands } from './file-io';
import { CSV_EXTENSION } from './shared';

const CSV_LIKE_EXTENSIONS = [CSV_EXTENSION, '.tsv', RSF_EXTENSION, RSF_LEGACY_EXTENSION];
const XLSX_EXTENSION = '.xlsx';
const JSON_EXTENSION = '.json';

export class FileOpening {
  constructor(private readonly core: FileIoCommands) {}

  /**
   * Auto-fit every column of a freshly opened tab, when the "auto-fit on
   * open" preference is enabled. Skipped when the tab already carries
   * column-width metadata (an RSF worksheet resized and saved by the user) —
   * an explicit prior choice always wins over the app default, matching
   * `getWrapCells` and the app zoom preference.
   */
  private async autoFitOnOpen(tab: Tab): Promise<void> {
    if (!getAutoFitOnOpen() || tab.colWidths.length > 0 || !isGridSurface(tab)) {
      return;
    }
    await this.core.gridActions()?.autoFitAllColumns(tab);
  }

  /** Open picked or dropped files. Every entry point (menu, shortcut, drop) funnels through here. */
  async openFiles(files: OpenedFile[], opts: { confirmNonCsv: boolean }): Promise<void> {
    for (const file of files) {
      await this.openFile(file, opts);
      // Only a file opened through the File System Access API can be read
      // again later, so only those join File > Open Recent (#598).
      if (file.handle && !file.tooLarge) {
        await recordRecentFile(file.handle, file.name);
      }
    }
  }

  /**
   * File > Open Recent…: lists the recently opened files and opens the one
   * picked, asking the browser for read permission again first (a stored
   * handle loses it when the page reloads). A file that has since been
   * moved or deleted is reported and dropped from the list. The dialog can
   * also clear the whole list.
   */
  async openRecent(): Promise<void> {
    const entries = await listRecentFiles();
    if (entries.length === 0) {
      this.core.ui.notify(t('notify.recentEmpty'), 'info');
      return;
    }
    const choice = await this.core.ui.chooseRecentFile(
      entries.map((entry) => ({ id: entry.id, name: entry.name, openedAt: entry.openedAt })),
    );
    if (choice === null) {
      return;
    }
    if (choice === 'clear') {
      await clearRecentFiles();
      this.core.ui.notify(t('notify.recentCleared'), 'info');
      return;
    }
    const entry = entries.find((e) => e.id === choice);
    if (!entry) {
      return;
    }
    if (!(await ensureReadPermission(entry.handle))) {
      this.core.ui.notify(t('notify.recentPermissionDenied', { name: entry.name }), 'warn');
      return;
    }
    let file: File;
    try {
      file = await entry.handle.getFile();
    } catch {
      await removeRecentFile(entry.id);
      this.core.ui.notify(t('notify.recentMissing', { name: entry.name }), 'warn');
      return;
    }
    const opened = await readFileObject(file, entry.handle, getMaxFileSize());
    await this.openFiles([opened], { confirmNonCsv: false });
  }

  async openDroppedFiles(fileList: File[], handles: Array<FileSystemFileHandle | null>): Promise<void> {
    const files: OpenedFile[] = [];
    const maxSize = getMaxFileSize();
    for (let i = 0; i < fileList.length; i++) {
      try {
        files.push(await readFileObject(fileList[i], handles[i] ?? null, maxSize));
      } catch (err) {
        this.core.ui.notify(
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

  /** Report a file over the size limit; true when it must not be opened. */
  private async refuseTooLarge(file: OpenedFile): Promise<boolean> {
    if (!file.tooLarge && file.size <= getMaxFileSize()) {
      return false;
    }
    await this.core.ui.showMessage(
      t('dialog.tooLarge.title'),
      t('dialog.tooLarge.message', {
        name: file.name,
        size: Math.ceil(file.size / (1024 * 1024)),
        limit: Math.round(getMaxFileSize() / (1024 * 1024)),
      }),
    );
    return true;
  }

  /**
   * The CSV-only edition opens CSV and plain text as a table and turns away
   * workbooks (`.rsf`, `.xlsx`) and Markdown, JSON and YAML files, saying so.
   * True when `file` was turned away.
   */
  private refuseInMinimal(file: OpenedFile): boolean {
    const lower = file.name.toLowerCase();
    const kind = textFileKindOf(file.name);
    const workbook = [RSF_EXTENSION, RSF_LEGACY_EXTENSION, XLSX_EXTENSION].some((ext) => lower.endsWith(ext));
    if (!workbook && (kind === null || kind === 'text')) {
      return false;
    }
    this.core.ui.notify(t('notify.minimalCsvOnly', { name: file.name }), 'error');
    return true;
  }

  private async openFile(file: OpenedFile, opts: { confirmNonCsv: boolean }): Promise<void> {
    if (await this.refuseTooLarge(file)) {
      return;
    }

    const lowerName = file.name.toLowerCase();
    if (isMinimalEdition() && this.refuseInMinimal(file)) {
      return;
    }
    if (lowerName.endsWith(RSF_EXTENSION) || lowerName.endsWith(RSF_LEGACY_EXTENSION)) {
      if (await this.alreadyOpen(file)) {
        return;
      }
      await this.openRsfFile(file);
      return;
    }

    if (lowerName.endsWith(XLSX_EXTENSION)) {
      await this.openXlsxFile(file);
      return;
    }

    const textKind = textFileKindOf(file.name);
    if (textKind && !isMinimalEdition()) {
      if (await this.alreadyOpen(file)) {
        return;
      }
      await this.openTextFile(file, textKind);
      return;
    }

    if (opts.confirmNonCsv) {
      const lower = file.name.toLowerCase();
      if (!CSV_LIKE_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
        const open = await this.core.ui.confirm(
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

    if (await this.alreadyOpen(file)) {
      return;
    }

    await this.warnAboutEncoding(file, detectEncoding(file.bytes));

    let doc: LosslessDocument;
    try {
      doc = await withBusyIfLarge(
        file.size > LARGE_OPEN_BYTES,
        this.core.ui,
        t('loading.opening', { name: file.name }),
        async () => {
          // The embedded WASM engine initializes in the background at startup;
          // parsing waits for it here (idempotent, usually already resolved) so
          // the first open still uses the fast engine.
          await initCsvEngine();
          return LosslessDocument.fromBytes(file.bytes);
        },
      );
    } catch (err) {
      this.core.ui.notify(
        t('notify.openFailed', { name: file.name, error: err instanceof Error ? err.message : String(err) }),
        'error',
      );
      return;
    }

    if (doc.diagnostics.length > 0) {
      const openAnyway = await this.core.ui.confirmValidation(file.name, validateDocument(doc));
      if (!openAnyway) {
        return;
      }
    }

    const tab = this.core.state.addTab(file.name, doc, file.handle, true);
    tab.diskStamp = file.handle ? (file.stamp ?? null) : null;
    await this.autoFitOnOpen(tab);
  }

  private async openRsfFile(file: OpenedFile): Promise<void> {
    const result = await withBusyIfLarge(
      file.size > LARGE_OPEN_BYTES,
      this.core.ui,
      t('loading.opening', { name: file.name }),
      async () => {
        await initCsvEngine(); // reading a compressed Zstandard frame needs the WASM codec
        return RsfDocument.fromBytes(file.bytes, file.name);
      },
    );
    if (!result.ok) {
      const reasonKey: Record<RsfParseError, string> = {
        'bad-magic': 'dialog.rsfInvalid.badMagic',
        'legacy-format': 'dialog.rsfInvalid.legacyFormat',
        'bad-version': 'dialog.rsfInvalid.badVersion',
        'bad-shape': 'dialog.rsfInvalid.badShape',
        checksum: 'dialog.rsfInvalid.checksum',
        'unsupported-compression': 'dialog.rsfInvalid.compression',
        'too-large': 'dialog.rsfInvalid.tooLarge',
      };
      await this.core.ui.showMessage(
        t('dialog.rsfInvalid.title'),
        t('dialog.rsfInvalid.message', { name: file.name, reason: t(reasonKey[result.error]) }),
      );
      return;
    }
    const name = file.name;
    const tab = this.core.state.addTab(name, result.doc, file.handle, true);
    tab.diskStamp = file.handle ? (file.stamp ?? null) : null;
    tab.rsfSaveExplained = true; // opened as a spreadsheet file; no explanation needed
    if (result.doc.filterDropped) {
      // The container carried filter metadata that failed validation; it was
      // ignored (never guessed at) and the sheet itself loaded normally.
      this.core.ui.notify(t('notify.filterDropped', { name }), 'warn');
    }
    // No auto-fit: an RSF workbook's worksheets keep the widths they were
    // saved with, and fitting them to content gave unintended widths.
  }

  /**
   * Import a `.xlsx` workbook: always a new `.rsf` tab, never a matching
   * handle, since an `.xlsx` file is never the save target for the resulting
   * document (mirrors the legacy `.rcsv` migration above). Only calculated
   * display values are read — no formulas, styles, or column widths —
   * matching the documented lossy scope of `.xlsx` export.
   */
  private async openXlsxFile(file: OpenedFile): Promise<void> {
    const result = await withBusyIfLarge(
      file.size > LARGE_OPEN_BYTES,
      this.core.ui,
      t('loading.opening', { name: file.name }),
      async () => {
        await initCsvEngine(); // reading DEFLATE-compressed ZIP entries needs the WASM codec
        return parseXlsxWorkbook(file.bytes);
      },
    );
    if (!result.ok) {
      const reasonKey: Record<XlsxImportError, string> = {
        'not-a-zip': 'dialog.xlsxInvalid.notAZip',
        'missing-workbook': 'dialog.xlsxInvalid.missingWorkbook',
        'no-sheets': 'dialog.xlsxInvalid.noSheets',
        'corrupt-entry': 'dialog.xlsxInvalid.corruptEntry',
        'too-large': 'dialog.xlsxInvalid.tooLarge',
      };
      await this.core.ui.showMessage(
        t('dialog.xlsxInvalid.title'),
        t('dialog.xlsxInvalid.message', { name: file.name, reason: t(reasonKey[result.error]) }),
      );
      return;
    }
    const name = `${file.name.slice(0, -XLSX_EXTENSION.length)}${RSF_EXTENSION}`;
    const doc = RsfDocument.fromSheetValues(name, result.sheets, getLocale());
    doc.markUnsaved();
    const tab = this.core.state.addTab(name, doc, null, true);
    tab.rsfSaveExplained = true; // opened as a spreadsheet file; no explanation needed
    this.core.ui.notify(t('notify.xlsxImported', { name }), 'info');
    await this.autoFitOnOpen(tab);
  }

  /**
   * Tell the user when a text file's encoding is outside the supported range
   * or could not be told apart with confidence (the file still opens).
   */
  private async warnAboutEncoding(file: OpenedFile, detection: EncodingDetection): Promise<void> {
    if (detection.unsupportedCandidate) {
      await this.core.ui.showMessage(
        t('dialog.unsupported.title'),
        t('dialog.unsupported.message', {
          name: file.name,
          candidate: detection.unsupportedCandidate,
          encoding: t(`encoding.${detection.encoding}`),
        }),
      );
    } else if (detection.uncertain) {
      await this.core.ui.showMessage(
        t('dialog.unsupported.title'),
        t('dialog.uncertain.message', { name: file.name }),
      );
    }
  }

  /**
   * Open a Markdown, JSON, YAML, or text file in its editor: one worksheet of
   * that kind holding the file's text. The tab keeps the file's handle and
   * name, and remembers its encoding, BOM, and line endings, so Save writes
   * the text back into the same file (see `FileIoCommands.save`).
   */
  private async openTextFile(file: OpenedFile, kind: TextFileKind): Promise<void> {
    const { text, format, detection } = decodeTextFile(file.bytes, kind);
    await this.warnAboutEncoding(file, detection);
    const base = textFileBaseName(file.name).trim();
    const sheetName = base && isValidSheetName(base) ? base : defaultSheetName();
    const doc = RsfDocument.fromSourceText(file.name, kind, text, sheetName, getLocale());
    const tab = this.core.state.addTab(file.name, doc, file.handle, true);
    tab.diskStamp = file.handle ? (file.stamp ?? null) : null;
    tab.textFile = format;
  }

  /**
   * File > Import JSON as Table…: pick `.json` files and import each as a
   * table (a `.json` file opened the ordinary way opens in the JSON editor).
   */
  async importJsonTables(files: OpenedFile[]): Promise<void> {
    for (const file of files) {
      if (!(await this.refuseTooLarge(file))) {
        await this.importJsonTable(file);
      }
    }
  }

  /**
   * Import a `.json` file as a table: always a new `.rsf` tab, never a
   * matching handle, for the same reason as `.xlsx` above — a `.json` file is
   * never the save target for the resulting document. Only a top-level array
   * of flat (non-nested) objects is supported (see `parseJsonWorkbook`);
   * columns are the union of every object's keys, in first-seen order.
   */
  private async importJsonTable(file: OpenedFile): Promise<void> {
    const result = await withBusyIfLarge(
      file.size > LARGE_OPEN_BYTES,
      this.core.ui,
      t('loading.opening', { name: file.name }),
      () => parseJsonWorkbook(file.bytes),
    );
    if (!result.ok) {
      const reasonKey: Record<JsonImportError, string> = {
        'invalid-json': 'dialog.jsonInvalid.invalidJson',
        'not-an-array': 'dialog.jsonInvalid.notAnArray',
        'empty-array': 'dialog.jsonInvalid.emptyArray',
        'not-flat-object': 'dialog.jsonInvalid.notFlatObject',
      };
      await this.core.ui.showMessage(
        t('dialog.jsonInvalid.title'),
        t('dialog.jsonInvalid.message', { name: file.name, reason: t(reasonKey[result.error]) }),
      );
      return;
    }
    const base = file.name.toLowerCase().endsWith(JSON_EXTENSION)
      ? file.name.slice(0, -JSON_EXTENSION.length)
      : file.name;
    const name = `${base}${RSF_EXTENSION}`;
    const doc = RsfDocument.fromValues(
      name,
      ',',
      result.rows,
      result.columnCount,
      defaultSheetName(),
      getLocale(),
    );
    doc.markUnsaved();
    const tab = this.core.state.addTab(name, doc, null, true);
    tab.rsfSaveExplained = true; // opened as a spreadsheet file; no explanation needed
    this.core.ui.notify(t('notify.jsonImported', { name }), 'info');
    await this.autoFitOnOpen(tab);
  }

  /**
   * Sheet > Add Sheet from CSV File…: add each picked CSV file to `tab`'s
   * workbook as a new sheet after the active one, named after the file. The
   * file is read with the same encoding detection as opening it; the file
   * itself is only read, never linked to the workbook.
   */
  async addCsvSheets(tab: Tab, files: OpenedFile[]): Promise<void> {
    for (const file of files) {
      const doc = tab.doc;
      if (!isWorkbook(doc) || this.core.state.activeTab !== tab) {
        return;
      }
      if (doc.sheetCount >= MAX_WORKSHEETS) {
        this.core.ui.notify(t('notify.sheetLimit', { max: MAX_WORKSHEETS }), 'warn');
        return;
      }
      if (await this.refuseTooLarge(file)) {
        continue;
      }
      await this.warnAboutEncoding(file, detectEncoding(file.bytes));
      let csv: LosslessDocument;
      try {
        csv = await withBusyIfLarge(
          file.size > LARGE_OPEN_BYTES,
          this.core.ui,
          t('loading.opening', { name: file.name }),
          async () => {
            await initCsvEngine();
            return LosslessDocument.fromBytes(file.bytes);
          },
        );
      } catch (err) {
        this.core.ui.notify(
          t('notify.openFailed', {
            name: file.name,
            error: err instanceof Error ? err.message : String(err),
          }),
          'error',
        );
        continue;
      }
      const base = file.name.replace(/\.(csv|tsv|txt)$/i, '').trim();
      const name = doc.uniqueSheetName(base && isValidSheetName(base) ? base : defaultSheetName());
      // Read the same way as Convert to RSF (`RsfDocument.fromLossless`).
      const rows: string[][] = [];
      for (let r = 0; r < csv.rowCount; r++) {
        const row: string[] = [];
        for (let c = 0; c < csv.fieldCount(r); c++) {
          row.push(csv.getValue(r, c));
        }
        rows.push(row);
      }
      const sheet = this.core.state.addSheetFromValues(tab, name, rows);
      if (sheet) {
        this.core.ui.notify(t('notify.csvSheetAdded', { name: sheet.name, file: file.name }), 'info');
      }
    }
  }

  /**
   * A file that is already open is never opened a second time, so two
   * copies cannot overwrite each other's saves. Open in this window: switch
   * to its tab. Open in another browser tab of the app: say so and stop.
   * (`.xlsx` files and JSON tables are imported into new, unsaved files and
   * never hold the original, so they are not checked.)
   */
  private async alreadyOpen(file: OpenedFile): Promise<boolean> {
    const existing = await this.findExistingTab(file);
    if (existing) {
      this.core.state.activateTab(existing.id);
      this.core.ui.notify(t('notify.sameFile', { name: file.name }), 'info');
      return true;
    }
    if (file.handle && (await isOpenInAnotherTab(file.handle))) {
      this.core.ui.notify(t('notify.openInAnotherTab', { name: file.name }), 'warn');
      return true;
    }
    return false;
  }

  private async findExistingTab(file: OpenedFile): Promise<Tab | null> {
    if (file.handle) {
      for (const tab of this.core.state.tabs) {
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
    return this.core.state.findTabForFile(file.name, file.bytes);
  }

  async reopen(tab: Tab): Promise<void> {
    if (!isCsv(tab.doc)) {
      return;
    }
    // The reopen dialog itself warns that unsaved edits are discarded.
    const choice = await this.core.ui.chooseReopen(tab);
    if (!choice) {
      return;
    }
    const doc = tab.doc.reinterpret(choice);
    this.core.state.setBaseline(tab, doc);
    if (doc.diagnostics.length > 0) {
      await this.core.ui.confirmValidation(tab.name, validateDocument(doc));
    }
  }
}
