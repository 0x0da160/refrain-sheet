// SPDX-License-Identifier: MIT

/**
 * Visual, cell-level formatting: bold/italic/underline, text color, cell
 * background color, per-side borders, and a numeric display format. Purely
 * presentational — it never affects a cell's value, formula evaluation,
 * sort/filter, or CSV export. Absent keys mean "not set" (inherit the
 * sheet's normal appearance); a style with no keys set is never stored (see
 * {@link isEmptyCellStyle}).
 *
 * Colors are `#rrggbb` hex strings (no alpha). A border side is "on" exactly
 * when its color string is present. Its line style ({@link BorderLineStyle})
 * and width ({@link BorderWidth}) are stored separately and only meaningful
 * while the side is on; when absent they default to {@link DEFAULT_BORDER_LINE_STYLE}
 * and {@link DEFAULT_BORDER_WIDTH} (see {@link borderSideValue}), which keeps
 * every border set before this feature existed rendering exactly as before.
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
  borderTopStyle?: BorderLineStyle;
  borderRightStyle?: BorderLineStyle;
  borderBottomStyle?: BorderLineStyle;
  borderLeftStyle?: BorderLineStyle;
  borderTopWidth?: BorderWidth;
  borderRightWidth?: BorderWidth;
  borderBottomWidth?: BorderWidth;
  borderLeftWidth?: BorderWidth;
  numberFormat?: NumberFormat;
}

/**
 * How a numeric cell's computed value is displayed: a fixed decimal count,
 * an optional thousands separator, and (for `currency`) a symbol prefix.
 * Purely a display transform of {@link CellStyle} — like every other style
 * property it never changes the cell's underlying value, formula result,
 * sort/filter order, or CSV/XLSX export (see `docs/rsf-format.md`). Applies
 * only to number-typed formula results; text, boolean, blank, and error
 * values render exactly as they do today regardless of this setting.
 */
export type NumberFormatKind = 'number' | 'percent' | 'currency';

export const NUMBER_FORMAT_KINDS: readonly NumberFormatKind[] = ['number', 'percent', 'currency'];

/** Highest decimal-place count the dialog and codec accept (clamped on both ends). */
export const MAX_NUMBER_FORMAT_DECIMALS = 10;

/** Highest currency-symbol length (UTF-16 code units) stored; longer input is truncated. */
export const MAX_CURRENCY_SYMBOL_LENGTH = 4;

export interface NumberFormat {
  kind: NumberFormatKind;
  /** Fixed decimal places, `0`-`{@link MAX_NUMBER_FORMAT_DECIMALS}`. */
  decimals: number;
  /** Group the integer part with thousands separators (e.g. `1,234`). */
  thousands: boolean;
  /** The prefix shown for `kind: 'currency'` (e.g. `"$"`, `"¥"`); ignored otherwise. */
  currencySymbol?: string;
}

/** Clamp/truncate a `NumberFormat` to the bounds every writer (dialog, codec) must respect. */
export function normalizeNumberFormat(format: NumberFormat): NumberFormat {
  const decimals = Math.max(0, Math.min(MAX_NUMBER_FORMAT_DECIMALS, Math.round(format.decimals)));
  const normalized: NumberFormat = { kind: format.kind, decimals, thousands: !!format.thousands };
  if (format.kind === 'currency') {
    normalized.currencySymbol = (format.currencySymbol ?? '$').slice(0, MAX_CURRENCY_SYMBOL_LENGTH);
  }
  return normalized;
}

/** Structural equality for {@link NumberFormat}, with `undefined` on both sides considered equal. */
export function numberFormatsEqual(a: NumberFormat | undefined, b: NumberFormat | undefined): boolean {
  if (a === undefined || b === undefined) {
    return a === b;
  }
  return (
    a.kind === b.kind &&
    a.decimals === b.decimals &&
    a.thousands === b.thousands &&
    (a.kind !== 'currency' || a.currencySymbol === b.currencySymbol)
  );
}

/** The four border sides, in the fixed order the codec and UI iterate them. */
export const BORDER_SIDES = ['borderTop', 'borderRight', 'borderBottom', 'borderLeft'] as const;
export type BorderSide = (typeof BORDER_SIDES)[number];

/** Color-valued style properties (the border sides plus text/background). */
export const COLOR_KEYS = ['textColor', 'backgroundColor', ...BORDER_SIDES] as const;
export type ColorKey = (typeof COLOR_KEYS)[number];

/** A border side's line style — the native CSS `border-style` keywords this app supports. */
export type BorderLineStyle = 'solid' | 'dashed' | 'dotted' | 'double';
export const BORDER_LINE_STYLES: readonly BorderLineStyle[] = ['solid', 'dashed', 'dotted', 'double'];
export const DEFAULT_BORDER_LINE_STYLE: BorderLineStyle = 'solid';
/** Line-style precedence used to resolve two overlapping borders on a tied width — higher wins. */
const BORDER_LINE_STYLE_PRECEDENCE: Record<BorderLineStyle, number> = {
  solid: 3,
  double: 2,
  dashed: 1,
  dotted: 0,
};

/** A border side's thickness. */
export type BorderWidth = 'thin' | 'medium' | 'thick';
export const BORDER_WIDTHS: readonly BorderWidth[] = ['thin', 'medium', 'thick'];
export const DEFAULT_BORDER_WIDTH: BorderWidth = 'thin';
/** Pixel width painted for each {@link BorderWidth}, also used to compare thickness on merge. */
export const BORDER_WIDTH_PX: Record<BorderWidth, number> = { thin: 1, medium: 2, thick: 3 };

