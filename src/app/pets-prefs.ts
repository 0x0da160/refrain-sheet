// SPDX-License-Identifier: MIT
/**
 * Whether the pixel pets (a white puppy and a black kitten playing at the
 * top right of the window) are shown. A per-browser preference kept in
 * `localStorage` only, never in a file: it is decoration, not a property of
 * any document. Shown unless turned off in File > Settings….
 */
import { safeStorageGet, safeStorageRemove, safeStorageSet } from './storage';

const KEY = 'refrain-csv-html.pets';

export function getPetsShown(): boolean {
  return safeStorageGet(KEY) !== 'false';
}

export function setPetsShown(shown: boolean): void {
  if (shown) {
    safeStorageRemove(KEY);
  } else {
    safeStorageSet(KEY, 'false');
  }
}
