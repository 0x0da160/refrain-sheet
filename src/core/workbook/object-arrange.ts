// SPDX-License-Identifier: MIT
/**
 * Arranging sheet objects (see `sheet-objects.ts`): groups, and lining
 * objects up or spacing them evenly.
 *
 * A group is the objects that share a `group` id. Picking one member picks
 * the whole group, so the group moves, copies and deletes as one; a member
 * can still be picked alone to edit it. Groups do not nest.
 *
 * Aligning and spacing work on boxes (each object's unrotated box, in
 * pixels at 100% zoom from the sheet's top-left corner); the caller turns
 * the new corners back into anchors, since cell sizes live in the view.
 */
import type { SheetObject } from './sheet-objects';

export const ARRANGEMENTS = [
  'alignLeft',
  'alignCenter',
  'alignRight',
  'alignTop',
  'alignMiddle',
  'alignBottom',
  'distributeHorizontally',
  'distributeVertically',
] as const;
export type Arrangement = (typeof ARRANGEMENTS)[number];

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** How many objects an arrangement needs: two to line up, three to space out. */
export function arrangementMinimum(how: Arrangement): number {
  return how.startsWith('distribute') ? 3 : 2;
}

/**
 * The top-left corner of each box after `how`: lined up on the outermost
 * edge (or the middle) of all of them, or spaced so the gaps between them
 * are equal with the first and last left where they are.
 */
export function arrangeBoxes(boxes: readonly Box[], how: Arrangement): Array<{ x: number; y: number }> {
  const left = Math.min(...boxes.map((b) => b.x));
  const top = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.w));
  const bottom = Math.max(...boxes.map((b) => b.y + b.h));
  if (how === 'distributeHorizontally' || how === 'distributeVertically') {
    return distribute(boxes, how === 'distributeHorizontally' ? 'x' : 'y');
  }
  return boxes.map((b) => {
    switch (how) {
      case 'alignLeft':
        return { x: left, y: b.y };
      case 'alignCenter':
        return { x: Math.round((left + right) / 2 - b.w / 2), y: b.y };
      case 'alignRight':
        return { x: right - b.w, y: b.y };
      case 'alignTop':
        return { x: b.x, y: top };
      case 'alignMiddle':
        return { x: b.x, y: Math.round((top + bottom) / 2 - b.h / 2) };
      default:
        return { x: b.x, y: bottom - b.h };
    }
  });
}

function distribute(boxes: readonly Box[], axis: 'x' | 'y'): Array<{ x: number; y: number }> {
  const size = (b: Box): number => (axis === 'x' ? b.w : b.h);
  const order = boxes.map((_, i) => i).sort((a, b) => boxes[a][axis] - boxes[b][axis] || a - b);
  const first = boxes[order[0]];
  const last = boxes[order[order.length - 1]];
  const used = order.reduce((sum, i) => sum + size(boxes[i]), 0);
  const gap = (last[axis] + size(last) - first[axis] - used) / (order.length - 1);
  const out = boxes.map((b) => ({ x: b.x, y: b.y }));
  let at = first[axis];
  for (const i of order) {
    out[i][axis] = Math.round(at);
    at += size(boxes[i]) + gap;
  }
  return out;
}

// ----- Groups -----

/** `ids` with every other member of their groups added, in stacking order. */
export function withGroups(objects: readonly SheetObject[], ids: readonly string[]): string[] {
  const picked = new Set(ids);
  const groups = new Set(objects.filter((o) => picked.has(o.id) && o.group).map((o) => o.group));
  return objects.filter((o) => picked.has(o.id) || (o.group && groups.has(o.group))).map((o) => o.id);
}

/** A group id no object of `objects` (or `taken`) uses yet. */
export function nextGroupId(objects: readonly SheetObject[], taken: ReadonlySet<string> = new Set()): string {
  const used = new Set([...objects.flatMap((o) => (o.group ? [o.group] : [])), ...taken]);
  let n = 1;
  while (used.has(`g${n}`)) {
    n += 1;
  }
  return `g${n}`;
}
