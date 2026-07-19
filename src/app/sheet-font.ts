// SPDX-License-Identifier: MIT
/**
 * Spreadsheet font preference.
 *
 * The user chooses one font family for the entire spreadsheet UI (the cell
 * grid, row/column headers, numeric and formula values, the formula bar, the
 * inline cell editor, and selection overlays). The choice is applied by
 * overriding a single document-level CSS custom property (`--font-sheet`);
 * every spreadsheet surface already reads that variable, so no per-element
 * work is needed.
 *
 * Precedence: this is an **application-level** preference stored only in
 * `localStorage`. RCSV documents do not carry a per-document sheet-font
 * override in this version, so the application preference always applies and
 * there is no conflict to resolve. (Choosing a font never touches document
 * bytes and never converts a CSV to RCSV — it is pure display state.)
 *
 * The three families are all local Windows/Office fonts declared in
 * `styles.css` with a monospace fallback chain. Nothing is fetched from a CDN
 * or bundled, and an unavailable preferred font degrades gracefully to its
 * declared fallbacks.
 */

export type SheetFontId = 'biz-ud' | 'ms' | 'ms-ui';

/** All selectable fonts, in menu order. */
export const SHEET_FONTS: readonly SheetFontId[] = ['biz-ud', 'ms', 'ms-ui'];

/** BIZ UD Gothic is the default (best CJK legibility of the three). */
export const DEFAULT_SHEET_FONT: SheetFontId = 'biz-ud';

/** The CSS custom property overridden on the document root. */
export const SHEET_FONT_PROPERTY = '--font-sheet';

/** Each font id maps to the matching `--sheet-font-*` variable from styles.css. */
const CSS_VALUE: Record<SheetFontId, string> = {
  'biz-ud': 'var(--sheet-font-biz-ud)',
  ms: 'var(--sheet-font-ms)',
  'ms-ui': 'var(--sheet-font-ms-ui)',
};

/** The i18n label key for a font id (localized in en/ja catalogs). */
export function sheetFontLabelKey(id: SheetFontId): string {
  return `font.${id}`;
}

const STORAGE_KEY = 'refrain-csv-html.sheetFont';

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

/** True for a recognized font id. */
export function isSheetFontId(value: unknown): value is SheetFontId {
  return typeof value === 'string' && (SHEET_FONTS as readonly string[]).includes(value);
}

/** The current sheet font: the stored preference, or the default. */
export function getSheetFont(): SheetFontId {
  const stored = safeStorageGet(STORAGE_KEY);
  return isSheetFontId(stored) ? stored : DEFAULT_SHEET_FONT;
}

/**
 * Apply a sheet font to the document root by overriding `--font-sheet`. Safe
 * to call when no document is available (e.g. non-DOM tests): it simply does
 * nothing.
 */
export function applySheetFont(id: SheetFontId = getSheetFont()): void {
  const root = globalThis.document?.documentElement;
  root?.style.setProperty(SHEET_FONT_PROPERTY, CSS_VALUE[id]);
}

/** Persist and apply a new sheet font (invalid ids fall back to the default). */
export function setSheetFont(id: SheetFontId): SheetFontId {
  const valid = isSheetFontId(id) ? id : DEFAULT_SHEET_FONT;
  safeStorageSet(STORAGE_KEY, valid);
  applySheetFont(valid);
  return valid;
}
