// SPDX-License-Identifier: MIT
/**
 * The function registry: the single source of truth for every worksheet
 * function.
 *
 * One {@link FunctionDef} per function drives *all* of:
 *
 * - which names the parser accepts (anything else is `#NAME?`),
 * - argument-count validation,
 * - evaluation,
 * - the autocomplete popup,
 * - the offline help dialog's function table,
 * - the localized description key (`formula.fn.<NAME>` in `en.json` / `ja.json`).
 *
 * A function therefore cannot be implemented without being documented, or
 * documented without being implemented — `tests/formula-help.test.ts` asserts
 * exactly that, and the i18n parity test asserts both locales describe every
 * entry.
 *
 * ## Evaluation contract
 *
 * A function receives {@link FnArg} accessors, never pre-computed values. The
 * accessors are lazy and memoized, which is what lets `IF` and `IFERROR` skip
 * the branch they do not need — evaluating an unused branch could raise an
 * error the formula is specifically written to avoid.
 *
 * A function returns either a single {@link FormulaValue} or a
 * {@link ValueGrid}. Returning a grid makes the formula a **dynamic array**:
 * the workbook spills it across the worksheet (see `spill.ts`).
 *
 * Nothing here uses `eval`, `new Function`, regular expressions built from user
 * input, the network, or the DOM.
 */

import {
  compileWildcard,
  matchWildcard,
  matchesCriterion,
  parseCriterion,
  unescapeWildcard,
  type Criterion,
} from './formula-criteria';
import {
  dateDif,
  isDateDifUnit,
  nowSerial,
  partsToSerial,
  remapShortYear,
  serialToParts,
  todaySerial,
} from './formula-date';
import {
  boundedText,
  codePointLength,
  lastCodePoints,
  sliceCodePoints,
  substituteText,
  toCodePoints,
  trimText,
} from './formula-text';
import {
  booleanValue,
  coerceToBoolean,
  coerceToNumber,
  coerceToText,
  compareValues,
  equalityKey,
  errorValue,
  flattenGrid,
  makeGrid,
  MAX_ARRAY_CELLS,
  MAX_ARRAY_COLS,
  MAX_ARRAY_ROWS,
  MAX_CRITERIA_PAIRS,
  MAX_SORT_KEYS,
  MAX_TEXT_LENGTH,
  numberValue,
  textValue,
  valuesEqual,
  type FormulaValue,
  type ValueGrid,
} from './formula-value';

// ---------------------------------------------------------------------------
// The evaluation contract
// ---------------------------------------------------------------------------

/** A grid, or the error that prevented one from being produced. */
export type GridResult = { ok: true; grid: ValueGrid } | { ok: false; error: FormulaValue };

/** What a function returns: one value, or a grid that spills. */
export type FnResult = FormulaValue | ValueGrid;

/** True when a function result is a grid rather than a single value. */
export function isGrid(result: FnResult): result is ValueGrid {
  return (result as ValueGrid).cells !== undefined;
}

/**
 * One argument of a call, evaluated on demand and memoized by the evaluator.
 */
export interface FnArg {
  /**
   * The argument as a single value. A multi-cell range or array collapses to
   * `#VALUE!`, matching the engine's scalar semantics.
   */
  value(): FormulaValue;
  /** The argument as a rectangular grid; a single value becomes 1×1. */
  grid(): GridResult;
  /**
   * True when the argument is written as a **range** (`A1:B2`, `A:A`, `1:10`,
   * or a worksheet-qualified one). A single cell reference is not a range —
   * that distinction is what makes `SUM(A1)` with text in `A1` a `#VALUE!`
   * while `SUM(A1:A1)` skips the text, which is the pre-existing behaviour.
   */
  isRange(): boolean;
  /** True when the argument slot was left empty (`XLOOKUP(a,b,c,,2)`). */
  isOmitted(): boolean;
}

/** Per-recalculation context handed to volatile functions. */
export interface FnContext {
  /**
   * The wall-clock instant this recalculation pass reads, in milliseconds
   * since the Unix epoch. Fixed for the whole pass so every `NOW()` in a
   * workbook agrees, and injectable so tests are not clock-dependent.
   */
  readonly nowMs: number;
}

