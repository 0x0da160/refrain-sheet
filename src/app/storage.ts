// SPDX-License-Identifier: MIT
/**
 * Defensive `localStorage` access shared by every `app/` module that
 * persists a local preference (settings, sticky-first-row, sheet font,
 * theme, ...). Storage may be unavailable (private browsing, `file://`
 * restrictions, quota exceeded) — callers never see that as an error, and a
 * value simply fails to persist or read back.
 */

/** Read a key from `localStorage`, or `null` if unavailable/unset. */
export function safeStorageGet(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Write a key to `localStorage`; silently no-ops if storage is unavailable. */
export function safeStorageSet(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // Storage may be unavailable; the value simply is not persisted.
  }
}

/** Remove a key from `localStorage`; silently no-ops if storage is unavailable. */
export function safeStorageRemove(key: string): void {
  try {
    globalThis.localStorage?.removeItem(key);
  } catch {
    // Storage may be unavailable; nothing was stored to remove.
  }
}

/**
 * Whether the app runs from a `file://` URL (the offline ZIP build opened
 * locally). Chromium-based browsers give every local HTML file one shared
 * storage origin, so any other local page the user opens can read this
 * origin's `localStorage` and IndexedDB. Data that is private to the user
 * (query text, file handles) is therefore kept in memory only there.
 */
export function storageSharedWithOtherLocalFiles(): boolean {
  return globalThis.location?.protocol === 'file:';
}
