// SPDX-License-Identifier: MIT
/**
 * Local application settings.
 *
 * Settings are stored only in `localStorage` and are never transmitted
 * anywhere (the CSP forbids network access entirely). Every value is read
 * defensively and clamped into a supported range, so corrupt or hostile
 * storage contents can never push the application outside safe bounds.
 *
 * Currently the only configurable setting is the maximum file size accepted
 * when opening a file. The limit is enforced before a file's bytes are read
 * into memory (see `pickFiles` / `openDroppedFiles`), because the whole file
 * is held in memory while editing.
 */

const MIB = 1024 * 1024;

/** Default maximum file size: whole files are kept in memory. */
export const DEFAULT_MAX_FILE_SIZE = 512 * MIB;
/** Smallest limit a user may choose. */
export const MIN_MAX_FILE_SIZE = 16 * MIB;
/** Largest limit a user may choose (still bounded by real browser memory). */
export const MAX_MAX_FILE_SIZE = 2 * 1024 * MIB; // 2 GiB

const MAX_FILE_SIZE_KEY = 'refrain-csv-html.maxFileSize';

function safeStorageGet(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function safeStorageSet(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // Storage may be unavailable (private mode, file:// restrictions); the
    // preference simply is not persisted. Nothing is ever sent anywhere.
  }
}

/** Clamp an arbitrary number of bytes into the supported file-size range. */
export function clampMaxFileSize(bytes: number): number {
  if (!Number.isFinite(bytes)) {
    return DEFAULT_MAX_FILE_SIZE;
  }
  const rounded = Math.floor(bytes);
  if (rounded < MIN_MAX_FILE_SIZE) {
    return MIN_MAX_FILE_SIZE;
  }
  if (rounded > MAX_MAX_FILE_SIZE) {
    return MAX_MAX_FILE_SIZE;
  }
  return rounded;
}

/**
 * The current maximum file-size limit in bytes. Reads the stored preference
 * (clamped) or the default when nothing valid is stored.
 */
export function getMaxFileSize(): number {
  const stored = safeStorageGet(MAX_FILE_SIZE_KEY);
  if (stored === null) {
    return DEFAULT_MAX_FILE_SIZE;
  }
  const parsed = Number(stored);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_MAX_FILE_SIZE;
  }
  return clampMaxFileSize(parsed);
}

/** Persist a new maximum file-size limit (clamped into range) locally. */
export function setMaxFileSize(bytes: number): number {
  const clamped = clampMaxFileSize(bytes);
  safeStorageSet(MAX_FILE_SIZE_KEY, String(clamped));
  return clamped;
}

/** Bytes -> whole MiB (rounded), for display and number inputs. */
export function bytesToMiB(bytes: number): number {
  return Math.round(bytes / MIB);
}

/** Whole MiB -> bytes. */
export function miBToBytes(mib: number): number {
  return Math.round(mib) * MIB;
}
