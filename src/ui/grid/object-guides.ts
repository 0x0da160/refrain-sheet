// SPDX-License-Identifier: MIT
/**
 * Guides while dragging objects over the grid (see `object-layer.ts`): the
 * moved objects' left, center and right (and top, middle and bottom) snap to
 * the same line of any other object within a few pixels, and a guide line
 * shows each snap. Pure: boxes in, a corrected move and the lines out.
 */

/** A box in grid-canvas pixels. */
export interface GuideBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A guide: a vertical line (`axis` x, at canvas x `at`) or a horizontal one, from `from` to `to`. */
export interface GuideLine {
  axis: 'x' | 'y';
  at: number;
  from: number;
  to: number;
}

/** How near (canvas px) a line must be to snap. */
const SNAP_DISTANCE = 6;

function lines(start: number, size: number): number[] {
  return [start, start + size / 2, start + size];
}

/** The nearest snap on one axis: the shift to apply and the other box it lines up with. */
function nearest(
  moving: GuideBox,
  others: readonly GuideBox[],
  axis: 'x' | 'y',
): { shift: number; at: number; other: GuideBox } | null {
  const size = axis === 'x' ? 'w' : 'h';
  let best: { shift: number; at: number; other: GuideBox } | null = null;
  for (const other of others) {
    for (const target of lines(other[axis], other[size])) {
      for (const edge of lines(moving[axis], moving[size])) {
        const shift = target - edge;
        if (Math.abs(shift) <= SNAP_DISTANCE && (best === null || Math.abs(shift) < Math.abs(best.shift))) {
          best = { shift, at: target, other };
        }
      }
    }
  }
  return best;
}

/**
 * The move (`dx`, `dy`) of the box `moving` (where it started), corrected
 * so an edge or middle lines up with one of `others` when it is near one,
 * and the guide lines to draw for it.
 */
export function snapMove(
  moving: GuideBox,
  others: readonly GuideBox[],
  dx: number,
  dy: number,
): { dx: number; dy: number; guides: GuideLine[] } {
  const moved = { ...moving, x: moving.x + dx, y: moving.y + dy };
  const x = nearest(moved, others, 'x');
  const y = nearest(moved, others, 'y');
  const at = { ...moved, x: moved.x + (x?.shift ?? 0), y: moved.y + (y?.shift ?? 0) };
  const guides: GuideLine[] = [];
  if (x) {
    const from = Math.min(at.y, x.other.y);
    guides.push({ axis: 'x', at: x.at, from, to: Math.max(at.y + at.h, x.other.y + x.other.h) });
  }
  if (y) {
    const from = Math.min(at.x, y.other.x);
    guides.push({ axis: 'y', at: y.at, from, to: Math.max(at.x + at.w, y.other.x + y.other.w) });
  }
  return { dx: dx + (x?.shift ?? 0), dy: dy + (y?.shift ?? 0), guides };
}

/** The smallest box around `boxes`. */
export function unionBox(boxes: readonly GuideBox[]): GuideBox {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return {
    x,
    y,
    w: Math.max(...boxes.map((b) => b.x + b.w)) - x,
    h: Math.max(...boxes.map((b) => b.y + b.h)) - y,
  };
}
