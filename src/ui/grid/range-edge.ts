// SPDX-License-Identifier: MIT
import type { CellRange } from '../../core/clipboard';

/** Width (px at 100% zoom) of the band along a selection's outer border that starts a move drag. */
export const MOVE_EDGE_PX = 4;

/**
 * Whether a point inside the rendered cell at (`row`, `col`) lies on the
 * outer border of `range` — within `band` pixels of an edge of the range's
 * rectangle, measured inside the range — so a drag started there moves the
 * selection instead of starting a new one. `x`/`y` are the point's offsets
 * from the cell's top-left corner and `width`/`height` the cell's size. The
 * band never takes more than a quarter of a small cell, so the middle of
 * every cell still selects normally.
 */
export function onRangeEdge(
  range: CellRange,
  row: number,
  col: number,
  point: { x: number; y: number; width: number; height: number },
  band: number,
): boolean {
  if (row < range.top || row > range.bottom || col < range.left || col > range.right) {
    return false;
  }
  const bx = Math.min(band, point.width / 4);
  const by = Math.min(band, point.height / 4);
  return (
    (row === range.top && point.y <= by) ||
    (row === range.bottom && point.height - point.y <= by) ||
    (col === range.left && point.x <= bx) ||
    (col === range.right && point.width - point.x <= bx)
  );
}
