// SPDX-License-Identifier: MIT
/**
 * Lookup and reference functions and their exact/approximate matchers.
 */
import { compileWildcard, matchWildcard, unescapeWildcard } from '../criteria';
import {
  coerceToText,
  compareValues,
  equalityKey,
  flattenGrid,
  type FormulaValue,
  makeGrid,
  numberValue,
  textValue,
  type ValueGrid,
  valuesEqual,
} from '../value';
import {
  gridOf,
  gridOrScalar,
  NA_ERR,
  numberOf,
  optionalBoolean,
  optionalNumber,
  REF_ERR,
  VALUE_ERR,
  vectorOf,
} from './helpers';
import { functionGroup, type FunctionDef } from './contract';

const { defs, def } = functionGroup();

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

/**
 * True when `needle` would take `findExact`'s wildcard path (a string
 * containing `*`, `?`, or `~`). VLOOKUP and MATCH always search with
 * `wildcards: true`, but a needle without those characters is an ordinary
 * exact match under the hood (see `findExact`'s `pattern`/`literal` split) —
 * `findExactIndexed` below only handles that ordinary case; a genuine
 * wildcard search still needs `findExact`'s linear scan.
 */
function isWildcardNeedle(needle: FormulaValue): boolean {
  return needle.type === 'string' && compileWildcard(needle.value) !== null;
}

/**
 * Cached exact-match index for VLOOKUP/MATCH/XLOOKUP's non-wildcard search
 * path, keyed by the shared, per-revision {@link ValueGrid} that
 * `rangeGridCaches` in `formula.ts` already hands out for a given range
 * within one evaluation pass. Building the index costs one pass over the
 * lookup column; every subsequent formula cell that searches the *same*
 * range then does an O(1)-average map lookup instead of its own O(n) linear
 * scan. A `WeakMap` keyed on the grid drops the index for free once a
 * mutation retires that grid (a fresh grid is built per revision — see
 * `RsfDocument`'s `touch`/`recalculate`), so no explicit invalidation is
 * needed. This is what fixes the "VLOOKUP table shared by 2,000 formula
 * cells" cost measured in `bench/perf.bench.ts`.
 */
const exactIndexCache = new WeakMap<ValueGrid, Map<string, Map<string, number[]>>>();

/**
 * The cached index for one (grid, selector) pair, building it on first use.
 * `selector` distinguishes the different vectors a grid can be searched
 * along (e.g. VLOOKUP's first column vs. a MATCH/XLOOKUP vector), since one
 * grid object can back more than one kind of search. Indices are grouped by
 * {@link equalityKey} — the same equivalence classes `valuesEqual` uses
 * elsewhere (UNIQUE, MODE.SNGL) — so a bucket holds every position, in scan
 * order, that a linear `valuesEqual` scan would call a match; entries with no
 * key (errors) are skipped, matching `valuesEqual`'s "error never matches"
 * rule.
 */
function exactIndexFor(
  grid: ValueGrid,
  selector: string,
  count: number,
  at: (i: number) => FormulaValue,
): Map<string, number[]> {
  let bySelector = exactIndexCache.get(grid);
  if (!bySelector) {
    bySelector = new Map();
    exactIndexCache.set(grid, bySelector);
  }
  let index = bySelector.get(selector);
  if (!index) {
    index = new Map();
    for (let i = 0; i < count; i++) {
      const key = equalityKey(at(i));
      if (key === null) {
        continue;
      }
      const bucket = index.get(key);
      if (bucket) {
        bucket.push(i);
      } else {
        index.set(key, [i]);
      }
    }
    bySelector.set(selector, index);
  }
  return index;
}

/**
 * Indexed equivalent of `findExact(hay, needle, false, reverse)`: forward
 * returns the first match, `reverse` the last — exactly `findExact`'s
 * contract, just without rescanning `hay` on every call. Only valid for a
 * non-wildcard needle; callers must route a wildcard needle to `findExact`
 * instead (see `isWildcardNeedle`).
 */
function findExactIndexed(
  grid: ValueGrid,
  selector: string,
  count: number,
  at: (i: number) => FormulaValue,
  needle: FormulaValue,
  reverse: boolean,
): number {
  const key = equalityKey(needle);
  if (key === null) {
    return -1;
  }
  const bucket = exactIndexFor(grid, selector, count, at).get(key);
  if (!bucket || bucket.length === 0) {
    return -1;
  }
  return reverse ? bucket[bucket.length - 1] : bucket[0];
}

// ----- Priority B: lookup and reference -----