/** The `CellStyle` key holding a side's line style, e.g. `borderTop` → `borderTopStyle`. */
export const BORDER_STYLE_KEY: Record<BorderSide, `${BorderSide}Style`> = {
  borderTop: 'borderTopStyle',
  borderRight: 'borderRightStyle',
  borderBottom: 'borderBottomStyle',
  borderLeft: 'borderLeftStyle',
};
/** The `CellStyle` key holding a side's width, e.g. `borderTop` → `borderTopWidth`. */
export const BORDER_WIDTH_KEY: Record<BorderSide, `${BorderSide}Width`> = {
  borderTop: 'borderTopWidth',
  borderRight: 'borderRightWidth',
  borderBottom: 'borderBottomWidth',
  borderLeft: 'borderLeftWidth',
};

/** A fully resolved border side: the color plus its effective line style and width. */
export interface BorderSideValue {
  color: string;
  lineStyle: BorderLineStyle;
  width: BorderWidth;
}

/**
 * Read one side of `style` as a {@link BorderSideValue}, or `null` when that
 * side has no color (i.e. is "off"). An absent line style/width defaults to
 * {@link DEFAULT_BORDER_LINE_STYLE}/{@link DEFAULT_BORDER_WIDTH} — every
 * border stored before this feature existed reads back identically.
 */
export function borderSideValue(
  style: CellStyle | null | undefined,
  side: BorderSide,
): BorderSideValue | null {
  const color = style?.[side];
  if (color === undefined) {
    return null;
  }
  return {
    color,
    lineStyle: style?.[BORDER_STYLE_KEY[side]] ?? DEFAULT_BORDER_LINE_STYLE,
    width: style?.[BORDER_WIDTH_KEY[side]] ?? DEFAULT_BORDER_WIDTH,
  };
}

/**
 * Resolve which single border should be painted on an edge shared by two
 * adjacent cells, given each cell's own value for that edge (`null` when a
 * cell has no border set on that side). Mirrors CSS `border-collapse`: the
 * wider border wins; on a width tie, line-style precedence (solid > double >
 * dashed > dotted) decides; on a further tie `own` wins, so a shared edge
 * between two identically-styled borders deterministically keeps the
 * top/left cell's value when the caller passes that cell's border as `own`.
 * Returns `null` only when neither side has a border. Render-only: never
 * changes either cell's stored style.
 */
export function resolveSharedBorder(
  own: BorderSideValue | null,
  neighbor: BorderSideValue | null,
): BorderSideValue | null {
  if (!own) {
    return neighbor;
  }
  if (!neighbor) {
    return own;
  }
  if (BORDER_WIDTH_PX[neighbor.width] !== BORDER_WIDTH_PX[own.width]) {
    return BORDER_WIDTH_PX[neighbor.width] > BORDER_WIDTH_PX[own.width] ? neighbor : own;
  }
  if (BORDER_LINE_STYLE_PRECEDENCE[neighbor.lineStyle] > BORDER_LINE_STYLE_PRECEDENCE[own.lineStyle]) {
    return neighbor;
  }
  return own;
}

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
    style.borderLeft === undefined &&
    style.numberFormat === undefined
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
    an.borderLeft === bn.borderLeft &&
    BORDER_SIDES.every(
      (side) =>
        an[BORDER_STYLE_KEY[side]] === bn[BORDER_STYLE_KEY[side]] &&
        an[BORDER_WIDTH_KEY[side]] === bn[BORDER_WIDTH_KEY[side]],
    ) &&
    numberFormatsEqual(an.numberFormat, bn.numberFormat)
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
  /** Leaves the side's line style untouched unless its color is set (or already set) in the same patch. */
  borderTopStyle?: BorderLineStyle;
  borderRightStyle?: BorderLineStyle;
  borderBottomStyle?: BorderLineStyle;
  borderLeftStyle?: BorderLineStyle;
  /** Leaves the side's width untouched unless its color is set (or already set) in the same patch. */
  borderTopWidth?: BorderWidth;
  borderRightWidth?: BorderWidth;
  borderBottomWidth?: BorderWidth;
  borderLeftWidth?: BorderWidth;
  /** `null` clears the number format ("General"); an object replaces it whole (never merged). */
  numberFormat?: NumberFormat | null;
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
  // A cleared border side (color set to null) also drops its line style/width
  // — they are meaningless without a color — while a side left untouched or
  // just turned on picks up whatever style/width the patch supplies.
  for (const side of BORDER_SIDES) {
    const styleKey = BORDER_STYLE_KEY[side];
    const widthKey = BORDER_WIDTH_KEY[side];
    if (patch[side] === null) {
      delete next[styleKey];
      delete next[widthKey];
      continue;
    }
    if (patch[styleKey] !== undefined) {
      next[styleKey] = patch[styleKey];
    }
    if (patch[widthKey] !== undefined) {
      next[widthKey] = patch[widthKey];
    }
  }
  if (patch.numberFormat !== undefined) {
    if (patch.numberFormat === null) {
      delete next.numberFormat;
    } else {
      next.numberFormat = normalizeNumberFormat(patch.numberFormat);
    }
  }
  return isEmptyCellStyle(next) ? null : next;
}
