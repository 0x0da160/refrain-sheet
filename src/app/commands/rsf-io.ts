// SPDX-License-Identifier: MIT
/**
 * The `.rsf` steps the file commands share: encoding a tab's workbook for a save
 * (sealed under its keys when the file is encrypted), and unlocking an encrypted
 * file on open. Dialogs go through `UiPort`; nothing here touches the DOM.
 */
import { isWorkbook } from '../../core/editor-document';
import { initCsvEngine } from '../../core/csv/csv-engine';
import { forEachIndexSliced } from '../../core/scheduler';
import { openEncryptedRsf, sealPlainRsf } from '../../core/workbook/rsf-encrypted-file';
import {
  defaultRsfEncryptionDeps,
  RsfEncryptionFailure,
  startRsfEncryption,
  type RsfEncryptionError,
  type RsfEncryptionSession,
} from '../../core/workbook/rsf-encryption';
import { RsfDocument, type RsfParseError } from '../../core/workbook/rsf-document';
import type { OpenedFile } from '../file-access';
import { t } from '../i18n';
import { getSuppressHistoryCapWarning } from '../settings';
import type { Tab } from '../state';
import { decidedBySheet, resolveWrap, resolveZoom } from '../state/view-layers';
import type { FileDialogsPort, NotifyPort } from '../ui-port';
import { LARGE_OP_CELLS, nextPaint, pct, withBusy, withBusyIfLarge } from './shared';

/** The dialogs these steps use: notices, busy progress, and the file dialogs (what a command holds). */
type RsfIoPort = NotifyPort & FileDialogsPort;

/** A `.rsf` file's document, with the keys of an encrypted one (null for a plain file). */
export interface LoadedRsf {
  doc: RsfDocument;
  encryption: RsfEncryptionSession | null;
}

/**
 * Serialize + compress a tab's RSF document behind the busy indicator and return
 * the finished bytes, or null when the encode was cancelled (the tab changed
 * while yielding). Split out so a destination that is not a file handle, such as
 * a Drive upload, reuses the same encode. An encrypted tab's bytes are sealed
 * under the keys its file was opened with, so every destination gets the same
 * encrypted file.
 */
export async function encodeRsfTabBytes(ui: RsfIoPort, tab: Tab): Promise<Uint8Array | null> {
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
      const proceed = await ui.confirmHistoryCapExceeded(tab.name, max);
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
  const bytes = await withBusyIfLarge(large, ui, t('loading.savingRsf', { name: tab.name }), async () => {
    await initCsvEngine(); // compression runs in the WASM codec when available
    if (!large) {
      return doc.toBytes();
    }
    // One sliced scan across every worksheet's rows, so the percentage
    // describes the whole save rather than one worksheet of it.
    const perSheet: Array<Array<[number, number, string]>> = doc.sheets.map(() => []);
    const completed = await forEachIndexSliced(doc.totalRows, (i) => doc.collectFlatRow(i, perSheet), {
      onProgress: (done, total) =>
        ui.setBusy(t('loading.savingSerialize', { name: tab.name, pct: pct(done, total) }), pct(done, total)),
      shouldStop: () => tab.doc !== doc,
    });
    if (!completed || tab.doc !== doc) {
      return null;
    }
    ui.setBusy(t('loading.savingCompress', { name: tab.name }));
    await nextPaint();
    return doc.toBytesFromSheetCells(perSheet);
  });
  if (bytes === null || !tab.encryption) {
    return bytes;
  }
  return sealForSave(ui, tab.name, bytes, tab.encryption);
}

/**
 * Seal a plain `.rsf` file under the keys its file was opened with, so an
 * encrypted file stays encrypted on every save. No password is asked. When the
 * sealing is refused the failure is reported, nothing is written, and the file
 * is left as it was.
 */
async function sealForSave(
  ui: RsfIoPort,
  name: string,
  plain: Uint8Array,
  session: RsfEncryptionSession,
): Promise<Uint8Array | null> {
  try {
    return await sealPlainRsf(session, plain, defaultRsfEncryptionDeps());
  } catch (err) {
    if (err instanceof RsfEncryptionFailure) {
      ui.notify(t('notify.rsfEncryptFailed', { name }), 'error');
      return null;
    }
    throw err;
  }
}

