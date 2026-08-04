// SPDX-License-Identifier: MIT

/**
 * Visual, cell-level formatting: bold/italic/underline, text color, cell
 * background color, and per-side borders. Purely presentational — it never
 * affects a cell's value, formula evaluation, sort/filter, or CSV export.
 * Absent keys mean "not set" (inherit the sheet's normal appearance); a style
 * with no keys set is never stored (see {@link isEmptyCellStyle}).
 *
 * Colors are `#rrggbb` hex strings (no alpha). A border side is "on" exactly
 * when its color string is present; there is no separate width/style choice —
 * every border is a thin solid line in the given color.
 */
export interface CellStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  textColor?: string;
  backgroundColor?: string;
  borderTop?: string;
  borderRight?: string;
  borderBottom?: string;
  borderLeft?: string;
}

/** The four border sides, in the fixed order the codec and UI iterate them. */
export const BORDER_SIDES = ['borderTop', 'borderRight', 'borderBottom', 'borderLeft'] as const;
export type BorderSide = (typeof BORDER_SIDES)[number];

/** Color-valued style properties (the border sides plus text/background). */
export const COLOR_KEYS = ['textColor', 'backgroundColor', ...BORDER_SIDES] as const;
export type ColorKey = (typeof COLOR_KEYS)[number];

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

/** True for a well-formed `#rrggbb` color string. */
export function isHexColor(value: string): boolean {
  return HEX_COLOR_RE.test(value);
}

/** Lowercase a valid hex color for canonical storage; null when invalid. */
export function normalizeHexColor(value: string): string | null {
  return isHexColor(value) ? value.toLowerCase() : null;
}

/** True when a style carries no properties (the canonical "no style" form is `null`, not `{}`). */
export function isEmptyCellStyle(style: CellStyle): boolean {
  return (
    !style.bold &&
    !style.italic &&
    !style.underline &&
    style.textColor === undefined &&
    style.backgroundColor === undefined &&
    style.borderTop === undefined &&
    style.borderRight === undefined &&
    style.borderBottom === undefined &&
    style.borderLeft === undefined
  );
}

/** Structural equality, with `null` and an empty style considered equal. */
export function cellStylesEqual(a: CellStyle | null, b: CellStyle | null): boolean {
  const an = a && !isEmptyCellStyle(a) ? a : null;
  const bn = b && !isEmptyCellStyle(b) ? b : null;
  if (an === null || bn === null) {
    return an === bn;
  }
  return (
    !!an.bold === !!bn.bold &&
    !!an.italic === !!bn.italic &&
    !!an.underline === !!bn.underline &&
    an.textColor === bn.textColor &&
    an.backgroundColor === bn.backgroundColor &&
    an.borderTop === bn.borderTop &&
    an.borderRight === bn.borderRight &&
    an.borderBottom === bn.borderBottom &&
    an.borderLeft === bn.borderLeft
  );
}

/**
 * A requested change to one or more of a style's properties. `undefined`
 * means "leave as-is"; `null` on a color property means "clear it"; `false`
 * on a boolean property means "turn it off" (booleans have no separate
 * "unset" state — an absent `bold` and `bold: false` are the same style).
 */
export interface CellStylePatch {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  textColor?: string | null;
  backgroundColor?: string | null;
  borderTop?: string | null;
  borderRight?: string | null;
  borderBottom?: string | null;
  borderLeft?: string | null;
}

/** Apply `patch` to `style` (or to the default empty style), returning the new style
 *  (or `null` when the result has no properties set). Never mutates its input. */
export function applyCellStylePatch(style: CellStyle | null, patch: CellStylePatch): CellStyle | null {
  const next: CellStyle = { ...(style ?? {}) };
  if (patch.bold !== undefined) {
    if (patch.bold) next.bold = true;
    else delete next.bold;
  }
  if (patch.italic !== undefined) {
    if (patch.italic) next.italic = true;
    else delete next.italic;
  }
  if (patch.underline !== undefined) {
    if (patch.underline) next.underline = true;
    else delete next.underline;
  }
  for (const key of COLOR_KEYS) {
    const value = patch[key];
    if (value === undefined) {
      continue;
    }
    if (value === null) {
      delete next[key];
    } else {
      next[key] = value;
    }
  }
  return isEmptyCellStyle(next) ? null : next;
}
