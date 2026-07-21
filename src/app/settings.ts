// SPDX-License-Identifier: MIT
/**
 * Local application settings.
 *
 * Settings are stored only in `localStorage` and are never transmitted
 * anywhere (the CSP forbids network access entirely). Every value is read
 * defensively and clamped into a supported range, so corrupt or hostile
 * storage contents can never push the application outside safe bounds.
 *
 * Settings currently stored here: the maximum file size accepted when opening
 * a file (enforced before a file's bytes are read into memory, because the
 * whole file is held in memory while editing), the application-level
 * spreadsheet zoom (used for documents that do not carry their own — RSF
 * documents persist zoom in their container and take precedence), and the
 * editing-help tooltip preference.
 */

import { RSF_ZOOM_MAX, RSF_ZOOM_MIN } from '../core/rsf-codec';

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

// ---------------------------------------------------------------------------
// Spreadsheet zoom
// ---------------------------------------------------------------------------

/** Zoom presets offered in the View menu (percent). */
export const SHEET_ZOOM_LEVELS = [50, 75, 90, 100, 110, 125, 150, 200] as const;
/** Default spreadsheet zoom (percent) when nothing else applies. */
export const DEFAULT_SHEET_ZOOM = 100;

const SHEET_ZOOM_KEY = 'refrain-csv-html.sheetZoom';

/**
 * Clamp an arbitrary zoom value into the supported percent range (the same
 * bounds the RSF container enforces, so a stored document zoom and the app
 * preference can never disagree about validity). Non-finite input falls back
 * to the default.
 */
export function clampSheetZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) {
    return DEFAULT_SHEET_ZOOM;
  }
  return Math.max(RSF_ZOOM_MIN, Math.min(RSF_ZOOM_MAX, Math.round(zoom)));
}

/**
 * The application-level spreadsheet zoom preference (percent). Used for new
 * tabs whose document does not store its own zoom (plain CSV documents, and
 * RSF documents saved before zoom persistence existed). Never written into
 * CSV files.
 */
export function getSheetZoom(): number {
  const stored = safeStorageGet(SHEET_ZOOM_KEY);
  if (stored === null) {
    return DEFAULT_SHEET_ZOOM;
  }
  const parsed = Number(stored);
  return Number.isFinite(parsed) ? clampSheetZoom(parsed) : DEFAULT_SHEET_ZOOM;
}

/** Persist the application-level spreadsheet zoom (clamped) locally. */
export function setSheetZoom(zoom: number): number {
  const clamped = clampSheetZoom(zoom);
  safeStorageSet(SHEET_ZOOM_KEY, String(clamped));
  return clamped;
}

/**
 * The next zoom preset in the given direction from an arbitrary current
 * zoom (which may be a non-preset value restored from an RSF document).
 * Clamps at the smallest/largest preset: stepping past an end returns the
 * end preset itself. Used by Zoom In / Zoom Out (keyboard and Ctrl/Cmd +
 * mouse wheel), which share the same command/state path as the menu presets.
 */
export function nextZoomLevel(current: number, direction: 1 | -1): number {
  const zoom = clampSheetZoom(current);
  if (direction === 1) {
    for (const level of SHEET_ZOOM_LEVELS) {
      if (level > zoom) {
        return level;
      }
    }
    return SHEET_ZOOM_LEVELS[SHEET_ZOOM_LEVELS.length - 1];
  }
  for (let i = SHEET_ZOOM_LEVELS.length - 1; i >= 0; i--) {
    if (SHEET_ZOOM_LEVELS[i] < zoom) {
      return SHEET_ZOOM_LEVELS[i];
    }
  }
  return SHEET_ZOOM_LEVELS[0];
}

// ---------------------------------------------------------------------------
// Editing-help tooltips
// ---------------------------------------------------------------------------

const EDIT_HINTS_KEY = 'refrain-csv-html.editHints';

/**
 * Whether the editing-help tooltips (inline editor / formula bar usage hints)
 * are enabled. **Default: enabled** — new users see the guidance as tooltips
 * and accessible descriptions; experienced users can turn it off in the View
 * menu. Stored only locally; never written into any document.
 */
export function getEditHints(): boolean {
  return safeStorageGet(EDIT_HINTS_KEY) !== '0';
}

/** Persist the editing-help tooltip preference locally. */
export function setEditHints(enabled: boolean): void {
  safeStorageSet(EDIT_HINTS_KEY, enabled ? '1' : '0');
}

/** Bytes -> whole MiB (rounded), for display and number inputs. */
export function bytesToMiB(bytes: number): number {
  return Math.round(bytes / MIB);
}

/** Whole MiB -> bytes. */
export function miBToBytes(mib: number): number {
  return Math.round(mib) * MIB;
}
