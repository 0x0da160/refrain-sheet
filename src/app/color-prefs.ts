// SPDX-License-Identifier: MIT
/**
 * The color picker's memory: the colors recently chosen and the ones marked
 * as favorites. Kept in this browser's `localStorage` only, never in a file;
 * only `#rrggbb` strings are stored.
 */
import { normalizeHexColor } from '../core/workbook/cell-style';
import { safeStorageGet, safeStorageSet } from './storage';

const RECENT_KEY = 'refrain-csv-html.recentColors';
const FAVORITE_KEY = 'refrain-csv-html.favoriteColors';

/** How many recent colors are kept. */
export const MAX_RECENT_COLORS = 10;
/** How many favorites can be kept. */
const MAX_FAVORITE_COLORS = 20;

function readList(key: string, max: number): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(safeStorageGet(key) ?? '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  const colors: string[] = [];
  for (const value of parsed) {
    const color = typeof value === 'string' ? normalizeHexColor(value) : null;
    if (color && !colors.includes(color)) {
      colors.push(color);
    }
  }
  return colors.slice(0, max);
}

/** The recently chosen colors, newest first. */
export function getRecentColors(): string[] {
  return readList(RECENT_KEY, MAX_RECENT_COLORS);
}

/** Put `color` first in the recent colors. */
export function rememberColor(color: string): void {
  const normalized = normalizeHexColor(color);
  if (!normalized) {
    return;
  }
  const next = [normalized, ...getRecentColors().filter((c) => c !== normalized)].slice(0, MAX_RECENT_COLORS);
  safeStorageSet(RECENT_KEY, JSON.stringify(next));
}

/** The favorite colors, in the order they were added. */
export function getFavoriteColors(): string[] {
  return readList(FAVORITE_KEY, MAX_FAVORITE_COLORS);
}

/** Add `color` to the favorites, or remove it when it is one. Returns whether it is a favorite now. */
export function toggleFavoriteColor(color: string): boolean {
  const normalized = normalizeHexColor(color);
  if (!normalized) {
    return false;
  }
  const favorites = getFavoriteColors();
  const isFavorite = favorites.includes(normalized);
  const next = isFavorite
    ? favorites.filter((c) => c !== normalized)
    : [...favorites, normalized].slice(-MAX_FAVORITE_COLORS);
  safeStorageSet(FAVORITE_KEY, JSON.stringify(next));
  return !isFavorite;
}
