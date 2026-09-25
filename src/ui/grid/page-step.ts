// SPDX-License-Identifier: MIT

/** Rows PageUp / PageDown move when the grid has no measurable height (not laid out yet). */
const FALLBACK_PAGE_ROWS = 20;

/**
 * How many rows PageUp / PageDown move: one screenful, i.e. the whole rows of
 * `rowHeight` that fit in the scroll area's `viewHeight` (at least one).
 */
export function pageStep(viewHeight: number, rowHeight: number): number {
  if (!(viewHeight > 0) || !(rowHeight > 0)) {
    return FALLBACK_PAGE_ROWS;
  }
  return Math.max(1, Math.floor(viewHeight / rowHeight));
}
