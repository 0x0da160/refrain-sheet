// SPDX-License-Identifier: MIT
/**
 * Document colours (design system D-13): the colours a user puts *into* a
 * document — text and fill colours, conditional-format colours — are data,
 * drawn the same in every theme. The design system offers them as a fixed
 * 65-colour set (`--swatch-*` in `design-system/v2/app/css/app-tokens.css`:
 * nine hue families in seven steps, plus white and black), and suggests
 * conditional-format defaults from the same set.
 *
 * The swatches are read from those CSS custom properties at runtime, so the
 * design system stays their single source, and offered to every native colour
 * picker as a `<datalist>`: browsers that support it (Chromium) show them as
 * one-click suggestions, the others simply ignore the list, and any colour can
 * still be chosen either way.
 */

const FAMILIES = ['gray', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'violet', 'pink'] as const;

/** The design system's 65 document-colour tokens, in palette order. */
export const SWATCH_TOKENS: readonly string[] = [
  ...FAMILIES.flatMap((family) => [1, 2, 3, 4, 5, 6, 7].map((step) => `--swatch-${family}-${step}`)),
  '--swatch-white',
  '--swatch-black',
];

/**
 * Conditional-format defaults, stored in the document when a new rule is
 * created. They equal the design system's `--cf-*` tokens (red.100 fill with
 * red.900 text for a highlight; white to green.300 for a colour scale) —
 * tests/document-colors.test.ts keeps the two in sync.
 */
export const CF_DEFAULT_BACKGROUND = '#ffddd9';
export const CF_DEFAULT_TEXT = '#5d0004';
export const CF_DEFAULT_SCALE_MIN_COLOR = '#ffffff';
export const CF_DEFAULT_SCALE_MAX_COLOR = '#8bc191';

/** The id of the shared `<datalist>` colour pickers point at. */
export const SWATCH_LIST_ID = 'document-swatches';

/**
 * Make sure the shared swatch `<datalist>` exists in `doc` and return its id.
 * Built once, from the computed `--swatch-*` values; tokens that do not
 * resolve (no stylesheet, e.g. in unit tests) are skipped.
 */
export function ensureSwatchList(doc: Document = document): string {
  if (doc.getElementById(SWATCH_LIST_ID)) return SWATCH_LIST_ID;
  const list = doc.createElement('datalist');
  list.id = SWATCH_LIST_ID;
  const style = doc.defaultView?.getComputedStyle(doc.documentElement);
  for (const token of SWATCH_TOKENS) {
    const value = style?.getPropertyValue(token).trim().toLowerCase() ?? '';
    if (/^#[0-9a-f]{6}$/.test(value)) {
      const option = doc.createElement('option');
      option.value = value;
      list.append(option);
    }
  }
  doc.body.append(list);
  return SWATCH_LIST_ID;
}
