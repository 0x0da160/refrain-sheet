// SPDX-License-Identifier: MIT
/**
 * A worksheet's print area (File > Print Area): the one block of cells
 * File > Print… prints for that sheet when "Print area" is chosen (and for
 * the sheet within "Entire file"). Kept in the worksheet's optional `.rsf`
 * key `printArea` as A1 text (`"A1:F40"`), and moved with inserted,
 * deleted and moved rows and columns the way data-validation ranges are.
 */
import { cellLabel, parseRef } from '../formula';
import type { PrintArea } from '../print-layout';

/** `"A1:F40"` (a single cell is still written as a range, `"B2:B2"`). */
export function printAreaToText(area: PrintArea): string {
  return `${cellLabel(area.top, area.left)}:${cellLabel(area.bottom, area.right)}`;
}

/**
 * The area named by `text` (`"A1:F40"`, `"f40:a1"`, `"$B$2"`, a single
 * cell), corners in any order, or null when it is not a cell or range.
 */
export function parsePrintArea(text: string): PrintArea | null {
  const parts = text.trim().split(':');
  if (parts.length < 1 || parts.length > 2) {
    return null;
  }
  const refs = parts.map((p) => parseRef(p.trim().replace(/\$/g, '').toUpperCase()));
  if (refs.some((r) => r === null)) {
    return null;
  }
  const [a, b] = [refs[0]!, refs[refs.length - 1]!];
  return {
    top: Math.min(a.row, b.row),
    left: Math.min(a.col, b.col),
    bottom: Math.max(a.row, b.row),
    right: Math.max(a.col, b.col),
  };
}

/** The area cut to a sheet of `rows` × `cols`, or null when nothing of it is left. */
export function clipPrintArea(area: PrintArea, rows: number, cols: number): PrintArea | null {
  const clipped = {
    top: area.top,
    left: area.left,
    bottom: Math.min(area.bottom, rows - 1),
    right: Math.min(area.right, cols - 1),
  };
  return clipped.top <= clipped.bottom && clipped.left <= clipped.right ? clipped : null;
}

export function printAreasEqual(a: PrintArea | null, b: PrintArea | null): boolean {
  return (
    a === b ||
    (a !== null &&
      b !== null &&
      a.top === b.top &&
      a.left === b.left &&
      a.bottom === b.bottom &&
      a.right === b.right)
  );
}

function withSpan(area: PrintArea, axis: 'row' | 'col', from: number, to: number): PrintArea {
  return axis === 'row' ? { ...area, top: from, bottom: to } : { ...area, left: from, right: to };
}

/** The area after `count` rows or columns were inserted at `index`: moved when after it, grown when inside. */
export function shiftPrintAreaForInsert(
  area: PrintArea | null,
  axis: 'row' | 'col',
  index: number,
  count: number,
): PrintArea | null {
  if (!area) {
    return null;
  }
  const [start, end] = axis === 'row' ? [area.top, area.bottom] : [area.left, area.right];
  return withSpan(area, axis, start >= index ? start + count : start, end >= index ? end + count : end);
}

/** The area after `count` rows or columns from `index` were deleted; null when all of it was. */
export function shiftPrintAreaForDelete(
  area: PrintArea | null,
  axis: 'row' | 'col',
  index: number,
  count: number,
): PrintArea | null {
  if (!area) {
    return null;
  }
  const last = index + count;
  const [start, end] = axis === 'row' ? [area.top, area.bottom] : [area.left, area.right];
  const from = start < index ? start : start < last ? index : start - count;
  const to = end < index ? end : end < last ? index - 1 : end - count;
  return from <= to ? withSpan(area, axis, from, to) : null;
}

/**
 * The area after moving `count` rows or columns from `from` to the boundary
 * `to`: inside the moved span it moves with it, otherwise it follows the
 * delete and the insert.
 */
export function movePrintArea(
  area: PrintArea | null,
  axis: 'row' | 'col',
  from: number,
  count: number,
  to: number,
): PrintArea | null {
  if (!area) {
    return null;
  }
  const dest = to > from ? to - count : to;
  const [start, end] = axis === 'row' ? [area.top, area.bottom] : [area.left, area.right];
  if (start >= from && end < from + count) {
    return withSpan(area, axis, start - from + dest, end - from + dest);
  }
  return shiftPrintAreaForInsert(shiftPrintAreaForDelete(area, axis, from, count), axis, dest, count);
}
