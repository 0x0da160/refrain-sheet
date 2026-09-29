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

import { isWorkbook, type EditorDocument } from '../core/editor-document';
import { BORDER_SIDES, normalizeHexColor } from '../core/workbook/cell-style';

const FAMILIES = ['gray', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'violet', 'pink'] as const;

/** The design system's 65 document-colour tokens, in palette order. */
export const SWATCH_TOKENS: readonly string[] = [
  ...FAMILIES.flatMap((family) => [1, 2, 3, 4, 5, 6, 7].map((step) => `--swatch-${family}-${step}`)),
  '--swatch-white',
  '--swatch-black',
];

/**
 * The same 65 swatches as values, in {@link SWATCH_TOKENS} order, for the
 * color picker's palette (which must draw before, and without, a stylesheet).
 * tests/ui/document-colors.test.ts keeps them equal to the tokens.
 */
export const SWATCH_COLORS: readonly string[] = [
  // gray
  '#eef4fc',
  '#dbe0e8',
  '#b9bec6',
  '#979ca3',
  '#767b82',
  '#54585f',
  '#31363c',
  // red
  '#ffefed',
  '#ffd4ce',
  '#f8a59b',
  '#e0796f',
  '#c35047',
  '#93332d',
  '#5b1f1a',
  // orange
  '#fff0e7',
  '#ffd6bc',
  '#f0ad7f',
  '#d88445',
  '#b95e00',
  '#874300',
  '#542700',
  // yellow
  '#faf4dd',
  '#ece0b3',
  '#d2bd70',
  '#b59a26',
  '#917900',
  '#695700',
  '#403400',
  // green
  '#e6fae9',
  '#c4eccb',
  '#8ed09c',
  '#59b26f',
  '#1b9247',
  '#006b2e',
  '#01421a',
  // teal
  '#ddfafa',
  '#b1edec',
  '#65d2d2',
  '#00b2b2',
  '#008c8c',
  '#006566',
  '#003e3e',
  // blue
  '#ebf5ff',
  '#cae2ff',
  '#8ec2fd',
  '#5b9fe9',
  '#287ccf',
  '#0e599d',
  '#083662',
  // violet
  '#f5f1ff',
  '#e5d8ff',
  '#c7aff5',
  '#a888e0',
  '#8962c5',
  '#644395',
  '#3d285c',
  // pink
  '#ffeef5',
  '#ffd1e5',
  '#efa3c7',
  '#d678a7',
  '#b94f87',
  '#8a3362',
  '#561e3c',
  // white, black
  '#ffffff',
  '#000000',
];

/**
 * Conditional-format defaults, stored in the document when a new rule is
 * created. They equal the design system's `--cf-*` tokens (red.100 fill with
 * red.900 text for a highlight; white to green.300 for a colour scale) —
 * tests/ui/document-colors.test.ts keeps the two in sync.
 */
export const CF_DEFAULT_BACKGROUND = '#ffddd9';
export const CF_DEFAULT_TEXT = '#5d0004';
export const CF_DEFAULT_SCALE_MIN_COLOR = '#ffffff';
export const CF_DEFAULT_SCALE_MAX_COLOR = '#8bc191';

/**
 * The colours a workbook already uses — cell text, fill and border colours
 * and sheet tab colours on every sheet — most used first, for the color
 * picker's "Used in this file" row.
 */
export function documentColorsOf(doc: EditorDocument): string[] {
  if (!isWorkbook(doc)) {
    return [];
  }
  const counts = new Map<string, number>();
  const count = (color: string | undefined): void => {
    const hex = color === undefined ? null : normalizeHexColor(color);
    if (hex) {
      counts.set(hex, (counts.get(hex) ?? 0) + 1);
    }
  };
  for (const sheet of doc.sheets) {
    count(sheet.tabColor);
    for (const [, , style] of sheet.collectStyles()) {
      count(style.textColor);
      count(style.backgroundColor);
      for (const side of BORDER_SIDES) {
        count(style[side]);
      }
    }
  }
  return [...counts].sort((a, b) => b[1] - a[1]).map(([color]) => color);
}

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
