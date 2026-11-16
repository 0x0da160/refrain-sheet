// SPDX-License-Identifier: MIT
/**
 * Conditional aggregation over typed columns: the scan behind `COUNTIFS`,
 * `SUMIFS` and friends when every range is one long worksheet column (see
 * {@link ColumnData}).
 *
 * It computes exactly what the cell-by-cell scan in `functions/aggregate.ts`
 * computes — that scan stays as the reference and as the path for every other
 * shape of argument. To keep the two from drifting:
 *
 * - whether a cell satisfies a criterion is decided by `matchesCriterion`
 *   itself, once per distinct text, boolean and blank; only the comparison of
 *   a number with a numeric operand is written out here, as the same `===`,
 *   `<` and `>` that function uses;
 * - numbers are added one at a time in row order, so a sum has the same last
 *   bit either way;
 * - a column holding an error anywhere is scanned position by position, in
 *   the reference scan's order ({@link scanRows}), because which error is
 *   reported — and whether one is reported at all — depends on that order.
 *
 * Without errors the order in which criteria are tested cannot change the
 * result, which is what lets the common case work on one bit per row: each
 * (column, criterion) pair becomes a row mask, kept with the column until a
 * row changes, and a formula combines the masks of its pairs. A summary sheet
 * whose formulas share their period and category criteria tests each of
 * those against the data once, not once per formula.
 *
 * `tests/core/formula-columnar.test.ts` checks the agreement on random data.
 */
import { type Criterion, matchesCriterion } from './criteria';
import {
  type ColumnData,
  EMPTY_VALUE,
  ERROR_CODES,
  errorValue,
  type FormulaValue,
  KIND_BOOLEAN,
  KIND_EMPTY,
  KIND_NUMBER,
  KIND_STRING,
  type ValueGrid,
} from './value';

/** The grid's typed column, or null when it has none. */
export function columnOf(grid: ValueGrid): ColumnData | null {
  return grid.cols === 1 && grid.column ? grid.column() : null;
}

/** How a number cell is tested against one criterion. */
const enum NumberTest {
  Never,
  Always,
  Equal,
  NotEqual,
  Greater,
  GreaterEqual,
  Less,
  LessEqual,
  /** Text comparison of the number as written, or a wildcard: ask `matchesCriterion`. */
  Ask,
}

function numberTest(criterion: Criterion): NumberTest {
  if (criterion.blankTest) {
    // A number is never blank.
    return criterion.op === '<>' ? NumberTest.Always : NumberTest.Never;
  }
  if (criterion.op === '=' || criterion.op === '<>') {
    if (criterion.wildcard || criterion.number === null) {
      return NumberTest.Ask;
    }
    return criterion.op === '=' ? NumberTest.Equal : NumberTest.NotEqual;
  }
  if (criterion.number === null) {
    return NumberTest.Never; // a text operand orders only against text
  }
  switch (criterion.op) {
    case '>':
      return NumberTest.Greater;
    case '>=':
      return NumberTest.GreaterEqual;
    case '<':
      return NumberTest.Less;
    default:
      return NumberTest.LessEqual;
  }
}

/** One criterion prepared against one column. */
interface Matcher {
  readonly column: ColumnData;
  readonly criterion: Criterion;
  readonly numbers: NumberTest;
  readonly operand: number;
  readonly blank: boolean;
  readonly yes: boolean;
  readonly no: boolean;
  /** Per distinct text of the column: 0 not asked yet, 1 no match, 2 match. */
  readonly texts: Uint8Array;
}

function matcher(column: ColumnData, criterion: Criterion): Matcher {
  return {
    column,
    criterion,
    numbers: numberTest(criterion),
    operand: criterion.number ?? 0,
    blank: matchesCriterion(EMPTY_VALUE, criterion),
    yes: matchesCriterion({ type: 'boolean', value: true }, criterion),
    no: matchesCriterion({ type: 'boolean', value: false }, criterion),
    texts: new Uint8Array(column.strings.length),
  };
}

function numberMatches(m: Matcher, n: number): boolean {
  switch (m.numbers) {
    case NumberTest.Never:
      return false;
    case NumberTest.Always:
      return true;
    case NumberTest.Equal:
      return n === m.operand;
    case NumberTest.NotEqual:
      return n !== m.operand;
    case NumberTest.Greater:
      return n > m.operand;
    // `>=` and `<=` are "not less" and "not greater", as `matchesCriterion`
    // orders two numbers — the same answer for every pair, NaN included.
    case NumberTest.GreaterEqual:
      return !(n < m.operand);
    case NumberTest.Less:
      return n < m.operand;
    case NumberTest.LessEqual:
      return !(n > m.operand);
    case NumberTest.Ask:
      return matchesCriterion({ type: 'number', value: n }, m.criterion);
  }
}

function textMatches(m: Matcher, id: number): boolean {
  let known = m.texts[id];
  if (known === 0) {
    known = matchesCriterion({ type: 'string', value: m.column.strings[id] }, m.criterion) ? 2 : 1;
    m.texts[id] = known;
  }
  return known === 2;
}

/** What a scan found: the first error in scan order, or the tallies. */
export type ColumnScan =
  | { error: FormulaValue }
  | {
      error: null;
      /** Positions satisfying every criterion. */
      hits: number;
      /** Sum of the numbers (booleans as 1 / 0) of `values` at those positions. */
      total: number;
      /** How many of those positions held a number or a boolean in `values`. */
      numbers: number;
    };

