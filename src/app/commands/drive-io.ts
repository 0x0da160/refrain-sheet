// SPDX-License-Identifier: MIT
// Google Drive sync commands (issue #416).
//
// Four operations, all user-initiated, none automatic:
//   open      pick a file through the Google Picker and load its bytes
//   save      overwrite the Drive file this tab came from
//   saveAs    create a new Drive file
//   signOut   drop and revoke the in-memory access token
//
// Nothing here runs unless the user invokes it: no background sync, no
// polling, and no network request on startup. In the offline build
// `driveConfigured()` is false, every command is disabled, and none of the
// Google scripts is ever fetched.

import { AppState, type Tab } from '../app-state';
import { getMaxFileSize } from '../settings';
import { t } from '../i18n';
import type { UiPort } from '../commands';
import { LosslessDocument } from '../../core/lossless-document';
import { DriveAuthCancelled, DriveAuthError, forgetToken, getAccessToken, signOut } from '../drive/auth';
import {
  DriveApiError,
  DriveAuthExpired,
  downloadFile,
  getMetadata,
  uploadFile,
  type DriveFileMeta,
} from '../drive/client';
import { driveConfigured } from '../drive/config';
import { pickDriveFile } from '../drive/picker';
import { DriveScriptError } from '../drive/script-loader';
import type { FileIoCommands } from './file-io';
import { withBusy } from './shared';

export class DriveIoCommands {
  constructor(
    private readonly state: AppState,
    private readonly ui: UiPort,
    private readonly fileIo: FileIoCommands,
  ) {}

  /** Drive sync exists only in a hosted build that was given a client id. */
  available(): boolean {
    return driveConfigured();
  }

  /**
   * Translate a failure into one localized, non-technical message. A cancelled
   * sign-in or Picker is not an error and reports nothing at all.
   */
  private report(err: unknown): void {
    if (err instanceof DriveAuthCancelled) {
      return;
    }
    if (err instanceof DriveScriptError) {
      this.ui.notify(t('notify.drive.scriptFailed'), 'error');
      return;
    }
    if (err instanceof DriveAuthExpired || err instanceof DriveAuthError) {
      this.ui.notify(t('notify.drive.authFailed'), 'error');
      return;
    }
    if (err instanceof DriveApiError) {
      this.ui.notify(t('notify.drive.apiFailed', { status: String(err.status) }), 'error');
      return;
    }
    this.ui.notify(t('notify.drive.unknownFailed'), 'error');
  }

  /**
   * Run a Drive operation, retrying once with a fresh token if Drive rejects
   * the one held. A token can expire mid-session; re-authorizing once is far
   * better than making the user redo the whole action.
   */
  private async withToken<T>(run: (token: string) => Promise<T>): Promise<T> {
    const token = await getAccessToken();
    try {
      return await run(token);
    } catch (err) {
      if (!(err instanceof DriveAuthExpired)) throw err;
      forgetToken();
      return run(await getAccessToken());
    }
  }

  /** Open a Drive file chosen through the Picker. */
  async open(): Promise<void> {
    if (!this.available()) return;
    try {
      const picked = await this.withToken(async (token) => pickDriveFile(token, t('drive.picker.title')));
      if (!picked) return;

      const bytes = await withBusy(this.ui, t('loading.drive.downloading', { name: picked.name }), () =>
        this.withToken((token) => downloadFile(picked.id, token)),
      );

      const maxSize = getMaxFileSize();
      if (bytes.length > maxSize) {
        this.ui.notify(t('notify.drive.tooLarge', { name: picked.name }), 'error');
        return;
      }

      await this.fileIo.openFiles([{ name: picked.name, bytes, handle: null, size: bytes.length }], {
        confirmNonCsv: true,
      });
      // Associate whichever tab the open produced, so a later save overwrites
      // this same Drive file rather than creating a duplicate.
      const tab = this.state.activeTab;
      if (tab) tab.drive = { fileId: picked.id, name: picked.name };
      this.state.emit('tabs');
    } catch (err) {
      this.report(err);
    }
  }

  /**
   * Overwrite the Drive file this tab came from. Falls through to
   * {@link saveAs} when the tab has no Drive association yet. Returns true
   * when the file was actually saved.
   */
  async save(tab: Tab): Promise<boolean> {
    if (!this.available()) return false;
    if (!tab.drive) {
      return this.saveAs(tab);
    }
    return this.upload(tab, { fileId: tab.drive.fileId, name: tab.drive.name });
  }

  /**
   * Create a new Drive file from this tab, asking for the name first.
   * Returns true when the file was actually saved.
   */
  async saveAs(tab: Tab): Promise<boolean> {
    if (!this.available()) return false;
    const name = await this.ui.promptDriveName(tab.drive?.name ?? tab.name);
    if (name === null) return false;
    return this.upload(tab, { name });
  }

  private async upload(tab: Tab, target: { fileId?: string; name: string }): Promise<boolean> {
    try {
      const encoded = await this.fileIo.encodeForUpload(tab);
      if (!encoded) return false;

      const meta: DriveFileMeta = await withBusy(
        this.ui,
        t('loading.drive.uploading', { name: target.name }),
        () =>
          this.withToken((token) =>
            uploadFile(
              {
                name: target.name,
                bytes: encoded.bytes,
                mimeType: encoded.mimeType,
                fileId: target.fileId,
                onProgress: (fraction) =>
                  this.ui.setBusy(
                    t('loading.drive.uploading', { name: target.name }),
                    Math.round(fraction * 100),
                  ),
              },
              token,
            ),
          ),
      );

      tab.drive = { fileId: meta.id, name: meta.name };
      // The uploaded bytes become the new baseline, exactly as a local save
      // would, so the tab stops reporting unsaved changes.
      if (tab.doc.kind === 'csv') {
        const baseline = LosslessDocument.fromBytes(encoded.bytes, {
          encoding: tab.doc.encoding,
          delimiter: tab.doc.delimiter,
        });
        this.state.setBaseline(tab, baseline);
      } else {
        this.state.markTabSaved(tab);
      }
      this.state.emit('tabs');
      this.ui.notify(t('notify.drive.saved', { name: meta.name }), 'info');
      return true;
    } catch (err) {
      this.report(err);
      return false;
    }
  }

  /** Drop and revoke the access token. Documents and tabs are untouched. */
  signOut(): void {
    signOut();
    this.state.emit('tabs');
    this.ui.notify(t('notify.drive.signedOut'), 'info');
  }

  /** Re-read a tab's Drive name, used to keep a renamed file's label honest. */
  async refreshName(tab: Tab): Promise<void> {
    if (!tab.drive) return;
    try {
      const meta = await this.withToken((token) => getMetadata(tab.drive!.fileId, token));
      tab.drive = { fileId: meta.id, name: meta.name };
      this.state.emit('tabs');
    } catch (err) {
      this.report(err);
    }
  }
}
