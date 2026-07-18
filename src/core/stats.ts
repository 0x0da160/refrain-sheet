// SPDX-License-Identifier: MIT
/**
 * Selection statistics over a rectangular grid range.
 *
 * Numeric conversion rules (documented and tested):
 * - A cell contributes to the numeric aggregates only when its *displayed*
 *   value (the computed value for formula cells) trims to a finite JavaScript
 *   number.
 * - Blank cells, non-numeric text, boolean text (`TRUE`/`FALSE`), formula
 *   error codes (`#DIV/0!`, …), and non-finite values (`Infinity`, `NaN`) are
 *   ignored for numeric aggregates.
 * - Every position inside the selected rectangle counts toward `count`; a
 *   position beyond a ragged CSV row's field count is treated as empty.
 */

export interface SelectionStats {
  /** Total number of selected cells (the rectangle's area). */
  count: number;
  /** Selected cells whose displayed value is non-empty. */
  nonEmpty: number;
  /** Selected cells whose displayed value is a finite number. */
  numeric: number;
  /** Sum of the numeric cells (0 when none). */
  sum: number;
  /** Average of the numeric cells, or null when there are none. */
  average: number | null;
  /** Minimum numeric value, or null when there are none. */
  min: number | null;
  /** Maximum numeric value, or null when there are none. */
  max: number | null;
}

export interface StatsRange {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * Parse a displayed cell value to a finite number, or null. Blank, text,
 * error codes, and non-finite values return null.
 */
export function numericCellValue(display: string): number | null {
  if (display === '') {
    return null;
  }
  const trimmed = display.trim();
  if (trimmed === '') {
    return null;
  }
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export function emptySelectionStats(): SelectionStats {
  return { count: 0, nonEmpty: 0, numeric: 0, sum: 0, average: null, min: null, max: null };
}

/**
 * Compute statistics over a rectangular selection. `readDisplay(row, col)`
 * returns the displayed value (already computed for formula cells).
 * `fieldCount(row)`, when provided, bounds ragged rows so positions beyond a
 * row's fields count as empty cells.
 */
export function computeSelectionStats(
  selrange: StatsRange,
  readDisplay: (row: number, col: number) => string,
  fieldCount?: (row: number) => number,
): SelectionStats {
  let count = 0;
  let nonEmpty = 0;
  let numeric = 0;
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  for (let r = selrange.top; r <= selrange.bottom; r++) {
    const lastField = fieldCount ? fieldCount(r) - 1 : selrange.right;
    for (let c = selrange.left; c <= selrange.right; c++) {
      count += 1;
      if (c > lastField) {
        continue; // beyond a ragged row's fields: an empty cell
      }
      const display = readDisplay(r, c);
      if (display !== '') {
        nonEmpty += 1;
      }
      const n = numericCellValue(display);
      if (n !== null) {
        numeric += 1;
        sum += n;
        if (n < min) min = n;
        if (n > max) max = n;
      }
    }
  }
  return {
    count,
    nonEmpty,
    numeric,
    sum,
    average: numeric > 0 ? sum / numeric : null,
    min: numeric > 0 ? min : null,
    max: numeric > 0 ? max : null,
  };
}
