// SPDX-License-Identifier: MIT
/**
 * Banded rows (View > Banded Rows): a faint tint on every other grid row.
 *
 * Off by default, as the design system decides (design-system/2.0.0: the
 * `--canvas-row-alt` bands compete with the fill colours a user gives cells).
 * Like the theme and the density, it is a display preference stored only in
 * `localStorage` on this device and applied as one attribute on the document
 * root (`data-banded-rows`), which the grid stylesheet keys the band off; it
 * never touches document bytes, RSF data, or calculations.
 */

const STORAGE_KEY = 'refrain-csv-html.bandedRows';

/** Whether banded rows are on (the stored preference; off when unset). */
export function getBandedRows(): boolean {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Reflect the preference on the document root. Safe to call without a DOM. */
export function applyBandedRows(enabled: boolean = getBandedRows()): void {
  globalThis.document?.documentElement.toggleAttribute('data-banded-rows', enabled);
}

/** Persist and apply the preference. */
export function setBandedRows(enabled: boolean): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    // Storage may be unavailable (private mode, file:// restrictions); the
    // preference simply is not persisted. Nothing is ever sent anywhere.
  }
  applyBandedRows(enabled);
}
