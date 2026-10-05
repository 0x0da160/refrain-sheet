// SPDX-License-Identifier: MIT
/**
 * A cell's (or part of a cell's text's) own font: a family name and a size
 * in points, stored on {@link CellStyle} and on rich-text runs (the app shows
 * and draws sizes in px, 4/3 of a point; see `ui/font-choices.ts`). The name is
 * kept exactly as chosen even where that font is not installed: the display
 * falls back to the sheet font, and the file still names the chosen one.
 */

/** Smallest and largest font size (points) a cell may carry. */
const MIN_FONT_SIZE = 6;
const MAX_FONT_SIZE = 96;

/** Longest font family name stored. */
export const MAX_FONT_FAMILY_LENGTH = 100;

/** A font size as stored: a half point from 6 to 96, or null for anything else. */
export function normalizeFontSize(value: number): number | null {
  if (!Number.isFinite(value) || value < MIN_FONT_SIZE || value > MAX_FONT_SIZE) {
    return null;
  }
  return Number.isInteger(value * 2) ? value : null;
}

// Characters a family name may not hold: controls, and the quote and
// backslash so the name can always sit inside a quoted CSS string.
// eslint-disable-next-line no-control-regex
const BAD_FAMILY_CHARS = /[\u0000-\u001f\u007f"\\]/;

/** A font family name as stored (trimmed, 1–100 characters), or null when it cannot be one. */
export function normalizeFontFamily(value: string): string | null {
  const name = value.trim();
  if (name === '' || name.length > MAX_FONT_FAMILY_LENGTH || BAD_FAMILY_CHARS.test(name)) {
    return null;
  }
  return name;
}
