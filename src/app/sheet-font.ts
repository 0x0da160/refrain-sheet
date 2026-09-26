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
 * Precedence: the font is a layered setting like zoom and wrap
 * (`src/core/settings-cascade.ts`): **worksheet > file > this browser**. An
 * RSF worksheet or file may name its own font; the browser level stored here
 * in `localStorage` is the default for everything else (see
 * `resolveSheetFont` in `state/view-layers.ts`). Choosing a font never touches
 * a CSV's bytes and never converts a CSV to RSF — it is pure display state.
 *
 * All six families are local fonts declared in
 * `styles/tailwind-token-bridge.css`: BIZ UD Gothic (the default) with a
 * cross-platform fallback chain (fixed-pitch Windows families first, then
 * Hiragino / Noto CJK, ending in sans-serif); MS Gothic and MS UI Gothic with
 * a monospace fallback chain; Noto Sans JP, Meiryo UI, and Yu Gothic UI,
 * added in #396, with a proportional sans-serif fallback chain matching their
 * own metrics. Nothing is fetched from a CDN or bundled, and an unavailable
 * preferred font degrades gracefully to its declared fallbacks.
 */

export type SheetFontId = 'biz-ud' | 'ms' | 'ms-ui' | 'noto-sans-jp' | 'meiryo-ui' | 'yu-gothic-ui';

/** All selectable fonts, in menu order. */
export const SHEET_FONTS: readonly SheetFontId[] = [
  'biz-ud',
  'ms',
  'ms-ui',
  'noto-sans-jp',
  'meiryo-ui',
  'yu-gothic-ui',
];

/**
 * BIZ UD Gothic is the default: bundled with Windows 10 (1809+) / 11, the
 * primary target, and fixed-pitch so kana/kanji and digits line up across
 * cells. Other platforms reach Hiragino / Noto CJK through its fallback chain.
 */
export const DEFAULT_SHEET_FONT: SheetFontId = 'biz-ud';

/** The CSS custom property overridden on the document root. */
export const SHEET_FONT_PROPERTY = '--font-sheet';

/** Each font id maps to the matching `--sheet-font-*` variable from styles.css. */
const CSS_VALUE: Record<SheetFontId, string> = {
  'biz-ud': 'var(--sheet-font-biz-ud)',
  ms: 'var(--sheet-font-ms)',
  'ms-ui': 'var(--sheet-font-ms-ui)',
  'noto-sans-jp': 'var(--sheet-font-noto-sans-jp)',
  'meiryo-ui': 'var(--sheet-font-meiryo-ui)',
  'yu-gothic-ui': 'var(--sheet-font-yu-gothic-ui)',
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

/** This browser's font, or `undefined` when none is chosen. */
export function getBrowserSheetFont(): SheetFontId | undefined {
  const stored = safeStorageGet(STORAGE_KEY);
  return isSheetFontId(stored) ? stored : undefined;
}

/** This browser's font, or the default: what a document with no font of its own uses. */
export function getSheetFont(): SheetFontId {
  return getBrowserSheetFont() ?? DEFAULT_SHEET_FONT;
}

/** Set this browser's font, or clear it (`undefined`: the default applies). Does not apply it. */
export function setBrowserSheetFont(id: SheetFontId | undefined): void {
  if (id === undefined) {
    try {
      globalThis.localStorage?.removeItem(STORAGE_KEY);
    } catch {
      // Storage may be unavailable: nothing was stored to remove.
    }
    return;
  }
  safeStorageSet(STORAGE_KEY, id);
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
