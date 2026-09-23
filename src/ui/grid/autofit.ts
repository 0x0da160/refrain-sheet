// SPDX-License-Identifier: MIT
// Pure column auto-fit planning for the grid (no DOM): which rows to measure
// and the clamped width they need. The grid supplies real text measurement.
import { yieldToBrowser } from '../../core/scheduler';
import { MAX_COL_WIDTH, MIN_COL_WIDTH } from './geometry';

/**
 * Compute an auto-fit column width from measured content widths (visible cell
 * widths plus the header), clamped to [min, max]. The result is the width the
 * widest measured content needs — it may be **narrower or wider** than the
 * column's current width, so auto-fit both grows and shrinks. Extracted as a
 * pure function so the grow/shrink/clamp behavior is unit-testable without a
 * DOM (real measurement uses `scrollWidth`).
 */
export function autoFitWidth(contentWidths: number[], min = MIN_COL_WIDTH, max = MAX_COL_WIDTH): number {
  let needed = min;
  for (const w of contentWidths) {
    if (w > needed) {
      needed = w;
    }
  }
  return Math.max(min, Math.min(max, needed));
}

/** Cap of off-screen rows measured per auto-fit (documented sampling budget). */
export const AUTOFIT_SAMPLE_BUDGET = 1000;

export interface AutoFitInput {
  rowCount: number;
  /** Visible header text of the column (always measured). */
  header: string;
  /** Displayed cell text (formula cells contribute their calculated values). */
  getDisplayValue(row: number): string;
  /** Rows currently materialized in the virtualized grid (measured first). */
  visibleRows: number[];
  /** Text width in px under the active sheet font/size/spacing. */
  measure(text: string): number;
  /** Non-text horizontal chrome of a cell (padding + borders) in px. */
  cellChrome: number;
  /** Non-text horizontal chrome of the header (padding + resize handle) in px. */
  headerChrome: number;
  /** Maximum number of off-screen rows to sample (0 disables sampling). */
  sampleBudget: number;
  min?: number;
  max?: number;
}

export interface AutoFitResult {
  /** Clamped target width in px. */
  width: number;
  /** How many data rows were actually measured. */
  measuredRows: number;
  /** True when the width is based on a sample, not every row. */
  sampled: boolean;
}

/**
 * Plan an auto-fit width from *measured text widths* of the displayed values
 * (never character counts or average-width guesses). All currently visible
 * rows are measured, plus a deterministic, evenly spaced sample of off-screen
 * rows up to `sampleBudget` — the whole column is never rendered or measured
 * synchronously for large sheets. The result is recomputed from the current
 * content on every call (nothing is cached), so it freely shrinks as well as
 * grows and can never retain a stale historic maximum; font, locale, or
 * content changes are picked up on the next invocation automatically.
 */
export function planAutoFit(input: AutoFitInput): AutoFitResult {
  const min = input.min ?? MIN_COL_WIDTH;
  const max = input.max ?? MAX_COL_WIDTH;
  let needed = input.measure(input.header) + input.headerChrome;
  const rows = new Set<number>();
  for (const r of input.visibleRows) {
    if (r >= 0 && r < input.rowCount) {
      rows.add(r);
    }
  }
  if (input.sampleBudget > 0 && rows.size < input.rowCount) {
    // Deterministic, evenly spaced sample across the whole column so short
    // and long regions are both represented.
    const budget = Math.min(input.sampleBudget, input.rowCount);
    const step = input.rowCount / budget;
    for (let k = 0; k < budget; k++) {
      rows.add(Math.min(input.rowCount - 1, Math.floor(k * step)));
    }
  }
  let measuredRows = 0;
  for (const r of rows) {
    const w = input.measure(input.getDisplayValue(r)) + input.cellChrome;
    if (w > needed) {
      needed = w;
    }
    measuredRows += 1;
  }
  return {
    width: Math.max(min, Math.min(max, Math.ceil(needed))),
    measuredRows,
    sampled: measuredRows < input.rowCount,
  };
}

export interface MultiAutoFitOptions {
  /** Called between columns of a yielding run (done columns, total columns). */
  onProgress?: (done: number, total: number) => void;
  /** Checked after each yield; return true to abandon the remaining columns. */
  shouldStop?: () => boolean;
  /** Yield to the browser between columns (used for genuinely large jobs). */
  yieldBetween?: boolean;
}

export interface MultiAutoFitResult {
  /** Per-column plans, keyed by column index (partial when not completed). */
  plans: Map<number, AutoFitResult>;
  /** False when `shouldStop` abandoned the run — apply nothing in that case. */
  completed: boolean;
}

/**
 * Plan auto-fit widths for several columns. Every column is measured
 * independently with {@link planAutoFit} (its own header, displayed values,
 * and sampling), so each column can shrink or grow on its own. Large jobs
 * yield to the browser between columns and report per-column progress; a
 * cancelled run returns `completed: false` and its partial plans must be
 * discarded, so widths are only ever applied all-or-nothing.
 */
export async function planAutoFitColumns(
  cols: number[],
  makeInput: (col: number) => AutoFitInput,
  opts: MultiAutoFitOptions = {},
): Promise<MultiAutoFitResult> {
  const plans = new Map<number, AutoFitResult>();
  for (let i = 0; i < cols.length; i++) {
    if (opts.yieldBetween && i > 0) {
      opts.onProgress?.(i, cols.length);
      await yieldToBrowser();
      if (opts.shouldStop?.()) {
        return { plans, completed: false };
      }
    }
    plans.set(cols[i], planAutoFit(makeInput(cols[i])));
  }
  return { plans, completed: true };
}
