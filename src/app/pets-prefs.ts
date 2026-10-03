// SPDX-License-Identifier: MIT
/**
 * Whether the pixel pets (a white puppy and a black kitten playing at the
 * top right of the window) are shown. A per-browser preference kept in
 * `localStorage` only, never in a file: it is decoration, not a property of
 * any document. Hidden unless turned on in File > Settings…; only an
 * explicit `'true'` shows them, so a browser that never chose (or turned
 * them off, stored as `'false'` before they were hidden by default) keeps
 * them hidden.
 */
import { safeStorageGet, safeStorageSet } from './storage';

const KEY = 'refrain-csv-html.pets';

export function getPetsShown(): boolean {
  return safeStorageGet(KEY) === 'true';
}

export function setPetsShown(shown: boolean): void {
  safeStorageSet(KEY, shown ? 'true' : 'false');
}
