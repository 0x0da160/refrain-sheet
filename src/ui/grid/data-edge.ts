// SPDX-License-Identifier: MIT

/**
 * Ctrl+Arrow "jump to the data edge" along one line of cells (a row, or the
 * visible rows of a column), the usual spreadsheet rule:
 *
 * - from a filled cell whose neighbor is also filled, go to the last filled
 *   cell before the next empty one;
 * - otherwise go to the next filled cell, or to the end of the line when
 *   there is none.
 *
 * `next(i)` gives the position after `i` in the direction of travel (or
 * `null` at the end), so callers decide how hidden or sorted rows are
 * walked; `filled(i)` says whether that cell has content.
 */
export function findDataEdge(
  start: number,
  next: (position: number) => number | null,
  filled: (position: number) => boolean,
): number {
  let current = next(start);
  if (current === null) {
    return start;
  }
  if (filled(start) && filled(current)) {
    for (let after = next(current); after !== null && filled(after); after = next(after)) {
      current = after;
    }
    return current;
  }
  while (!filled(current)) {
    const after = next(current);
    if (after === null) {
      break;
    }
    current = after;
  }
  return current;
}
