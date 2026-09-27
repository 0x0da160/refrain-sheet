// SPDX-License-Identifier: MIT
/**
 * Argument readers and numeric helpers shared by the function groups.
 */
import {
  coerceToBoolean,
  coerceToNumber,
  coerceToText,
  errorValue,
  flattenGrid,
  type FormulaValue,
  makeGrid,
  MAX_ARRAY_CELLS,
  MAX_ARRAY_COLS,
  MAX_ARRAY_ROWS,
  type ValueGrid,
} from '../value';
import { type FnArg, type FnResult, type GridResult, isGrid } from './contract';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export const VALUE_ERR = errorValue('#VALUE!');
export const NA_ERR = errorValue('#N/A');
export const NUM_ERR = errorValue('#NUM!');
export const DIV0_ERR = errorValue('#DIV/0!');
export const REF_ERR = errorValue('#REF!');
export const CALC_ERR = errorValue('#CALC!');

/** Read an argument as a grid, or bail out with the error that stopped it. */
export function gridOf(arg: FnArg): GridResult {
  return arg.grid();
}

/** Read an argument as a number, or return the error to propagate. */
export function numberOf(arg: FnArg): { ok: true; n: number } | { ok: false; error: FormulaValue } {
  const v = arg.value();
  if (v.type === 'error') {
    return { ok: false, error: v };
  }
  const n = coerceToNumber(v);
  return n === null ? { ok: false, error: VALUE_ERR } : { ok: true, n };
}

/** Read an argument as text, or return the error to propagate. */
export function textOf(arg: FnArg): { ok: true; s: string } | { ok: false; error: FormulaValue } {
  const v = arg.value();
  if (v.type === 'error') {
    return { ok: false, error: v };
  }
  const s = coerceToText(v);
  return s === null ? { ok: false, error: VALUE_ERR } : { ok: true, s };
}

/**
 * Read an optional numeric argument: `fallback` when the slot is absent or
 * omitted (`FN(a,,c)`), the coerced number otherwise. `provided` distinguishes
 * "defaulted" from "explicitly supplied", for callers where that changes
 * behaviour beyond the numeric value itself (e.g. `INDEX`'s column axis).
 */
export function optionalNumber(
  args: readonly FnArg[],
  index: number,
  fallback: number,
): { ok: true; n: number; provided: boolean } | { ok: false; error: FormulaValue } {
  if (index >= args.length || args[index].isOmitted()) {
    return { ok: true, n: fallback, provided: false };
  }
  const n = numberOf(args[index]);
  return n.ok ? { ok: true, n: n.n, provided: true } : n;
}

/**
 * Read an optional boolean argument: `fallback` when the slot is absent or
 * omitted, the coerced boolean otherwise.
 */
export function optionalBoolean(
  args: readonly FnArg[],
  index: number,
  fallback: boolean,
): { ok: true; b: boolean } | { ok: false; error: FormulaValue } {
  if (index >= args.length || args[index].isOmitted()) {
    return { ok: true, b: fallback };
  }
  const v = args[index].value();
  if (v.type === 'error') {
    return { ok: false, error: v };
  }
  const b = coerceToBoolean(v);
  return b === null ? { ok: false, error: VALUE_ERR } : { ok: true, b };
}

/**
 * Collect the numeric contributions of one argument, preserving the engine's
 * long-standing split: **ranges and arrays** skip blanks and non-numeric text
 * (as conventional spreadsheets do), while a **scalar** argument must be
 * numeric-coercible. Errors abort and are returned.
 */
export function collectNumbers(arg: FnArg, out: number[]): FormulaValue | null {
  const g = gridOf(arg);
  if (!g.ok) {
    return g.error;
  }
  const grid = g.grid;
  const aggregate = arg.isRange() || grid.rows !== 1 || grid.cols !== 1;
  if (aggregate) {
    for (let r = 0; r < grid.rows; r++) {
      const row = grid.cells[r];
      for (let c = 0; c < grid.cols; c++) {
        const v = row[c];
        if (v.type === 'error') {
          return v;
        }
        if (v.type === 'number') {
          out.push(v.value);
        } else if (v.type === 'boolean') {
          out.push(v.value ? 1 : 0);
        }
        // Text and blanks inside a range or array are skipped.
      }
    }
    return null;
  }
  const v = grid.cells[0][0];
  if (v.type === 'error') {
    return v;
  }
  if (v.type === 'empty') {
    return null;
  }
  const n = coerceToNumber(v);
  if (n === null) {
    return VALUE_ERR;
  }
  out.push(n);
  return null;
}

/** Gather every value of every argument in row-major order. */
export function collectValues(args: readonly FnArg[], out: FormulaValue[]): FormulaValue | null {
  for (const arg of args) {
    const g = gridOf(arg);
    if (!g.ok) {
      return g.error;
    }
    for (const v of flattenGrid(g.grid)) {
      out.push(v);
    }
  }
  return null;
}

