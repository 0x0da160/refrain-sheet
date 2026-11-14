// SPDX-License-Identifier: MIT
/**
 * Opening files — picked, dropped, recent, and reopened with other options —
 * and turning each supported format (CSV-like text, .rsf, .xlsx, and the
 * Markdown/JSON/YAML/text files that open in an editor) into a tab. A file whose
 * name and content do not say what it is is opened as the kind the user picks.
 * Validation problems are shown before anything opens; a file already open in
 * another tab is activated instead of opened twice. A document tab can also be
 * reopened as another kind (see `reopenAs`).
 */
import { isMinimalEdition } from '../edition';
import { isCsv, isWorkbook, type EditorDocument } from '../../core/editor-document';
import { initCsvEngine } from '../../core/csv/csv-engine';
import { detectEncoding, type EncodingDetection } from '../../core/csv/encoding';
import {
  decodeTextFile,
  textFileKindOf,
  type TextFileFormat,
  type TextFileKind,
} from '../../core/interchange/text-file';
import { sniffContentKind, type OpenAsKind } from '../../core/interchange/open-kind';
import { isRsfEncryptedContainer, type RsfEncryptionSession } from '../../core/workbook/rsf-encryption';
import { isValidSheetName } from '../../core/formula';
import { LosslessDocument } from '../../core/csv/lossless-document';
import {
  MAX_WORKSHEETS,
  RsfDocument,
  RSF_EXTENSION,
  RSF_LEGACY_EXTENSION,
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
import { clearRecentDriveFiles, listRecentDriveFiles } from '../recent-drive-files';
import { getLocale, t } from '../i18n';
import { getAutoFitOnOpen, getMaxFileSize } from '../settings';
import {
  CSV_EXTENSION,
  isGridSurface,
  LARGE_OPEN_BYTES,
  warnProtectedAndOfferUnlock,
  withBusyIfLarge,
} from './shared';
import { csvRows, sheetNameBase } from './tab-as-sheet';
import { showRsfInvalid, unlockEncryptedRsf, type LoadedRsf } from './rsf-io';

import type { FileIoCommands } from './file-io';
import type { RecentFileChoice } from '../ui-port';

const XLSX_EXTENSION = '.xlsx';
const JSON_EXTENSION = '.json';
const TSV_EXTENSION = '.tsv';

/** The kind a file opens as: the XLSX importer, or one of the kinds in {@link OpenAsKind}. */
type OpenChoice = 'xlsx' | OpenAsKind;

/** A document made from a file's bytes as one kind, not yet in a tab. */
interface LoadedDocument {
  doc: EditorDocument;
  /** For a plain-text file, how its bytes are laid out (see `TextFileFormat`); null otherwise. */
  textFile: TextFileFormat | null;
  /** The keys of an encrypted `.rsf` file, so its saves stay encrypted; null otherwise. */
  encryption: RsfEncryptionSession | null;
}

/**
 * The kind a file opens as from its name alone, or null when the name does not
 * say (then its content, or the user, decides; see `FileOpening.choiceFor`).
 */
function kindOfName(name: string): OpenAsKind | null {
  const lower = name.toLowerCase();
  if (lower.endsWith(RSF_EXTENSION) || lower.endsWith(RSF_LEGACY_EXTENSION)) {
    return 'rsf';
  }
  if (lower.endsWith(CSV_EXTENSION) || lower.endsWith(TSV_EXTENSION)) {
    return 'csv';
  }
  return textFileKindOf(name);
}

/** Opens a Drive file from File > Open Recent… again (`DriveIoCommands.reopen`). */
export interface RecentDriveOpener {
  reopen(fileId: string, name: string): Promise<void>;
}

/** Marks a Drive row's id in the recent list, apart from the ids of files on this device. */
const DRIVE_ID_PREFIX = 'drive:';

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
  async openFiles(files: OpenedFile[]): Promise<void> {
    for (const file of files) {
      await this.openFile(file);
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
   *
   * `drive` (the hosted build with Google Drive) adds the Drive files this
   * browser opened or saved, listed apart from the files on this device and
   * opened again through it.
   */
  async openRecent(drive: RecentDriveOpener | null = null): Promise<void> {
    const choices = await this.recentChoices(drive !== null);
    if (choices.length === 0) {
      this.core.ui.notify(t(drive ? 'notify.recentEmptyDrive' : 'notify.recentEmpty'), 'info');
      return;
    }
    const choice = await this.core.ui.chooseRecentFile(choices);
    if (choice === null) {
      return;
    }
    if (choice === 'clear') {
      await clearRecentFiles();
      clearRecentDriveFiles();
      this.core.ui.notify(t('notify.recentCleared'), 'info');
      return;
    }
    await this.openRecentChoice(choice, drive);
  }

  /**
   * The recently opened files, newest first within each place: those on
   * this device, then (with `withDrive`) the Drive files this browser
   * opened or saved. The home screen lists the first few of these.
   */
  async recentChoices(withDrive: boolean): Promise<RecentFileChoice[]> {
    const entries = await listRecentFiles();
    const driveEntries = withDrive ? listRecentDriveFiles() : [];
    return [
      ...entries.map((entry) => ({
        id: entry.id,
        name: entry.name,
        openedAt: entry.openedAt,
        where: 'device' as const,
      })),
      ...driveEntries.map((entry) => ({
        id: `${DRIVE_ID_PREFIX}${entry.fileId}`,
        name: entry.name,
        openedAt: entry.openedAt,
        where: 'drive' as const,
      })),
    ];
  }

  /**
   * Open one recent file by its {@link recentChoices} id, asking the browser
   * for read permission again first (a stored handle loses it when the page
   * reloads). A file that has since been moved or deleted is reported and
   * dropped from the list.
   */
  async openRecentChoice(id: string, drive: RecentDriveOpener | null): Promise<void> {
    if (id.startsWith(DRIVE_ID_PREFIX)) {
      const fileId = id.slice(DRIVE_ID_PREFIX.length);
      const driveEntry = drive ? listRecentDriveFiles().find((e) => e.fileId === fileId) : undefined;
      if (drive && driveEntry) {
        await drive.reopen(driveEntry.fileId, driveEntry.name);
      }
      return;
    }
    const entry = (await listRecentFiles()).find((e) => e.id === id);
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
    await this.openFiles([opened]);
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
    await this.openFiles(files);
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

  private async openFile(file: OpenedFile): Promise<void> {
    if (await this.refuseTooLarge(file)) {
      return;
    }
    if (isMinimalEdition() && this.refuseInMinimal(file)) {
      return;
    }
    const choice = await this.choiceFor(file);
    if (choice === 'xlsx') {
      await this.openXlsxFile(file);
    } else if (choice !== null) {
      await this.openAs(file, choice);
    }
  }

  /**
   * The kind a file opens as. Its name decides when it names a kind the app
   * knows. Otherwise its content decides when the content says what the file
   * is (an RSF file, an XLSX workbook, a JSON document). Otherwise the user
   * picks, and null means the pick was cancelled. The CSV-only edition has one
   * kind to open as, so it never asks.
   */
  private async choiceFor(file: OpenedFile): Promise<OpenChoice | null> {
    if (file.name.toLowerCase().endsWith(XLSX_EXTENSION)) {
      return 'xlsx';
    }
    if (isMinimalEdition()) {
      return 'csv';
    }
    const named = kindOfName(file.name);
    if (named !== null) {
      return named;
    }
    const content = sniffContentKind(file.bytes);
    if (content !== null) {
      return content;
    }
    return this.core.ui.chooseFileType(file.name, 'open');
  }

  /** Open `file` as `kind` in a new tab, unless it is already open, in which case that tab is shown. */
  private async openAs(file: OpenedFile, kind: OpenAsKind): Promise<void> {
    if (await this.alreadyOpen(file)) {
      return;
    }
    switch (kind) {
      case 'csv':
        await this.openCsvFile(file);
        return;
      case 'rsf':
        await this.openRsfFile(file);
        return;
      default:
        await this.openTextFile(file, kind);
    }
  }

  private async openCsvFile(file: OpenedFile): Promise<void> {
    const doc = await this.loadCsv(file);
    if (!doc) {
      return;
    }
    const tab = this.core.state.addTab(file.name, doc, file.handle, true);
    tab.diskStamp = file.handle ? (file.stamp ?? null) : null;
    await this.autoFitOnOpen(tab);
  }

  /**
   * A CSV document from `file`'s bytes, or null when they could not be read or
   * the user declines the problems found in them (the reason is shown first).
   */
  private async loadCsv(file: OpenedFile): Promise<LosslessDocument | null> {
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
      return null;
    }

    if (doc.diagnostics.length > 0) {
      const openAnyway = await this.core.ui.confirmValidation(file.name, validateDocument(doc));
      if (!openAnyway) {
        return null;
      }
    }
    return doc;
  }

  private async openRsfFile(file: OpenedFile): Promise<void> {
    const loaded = await this.loadRsf(file);
    if (!loaded) {
      return;
    }
    const tab = this.core.state.addTab(file.name, loaded.doc, file.handle, true);
    tab.diskStamp = file.handle ? (file.stamp ?? null) : null;
    tab.fileSize = file.bytes.length;
    tab.rsfSaveExplained = true; // opened as a spreadsheet file; no explanation needed
    tab.encryption = loaded.encryption; // an encrypted file's saves stay encrypted
    // No auto-fit: an RSF workbook's worksheets keep the widths they were
    // saved with, and fitting them to content gave unintended widths.
  }

  /**
   * A workbook from `file`'s `.rsf` bytes, or null when they are not a valid RSF
   * file, or an encrypted file is not unlocked (the reason is shown). Its keys
   * come back too, so a later save seals the file under them.
   */
  private async loadRsf(file: OpenedFile): Promise<LoadedRsf | null> {
    if (isRsfEncryptedContainer(file.bytes)) {
      return unlockEncryptedRsf(this.core.ui, file);
    }
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
      await showRsfInvalid(this.core.ui, file.name, result.error);
      return null;
    }
    if (result.doc.filterDropped) {
      // The container carried filter metadata that failed validation; it was
      // ignored (never guessed at) and the sheet itself loaded normally.
      this.core.ui.notify(t('notify.filterDropped', { name: file.name }), 'warn');
    }
    return { doc: result.doc, encryption: null };
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
    const { doc, textFile } = await this.loadText(file, kind);
    const tab = this.core.state.addTab(file.name, doc, file.handle, true);
    tab.diskStamp = file.handle ? (file.stamp ?? null) : null;
    tab.textFile = textFile;
    tab.fileSize = file.bytes.length;
  }

  /** A plain-text file's document (one worksheet of `kind`), and how its bytes are laid out. */
  private async loadText(
    file: OpenedFile,
    kind: TextFileKind,
  ): Promise<{ doc: RsfDocument; textFile: TextFileFormat }> {
    const { text, format, detection } = decodeTextFile(file.bytes, kind);
    await this.warnAboutEncoding(file, detection);
    const base = sheetNameBase(file.name);
    const sheetName = base && isValidSheetName(base) ? base : defaultSheetName();
    const doc = RsfDocument.fromSourceText(file.name, kind, text, sheetName, getLocale());
    return { doc, textFile: format };
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
      const sheet = this.core.state.addSheetFromValues(tab, name, csvRows(csv));
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

  /**
   * File > Reopen as…: read the tab's file again as a kind the user picks, as
   * Reopen with Encoding does for a CSV. The file itself is not changed, and
   * unsaved edits are discarded. A spreadsheet file (an RSF, or an XLSX by its
   * content) has no text or table reading, so it is refused with a message.
   */
  async reopenAs(tab: Tab): Promise<void> {
    // A protected tab is not changed without the user first unlocking it.
    if (tab.readOnly && !(await warnProtectedAndOfferUnlock(this.core.ui, this.core.state, tab, 'book'))) {
      return;
    }
    const source = await this.tabSource(tab);
    if (source === null) {
      this.core.ui.notify(t('notify.reopenUnavailable', { name: tab.name }), 'warn');
      return;
    }
    if (await this.refuseTooLarge(source)) {
      return;
    }
    const content = sniffContentKind(source.bytes);
    if (content === 'rsf' || content === 'xlsx') {
      this.core.ui.notify(t('notify.reopenWorkbook', { name: tab.name }), 'warn');
      return;
    }
    // The dialog itself warns that unsaved edits are discarded.
    const kind = await this.core.ui.chooseFileType(tab.name, 'reopen');
    if (kind === null) {
      return;
    }
    const loaded = await this.loadAs(source, kind);
    if (!loaded) {
      return;
    }
    // The new document replaces the old one and clears its undo history, as a
    // reopen with another encoding does. The view (zoom, widths, selection)
    // stays where it was.
    this.core.state.setBaseline(tab, loaded.doc);
    tab.textFile = loaded.textFile;
    tab.fileSize = kind === 'csv' ? null : source.bytes.length;
    tab.diskStamp = source.handle ? (source.stamp ?? null) : null;
  }

  /** The document `file` holds as `kind`, or null when it could not be loaded (the reason is shown). */
  private async loadAs(file: OpenedFile, kind: OpenAsKind): Promise<LoadedDocument | null> {
    if (kind === 'csv') {
      const doc = await this.loadCsv(file);
      return doc ? { doc, textFile: null, encryption: null } : null;
    }
    if (kind === 'rsf') {
      const loaded = await this.loadRsf(file);
      return loaded ? { doc: loaded.doc, textFile: null, encryption: loaded.encryption } : null;
    }
    const text = await this.loadText(file, kind);
    return { ...text, encryption: null };
  }

  /**
   * The bytes to read a tab's file again from: the file on disk through the
   * tab's handle when it has one, else the bytes the tab still holds (a CSV's
   * original bytes, a text file's last read or written bytes). Null when
   * neither is available, as for a workbook with no file behind it.
   */
  private async tabSource(tab: Tab): Promise<OpenedFile | null> {
    if (tab.handle) {
      try {
        return await readFileObject(await tab.handle.getFile(), tab.handle, getMaxFileSize());
      } catch {
        return null;
      }
    }
    if (isCsv(tab.doc)) {
      return { name: tab.name, bytes: tab.doc.bytes, handle: null, size: tab.doc.bytes.length };
    }
    if (tab.textFile) {
      const bytes = tab.textFile.savedBytes;
      return { name: tab.name, bytes, handle: null, size: bytes.length };
    }
    return null;
  }
}
