// SPDX-License-Identifier: MIT
// Build-time configuration for the opt-in Google Drive sync (issue #416).
//
// The OAuth client id is injected by vite.config.ts and is ALWAYS the empty
// string in the offline build, whatever the build environment happens to hold.
// The offline artifact must never carry a credential or reach the network;
// scripts/check-dist.mjs asserts that mechanically rather than trusting it.
//
// An OAuth client id for a browser app is a public identifier, not a secret —
// it is delivered through the `GOOGLE_OAUTH_CLIENT_ID` repository *variable*,
// never a secret. See knowledge/operations/security-supply-chain.md.

declare const __DRIVE_CLIENT_ID__: string;

export const DRIVE_CLIENT_ID: string = typeof __DRIVE_CLIENT_ID__ === 'string' ? __DRIVE_CLIENT_ID__ : '';

/**
 * Per-file access: the app may only touch files it created itself, or files
 * the user explicitly handed it through the Google Picker. It can never
 * enumerate or read the rest of the user's Drive. This is a non-sensitive
 * scope, so publishing the app needs only basic OAuth verification.
 */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

/** Google Identity Services: the token client and its consent popup. */
export const GSI_CLIENT_URL = 'https://accounts.google.com/gsi/client';
/** The gapi loader, which in turn hosts the Google Picker. */
export const GAPI_URL = 'https://apis.google.com/js/api.js';

export const DRIVE_FILES_ENDPOINT = 'https://www.googleapis.com/drive/v3/files';
export const DRIVE_UPLOAD_ENDPOINT = 'https://www.googleapis.com/upload/drive/v3/files';

/**
 * Uploads at or above this size go through a resumable session instead of a
 * single request, so a large sheet does not have to succeed in one shot.
 */
export const RESUMABLE_THRESHOLD_BYTES = 5 * 1024 * 1024;

/** Chunk size for resumable uploads. Google requires a multiple of 256 KiB. */
export const RESUMABLE_CHUNK_BYTES = 8 * 256 * 1024;

/**
 * Drive sync exists only in a hosted build that was given a client id. The
 * offline build always reports false, so every entry point stays hidden.
 */
export function driveConfigured(): boolean {
  return DRIVE_CLIENT_ID.length > 0;
}