/** True when a value counts as blank for `COUNTA` / `COUNTBLANK` / `TEXTJOIN`. */
export function isBlank(value: FormulaValue): boolean {
  return value.type === 'empty';
}

/** Same shape? Used wherever paired ranges must line up. */
export function sameShape(a: ValueGrid, b: ValueGrid): boolean {
  return a.rows === b.rows && a.cols === b.cols;
}

/** Build a grid, refusing one that exceeds the documented dynamic-array caps. */
export function boundedGrid(cells: FormulaValue[][]): FnResult {
  const rows = cells.length;
  const cols = rows === 0 ? 0 : cells[0].length;
  if (rows === 0 || cols === 0) {
    return CALC_ERR;
  }
  if (rows > MAX_ARRAY_ROWS || cols > MAX_ARRAY_COLS || rows * cols > MAX_ARRAY_CELLS) {
    return NUM_ERR;
  }
  return makeGrid(cells);
}

/**
 * Collapse a grid that turned out to hold exactly one cell back to a scalar,
 * so `=FILTER(A1:A5, A1:A5>4)` matching one row is an ordinary value rather
 * than a 1×1 spill.
 */
export function gridOrScalar(result: FnResult): FnResult {
  if (isGrid(result) && result.rows === 1 && result.cols === 1) {
    return result.cells[0][0];
  }
  return result;
}

/** Extract a 1-D vector from a grid that is a single row or column. */
export function vectorOf(grid: ValueGrid): { values: FormulaValue[]; vertical: boolean } | null {
  if (grid.cols === 1) {
    const values: FormulaValue[] = [];
    for (let r = 0; r < grid.rows; r++) {
      values.push(grid.cells[r][0]);
    }
    return { values, vertical: true };
  }
  if (grid.rows === 1) {
    return { values: grid.cells[0].slice(), vertical: false };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Statistics helpers
// ---------------------------------------------------------------------------

/**
 * Sample or population standard deviation via **Welford's online algorithm**,
 * which accumulates the mean and the sum of squared deviations in one pass
 * without ever forming `sum(x²)`. The textbook `sqrt(E[x²] - E[x]²)` loses
 * catastrophically to cancellation on values of large magnitude and small
 * spread (`1e9, 1e9+1, 1e9+2` can even produce a negative variance); Welford
 * does not.
 */
export function standardDeviation(values: readonly number[], population: boolean): number | null {
  const n = values.length;
  const minimum = population ? 1 : 2;
  if (n < minimum) {
    return null;
  }
  let mean = 0;
  let m2 = 0;
  let count = 0;
  for (const x of values) {
    count += 1;
    const delta = x - mean;
    mean += delta / count;
    m2 += delta * (x - mean);
  }
  const divisor = population ? n : n - 1;
  return Math.sqrt(m2 / divisor);
}

/**
 * Round `value` to `digits` decimal places with the given rounding direction.
 *
 * Negative `digits` round to powers of ten left of the decimal point:
 * `ROUND(1234, -2)` is 1200. `'half'` rounds half **away from zero**
 * (`ROUND(-2.5, 0)` is -3), which is the spreadsheet convention and differs
 * from JavaScript's `Math.round`, which rounds half toward positive infinity.
 *
 * Scaling is done by multiplying by a power of ten and dividing back. That is
 * the conventional spreadsheet implementation and is what makes
 * `ROUND(2.675, 2)` produce 2.68 rather than the 2.67 a purely binary
 * treatment of the literal would give.
 */
export function roundTo(value: number, digits: number, mode: 'half' | 'up' | 'down'): number | null {
  if (!Number.isFinite(value) || !Number.isFinite(digits)) {
    return null;
  }
  const d = Math.trunc(digits);
  // Beyond ±308 the scale factor is 0 or Infinity; clamp to the identity /
  // zero results those extremes mean rather than producing NaN.
  if (d > 308) {
    return value;
  }
  if (d < -308) {
    return 0;
  }
  const factor = Math.pow(10, d);
  const scaled = value * factor;
  if (!Number.isFinite(scaled)) {
    return value;
  }
  let rounded: number;
  switch (mode) {
    case 'up':
      rounded = scaled < 0 ? Math.floor(scaled) : Math.ceil(scaled);
      break;
    case 'down':
      rounded = Math.trunc(scaled);
      break;
    case 'half': {
      // Away from zero on an exact half, with a tiny relative tolerance so a
      // value that is a half in decimal but a hair under it in binary still
      // rounds up (the 2.675 case).
      const abs = Math.abs(scaled);
      const frac = abs - Math.floor(abs);
      const up = frac > 0.5 || Math.abs(frac - 0.5) < 1e-9;
      const magnitude = up ? Math.floor(abs) + 1 : Math.floor(abs);
      rounded = scaled < 0 ? -magnitude : magnitude;
      break;
    }
  }
  const result = rounded / factor;
  return Number.isFinite(result) ? result : null;
}
