// SPDX-License-Identifier: MIT
/**
 * Numeric-series inference for AutoFill (fill handle / Fill command).
 *
 * Given the seed values of one fill lane (one column of a downward fill or
 * one row of a rightward fill), {@link inferLinearSeries} detects a linear
 * arithmetic progression from **at least two** numeric seeds — `1, 2, 3`
 * continues `4, 5, 6`; `2, 4` infers step `+2`; `10, 7` infers `-3` — and
 * {@link seriesValueAt} produces the continuation values.
 *
 * Documented fallback rules (implemented by the caller):
 * - One numeric seed: the value is copied (no implicit series).
 * - Formulas: never series-inferred; they keep reference translation.
 * - Non-numeric, mixed, or non-linear seeds: the existing copy/tile behavior.
 *
 * Precision: values are computed with decimal fixed-point arithmetic scaled
 * to the seeds' maximum number of decimal places, so `0.1, 0.2` continues
 * `0.3` (never `0.30000000000000004`). Integer seeds with uniform
 * zero-padding (`01, 02`) keep their padding width.
 */

export interface SeriesSpec {
  /** Value of the last seed (the series continues from here). */
  last: number;
  /** Constant difference between consecutive seeds. */
  step: number;
  /** Decimal places used to format continuation values. */
  decimals: number;
  /** Zero-padded minimum digit width (0 = no padding). */
  padWidth: number;
}

/** Longest decimal fraction the fixed-point math handles exactly. */
export const MAX_SERIES_DECIMALS = 10;

/** Strict numeric parse of a raw cell input for series inference. */
export function seriesNumber(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === '') {
    return null;
  }
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/** Decimal places of a plain decimal literal (0 for integers/exponents). */
function decimalsOf(input: string): number {
  const m = /^-?\d*\.(\d+)$/.exec(input.trim());
  return m ? Math.min(m[1].length, MAX_SERIES_DECIMALS) : 0;
}

/**
 * Detect an arithmetic progression in the seed inputs. Returns null unless
 * there are at least two seeds, every seed is numeric (formulas and text are
 * not), and the pairwise differences are constant — ambiguity is never
 * guessed at; the caller then falls back to plain copy/tile fill.
 */
export function inferLinearSeries(seeds: string[]): SeriesSpec | null {
  if (seeds.length < 2) {
    return null;
  }
  const values: number[] = [];
  let decimals = 0;
  for (const seed of seeds) {
    const n = seriesNumber(seed);
    if (n === null) {
      return null;
    }
    values.push(n);
    decimals = Math.max(decimals, decimalsOf(seed));
  }
  // Fixed-point comparison of steps at the seeds' own precision, so decimal
  // seeds like 0.1/0.2/0.3 (whose float diffs differ in the last bit) still
  // count as a constant step.
  const scale = 10 ** decimals;
  const scaled = values.map((v) => Math.round(v * scale));
  const step = scaled[1] - scaled[0];
  for (let i = 2; i < scaled.length; i++) {
    if (scaled[i] - scaled[i - 1] !== step) {
      return null;
    }
  }
  // Zero-padding is preserved only when every seed is an integer literal of
  // the same width beginning with '0' (e.g. 001, 002).
  let padWidth = 0;
  if (seeds.every((s) => /^-?0\d+$/.test(s.trim()))) {
    const widths = new Set(seeds.map((s) => s.trim().replace('-', '').length));
    if (widths.size === 1) {
      padWidth = [...widths][0];
    }
  }
  return { last: scaled[scaled.length - 1] / scale, step: step / scale, decimals, padWidth };
}

/**
 * The k-th continuation value (k = 1 is the first cell after the seeds),
 * formatted at the seeds' precision.
 */
export function seriesValueAt(spec: SeriesSpec, k: number): string {
  const scale = 10 ** spec.decimals;
  const value = (Math.round(spec.last * scale) + Math.round(spec.step * scale) * k) / scale;
  let text = spec.decimals > 0 ? value.toFixed(spec.decimals) : String(value);
  if (spec.padWidth > 0) {
    const negative = text.startsWith('-');
    const digits = negative ? text.slice(1) : text;
    text = (negative ? '-' : '') + digits.padStart(spec.padWidth, '0');
  }
  return text;
}
