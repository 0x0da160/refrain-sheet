// SPDX-License-Identifier: MIT
import { getCsvEngine } from './csv-engine';
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
 * Incremental selection-statistics scanner. One row is scanned at a time so
 * large selections can be processed in time slices off the critical
 * selection-event path (the status bar shows "Calculating…" meanwhile);
 * {@link computeSelectionStats} drives the same scanner synchronously, so the
 * two paths cannot diverge.
 */
export class SelectionStatsAccumulator {
  private count = 0;
  private nonEmpty = 0;
  // Collect finite numbers in cell order; the numeric reduction (sum/min/max)
  // runs in the WASM engine (with an order-identical JS fallback). Parsing
  // stays here so JS `Number()` semantics remain the single source of truth.
  private readonly numbers: number[] = [];

  constructor(
    private readonly selrange: StatsRange,
    private readonly readDisplay: (row: number, col: number) => string,
    private readonly fieldCount?: (row: number) => number,
    /**
     * Optional predicate marking rows hidden by an active filter. Hidden rows
     * are excluded from every statistic (count included), so the status-bar
     * aggregates describe exactly the visible selection — consistent with
     * copy, fill, and clear, which also skip filtered-out rows.
     */
    private readonly isRowHidden?: (row: number) => boolean,
  ) {}

  /** Scan one document row of the selection rectangle. */
  scanRow(r: number): void {
    const { selrange } = this;
    if (this.isRowHidden?.(r)) {
      return; // filtered-out row: excluded from the visible-selection stats
    }
    const lastField = this.fieldCount ? this.fieldCount(r) - 1 : selrange.right;
    for (let c = selrange.left; c <= selrange.right; c++) {
      this.count += 1;
      if (c > lastField) {
        continue; // beyond a ragged row's fields: an empty cell
      }
      const display = this.readDisplay(r, c);
      if (display !== '') {
        this.nonEmpty += 1;
      }
      const n = numericCellValue(display);
      if (n !== null) {
        this.numbers.push(n);
      }
    }
  }

  /** Reduce the scanned rows to the final statistics. */
  finalize(): SelectionStats {
    const numeric = this.numbers.length;
    const { sum, min, max } = getCsvEngine().statsAggregate(Float64Array.from(this.numbers));
    return {
      count: this.count,
      nonEmpty: this.nonEmpty,
      numeric,
      sum,
      average: numeric > 0 ? sum / numeric : null,
      min: numeric > 0 ? min : null,
      max: numeric > 0 ? max : null,
    };
  }
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
  isRowHidden?: (row: number) => boolean,
): SelectionStats {
  const acc = new SelectionStatsAccumulator(selrange, readDisplay, fieldCount, isRowHidden);
  for (let r = selrange.top; r <= selrange.bottom; r++) {
    acc.scanRow(r);
  }
  return acc.finalize();
}