/**
 * Ask for the password of an encrypted `.rsf` file until it opens or the user
 * cancels. Nothing about the content is shown before it opens. A wrong password
 * and damaged data cannot be told apart, so both ask again.
 */
export async function unlockEncryptedRsf(ui: RsfIoPort, file: OpenedFile): Promise<LoadedRsf | null> {
  let retry = false;
  for (;;) {
    const password = await ui.promptRsfPassword(file.name, retry);
    if (password === null) {
      return null;
    }
    const opened = await withBusy(ui, t('loading.opening', { name: file.name }), async () => {
      await initCsvEngine(); // Argon2id and the decompression run in the WASM codec
      return openEncryptedRsf(file.bytes, password, defaultRsfEncryptionDeps());
    });
    if (!opened.ok) {
      if (opened.error === 'auth-failed') {
        retry = true;
        continue;
      }
      await ui.showMessage(
        t('dialog.rsfEncrypted.title'),
        t('dialog.rsfEncrypted.message', { name: file.name, reason: t(encryptedReasonKey(opened.error)) }),
      );
      return null;
    }
    const result = RsfDocument.fromBytes(opened.plain, file.name);
    if (!result.ok) {
      await showRsfInvalid(ui, file.name, result.error);
      return null;
    }
    if (result.doc.filterDropped) {
      // Same as a plain file: filter metadata that failed validation was ignored.
      ui.notify(t('notify.filterDropped', { name: file.name }), 'warn');
    }
    return { doc: result.doc, encryption: opened.session };
  }
}

/**
 * Ask for a new password to encrypt `name` under, then start its keys: one
 * Argon2id run behind the busy indicator. Null when the user cancels, or when
 * the keys cannot be made (the reason is shown). Nothing is written here.
 */
export async function promptAndStartEncryption(
  ui: RsfIoPort,
  name: string,
): Promise<RsfEncryptionSession | null> {
  const password = await ui.promptNewRsfPassword(name);
  if (password === null) {
    return null;
  }
  try {
    return await withBusy(ui, t('loading.encrypting', { name }), async () => {
      await initCsvEngine(); // Argon2id runs in the WASM codec
      return startRsfEncryption(password, defaultRsfEncryptionDeps());
    });
  } catch (err) {
    if (err instanceof RsfEncryptionFailure) {
      ui.notify(t('notify.rsfEncryptFailed', { name }), 'error');
      return null;
    }
    throw err;
  }
}

/** Tell the user why `.rsf` bytes could not be opened as a workbook. */
export async function showRsfInvalid(ui: RsfIoPort, name: string, error: RsfParseError): Promise<void> {
  const reasonKey: Record<RsfParseError, string> = {
    'bad-magic': 'dialog.rsfInvalid.badMagic',
    'legacy-format': 'dialog.rsfInvalid.legacyFormat',
    'bad-version': 'dialog.rsfInvalid.badVersion',
    'bad-shape': 'dialog.rsfInvalid.badShape',
    checksum: 'dialog.rsfInvalid.checksum',
    'unsupported-compression': 'dialog.rsfInvalid.compression',
    'too-large': 'dialog.rsfInvalid.tooLarge',
  };
  await ui.showMessage(
    t('dialog.rsfInvalid.title'),
    t('dialog.rsfInvalid.message', { name, reason: t(reasonKey[error]) }),
  );
}

/** The message key for an encrypted `.rsf` file that cannot be opened (a wrong password is asked again instead). */
function encryptedReasonKey(error: RsfEncryptionError): string {
  switch (error) {
    case 'unsupported-encryption':
    case 'kdf-limit':
      return 'dialog.rsfEncrypted.unsupported';
    case 'too-large':
      return 'dialog.rsfInvalid.tooLarge';
    case 'needs-wasm':
      return 'dialog.rsfInvalid.compression';
    case 'needs-webcrypto':
      return 'dialog.rsfEncrypted.unavailable';
    default:
      return 'dialog.rsfEncrypted.damaged';
  }
}
