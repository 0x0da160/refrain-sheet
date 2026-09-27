// SPDX-License-Identifier: MIT

/**
 * Column-width bookkeeping for column insert and delete. Widths are stored
 * per column index (0 or a missing entry = the default width), so a real
 * insert or delete has to move them with the columns; otherwise every width
 * stays where it was while the values beside it shift, and each column ends
 * up with its neighbour's width.
 */

/** `widths` after inserting `count` columns at `index`, taking `restored` widths (default otherwise). */
export function insertColWidths(
  widths: readonly number[],
  index: number,
  count: number,
  restored: readonly number[] = [],
): number[] {
  const out = Array.from({ length: Math.max(widths.length, index) }, (_, i) => widths[i] ?? 0);
  out.splice(index, 0, ...Array.from({ length: count }, (_, i) => restored[i] ?? 0));
  return trimDefaults(out);
}

/** `widths` after deleting `count` columns at `index`. */
export function deleteColWidths(widths: readonly number[], index: number, count: number): number[] {
  const out = Array.from({ length: widths.length }, (_, i) => widths[i] ?? 0);
  out.splice(index, count);
  return trimDefaults(out);
}

/** The widths of `count` columns from `index` (0 = default), e.g. to restore them on undo. */
export function colWidthsAt(widths: readonly number[], index: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => widths[index + i] ?? 0);
}

function trimDefaults(widths: number[]): number[] {
  let end = widths.length;
  while (end > 0 && !(widths[end - 1] > 0)) {
    end -= 1;
  }
  widths.length = end;
  return widths;
}