type Pairs = ReadonlyArray<{ column: ColumnData; criterion: Criterion }>;

/**
 * Scan `pairs` (each a column and the criterion its cells must satisfy), and
 * tally `values` at every position that satisfies all of them. Every column
 * must have the same length.
 */
export function scanColumns(pairs: Pairs, values: ColumnData | null): ColumnScan {
  const masks: Uint32Array[] = [];
  for (const pair of pairs) {
    const mask = rowMask(pair.column, pair.criterion);
    if (!mask) {
      return scanRows(pairs, values);
    }
    masks.push(mask);
  }
  return tallyMasked(masks, values);
}

/**
 * The reference order, position by position: at each one the criteria are
 * tested in turn until one fails, an error cell met on the way is the result,
 * and so is an error in `values` at a position that satisfied them all.
 */
function scanRows(pairs: Pairs, values: ColumnData | null): ColumnScan {
  const matchers = pairs.map((pair) => matcher(pair.column, pair.criterion));
  const rows = pairs[0].column.length;
  let hits = 0;
  let total = 0;
  let numbers = 0;
  for (let i = 0; i < rows; i++) {
    let all = true;
    for (let k = 0; k < matchers.length; k++) {
      const m = matchers[k];
      const at = m.column.offset + i;
      const kind = m.column.kinds[at];
      let ok: boolean;
      if (kind === KIND_STRING) {
        ok = textMatches(m, m.column.ids[at]);
      } else if (kind === KIND_NUMBER) {
        ok = numberMatches(m, m.column.nums[at]);
      } else if (kind === KIND_EMPTY) {
        ok = m.blank;
      } else if (kind === KIND_BOOLEAN) {
        ok = m.column.nums[at] !== 0 ? m.yes : m.no;
      } else {
        return { error: errorValue(ERROR_CODES[m.column.ids[at]]) };
      }
      if (!ok) {
        all = false;
        break;
      }
    }
    if (!all) {
      continue;
    }
    hits += 1;
    if (values) {
      const at = values.offset + i;
      const kind = values.kinds[at];
      if (kind === KIND_NUMBER || kind === KIND_BOOLEAN) {
        total += values.nums[at];
        numbers += 1;
      } else if (kind !== KIND_EMPTY && kind !== KIND_STRING) {
        return { error: errorValue(ERROR_CODES[values.ids[at]]) };
      }
    }
  }
  return { error: null, hits, total, numbers };
}

/** Row masks kept per column before the oldest are dropped (each is one bit per row). */
const MAX_KEPT_MASKS = 256;

/**
 * Which rows of `column` satisfy `criterion`, one bit per row (bit `i & 31`
 * of word `i >> 5`), or null when the column holds an error — then only
 * {@link scanRows} can tell what the result is. Kept with the column, so the
 * next formula with the same criterion reuses it.
 */
function rowMask(column: ColumnData, criterion: Criterion): Uint32Array | null {
  const key = [
    column.offset,
    column.length,
    criterion.op,
    criterion.blankTest ? 1 : 0,
    criterion.wildcard ? 1 : 0,
    String(criterion.number),
    criterion.text,
  ].join('\u0000');
  const kept = column.derived?.get(key);
  if (kept) {
    return kept;
  }
  const m = matcher(column, criterion);
  const { kinds, nums, ids, offset, length } = column;
  const texts = m.texts;
  const bits = new Uint32Array((length + 31) >> 5);
  for (let i = 0; i < length; i++) {
    const at = offset + i;
    const kind = kinds[at];
    let ok: boolean;
    if (kind === KIND_STRING) {
      const known = texts[ids[at]];
      ok = known === 0 ? textMatches(m, ids[at]) : known === 2;
    } else if (kind === KIND_NUMBER) {
      ok = numberMatches(m, nums[at]);
    } else if (kind === KIND_EMPTY) {
      ok = m.blank;
    } else if (kind === KIND_BOOLEAN) {
      ok = nums[at] !== 0 ? m.yes : m.no;
    } else {
      return null;
    }
    if (ok) {
      bits[i >> 5] |= 1 << (i & 31);
    }
  }
  if (column.derived) {
    if (column.derived.size >= MAX_KEPT_MASKS) {
      column.derived.clear();
    }
    column.derived.set(key, bits);
  }
  return bits;
}

/** The number of set bits in a 32-bit word. */
function popcount(word: number): number {
  let v = word - ((word >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/** Tally the rows set in every mask, visiting them in row order. */
function tallyMasked(masks: readonly Uint32Array[], values: ColumnData | null): ColumnScan {
  const first = masks[0];
  let hits = 0;
  let total = 0;
  let numbers = 0;
  for (let w = 0; w < first.length; w++) {
    let word = first[w];
    for (let k = 1; k < masks.length && word !== 0; k++) {
      word &= masks[k][w];
    }
    if (word === 0) {
      continue;
    }
    hits += popcount(word);
    if (!values) {
      continue;
    }
    const base = values.offset + (w << 5);
    while (word !== 0) {
      const lowest = word & -word;
      const at = base + (31 - Math.clz32(lowest));
      const kind = values.kinds[at];
      if (kind === KIND_NUMBER || kind === KIND_BOOLEAN) {
        total += values.nums[at];
        numbers += 1;
      } else if (kind !== KIND_EMPTY && kind !== KIND_STRING) {
        return { error: errorValue(ERROR_CODES[values.ids[at]]) };
      }
      word ^= lowest;
    }
  }
  return { error: null, hits, total, numbers };
}
