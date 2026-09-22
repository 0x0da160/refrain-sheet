// SPDX-License-Identifier: MIT
// The Google Picker: the only way this app can reach a file it did not create.
//
// The `drive.file` scope grants per-file access to files the app created *or*
// the user selected here. That is why the Picker is required rather than a
// convenience: without it, "open from Drive" could only ever show files this
// app had written itself.

import { DRIVE_CLIENT_ID, GAPI_URL } from './config';
import { loadExternalScript } from './script-loader';

export interface PickedFile {
  id: string;
  name: string;
  mimeType?: string;
}

declare const __DRIVE_API_KEY__: string;

/**
 * Optional Picker developer key. The Picker is documented as needing one; it
 * is supplied through the `GOOGLE_DRIVE_API_KEY` repository variable when
 * present, and omitted otherwise so the rest of Drive sync still works.
 */
const DRIVE_API_KEY: string = typeof __DRIVE_API_KEY__ === 'string' ? __DRIVE_API_KEY__ : '';

interface PickerDocument {
  id?: string;
  name?: string;
  mimeType?: string;
}

interface PickerResponse {
  action?: string;
  docs?: PickerDocument[];
}

interface PickerBuilderApi {
  addView(view: unknown): PickerBuilderApi;
  setOAuthToken(token: string): PickerBuilderApi;
  setDeveloperKey(key: string): PickerBuilderApi;
  setAppId(appId: string): PickerBuilderApi;
  setCallback(callback: (response: PickerResponse) => void): PickerBuilderApi;
  setTitle(title: string): PickerBuilderApi;
  build(): { setVisible(visible: boolean): void };
}

interface PickerNamespace {
  PickerBuilder: new () => PickerBuilderApi;
  DocsView: new (viewId?: unknown) => {
    setMimeTypes(mimeTypes: string): unknown;
    setIncludeFolders(include: boolean): unknown;
  };
  ViewId: { DOCS: unknown };
  Action: { PICKED: string; CANCEL: string };
}

interface GapiNamespace {
  load(name: string, callback: () => void): void;
}

/**
 * The Cloud project number, which the Picker wants as the "app id". It is the
 * numeric prefix of the OAuth client id, so it needs no separate configuration.
 */
function appIdFromClientId(clientId: string): string {
  const dash = clientId.indexOf('-');
  const prefix = dash === -1 ? clientId : clientId.slice(0, dash);
  return /^\d+$/.test(prefix) ? prefix : '';
}

/** MIME types worth offering: the Picker filters the list Drive shows. */
const PICKER_MIME_TYPES = [
  'text/csv',
  'text/tab-separated-values',
  'text/plain',
  'application/json',
  'application/octet-stream',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
].join(',');

function gapi(): GapiNamespace {
  const api = (globalThis as { gapi?: GapiNamespace }).gapi;
  if (!api) throw new Error('the Google API loader did not load');
  return api;
}

function pickerNamespace(): PickerNamespace {
  const google = (globalThis as { google?: { picker?: PickerNamespace } }).google;
  if (!google?.picker) throw new Error('the Google Picker did not load');
  return google.picker;
}

let pickerReady: Promise<void> | null = null;

async function ensurePicker(): Promise<void> {
  if (pickerReady) return pickerReady;
  pickerReady = (async () => {
    await loadExternalScript(GAPI_URL);
    await new Promise<void>((resolve) => gapi().load('picker', resolve));
  })().catch((err: unknown) => {
    pickerReady = null;
    throw err;
  });
  return pickerReady;
}

/**
 * Show the Picker and resolve with the chosen file, or null when the user
 * cancels. Only ever returns one file: this app opens a document at a time
 * through this path.
 */
export async function pickDriveFile(token: string, title: string): Promise<PickedFile | null> {
  await ensurePicker();
  const picker = pickerNamespace();

  return new Promise<PickedFile | null>((resolve) => {
    const view = new picker.DocsView(picker.ViewId.DOCS);
    view.setMimeTypes(PICKER_MIME_TYPES);
    view.setIncludeFolders(true);

    let builder = new picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(token)
      .setTitle(title)
      .setCallback((response) => {
        if (response.action === picker.Action.CANCEL) {
          resolve(null);
          return;
        }
        if (response.action !== picker.Action.PICKED) return;
        const doc = response.docs?.[0];
        resolve(doc?.id ? { id: doc.id, name: doc.name ?? doc.id, mimeType: doc.mimeType } : null);
      });

    const appId = appIdFromClientId(DRIVE_CLIENT_ID);
    if (appId) builder = builder.setAppId(appId);
    if (DRIVE_API_KEY) builder = builder.setDeveloperKey(DRIVE_API_KEY);

    builder.build().setVisible(true);
  });
}

export const __testing = { appIdFromClientId, PICKER_MIME_TYPES };
