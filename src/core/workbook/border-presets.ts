// SPDX-License-Identifier: MIT
import {
  BORDER_SIDES,
  BORDER_STYLE_KEY,
  BORDER_WIDTH_KEY,
  type BorderLineStyle,
  type BorderSide,
  type BorderWidth,
  type CellStylePatch,
} from './cell-style';

/**
 * Which borders a Borders preset draws on a selected range: every edge of
 * every cell, the range's outline, only the lines between its cells, one
 * outer edge, or none at all (which removes every side of every cell).
 */
export type BorderPreset = 'all' | 'outside' | 'inside' | 'top' | 'bottom' | 'left' | 'right' | 'none';

export const BORDER_PRESETS: readonly BorderPreset[] = [
  'all',
  'outside',
  'inside',
  'top',
  'bottom',
  'left',
  'right',
  'none',
];

/** The line a preset draws. */
export interface BorderLine {
  readonly color: string;
  readonly lineStyle: BorderLineStyle;
  readonly width: BorderWidth;
}

/** A range's bounds, inclusive. */
interface Bounds {
  readonly top: number;
  readonly left: number;
  readonly bottom: number;
  readonly right: number;
}

/**
 * The sides `preset` draws on the cell at (`row`, `col`) of `range`. The lines
 * between two cells are drawn once, on the right and bottom sides of the cell
 * before them, so a double line is never stacked on itself.
 */
function presetSides(preset: BorderPreset, range: Bounds, row: number, col: number): BorderSide[] {
  const top = row === range.top;
  const bottom = row === range.bottom;
  const left = col === range.left;
  const right = col === range.right;
  switch (preset) {
    case 'all':
    case 'none':
      return [...BORDER_SIDES];
    case 'outside':
      return BORDER_SIDES.filter(
        (side) =>
          (side === 'borderTop' && top) ||
          (side === 'borderBottom' && bottom) ||
          (side === 'borderLeft' && left) ||
          (side === 'borderRight' && right),
      );
    case 'inside':
      return [...(right ? [] : (['borderRight'] as const)), ...(bottom ? [] : (['borderBottom'] as const))];
    case 'top':
      return top ? ['borderTop'] : [];
    case 'bottom':
      return bottom ? ['borderBottom'] : [];
    case 'left':
      return left ? ['borderLeft'] : [];
    case 'right':
      return right ? ['borderRight'] : [];
  }
}

/**
 * The style patch `preset` applies to one cell of `range`, or null when it
 * leaves that cell alone. Drawing presets add their sides and keep the
 * cell's other borders; `none` clears all four sides.
 */
export function borderPresetPatch(
  preset: BorderPreset,
  line: BorderLine,
  range: Bounds,
  row: number,
  col: number,
): CellStylePatch | null {
  const sides = presetSides(preset, range, row, col);
  if (sides.length === 0) {
    return null;
  }
  const patch: CellStylePatch = {};
  for (const side of sides) {
    if (preset === 'none') {
      patch[side] = null;
    } else {
      patch[side] = line.color;
      patch[BORDER_STYLE_KEY[side]] = line.lineStyle;
      patch[BORDER_WIDTH_KEY[side]] = line.width;
    }
  }
  return patch;
}
