// SPDX-License-Identifier: MIT
/**
 * This browser's level of the grid look (banded rows and their strength,
 * gridlines, and the selected row/column highlight), and applying the
 * effective look.
 *
 * The look is layered **worksheet > file > this browser**
 * (`src/core/grid-look.ts`, resolved per document by `resolveGridLook` in
 * `state/view-layers.ts`). The browser level lives only in `localStorage`
 * on this device. The effective look is applied as attributes on the
 * document root, which the grid stylesheet keys off; it never touches
 * document bytes, RSF data, or calculations.
 */

import { isBandLevel, type GridLook, type GridLookLayer } from '../core/grid-look';
import { safeStorageGet, safeStorageRemove, safeStorageSet } from './storage';

/** Storage key per boolean setting; `bands` keeps the key View > Banded Rows always used. */
const BOOLEAN_KEYS = {
  bands: 'refrain-csv-html.bandedRows',
  gridlines: 'refrain-csv-html.gridlines',
  rowHighlight: 'refrain-csv-html.rowHighlight',
  colHighlight: 'refrain-csv-html.colHighlight',
} as const;

const BAND_LEVEL_KEY = 'refrain-csv-html.bandLevel';

/** This browser's look; a key is missing when this browser specifies none. */
export function getBrowserGridLook(): GridLookLayer {
  const look: GridLookLayer = {};
  for (const [name, key] of Object.entries(BOOLEAN_KEYS) as Array<[keyof typeof BOOLEAN_KEYS, string]>) {
    const stored = safeStorageGet(key);
    if (stored === '1' || stored === '0') {
      look[name] = stored === '1';
    }
  }
  const level = Number(safeStorageGet(BAND_LEVEL_KEY));
  if (isBandLevel(level)) {
    look.bandLevel = level;
  }
  return look;
}

/** Store this browser's look; a missing key clears that setting. Does not apply it. */
export function setBrowserGridLook(look: GridLookLayer): void {
  for (const [name, key] of Object.entries(BOOLEAN_KEYS) as Array<[keyof typeof BOOLEAN_KEYS, string]>) {
    const value = look[name];
    if (value === undefined) {
      safeStorageRemove(key);
    } else {
      safeStorageSet(key, value ? '1' : '0');
    }
  }
  if (look.bandLevel === undefined) {
    safeStorageRemove(BAND_LEVEL_KEY);
  } else {
    safeStorageSet(BAND_LEVEL_KEY, String(look.bandLevel));
  }
}

/** Reflect the effective look on the document root. Safe to call without a DOM. */
export function applyGridLook(look: GridLook): void {
  const root = globalThis.document?.documentElement;
  if (!root) {
    return;
  }
  root.toggleAttribute('data-banded-rows', look.bands);
  root.setAttribute('data-band-level', String(look.bandLevel));
  root.toggleAttribute('data-no-gridlines', !look.gridlines);
  root.toggleAttribute('data-row-highlight', look.rowHighlight);
  root.toggleAttribute('data-col-highlight', look.colHighlight);
}
