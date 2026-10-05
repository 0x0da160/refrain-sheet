// SPDX-License-Identifier: MIT
/**
 * Row heights a person set on an RSF worksheet (Format > Row Height…, or by
 * dragging a row header's bottom edge): a sparse map from document row to
 * height in px at 100% zoom. A row not in the map takes the default height
 * (or the height its wrapped text needs). Presentational only, like column
 * widths: never cell data, evaluation, or export.
 *
 * Maps are replaced, never changed in place, so the grid can tell by
 * identity that the heights changed.
 */

export type RowHeights = ReadonlyMap<number, number>;

/** A row's height when nothing sets it (one line), px at 100% zoom. */
export const DEFAULT_ROW_HEIGHT = 24;

/** Smallest and largest row height, px at 100% zoom. */
export const MIN_ROW_HEIGHT = 8;
export const MAX_ROW_HEIGHT = 600;

/** A height clamped into range and rounded to whole pixels. */
export function clampRowHeight(px: number): number {
  return Math.max(MIN_ROW_HEIGHT, Math.min(MAX_ROW_HEIGHT, Math.round(px)));
}

/** `heights` after inserting `count` rows at `index`, taking `restored` heights (0 = default). */
export function insertRowHeights(
  heights: RowHeights,
  index: number,
  count: number,
  restored: readonly number[] = [],
): RowHeights {
  const out = new Map<number, number>();
  for (const [row, px] of heights) {
    out.set(row >= index ? row + count : row, px);
  }
  restored.forEach((px, i) => {
    if (i < count && px > 0) {
      out.set(index + i, px);
    }
  });
  return out.size === 0 && heights.size === 0 ? heights : out;
}

/** `heights` after deleting `count` rows at `index`. */
export function deleteRowHeights(heights: RowHeights, index: number, count: number): RowHeights {
  if (heights.size === 0) {
    return heights;
  }
  const out = new Map<number, number>();
  for (const [row, px] of heights) {
    if (row < index) {
      out.set(row, px);
    } else if (row >= index + count) {
      out.set(row - count, px);
    }
  }
  return out;
}

/** The heights of `count` rows from `index` (0 = default), e.g. to restore them on undo. */
export function rowHeightsAt(heights: RowHeights, index: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => heights.get(index + i) ?? 0);
}

/** `heights` with `rows` set to `px`, or back to the default when `px` is null. */
export function withRowHeights(heights: RowHeights, rows: Iterable<number>, px: number | null): RowHeights {
  const out = new Map(heights);
  for (const row of rows) {
    if (px === null) {
      out.delete(row);
    } else {
      out.set(row, clampRowHeight(px));
    }
  }
  return out;
}