export interface FunctionDef {
  readonly name: string;
  /** Minimum argument count (inclusive). */
  readonly minArgs: number;
  /** Maximum argument count (inclusive); `Infinity` for variadic. */
  readonly maxArgs: number;
  /** Call signature shown in autocomplete and the help table. */
  readonly signature: string;
  /** A ready-to-read example formula shown in help. */
  readonly example: string;
  /** True when the result depends on the clock rather than on cells. */
  readonly volatile?: boolean;
  /** True when the function can return a grid (a dynamic array). */
  readonly dynamic?: boolean;
  readonly call: (args: readonly FnArg[], ctx: FnContext) => FnResult;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const VALUE_ERR = errorValue('#VALUE!');
const NA_ERR = errorValue('#N/A');
const NUM_ERR = errorValue('#NUM!');
const DIV0_ERR = errorValue('#DIV/0!');
const REF_ERR = errorValue('#REF!');
const CALC_ERR = errorValue('#CALC!');

/** Read an argument as a grid, or bail out with the error that stopped it. */
function gridOf(arg: FnArg): GridResult {
  return arg.grid();
}

/** Read an argument as a number, or return the error to propagate. */
function numberOf(arg: FnArg): { ok: true; n: number } | { ok: false; error: FormulaValue } {
  const v = arg.value();
  if (v.type === 'error') {
    return { ok: false, error: v };
  }
  const n = coerceToNumber(v);
  return n === null ? { ok: false, error: VALUE_ERR } : { ok: true, n };
}

/** Read an argument as text, or return the error to propagate. */
function textOf(arg: FnArg): { ok: true; s: string } | { ok: false; error: FormulaValue } {
  const v = arg.value();
  if (v.type === 'error') {
    return { ok: false, error: v };
  }
  const s = coerceToText(v);
  return s === null ? { ok: false, error: VALUE_ERR } : { ok: true, s };
}

/**
 * Collect the numeric contributions of one argument, preserving the engine's
 * long-standing split: **ranges and arrays** skip blanks and non-numeric text
 * (as conventional spreadsheets do), while a **scalar** argument must be
 * numeric-coercible. Errors abort and are returned.
 */
function collectNumbers(arg: FnArg, out: number[]): FormulaValue | null {
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
function collectValues(args: readonly FnArg[], out: FormulaValue[]): FormulaValue | null {
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
function isBlank(value: FormulaValue): boolean {
  return value.type === 'empty';
}

/** Same shape? Used wherever paired ranges must line up. */
function sameShape(a: ValueGrid, b: ValueGrid): boolean {
  return a.rows === b.rows && a.cols === b.cols;
}

/** Build a grid, refusing one that exceeds the documented dynamic-array caps. */
function boundedGrid(cells: FormulaValue[][]): FnResult {
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
function gridOrScalar(result: FnResult): FnResult {
  if (isGrid(result) && result.rows === 1 && result.cols === 1) {
    return result.cells[0][0];
  }
  return result;
}

/** Extract a 1-D vector from a grid that is a single row or column. */
function vectorOf(grid: ValueGrid): { values: FormulaValue[]; vertical: boolean } | null {
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
// Conditional aggregation
// ---------------------------------------------------------------------------

/**
 * Parse and validate the `criteria_range, criterion` pairs shared by
 * `COUNTIFS`, `SUMIFS`, and `AVERAGEIFS`. Every criteria range must have the
 * same shape as `shape` (the sum/average range, or the first criteria range
 * for `COUNTIFS`); a mismatch is `#VALUE!` rather than a silently misaligned
 * scan.
 */
type PairList =
  { ok: true; pairs: Array<{ grid: ValueGrid; criterion: Criterion }> } | { ok: false; error: FormulaValue };

function readCriteriaPairs(args: readonly FnArg[], from: number, shape: ValueGrid | null): PairList {
  const count = args.length - from;
  if (count <= 0 || count % 2 !== 0) {
    return { ok: false, error: errorValue('#ERROR!') };
  }
  if (count / 2 > MAX_CRITERIA_PAIRS) {
    return { ok: false, error: NUM_ERR };
  }
  const pairs: Array<{ grid: ValueGrid; criterion: Criterion }> = [];
  let reference = shape;
  for (let i = from; i < args.length; i += 2) {
    const g = gridOf(args[i]);
    if (!g.ok) {
      return { ok: false, error: g.error };
    }
    reference ??= g.grid;
    if (!sameShape(g.grid, reference)) {
      return { ok: false, error: VALUE_ERR };
    }
    const criterionValue = args[i + 1].value();
    if (criterionValue.type === 'error') {
      return { ok: false, error: criterionValue };
    }
    const parsed = parseCriterion(criterionValue);
    if (!parsed.ok) {
      return { ok: false, error: VALUE_ERR };
    }
    pairs.push({ grid: g.grid, criterion: parsed.criterion });
  }
  return { ok: true, pairs };
}

/**
 * Visit every position of the criteria shape, calling `hit` for positions that
 * satisfy every criterion. Returns the first error found in any criteria range
 * so it propagates instead of being silently skipped.
 */
function scanCriteria(
  pairs: Array<{ grid: ValueGrid; criterion: Criterion }>,
  hit: (row: number, col: number) => FormulaValue | null,
): FormulaValue | null {
  const shape = pairs[0].grid;
  for (let r = 0; r < shape.rows; r++) {
    for (let c = 0; c < shape.cols; c++) {
      let all = true;
      for (const pair of pairs) {
        const cell = pair.grid.cells[r][c];
        if (cell.type === 'error') {
          return cell;
        }
        if (!matchesCriterion(cell, pair.criterion)) {
          all = false;
          break;
        }
      }
      if (all) {
        const err = hit(r, c);
        if (err) {
          return err;
        }
      }
    }
  }
  return null;
}

/** `SUMIF` / `AVERAGEIF`: one criteria range, one criterion, one value range. */
function singleCriteriaAggregate(args: readonly FnArg[], mode: 'sum' | 'average'): FnResult {
  const criteriaGrid = gridOf(args[0]);
  if (!criteriaGrid.ok) {
    return criteriaGrid.error;
  }
  const criterionValue = args[1].value();
  if (criterionValue.type === 'error') {
    return criterionValue;
  }
  const parsed = parseCriterion(criterionValue);
  if (!parsed.ok) {
    return VALUE_ERR;
  }
  let valueGrid = criteriaGrid.grid;
  if (args.length >= 3 && !args[2].isOmitted()) {
    const g = gridOf(args[2]);
    if (!g.ok) {
      return g.error;
    }
    if (!sameShape(g.grid, criteriaGrid.grid)) {
      return VALUE_ERR;
    }
    valueGrid = g.grid;
  }
  return reduceMatches([{ grid: criteriaGrid.grid, criterion: parsed.criterion }], valueGrid, mode);
}

/** Sum or average the values of `valueGrid` at every matching position. */
function reduceMatches(
  pairs: Array<{ grid: ValueGrid; criterion: Criterion }>,
  valueGrid: ValueGrid,
  mode: 'sum' | 'average',
): FnResult {
  let total = 0;
  let count = 0;
  const err = scanCriteria(pairs, (r, c) => {
    const v = valueGrid.cells[r][c];
    if (v.type === 'error') {
      return v;
    }
    if (v.type === 'number') {
      total += v.value;
      count += 1;
    } else if (v.type === 'boolean') {
      total += v.value ? 1 : 0;
      count += 1;
    }
    // Text and blanks contribute nothing, as in conventional spreadsheets.
    return null;
  });
  if (err) {
    return err;
  }
  if (mode === 'sum') {
    return numberValue(total);
  }
  return count === 0 ? DIV0_ERR : numberValue(total / count);
}

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

/**
 * Find `needle` in `hay` using exact matching. `wildcards` enables `*` / `?`
 * against text values. Returns the 0-based index or -1.
 */
function findExact(
  hay: readonly FormulaValue[],
  needle: FormulaValue,
  wildcards: boolean,
  reverse: boolean,
): number {
  const pattern = wildcards && needle.type === 'string' ? compileWildcard(needle.value) : null;
  const literal =
    wildcards && needle.type === 'string' && pattern === null
      ? textValue(unescapeWildcard(needle.value))
      : needle;
  const test = (v: FormulaValue): boolean => {
    if (pattern) {
      const text = v.type === 'string' ? v.value : coerceToText(v);
      return text !== null && v.type !== 'error' && matchWildcard(pattern, text);
    }
    return valuesEqual(v, literal);
  };
  if (reverse) {
    for (let i = hay.length - 1; i >= 0; i--) {
      if (test(hay[i])) {
        return i;
      }
    }
    return -1;
  }
  for (let i = 0; i < hay.length; i++) {
    if (test(hay[i])) {
      return i;
    }
  }
  return -1;
}

/**
 * Approximate lookup: the index of the last value that does not exceed
 * `needle` (`direction` 1, for an **ascending** array) or the last value that
 * is not below it (`direction` -1, for a **descending** array).
 *
 * The scan is linear and forward, deliberately not a binary search. Binary
 * search on an unsorted array returns an arbitrary element that depends on the
 * array's length; a forward scan returns a value that is at least locally
 * consistent, and — crucially — is deterministic for every input, sorted or
 * not. Callers are documented as owing sorted input; unsorted input yields a
 * defined but not meaningful answer, never a crash and never a hang.
 *
 * Values that cannot be compared with the needle (a different type) are
 * skipped rather than terminating the scan.
 */
function findApproximate(hay: readonly FormulaValue[], needle: FormulaValue, direction: 1 | -1): number {
  let best = -1;
  for (let i = 0; i < hay.length; i++) {
    const v = hay[i];
    if (v.type === 'error' || v.type === 'empty') {
      continue;
    }
    if (!comparableKinds(v, needle)) {
      continue;
    }
    const cmp = compareValues(v, needle);
    if (direction === 1 ? cmp <= 0 : cmp >= 0) {
      best = i;
    }
  }
  return best;
}

/** True when two values sit in the same comparison family (numbers vs text). */
function comparableKinds(a: FormulaValue, b: FormulaValue): boolean {
  const fam = (v: FormulaValue): number =>
    v.type === 'number' || v.type === 'boolean' ? 0 : v.type === 'string' ? 1 : 2;
  return fam(a) === fam(b);
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
function standardDeviation(values: readonly number[], population: boolean): number | null {
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
function roundTo(value: number, digits: number, mode: 'half' | 'up' | 'down'): number | null {
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

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

const DEFS: FunctionDef[] = [];

function def(entry: FunctionDef): void {
  DEFS.push(entry);
}

// ----- Pre-existing aggregation (behaviour preserved exactly) -----

for (const name of ['SUM', 'AVERAGE', 'MIN', 'MAX', 'COUNT'] as const) {
  def({
    name,
    // Zero arguments has always been accepted here (`=SUM()` is 0), and
    // changing that would break existing workbooks for no gain.
    minArgs: 0,
    maxArgs: Infinity,
    signature: `${name}(value, …)`,
    example: name === 'AVERAGE' ? '=AVERAGE(B1:B20)' : `=${name}(A1:A10)`,
    call: (args) => {
      const numbers: number[] = [];
      for (const arg of args) {
        const err = name === 'COUNT' ? collectCount(arg, numbers) : collectNumbers(arg, numbers);
        if (err) {
          return err;
        }
      }
      switch (name) {
        case 'SUM':
          return numberValue(numbers.reduce((a, b) => a + b, 0));
        case 'AVERAGE':
          return numbers.length === 0
            ? DIV0_ERR
            : numberValue(numbers.reduce((a, b) => a + b, 0) / numbers.length);
        case 'MIN':
          return numberValue(numbers.length === 0 ? 0 : minOf(numbers));
        case 'MAX':
          return numberValue(numbers.length === 0 ? 0 : maxOf(numbers));
        case 'COUNT':
          return numberValue(numbers.length);
      }
    },
  });
}

/** `COUNT` counts numeric values only; unlike `SUM` it ignores non-numeric scalars. */
function collectCount(arg: FnArg, out: number[]): FormulaValue | null {
  if (arg.isRange()) {
    return collectNumbers(arg, out);
  }
  const g = gridOf(arg);
  if (!g.ok) {
    return g.error;
  }
  if (g.grid.rows !== 1 || g.grid.cols !== 1) {
    return collectNumbers(arg, out);
  }
  const v = g.grid.cells[0][0];
  if (v.type === 'error') {
    return v;
  }
  const n = coerceToNumber(v);
  if (n !== null && v.type !== 'empty') {
    out.push(n);
  }
  return null;
}

/** Loop-based min/max: `Math.min(...xs)` overflows the argument limit on large ranges. */
function minOf(values: readonly number[]): number {
  let m = values[0];
  for (const v of values) {
    if (v < m) m = v;
  }
  return m;
}

function maxOf(values: readonly number[]): number {
  let m = values[0];
  for (const v of values) {
    if (v > m) m = v;
  }
  return m;
}

def({
  name: 'IF',
  minArgs: 2,
  maxArgs: 3,
  signature: 'IF(condition, then, else)',
  example: '=IF(A1>10, "big", "small")',
  call: (args) => {
    const cond = args[0].value();
    if (cond.type === 'error') {
      return cond;
    }
    const truthy = coerceToBoolean(cond);
    if (truthy === null) {
      return VALUE_ERR;
    }
    // Only the taken branch is evaluated: the other may legitimately error.
    if (truthy) {
      return args[1].value();
    }
    return args.length > 2 ? args[2].value() : booleanValue(false);
  },
});

// ----- Priority A: counting and conditional aggregation -----

def({
  name: 'COUNTA',
  minArgs: 1,
  maxArgs: Infinity,
  signature: 'COUNTA(value, …)',
  example: '=COUNTA(A1:A10)',
  call: (args) => {
    const values: FormulaValue[] = [];
    const err = collectValues(args, values);
    if (err) {
      return err;
    }
    // COUNTA counts everything that is not blank — including errors, which is
    // the documented conventional behaviour (an error *is* a value).
    let n = 0;
    for (const v of values) {
      if (!isBlank(v)) {
        n += 1;
      }
    }
    return numberValue(n);
  },
});

def({
  name: 'COUNTBLANK',
  minArgs: 1,
  maxArgs: 1,
  signature: 'COUNTBLANK(range)',
  example: '=COUNTBLANK(A1:A10)',
  call: (args) => {
    const g = gridOf(args[0]);
    if (!g.ok) {
      return g.error;
    }
    let n = 0;
    for (const v of flattenGrid(g.grid)) {
      // A cell holding the empty string counts as blank, matching the
      // conventional behaviour for a formula that returned "".
      if (v.type === 'empty' || (v.type === 'string' && v.value === '')) {
        n += 1;
      }
    }
    return numberValue(n);
  },
});

def({
  name: 'COUNTIF',
  minArgs: 2,
  maxArgs: 2,
  signature: 'COUNTIF(range, criterion)',
  example: '=COUNTIF(A1:A10, ">10")',
  call: (args) => {
    const pairs = readCriteriaPairs(args, 0, null);
    if (!pairs.ok) {
      return pairs.error;
    }
    let n = 0;
    const err = scanCriteria(pairs.pairs, () => {
      n += 1;
      return null;
    });
    return err ?? numberValue(n);
  },
});

def({
  name: 'COUNTIFS',
  minArgs: 2,
  maxArgs: Infinity,
  signature: 'COUNTIFS(range1, criterion1, …)',
  example: '=COUNTIFS(A1:A10, ">10", B1:B10, "yes")',
  call: (args) => {
    const pairs = readCriteriaPairs(args, 0, null);
    if (!pairs.ok) {
      return pairs.error;
    }
    let n = 0;
    const err = scanCriteria(pairs.pairs, () => {
      n += 1;
      return null;
    });
    return err ?? numberValue(n);
  },
});

def({
  name: 'SUMIF',
  minArgs: 2,
  maxArgs: 3,
  signature: 'SUMIF(range, criterion, [sum_range])',
  example: '=SUMIF(A1:A10, ">10", B1:B10)',
  call: (args) => singleCriteriaAggregate(args, 'sum'),
});

def({
  name: 'AVERAGEIF',
  minArgs: 2,
  maxArgs: 3,
  signature: 'AVERAGEIF(range, criterion, [average_range])',
  example: '=AVERAGEIF(A1:A10, ">10", B1:B10)',
  call: (args) => singleCriteriaAggregate(args, 'average'),
});

for (const name of ['SUMIFS', 'AVERAGEIFS'] as const) {
  const mode = name === 'SUMIFS' ? 'sum' : 'average';
  def({
    name,
    minArgs: 3,
    maxArgs: Infinity,
    signature: `${name}(${mode}_range, range1, criterion1, …)`,
    example: `=${name}(C1:C10, A1:A10, ">10", B1:B10, "yes")`,
    call: (args) => {
      const valueGrid = gridOf(args[0]);
      if (!valueGrid.ok) {
        return valueGrid.error;
      }
      const pairs = readCriteriaPairs(args, 1, valueGrid.grid);
      if (!pairs.ok) {
        return pairs.error;
      }
      return reduceMatches(pairs.pairs, valueGrid.grid, mode);
    },
  });
}

// ----- Priority A: logical and error handling -----

for (const name of ['AND', 'OR'] as const) {
  def({
    name,
    minArgs: 1,
    maxArgs: Infinity,
    signature: `${name}(logical1, …)`,
    example: name === 'AND' ? '=AND(A1>0, B1<10)' : '=OR(A1>0, B1<10)',
    call: (args) => {
      const values: FormulaValue[] = [];
      const err = collectValues(args, values);
      if (err) {
        return err;
      }
      let seen = 0;
      let result = name === 'AND';
      for (const v of values) {
        if (v.type === 'error') {
          return v;
        }
        // Text and blanks inside a range are ignored, as in conventional
        // spreadsheets; a bare text scalar is still a #VALUE!.
        if (v.type === 'empty') {
          continue;
        }
        const b = coerceToBoolean(v);
        if (b === null) {
          if (values.length === 1) {
            return VALUE_ERR;
          }
          continue;
        }
        seen += 1;
        result = name === 'AND' ? result && b : result || b;
      }
      return seen === 0 ? VALUE_ERR : booleanValue(result);
    },
  });
}

def({
  name: 'NOT',
  minArgs: 1,
  maxArgs: 1,
  signature: 'NOT(logical)',
  example: '=NOT(A1>10)',
  call: (args) => {
    const v = args[0].value();
    if (v.type === 'error') {
      return v;
    }
    const b = coerceToBoolean(v);
    return b === null ? VALUE_ERR : booleanValue(!b);
  },
});

def({
  name: 'IFERROR',
  minArgs: 2,
  maxArgs: 2,
  signature: 'IFERROR(value, value_if_error)',
  example: '=IFERROR(A1/B1, 0)',
  dynamic: true,
  call: (args) => {
    // The fallback is evaluated only when needed, and the first argument is
    // read as a grid so that an erroring dynamic array is caught too.
    const g = args[0].grid();
    if (!g.ok) {
      return args[1].value();
    }
    if (g.grid.rows === 1 && g.grid.cols === 1) {
      const v = g.grid.cells[0][0];
      return v.type === 'error' ? args[1].value() : v;
    }
    // For an array, any error anywhere is replaced cell by cell, so a single
    // bad row does not discard the whole result.
    const fallback = args[1].value();
    const cells = g.grid.cells.map((row) => row.map((v) => (v.type === 'error' ? fallback : v)));
    return makeGrid(cells);
  },
});

// ----- Priority A: math and rounding -----

for (const [name, mode] of [
  ['ROUND', 'half'],
  ['ROUNDUP', 'up'],
  ['ROUNDDOWN', 'down'],
] as const) {
  def({
    name,
    minArgs: 1,
    maxArgs: 2,
    signature: `${name}(number, num_digits)`,
    example: `=${name}(A1, 2)`,
    call: (args) => {
      const n = numberOf(args[0]);
      if (!n.ok) {
        return n.error;
      }
      let digits = 0;
      if (args.length > 1 && !args[1].isOmitted()) {
        const d = numberOf(args[1]);
        if (!d.ok) {
          return d.error;
        }
        digits = d.n;
      }
      const result = roundTo(n.n, digits, mode);
      return result === null ? NUM_ERR : numberValue(result);
    },
  });
}

def({
  name: 'ABS',
  minArgs: 1,
  maxArgs: 1,
  signature: 'ABS(number)',
  example: '=ABS(A1)',
  call: (args) => {
    const n = numberOf(args[0]);
    return n.ok ? numberValue(Math.abs(n.n)) : n.error;
  },
});

def({
  name: 'MOD',
  minArgs: 2,
  maxArgs: 2,
  signature: 'MOD(number, divisor)',
  example: '=MOD(A1, 3)',
  call: (args) => {
    const a = numberOf(args[0]);
    if (!a.ok) {
      return a.error;
    }
    const b = numberOf(args[1]);
    if (!b.ok) {
      return b.error;
    }
    if (b.n === 0) {
      return DIV0_ERR;
    }
    // Spreadsheet MOD takes the sign of the divisor, unlike JavaScript's `%`
    // which takes the sign of the dividend: MOD(-3, 2) is 1, not -1.
    return numberValue(a.n - b.n * Math.floor(a.n / b.n));
  },
});

// ----- Priority B: lookup and reference -----

def({
  name: 'XLOOKUP',
  minArgs: 3,
  maxArgs: 6,
  signature: 'XLOOKUP(lookup, lookup_array, return_array, [if_not_found], [match_mode], [search_mode])',
  example: '=XLOOKUP(A1, B1:B10, C1:C10, "none")',
  dynamic: true,
  call: (args) => {
    const needle = args[0].value();
    if (needle.type === 'error') {
      return needle;
    }
    const lookupGrid = gridOf(args[1]);
    if (!lookupGrid.ok) {
      return lookupGrid.error;
    }
    const returnGrid = gridOf(args[2]);
    if (!returnGrid.ok) {
      return returnGrid.error;
    }
    const vector = vectorOf(lookupGrid.grid);
    if (!vector) {
      return VALUE_ERR; // lookup_array must be a single row or column
    }
    // Supported modes only; an unsupported one is refused rather than
    // silently downgraded to a different search.
    let matchMode = 0;
    if (args.length > 4 && !args[4].isOmitted()) {
      const m = numberOf(args[4]);
      if (!m.ok) {
        return m.error;
      }
      matchMode = Math.trunc(m.n);
      if (matchMode !== 0 && matchMode !== 2) {
        return VALUE_ERR; // -1 / 1 (approximate) are not implemented
      }
    }
    let searchMode = 1;
    if (args.length > 5 && !args[5].isOmitted()) {
      const s = numberOf(args[5]);
      if (!s.ok) {
        return s.error;
      }
      searchMode = Math.trunc(s.n);
      if (searchMode !== 1 && searchMode !== -1) {
        return VALUE_ERR; // 2 / -2 (binary search) are not implemented
      }
    }
    // The return array must line up with the lookup array along the search
    // axis; the other axis may be wider, which is what lets XLOOKUP return a
    // whole record as a spilled array.
    const along = vector.vertical ? returnGrid.grid.rows : returnGrid.grid.cols;
    if (along !== vector.values.length) {
      return VALUE_ERR;
    }
    const index = findExact(vector.values, needle, matchMode === 2, searchMode === -1);
    if (index < 0) {
      return args.length > 3 && !args[3].isOmitted() ? args[3].value() : NA_ERR;
    }
    const cells = vector.vertical
      ? [returnGrid.grid.cells[index].slice()]
      : returnGrid.grid.cells.map((row) => [row[index]]);
    return gridOrScalar(makeGrid(cells));
  },
});

def({
  name: 'VLOOKUP',
  minArgs: 3,
  maxArgs: 4,
  signature: 'VLOOKUP(lookup, table, col_index, [range_lookup])',
  example: '=VLOOKUP(A1, B1:D10, 3, FALSE)',
  call: (args) => {
    const needle = args[0].value();
    if (needle.type === 'error') {
      return needle;
    }
    const table = gridOf(args[1]);
    if (!table.ok) {
      return table.error;
    }
    const colArg = numberOf(args[2]);
    if (!colArg.ok) {
      return colArg.error;
    }
    const col = Math.trunc(colArg.n);
    if (col < 1) {
      return VALUE_ERR;
    }
    if (col > table.grid.cols) {
      return REF_ERR;
    }
    // Approximate is the default, matching conventional spreadsheets.
    let approximate = true;
    if (args.length > 3 && !args[3].isOmitted()) {
      const v = args[3].value();
      if (v.type === 'error') {
        return v;
      }
      const b = coerceToBoolean(v);
      if (b === null) {
        return VALUE_ERR;
      }
      approximate = b;
    }
    const firstColumn: FormulaValue[] = [];
    for (let r = 0; r < table.grid.rows; r++) {
      firstColumn.push(table.grid.cells[r][0]);
    }
    const index = approximate
      ? findApproximate(firstColumn, needle, 1)
      : findExact(firstColumn, needle, true, false);
    return index < 0 ? NA_ERR : table.grid.cells[index][col - 1];
  },
});

def({
  name: 'MATCH',
  minArgs: 2,
  maxArgs: 3,
  signature: 'MATCH(lookup, lookup_array, [match_type])',
  example: '=MATCH(A1, B1:B10, 0)',
  call: (args) => {
    const needle = args[0].value();
    if (needle.type === 'error') {
      return needle;
    }
    const g = gridOf(args[1]);
    if (!g.ok) {
      return g.error;
    }
    const vector = vectorOf(g.grid);
    if (!vector) {
      return VALUE_ERR;
    }
    let matchType = 1;
    if (args.length > 2 && !args[2].isOmitted()) {
      const m = numberOf(args[2]);
      if (!m.ok) {
        return m.error;
      }
      matchType = Math.trunc(m.n);
      if (matchType !== 0 && matchType !== 1 && matchType !== -1) {
        return VALUE_ERR;
      }
    }
    const index =
      matchType === 0
        ? findExact(vector.values, needle, true, false)
        : findApproximate(vector.values, needle, matchType === 1 ? 1 : -1);
    return index < 0 ? NA_ERR : numberValue(index + 1);
  },
});

def({
  name: 'INDEX',
  minArgs: 2,
  maxArgs: 3,
  signature: 'INDEX(array, row_num, [column_num])',
  example: '=INDEX(A1:C10, 2, 3)',
  dynamic: true,
  call: (args) => {
    const g = gridOf(args[0]);
    if (!g.ok) {
      return g.error;
    }
    const grid = g.grid;
    const rowArg = numberOf(args[1]);
    if (!rowArg.ok) {
      return rowArg.error;
    }
    const first = Math.trunc(rowArg.n);
    const hasCol = args.length > 2 && !args[2].isOmitted();
    let second = 0;
    if (hasCol) {
      const colArg = numberOf(args[2]);
      if (!colArg.ok) {
        return colArg.error;
      }
      second = Math.trunc(colArg.n);
    }
    // A single row or column with one index selects along its own axis, which
    // is what makes the INDEX/MATCH idiom read naturally.
    if (!hasCol && (grid.rows === 1 || grid.cols === 1)) {
      const flat = flattenGrid(grid);
      if (first === 0) {
        return grid;
      }
      if (first < 1 || first > flat.length) {
        return REF_ERR;
      }
      return flat[first - 1];
    }
    if (first < 0 || first > grid.rows || second < 0 || second > grid.cols) {
      return REF_ERR;
    }
    // Index 0 means "the whole row" / "the whole column".
    if (first === 0 && second === 0) {
      return grid;
    }
    if (first === 0) {
      return gridOrScalar(makeGrid(grid.cells.map((row) => [row[second - 1]])));
    }
    if (second === 0 || !hasCol) {
      return gridOrScalar(makeGrid([grid.cells[first - 1].slice()]));
    }
    return grid.cells[first - 1][second - 1];
  },
});

// ----- Priority B: text -----

for (const name of ['LEFT', 'RIGHT'] as const) {
  def({
    name,
    minArgs: 1,
    maxArgs: 2,
    signature: `${name}(text, [num_chars])`,
    example: `=${name}(A1, 3)`,
    call: (args) => {
      const t = textOf(args[0]);
      if (!t.ok) {
        return t.error;
      }
      let count = 1;
      if (args.length > 1 && !args[1].isOmitted()) {
        const n = numberOf(args[1]);
        if (!n.ok) {
          return n.error;
        }
        count = Math.trunc(n.n);
        if (count < 0) {
          return VALUE_ERR;
        }
      }
      return textValue(name === 'LEFT' ? sliceCodePoints(t.s, 0, count) : lastCodePoints(t.s, count));
    },
  });
}

def({
  name: 'MID',
  minArgs: 3,
  maxArgs: 3,
  signature: 'MID(text, start_num, num_chars)',
  example: '=MID(A1, 2, 3)',
  call: (args) => {
    const t = textOf(args[0]);
    if (!t.ok) {
      return t.error;
    }
    const start = numberOf(args[1]);
    if (!start.ok) {
      return start.error;
    }
    const count = numberOf(args[2]);
    if (!count.ok) {
      return count.error;
    }
    const s = Math.trunc(start.n);
    const n = Math.trunc(count.n);
    if (s < 1 || n < 0) {
      return VALUE_ERR;
    }
    return textValue(sliceCodePoints(t.s, s - 1, n));
  },
});

def({
  name: 'LEN',
  minArgs: 1,
  maxArgs: 1,
  signature: 'LEN(text)',
  example: '=LEN(A1)',
  call: (args) => {
    const t = textOf(args[0]);
    return t.ok ? numberValue(codePointLength(t.s)) : t.error;
  },
});

def({
  name: 'TRIM',
  minArgs: 1,
  maxArgs: 1,
  signature: 'TRIM(text)',
  example: '=TRIM(A1)',
  call: (args) => {
    const t = textOf(args[0]);
    return t.ok ? textValue(trimText(t.s)) : t.error;
  },
});

for (const name of ['UPPER', 'LOWER'] as const) {
  def({
    name,
    minArgs: 1,
    maxArgs: 1,
    signature: `${name}(text)`,
    example: `=${name}(A1)`,
    call: (args) => {
      const t = textOf(args[0]);
      if (!t.ok) {
        return t.error;
      }
      // Locale-independent case mapping: a locale-aware fold would make a
      // workbook's values depend on the host's language.
      return textValue(name === 'UPPER' ? t.s.toUpperCase() : t.s.toLowerCase());
    },
  });
}

def({
  name: 'CONCAT',
  minArgs: 1,
  maxArgs: Infinity,
  signature: 'CONCAT(text1, …)',
  example: '=CONCAT(A1:A3)',
  call: (args) => {
    const values: FormulaValue[] = [];
    const err = collectValues(args, values);
    if (err) {
      return err;
    }
    let out = '';
    for (const v of values) {
      if (v.type === 'error') {
        return v;
      }
      out += coerceToText(v) ?? '';
      if (out.length > MAX_TEXT_LENGTH) {
        return VALUE_ERR;
      }
    }
    const bounded = boundedText(out);
    return bounded === null ? VALUE_ERR : textValue(bounded);
  },
});

def({
  name: 'TEXTJOIN',
  minArgs: 3,
  maxArgs: Infinity,
  signature: 'TEXTJOIN(delimiter, ignore_empty, text1, …)',
  example: '=TEXTJOIN(", ", TRUE, A1:A10)',
  call: (args) => {
    const delim = textOf(args[0]);
    if (!delim.ok) {
      return delim.error;
    }
    const flagValue = args[1].value();
    if (flagValue.type === 'error') {
      return flagValue;
    }
    const ignoreEmpty = coerceToBoolean(flagValue);
    if (ignoreEmpty === null) {
      return VALUE_ERR;
    }
    const values: FormulaValue[] = [];
    const err = collectValues(args.slice(2), values);
    if (err) {
      return err;
    }
    const parts: string[] = [];
    let length = 0;
    for (const v of values) {
      if (v.type === 'error') {
        return v;
      }
      const text = coerceToText(v) ?? '';
      if (ignoreEmpty && text === '') {
        continue;
      }
      parts.push(text);
      length += text.length + delim.s.length;
      if (length > MAX_TEXT_LENGTH) {
        return VALUE_ERR;
      }
    }
    const bounded = boundedText(parts.join(delim.s));
    return bounded === null ? VALUE_ERR : textValue(bounded);
  },
});

def({
  name: 'SUBSTITUTE',
  minArgs: 3,
  maxArgs: 4,
  signature: 'SUBSTITUTE(text, old_text, new_text, [instance_num])',
  example: '=SUBSTITUTE(A1, "-", "/")',
  call: (args) => {
    const text = textOf(args[0]);
    if (!text.ok) {
      return text.error;
    }
    const oldText = textOf(args[1]);
    if (!oldText.ok) {
      return oldText.error;
    }
    const newText = textOf(args[2]);
    if (!newText.ok) {
      return newText.error;
    }
    let instance: number | undefined;
    if (args.length > 3 && !args[3].isOmitted()) {
      const n = numberOf(args[3]);
      if (!n.ok) {
        return n.error;
      }
      instance = Math.trunc(n.n);
      if (instance < 1) {
        return VALUE_ERR;
      }
    }
    const result = substituteText(text.s, oldText.s, newText.s, instance);
    return result === null ? VALUE_ERR : textValue(result);
  },
});

def({
  name: 'REPLACE',
  minArgs: 4,
  maxArgs: 4,
  signature: 'REPLACE(old_text, start_num, num_chars, new_text)',
  example: '=REPLACE(A1, 1, 3, "abc")',
  call: (args) => {
    const oldText = textOf(args[0]);
    if (!oldText.ok) {
      return oldText.error;
    }
    const start = numberOf(args[1]);
    if (!start.ok) {
      return start.error;
    }
    const count = numberOf(args[2]);
    if (!count.ok) {
      return count.error;
    }
    const newText = textOf(args[3]);
    if (!newText.ok) {
      return newText.error;
    }
    const s = Math.trunc(start.n);
    const n = Math.trunc(count.n);
    if (s < 1 || n < 0) {
      return VALUE_ERR;
    }
    const points = toCodePoints(oldText.s);
    const head = points.slice(0, s - 1).join('');
    const tail = points.slice(s - 1 + n).join('');
    const bounded = boundedText(head + newText.s + tail);
    return bounded === null ? VALUE_ERR : textValue(bounded);
  },
});

// ----- Priority C: date and time -----

def({
  name: 'TODAY',
  minArgs: 0,
  maxArgs: 0,
  signature: 'TODAY()',
  example: '=TODAY()',
  volatile: true,
  call: (_args, ctx) => numberValue(todaySerial(ctx.nowMs)),
});

def({
  name: 'NOW',
  minArgs: 0,
  maxArgs: 0,
  signature: 'NOW()',
  example: '=NOW()',
  volatile: true,
  call: (_args, ctx) => numberValue(nowSerial(ctx.nowMs)),
});

def({
  name: 'DATE',
  minArgs: 3,
  maxArgs: 3,
  signature: 'DATE(year, month, day)',
  example: '=DATE(2026, 7, 25)',
  call: (args) => {
    const y = numberOf(args[0]);
    if (!y.ok) {
      return y.error;
    }
    const m = numberOf(args[1]);
    if (!m.ok) {
      return m.error;
    }
    const d = numberOf(args[2]);
    if (!d.ok) {
      return d.error;
    }
    // DATE's own two-digit-year rule runs first; the serial scale itself does
    // no year remapping.
    const year = remapShortYear(y.n);
    if (year === null) {
      return NUM_ERR;
    }
    const serial = partsToSerial(year, m.n, d.n);
    return serial === null ? NUM_ERR : numberValue(serial);
  },
});

for (const name of ['YEAR', 'MONTH', 'DAY'] as const) {
  def({
    name,
    minArgs: 1,
    maxArgs: 1,
    signature: `${name}(serial_number)`,
    example: `=${name}(A1)`,
    call: (args) => {
      const n = numberOf(args[0]);
      if (!n.ok) {
        return n.error;
      }
      const parts = serialToParts(n.n);
      if (!parts) {
        return NUM_ERR;
      }
      return numberValue(name === 'YEAR' ? parts.year : name === 'MONTH' ? parts.month : parts.day);
    },
  });
}

def({
  name: 'DATEDIF',
  minArgs: 3,
  maxArgs: 3,
  signature: 'DATEDIF(start_date, end_date, unit)',
  example: '=DATEDIF(A1, B1, "Y")',
  call: (args) => {
    const start = numberOf(args[0]);
    if (!start.ok) {
      return start.error;
    }
    const end = numberOf(args[1]);
    if (!end.ok) {
      return end.error;
    }
    const unitText = textOf(args[2]);
    if (!unitText.ok) {
      return unitText.error;
    }
    const unit = unitText.s.trim().toUpperCase();
    if (!isDateDifUnit(unit)) {
      return VALUE_ERR;
    }
    const result = dateDif(start.n, end.n, unit);
    return result === null ? NUM_ERR : numberValue(result);
  },
});

// ----- Priority C: statistics -----

def({
  name: 'MEDIAN',
  minArgs: 1,
  maxArgs: Infinity,
  signature: 'MEDIAN(number1, …)',
  example: '=MEDIAN(A1:A10)',
  call: (args) => {
    const numbers: number[] = [];
    for (const arg of args) {
      const err = collectNumbers(arg, numbers);
      if (err) {
        return err;
      }
    }
    if (numbers.length === 0) {
      return NUM_ERR;
    }
    const sorted = numbers.slice().sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return numberValue(sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
  },
});

def({
  name: 'MODE.SNGL',
  minArgs: 1,
  maxArgs: Infinity,
  signature: 'MODE.SNGL(number1, …)',
  example: '=MODE.SNGL(A1:A10)',
  call: (args) => {
    const numbers: number[] = [];
    for (const arg of args) {
      const err = collectNumbers(arg, numbers);
      if (err) {
        return err;
      }
    }
    const counts = new Map<number, number>();
    let best: number | null = null;
    let bestCount = 1;
    for (const n of numbers) {
      const c = (counts.get(n) ?? 0) + 1;
      counts.set(n, c);
      // Strictly greater keeps the *first* value to reach the highest count,
      // which makes ties deterministic and order-dependent in the documented
      // way (earliest wins).
      if (c > bestCount) {
        bestCount = c;
        best = n;
      }
    }
    return best === null ? NA_ERR : numberValue(best);
  },
});

for (const name of ['STDEV.S', 'STDEV.P'] as const) {
  const population = name === 'STDEV.P';
  def({
    name,
    minArgs: 1,
    maxArgs: Infinity,
    signature: `${name}(number1, …)`,
    example: `=${name}(A1:A10)`,
    call: (args) => {
      const numbers: number[] = [];
      for (const arg of args) {
        const err = collectNumbers(arg, numbers);
        if (err) {
          return err;
        }
      }
      const result = standardDeviation(numbers, population);
      // STDEV.S needs at least two values and STDEV.P at least one; anything
      // less is #DIV/0!, the conventional error for an empty divisor.
      return result === null ? DIV0_ERR : numberValue(result);
    },
  });
}

def({
  name: 'RANK.EQ',
  minArgs: 2,
  maxArgs: 3,
  signature: 'RANK.EQ(number, ref, [order])',
  example: '=RANK.EQ(A1, A1:A10)',
  call: (args) => {
    const target = numberOf(args[0]);
    if (!target.ok) {
      return target.error;
    }
    const numbers: number[] = [];
    const err = collectNumbers(args[1], numbers);
    if (err) {
      return err;
    }
    let ascending = false;
    if (args.length > 2 && !args[2].isOmitted()) {
      const o = numberOf(args[2]);
      if (!o.ok) {
        return o.error;
      }
      ascending = o.n !== 0;
    }
    if (!numbers.includes(target.n)) {
      return NA_ERR;
    }
    // Ties share the best (lowest) rank, and the ranks that would have
    // followed are skipped — the "EQ" in the name.
    let better = 0;
    for (const n of numbers) {
      if (ascending ? n < target.n : n > target.n) {
        better += 1;
      }
    }
    return numberValue(better + 1);
  },
});

// ----- Dynamic arrays -----

def({
  name: 'FILTER',
  minArgs: 2,
  maxArgs: 3,
  signature: 'FILTER(array, include, [if_empty])',
  example: '=FILTER(A1:C10, B1:B10>5)',
  dynamic: true,
  call: (args) => {
    const source = gridOf(args[0]);
    if (!source.ok) {
      return source.error;
    }
    const include = gridOf(args[1]);
    if (!include.ok) {
      return include.error;
    }
    const grid = source.grid;
    const mask = include.grid;
    // The mask is a single column (keep rows) or a single row (keep columns),
    // and its length must equal the matching dimension of the source.
    const byRow = mask.cols === 1 && mask.rows === grid.rows;
    const byCol = mask.rows === 1 && mask.cols === grid.cols;
    if (!byRow && !byCol) {
      return VALUE_ERR;
    }
    // A single-value mask cannot select among several rows or columns; it
    // would otherwise be read as a whole-array keep-or-drop, which silently
    // hides a mistyped condition range.
    if (mask.rows === 1 && mask.cols === 1 && (grid.rows > 1 || grid.cols > 1)) {
      return VALUE_ERR;
    }
    if (byRow && byCol && grid.rows !== grid.cols) {
      return VALUE_ERR;
    }
    const keep: number[] = [];
    const length = byRow ? mask.rows : mask.cols;
    for (let i = 0; i < length; i++) {
      const v = byRow ? mask.cells[i][0] : mask.cells[0][i];
      if (v.type === 'error') {
        return v;
      }
      const b = coerceToBoolean(v);
      if (b === null) {
        return VALUE_ERR;
      }
      if (b) {
        keep.push(i);
      }
    }
    if (keep.length === 0) {
      return args.length > 2 && !args[2].isOmitted() ? args[2].value() : CALC_ERR;
    }
    const cells = byRow
      ? keep.map((r) => grid.cells[r].slice())
      : grid.cells.map((row) => keep.map((c) => row[c]));
    return gridOrScalar(boundedGrid(cells));
  },
});

def({
  name: 'UNIQUE',
  minArgs: 1,
  maxArgs: 3,
  signature: 'UNIQUE(array, [by_column], [exactly_once])',
  example: '=UNIQUE(A1:A10)',
  dynamic: true,
  call: (args) => {
    const source = gridOf(args[0]);
    if (!source.ok) {
      return source.error;
    }
    let byColumn = false;
    if (args.length > 1 && !args[1].isOmitted()) {
      const v = args[1].value();
      if (v.type === 'error') {
        return v;
      }
      const b = coerceToBoolean(v);
      if (b === null) {
        return VALUE_ERR;
      }
      byColumn = b;
    }
    let exactlyOnce = false;
    if (args.length > 2 && !args[2].isOmitted()) {
      const v = args[2].value();
      if (v.type === 'error') {
        return v;
      }
      const b = coerceToBoolean(v);
      if (b === null) {
        return VALUE_ERR;
      }
      exactlyOnce = b;
    }
    const grid = source.grid;
    // Work on a list of "lines": rows by default, columns with by_column.
    const lines: FormulaValue[][] = byColumn
      ? Array.from({ length: grid.cols }, (_v, c) => grid.cells.map((row) => row[c]))
      : grid.cells.map((row) => row.slice());
    const keys: string[] = [];
    for (const line of lines) {
      const parts: string[] = [];
      for (const v of line) {
        if (v.type === 'error') {
          return v;
        }
        parts.push(equalityKey(v) ?? '');
      }
      keys.push(parts.join(' '));
    }
    const counts = new Map<string, number>();
    for (const key of keys) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const seen = new Set<string>();
    const kept: FormulaValue[][] = [];
    for (let i = 0; i < lines.length; i++) {
      const key = keys[i];
      if (exactlyOnce) {
        if (counts.get(key) === 1) {
          kept.push(lines[i]);
        }
        continue;
      }
      // Stable first-occurrence order.
      if (!seen.has(key)) {
        seen.add(key);
        kept.push(lines[i]);
      }
    }
    if (kept.length === 0) {
      return CALC_ERR;
    }
    const cells = byColumn ? Array.from({ length: grid.rows }, (_v, r) => kept.map((line) => line[r])) : kept;
    return gridOrScalar(boundedGrid(cells));
  },
});

def({
  name: 'SORT',
  minArgs: 1,
  maxArgs: 1 + MAX_SORT_KEYS * 2,
  signature: 'SORT(array, [sort_index], [is_ascending], …)',
  example: '=SORT(A1:C10, 2, FALSE)',
  dynamic: true,
  call: (args) => {
    const source = gridOf(args[0]);
    if (!source.ok) {
      return source.error;
    }
    const grid = source.grid;
    const keys: Array<{ index: number; ascending: boolean }> = [];
    for (let i = 1; i < args.length; i += 2) {
      let index = 1;
      if (!args[i].isOmitted()) {
        const n = numberOf(args[i]);
        if (!n.ok) {
          return n.error;
        }
        index = Math.trunc(n.n);
      }
      if (index < 1 || index > grid.cols) {
        return VALUE_ERR;
      }
      let ascending = true;
      if (i + 1 < args.length && !args[i + 1].isOmitted()) {
        const v = args[i + 1].value();
        if (v.type === 'error') {
          return v;
        }
        const b = coerceToBoolean(v);
        if (b === null) {
          return VALUE_ERR;
        }
        ascending = b;
      }
      keys.push({ index, ascending });
    }
    if (keys.length === 0) {
      keys.push({ index: 1, ascending: true });
    }
    if (keys.length > MAX_SORT_KEYS) {
      return NUM_ERR;
    }
    // Decorate with the original position so the sort is stable regardless of
    // the host's Array.prototype.sort, and so the source is never mutated.
    const rows = grid.cells.map((row, i) => ({ row: row.slice(), i }));
    rows.sort((a, b) => {
      for (const key of keys) {
        const cmp = compareValues(a.row[key.index - 1], b.row[key.index - 1]);
        if (cmp !== 0) {
          return key.ascending ? cmp : -cmp;
        }
      }
      return a.i - b.i;
    });
    return gridOrScalar(boundedGrid(rows.map((entry) => entry.row)));
  },
});

def({
  name: 'SEQUENCE',
  minArgs: 1,
  maxArgs: 4,
  signature: 'SEQUENCE(rows, [columns], [start], [step])',
  example: '=SEQUENCE(5, 2, 1, 1)',
  dynamic: true,
  call: (args) => {
    const readInt = (index: number, fallback: number): number | FormulaValue => {
      if (index >= args.length || args[index].isOmitted()) {
        return fallback;
      }
      const n = numberOf(args[index]);
      return n.ok ? n.n : n.error;
    };
    const rowsRaw = readInt(0, 1);
    if (typeof rowsRaw !== 'number') {
      return rowsRaw;
    }
    const colsRaw = readInt(1, 1);
    if (typeof colsRaw !== 'number') {
      return colsRaw;
    }
    const start = readInt(2, 1);
    if (typeof start !== 'number') {
      return start;
    }
    const step = readInt(3, 1);
    if (typeof step !== 'number') {
      return step;
    }
    const rows = Math.trunc(rowsRaw);
    const cols = Math.trunc(colsRaw);
    if (rows < 1 || cols < 1) {
      return VALUE_ERR;
    }
    if (rows > MAX_ARRAY_ROWS || cols > MAX_ARRAY_COLS || rows * cols > MAX_ARRAY_CELLS) {
      return NUM_ERR;
    }
    const cells: FormulaValue[][] = [];
    for (let r = 0; r < rows; r++) {
      const row: FormulaValue[] = [];
      for (let c = 0; c < cols; c++) {
        const value = start + (r * cols + c) * step;
        if (!Number.isFinite(value)) {
          return NUM_ERR;
        }
        row.push({ type: 'number', value });
      }
      cells.push(row);
    }
    return gridOrScalar(makeGrid(cells));
  },
});

// ---------------------------------------------------------------------------
// Registry access
// ---------------------------------------------------------------------------

const BY_NAME = new Map<string, FunctionDef>();
for (const entry of DEFS) {
  BY_NAME.set(entry.name, entry);
}

/** Every function definition, sorted by name for stable help/autocomplete output. */
export const FUNCTION_DEFS: readonly FunctionDef[] = DEFS.slice().sort((a, b) =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
);

/** Every supported function name, sorted. */
export const SUPPORTED_FUNCTIONS: readonly string[] = FUNCTION_DEFS.map((f) => f.name);

/** Look up a function by its already-upper-cased name. */
export function lookupFunction(name: string): FunctionDef | null {
  return BY_NAME.get(name) ?? null;
}

/** True when at least one named function is volatile (recalculates on the clock). */
export function isVolatileFunction(name: string): boolean {
  return BY_NAME.get(name)?.volatile === true;
}

/** The display metadata the help dialog and autocomplete read. */
export interface FunctionInfo {
  name: string;
  signature: string;
  example: string;
  volatile?: boolean;
  dynamic?: boolean;
}

/**
 * Display metadata for every function. Kept as a separate, plain-data view so
 * the UI layer never holds a reference to an implementation closure.
 */
export const FUNCTION_INFOS: readonly FunctionInfo[] = FUNCTION_DEFS.map((entry) => ({
  name: entry.name,
  signature: entry.signature,
  example: entry.example,
  ...(entry.volatile === true ? { volatile: true } : {}),
  ...(entry.dynamic === true ? { dynamic: true } : {}),
}));

/** Names of the functions marked volatile, for documentation and tests. */
export const VOLATILE_FUNCTIONS: readonly string[] = FUNCTION_DEFS.filter((f) => f.volatile).map(
  (f) => f.name,
);