def({
  name: 'XLOOKUP',
  minArgs: 3,
  maxArgs: 6,
  signature: 'XLOOKUP(lookup, lookup_array, return_array, [if_not_found], [match_mode], [search_mode])',
  example: '=XLOOKUP(A1, B1:B10, C1:C10, "none")',
  category: 'lookup',
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
    const matchModeArg = optionalNumber(args, 4, 0);
    if (!matchModeArg.ok) {
      return matchModeArg.error;
    }
    const matchMode = Math.trunc(matchModeArg.n);
    if (matchMode !== 0 && matchMode !== 2) {
      return VALUE_ERR; // -1 / 1 (approximate) are not implemented
    }
    const searchModeArg = optionalNumber(args, 5, 1);
    if (!searchModeArg.ok) {
      return searchModeArg.error;
    }
    const searchMode = Math.trunc(searchModeArg.n);
    if (searchMode !== 1 && searchMode !== -1) {
      return VALUE_ERR; // 2 / -2 (binary search) are not implemented
    }
    // The return array must line up with the lookup array along the search
    // axis; the other axis may be wider, which is what lets XLOOKUP return a
    // whole record as a spilled array.
    const along = vector.vertical ? returnGrid.grid.rows : returnGrid.grid.cols;
    if (along !== vector.values.length) {
      return VALUE_ERR;
    }
    // Wildcard mode still needs `findExact`'s linear scan; the plain exact
    // mode (0) never compiles a wildcard pattern, so it always qualifies for
    // the cached index (see `findExactIndexed`).
    const index =
      matchMode === 2
        ? findExact(vector.values, needle, true, searchMode === -1)
        : findExactIndexed(
            lookupGrid.grid,
            vector.vertical ? 'xlookup:col0' : 'xlookup:row0',
            vector.values.length,
            (i) => vector.values[i],
            needle,
            searchMode === -1,
          );
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
  category: 'lookup',
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
    const approximateArg = optionalBoolean(args, 3, true);
    if (!approximateArg.ok) {
      return approximateArg.error;
    }
    const approximate = approximateArg.b;
    // The exact, non-wildcard case (the common one — approximate defaults to
    // true, but FALSE range_lookup is the idiomatic exact-match call) never
    // needs the `firstColumn` copy at all: the cached index reads
    // `table.grid` directly, so a table shared by many VLOOKUP cells builds
    // its index once instead of paying an O(rows) copy *and* scan per cell.
    let index: number;
    if (approximate || isWildcardNeedle(needle)) {
      const firstColumn: FormulaValue[] = [];
      for (let r = 0; r < table.grid.rows; r++) {
        firstColumn.push(table.grid.cells[r][0]);
      }
      index = approximate
        ? findApproximate(firstColumn, needle, 1)
        : findExact(firstColumn, needle, true, false);
    } else {
      index = findExactIndexed(
        table.grid,
        'vlookup:col0',
        table.grid.rows,
        (r) => table.grid.cells[r][0],
        needle,
        false,
      );
    }
    return index < 0 ? NA_ERR : table.grid.cells[index][col - 1];
  },
});

def({
  name: 'MATCH',
  minArgs: 2,
  maxArgs: 3,
  signature: 'MATCH(lookup, lookup_array, [match_type])',
  example: '=MATCH(A1, B1:B10, 0)',
  category: 'lookup',
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
    const matchTypeArg = optionalNumber(args, 2, 1);
    if (!matchTypeArg.ok) {
      return matchTypeArg.error;
    }
    const matchType = Math.trunc(matchTypeArg.n);
    if (matchType !== 0 && matchType !== 1 && matchType !== -1) {
      return VALUE_ERR;
    }
    const index =
      matchType !== 0
        ? findApproximate(vector.values, needle, matchType === 1 ? 1 : -1)
        : isWildcardNeedle(needle)
          ? findExact(vector.values, needle, true, false)
          : findExactIndexed(
              g.grid,
              vector.vertical ? 'match:col0' : 'match:row0',
              vector.values.length,
              (i) => vector.values[i],
              needle,
              false,
            );
    return index < 0 ? NA_ERR : numberValue(index + 1);
  },
});

def({
  name: 'INDEX',
  minArgs: 2,
  maxArgs: 3,
  signature: 'INDEX(array, row_num, [column_num])',
  example: '=INDEX(A1:C10, 2, 3)',
  category: 'lookup',
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
    const colArg = optionalNumber(args, 2, 0);
    if (!colArg.ok) {
      return colArg.error;
    }
    const hasCol = colArg.provided;
    const second = Math.trunc(colArg.n);
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

export const LOOKUP_FUNCTIONS: readonly FunctionDef[] = defs;
