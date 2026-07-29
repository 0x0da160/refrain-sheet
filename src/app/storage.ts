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
