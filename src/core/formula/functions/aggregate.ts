// SPDX-License-Identifier: MIT
/**
 * Aggregation, counting, and conditional aggregation (`SUMIFS` and friends).
 */
import { type ColumnScan, columnOf, scanColumns } from '../columnar';
import { type Criterion, matchesCriterion, parseCriterion } from '../criteria';
import {
  booleanValue,
  coerceToBoolean,
  coerceToNumber,
  type ColumnData,
  errorValue,
  flattenGrid,
  type FormulaValue,
  MAX_CRITERIA_PAIRS,
  numberValue,
  type ValueGrid,
} from '../value';
import { functionGroup, type FunctionDef, type FnArg, type FnResult } from './contract';
import {
  collectNumbers,
  collectValues,
  DIV0_ERR,
  gridOf,
  isBlank,
  NUM_ERR,
  sameShape,
  VALUE_ERR,
} from './helpers';

const { defs, def } = functionGroup();

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
type PairList = { ok: true; pairs: CriteriaPair[] } | { ok: false; error: FormulaValue };

/** A range to scan: its grid, and its typed column when it has one (see `../columnar.ts`). */
interface ScanRange {
  grid: ValueGrid;
  column: ColumnData | null;
}

type CriteriaPair = ScanRange & { criterion: Criterion };

/**
 * Read a range argument for a scan, now: its typed column when it is one long
 * worksheet column, otherwise its cells — at the same point, and so in the
 * same order across arguments, as a plain `grid()` call reads them.
 */
function scanRangeOf(arg: FnArg): { ok: true; range: ScanRange } | { ok: false; error: FormulaValue } {
  const g = arg.lazyGrid ? arg.lazyGrid() : gridOf(arg);
  if (!g.ok) {
    return g;
  }
  const column = columnOf(g.grid);
  if (!column) {
    void g.grid.cells;
  }
  return { ok: true, range: { grid: g.grid, column } };
}

function readCriteriaPairs(args: readonly FnArg[], from: number, shape: ValueGrid | null): PairList {
  const count = args.length - from;
  if (count <= 0 || count % 2 !== 0) {
    return { ok: false, error: errorValue('#ERROR!') };
  }
  if (count / 2 > MAX_CRITERIA_PAIRS) {
    return { ok: false, error: NUM_ERR };
  }
  const pairs: CriteriaPair[] = [];
  let reference = shape;
  for (let i = from; i < args.length; i += 2) {
    const g = scanRangeOf(args[i]);
    if (!g.ok) {
      return { ok: false, error: g.error };
    }
    reference ??= g.range.grid;
    if (!sameShape(g.range.grid, reference)) {
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
    pairs.push({ ...g.range, criterion: parsed.criterion });
  }
  return { ok: true, pairs };
}

/**
 * Visit every position of the criteria shape, calling `hit` for positions that
 * satisfy every criterion. Returns the first error found in any criteria range
 * so it propagates instead of being silently skipped.
 */
function scanCriteria(
  pairs: readonly CriteriaPair[],
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

/**
 * Count the positions satisfying every criterion and tally `values` there:
 * over typed columns when every range has one, cell by cell otherwise. The
 * two compute the same thing (see `../columnar.ts`).
 */
function tallyMatches(pairs: readonly CriteriaPair[], values: ScanRange | null): ColumnScan {
  const columns: Array<{ column: ColumnData; criterion: Criterion }> = [];
  for (const pair of pairs) {
    if (pair.column) {
      columns.push({ column: pair.column, criterion: pair.criterion });
    }
  }
  if (columns.length === pairs.length && (!values || values.column)) {
    return scanColumns(columns, values ? values.column : null);
  }
  let hits = 0;
  let total = 0;
  let numbers = 0;
  const error = scanCriteria(pairs, (r, c) => {
    hits += 1;
    if (!values) {
      return null;
    }
    const v = values.grid.cells[r][c];
    if (v.type === 'error') {
      return v;
    }
    if (v.type === 'number') {
      total += v.value;
      numbers += 1;
    } else if (v.type === 'boolean') {
      total += v.value ? 1 : 0;
      numbers += 1;
    }
    // Text and blanks contribute nothing, as in conventional spreadsheets.
    return null;
  });
  return error ? { error } : { error: null, hits, total, numbers };
}

/** `COUNTIF` / `COUNTIFS`: how many positions satisfy every criterion. */
function countMatches(args: readonly FnArg[]): FnResult {
  const pairs = readCriteriaPairs(args, 0, null);
  if (!pairs.ok) {
    return pairs.error;
  }
  const found = tallyMatches(pairs.pairs, null);
  return found.error ?? numberValue(found.hits);
}

/** `SUMIF` / `AVERAGEIF`: one criteria range, one criterion, one value range. */
function singleCriteriaAggregate(args: readonly FnArg[], mode: 'sum' | 'average'): FnResult {
  const criteria = scanRangeOf(args[0]);
  if (!criteria.ok) {
    return criteria.error;
  }
  const criterionValue = args[1].value();
  if (criterionValue.type === 'error') {
    return criterionValue;
  }
  const parsed = parseCriterion(criterionValue);
  if (!parsed.ok) {
    return VALUE_ERR;
  }
  let values = criteria.range;
  if (args.length >= 3 && !args[2].isOmitted()) {
    const g = scanRangeOf(args[2]);
    if (!g.ok) {
      return g.error;
    }
    if (!sameShape(g.range.grid, criteria.range.grid)) {
      return VALUE_ERR;
    }
    values = g.range;
  }
  return reduceMatches([{ ...criteria.range, criterion: parsed.criterion }], values, mode);
}

/** Sum or average the values of `values` at every matching position. */
function reduceMatches(pairs: readonly CriteriaPair[], values: ScanRange, mode: 'sum' | 'average'): FnResult {
  const found = tallyMatches(pairs, values);
  if (found.error) {
    return found.error;
  }
  if (mode === 'sum') {
    return numberValue(found.total);
  }
  return found.numbers === 0 ? DIV0_ERR : numberValue(found.total / found.numbers);
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
    category: 'math',
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
  category: 'logical',
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
  category: 'conditional',
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
  category: 'conditional',
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
  category: 'conditional',
  call: countMatches,
});

def({
  name: 'COUNTIFS',
  minArgs: 2,
  maxArgs: Infinity,
  signature: 'COUNTIFS(range1, criterion1, …)',
  example: '=COUNTIFS(A1:A10, ">10", B1:B10, "yes")',
  category: 'conditional',
  call: countMatches,
});

def({
  name: 'SUMIF',
  minArgs: 2,
  maxArgs: 3,
  signature: 'SUMIF(range, criterion, [sum_range])',
  example: '=SUMIF(A1:A10, ">10", B1:B10)',
  category: 'conditional',
  call: (args) => singleCriteriaAggregate(args, 'sum'),
});

def({
  name: 'AVERAGEIF',
  minArgs: 2,
  maxArgs: 3,
  signature: 'AVERAGEIF(range, criterion, [average_range])',
  example: '=AVERAGEIF(A1:A10, ">10", B1:B10)',
  category: 'conditional',
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
    category: 'conditional',
    call: (args) => {
      const values = scanRangeOf(args[0]);
      if (!values.ok) {
        return values.error;
      }
      const pairs = readCriteriaPairs(args, 1, values.range.grid);
      if (!pairs.ok) {
        return pairs.error;
      }
      return reduceMatches(pairs.pairs, values.range, mode);
    },
  });
}

export const AGGREGATE_FUNCTIONS: readonly FunctionDef[] = defs;
