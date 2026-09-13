// SPDX-License-Identifier: MIT
// A minimal Google Drive v3 client: fetch a file's bytes, create a new file,
// and overwrite an existing one. Nothing else — no listing, no sharing, no
// deletion. Combined with the `drive.file` scope, the blast radius is limited
// to files this app created or the user explicitly picked.
//
// Uploads above RESUMABLE_THRESHOLD_BYTES use a resumable session so a large
// sheet is not required to succeed in a single request.

import {
  DRIVE_FILES_ENDPOINT,
  DRIVE_UPLOAD_ENDPOINT,
  RESUMABLE_CHUNK_BYTES,
  RESUMABLE_THRESHOLD_BYTES,
} from './config';

export interface DriveFileMeta {
  id: string;
  name: string;
  mimeType?: string;
}

/** The access token was rejected; the caller should re-authorize and retry. */
export class DriveAuthExpired extends Error {
  constructor() {
    super('the Google access token was rejected');
    this.name = 'DriveAuthExpired';
  }
}

/** Any other Drive API failure, carrying the HTTP status for the caller. */
export class DriveApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'DriveApiError';
  }
}

async function failure(response: Response): Promise<never> {
  if (response.status === 401) throw new DriveAuthExpired();
  let detail = response.statusText;
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    if (body?.error?.message) detail = body.error.message;
  } catch {
    // A non-JSON error body tells us nothing more than the status already does.
  }
  throw new DriveApiError(response.status, detail);
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

/** Read a file's metadata (used to learn its name after the Picker). */
export async function getMetadata(fileId: string, token: string): Promise<DriveFileMeta> {
  const url = `${DRIVE_FILES_ENDPOINT}/${encodeURIComponent(fileId)}?fields=id,name,mimeType`;
  const response = await fetch(url, { headers: authHeaders(token) });
  if (!response.ok) await failure(response);
  return (await response.json()) as DriveFileMeta;
}

/** Download a file's raw bytes. */
export async function downloadFile(fileId: string, token: string): Promise<Uint8Array> {
  const url = `${DRIVE_FILES_ENDPOINT}/${encodeURIComponent(fileId)}?alt=media`;
  const response = await fetch(url, { headers: authHeaders(token) });
  if (!response.ok) await failure(response);
  return new Uint8Array(await response.arrayBuffer());
}

function toBlob(bytes: Uint8Array, mimeType: string): Blob {
  // Copy into a fresh ArrayBuffer-backed view so the Blob never sees a
  // SharedArrayBuffer-typed buffer (same reasoning as file-access.ts).
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return new Blob([copy], { type: mimeType });
}

/**
 * Create a new file, or overwrite an existing one when `fileId` is given.
 * Chooses a single multipart request or a resumable session by size.
 */
export async function uploadFile(
  options: {
    name: string;
    bytes: Uint8Array;
    mimeType: string;
    /** Overwrite this file instead of creating a new one. */
    fileId?: string;
    /** Parent folder for a newly created file. */
    parentId?: string;
    onProgress?: (fraction: number) => void;
  },
  token: string,
): Promise<DriveFileMeta> {
  const { bytes } = options;
  if (bytes.length >= RESUMABLE_THRESHOLD_BYTES) {
    return uploadResumable(options, token);
  }
  return uploadMultipart(options, token);
}

interface UploadOptions {
  name: string;
  bytes: Uint8Array;
  mimeType: string;
  fileId?: string;
  parentId?: string;
  onProgress?: (fraction: number) => void;
}

function metadataFor(options: UploadOptions): Record<string, unknown> {
  const metadata: Record<string, unknown> = { name: options.name };
  // `parents` may only be set when creating; Drive rejects it on an update.
  if (!options.fileId && options.parentId) metadata.parents = [options.parentId];
  return metadata;
}

function uploadUrl(options: UploadOptions, uploadType: string): string {
  const base = options.fileId
    ? `${DRIVE_UPLOAD_ENDPOINT}/${encodeURIComponent(options.fileId)}`
    : DRIVE_UPLOAD_ENDPOINT;
  return `${base}?uploadType=${uploadType}&fields=id,name,mimeType`;
}

async function uploadMultipart(options: UploadOptions, token: string): Promise<DriveFileMeta> {
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadataFor(options))], { type: 'application/json' }));
  form.append('file', toBlob(options.bytes, options.mimeType));

  const response = await fetch(uploadUrl(options, 'multipart'), {
    method: options.fileId ? 'PATCH' : 'POST',
    headers: authHeaders(token),
    body: form,
  });
  if (!response.ok) await failure(response);
  options.onProgress?.(1);
  return (await response.json()) as DriveFileMeta;
}

async function uploadResumable(options: UploadOptions, token: string): Promise<DriveFileMeta> {
  const start = await fetch(uploadUrl(options, 'resumable'), {
    method: options.fileId ? 'PATCH' : 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(metadataFor(options)),
  });
  if (!start.ok) await failure(start);

  const session = start.headers.get('Location');
  if (!session) throw new DriveApiError(start.status, 'Drive returned no resumable upload URL');

  const total = options.bytes.length;
  let offset = 0;
  for (;;) {
    const end = Math.min(offset + RESUMABLE_CHUNK_BYTES, total);
    const chunk = options.bytes.subarray(offset, end);
    const response = await fetch(session, {
      method: 'PUT',
      headers: {
        'Content-Range': `bytes ${offset}-${end - 1}/${total}`,
      },
      body: toBlob(chunk, options.mimeType),
    });

    // 308 means "chunk stored, send the next one". Drive reports how much it
    // actually kept, which is the offset to resume from.
    if (response.status === 308) {
      const range = response.headers.get('Range');
      const stored = range ? Number(range.slice(range.lastIndexOf('-') + 1)) + 1 : end;
      offset = Number.isFinite(stored) && stored > offset ? stored : end;
      options.onProgress?.(offset / total);
      continue;
    }
    if (!response.ok) await failure(response);
    options.onProgress?.(1);
    return (await response.json()) as DriveFileMeta;
  }
}
