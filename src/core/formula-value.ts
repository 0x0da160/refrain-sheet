// SPDX-License-Identifier: MIT
/**
 * The formula value model: the single vocabulary every part of the formula
 * engine speaks.
 *
 * A formula value is one of six things:
 *
 * | Kind      | Written as        | Notes                                        |
 * | --------- | ----------------- | -------------------------------------------- |
 * | blank     | `{type:'empty'}`  | An empty cell, or an omitted optional argument |
 * | number    | `{type:'number'}` | Always a **finite** double (see {@link finiteNumber}) |
 * | text      | `{type:'string'}` | A JavaScript string; may hold any Unicode      |
 * | boolean   | `{type:'boolean'}`| `TRUE` / `FALSE`                               |
 * | error     | `{type:'error'}`  | One of {@link ERROR_CODES}                     |
 * | array     | {@link ValueGrid} | A rectangular block, only where arrays are allowed |
 *
 * Date and time values are **not** a separate kind: they are numbers on the
 * serial scale documented in `formula-date.ts`. That keeps the value model
 * small and makes `=A1+7` (a week later) work without special cases, at the
 * cost of dates displaying as their serial number — see the known-limitations
 * note in `docs/rsf-format.md`.
 *
 * ## Coercion rules (authoritative)
 *
 * These are the only conversions the engine performs. Every function documents
 * which one it applies; nothing coerces implicitly outside these helpers.
 *
 * **To number** ({@link coerceToNumber}) — number → itself; boolean → 1 / 0;
 * blank → 0; text → the number it parses to, or *not a number* when it does
 * not parse (which callers turn into `#VALUE!`); error → not a number (the
 * error propagates instead). Leading/trailing whitespace in text is ignored;
 * an empty or whitespace-only string does **not** parse.
 *
 * **To text** ({@link coerceToText}) — text → itself; number → its shortest
 * round-tripping decimal form; boolean → `TRUE` / `FALSE`; blank → the empty
 * string; error → not text (the error propagates).
 *
 * **To boolean** ({@link coerceToBoolean}) — boolean → itself; number → false
 * only when zero; blank → false; text → *not a boolean* (`#VALUE!`), matching
 * conventional spreadsheets, which never read `"TRUE"` as a boolean in a
 * logical position; error → not a boolean.
 *
 * **Blanks inside ranges** are skipped by aggregation (`SUM`, `AVERAGE`,
 * `COUNT`, `MEDIAN`, …) and are *not* treated as zero. A blank used directly
 * in arithmetic (`=A1+1` with `A1` empty) is zero, as above. This is the
 * conventional spreadsheet split and the two rules are deliberately different.
 *
 * **Errors** propagate through every operator and function unless the function
 * documents that it inspects them — today only `IFERROR`, which is why it must
 * evaluate its first argument without the caller collapsing errors first.
 *
 * Nothing here touches the DOM, the network, `eval`, or `new Function`.
 */

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Every error a formula can evaluate to.
 *
 * `#ERROR!` and `#CYCLE!` predate this list and are specific to this engine
 * (a formula that does not parse, and a circular reference). The rest use the
 * conventional spreadsheet spellings so a formula copied from a spreadsheet
 * reads the same way here.
 */
export type ErrorCode =
  | '#ERROR!'
  | '#NAME?'
  | '#VALUE!'
  | '#DIV/0!'
  | '#REF!'
  | '#CYCLE!'
  | '#N/A'
  | '#NUM!'
  | '#SPILL!'
  | '#CALC!';

/**
 * Error literals recognised by the tokenizer, **longest first** so that
 * scanning `#NAME?` never stops early on a shorter prefix.
 */
export const ERROR_CODES: readonly ErrorCode[] = [
  '#DIV/0!',
  '#SPILL!',
  '#ERROR!',
  '#CYCLE!',
  '#VALUE!',
  '#NAME?',
  '#CALC!',
  '#NUM!',
  '#REF!',
  '#N/A',
];

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

export type FormulaValue =
  | { type: 'number'; value: number }
  | { type: 'string'; value: string }
  | { type: 'boolean'; value: boolean }
  | { type: 'empty' }
  | { type: 'error'; code: ErrorCode };

export const EMPTY_VALUE: FormulaValue = { type: 'empty' };
export const TRUE_VALUE: FormulaValue = { type: 'boolean', value: true };
export const FALSE_VALUE: FormulaValue = { type: 'boolean', value: false };

/**
 * A number value. Non-finite results (overflow, `0/0`, `Infinity`) are **not**
 * representable: they become `#NUM!`, so no downstream code has to defend
 * against `NaN` or `Infinity` leaking into a cell.
 */
export function numberValue(value: number): FormulaValue {
  return Number.isFinite(value) ? { type: 'number', value } : { type: 'error', code: '#NUM!' };
}

/** A number value that is known finite (internal fast path; still validated). */
export function finiteNumber(value: number): FormulaValue {
  return numberValue(value);
}

export function textValue(value: string): FormulaValue {
  return { type: 'string', value };
}

export function booleanValue(value: boolean): FormulaValue {
  return value ? TRUE_VALUE : FALSE_VALUE;
}

export function errorValue(code: ErrorCode): FormulaValue {
  return { type: 'error', code };
}

export function isError(value: FormulaValue): value is { type: 'error'; code: ErrorCode } {
  return value.type === 'error';
}

/** The first error among the given values, or null when none is an error. */
export function firstError(...values: FormulaValue[]): FormulaValue | null {
  for (const v of values) {
    if (v.type === 'error') {
      return v;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Arrays
// ---------------------------------------------------------------------------

/**
 * A rectangular block of values: the result of a dynamic-array function and
 * the materialized form of a range argument. Always `rows × cols` with every
 * row exactly `cols` long — callers may index without bounds checks.
 *
 * A grid never contains another grid: arrays do not nest.
 */
export interface ValueGrid {
  readonly rows: number;
  readonly cols: number;
  /** Row-major cells; `cells[r][c]` with `r < rows`, `c < cols`. */
  readonly cells: readonly (readonly FormulaValue[])[];
}

/** Build a grid from row-major cells, trusting (and asserting) rectangularity. */
export function makeGrid(cells: readonly (readonly FormulaValue[])[]): ValueGrid {
  const rows = cells.length;
  const cols = rows === 0 ? 0 : cells[0].length;
  return { rows, cols, cells };
}

/** A 1×1 grid holding one value. */
export function scalarGrid(value: FormulaValue): ValueGrid {
  return { rows: 1, cols: 1, cells: [[value]] };
}

/** True when the grid holds exactly one cell. */
export function isSingleCell(grid: ValueGrid): boolean {
  return grid.rows === 1 && grid.cols === 1;
}

/** The grid's cells in row-major order as a flat list. */
export function flattenGrid(grid: ValueGrid): FormulaValue[] {
  const out: FormulaValue[] = [];
  for (let r = 0; r < grid.rows; r++) {
    const row = grid.cells[r];
    for (let c = 0; c < grid.cols; c++) {
      out.push(row[c]);
    }
  }
  return out;
}

/** The first error anywhere in the grid (row-major scan), or null. */
export function gridError(grid: ValueGrid): FormulaValue | null {
  for (let r = 0; r < grid.rows; r++) {
    const row = grid.cells[r];
    for (let c = 0; c < grid.cols; c++) {
      if (row[c].type === 'error') {
        return row[c];
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Documented limits
// ---------------------------------------------------------------------------
//
// Every bound below exists so a formula typed by a user — or arriving inside an
// untrusted `.rsf` file — cannot hang the tab, exhaust memory, or blow the
// stack. They are deliberately generous for real spreadsheets and hard for
// abusive ones. `docs/security.md` documents them as a group.

/** Longest formula source accepted, in UTF-16 code units. */
export const MAX_FORMULA_LENGTH = 8192;

/** Maximum arguments in one function call. */
export const MAX_FUNCTION_ARGS = 255;

/** Maximum cells visited by one range/array argument. */
export const MAX_RANGE_CELLS = 2_000_000;

/** Maximum rows a dynamic array may spill. */
export const MAX_ARRAY_ROWS = 100_000;

/** Maximum columns a dynamic array may spill. */
export const MAX_ARRAY_COLS = 16_384;

/** Maximum cells one dynamic array may produce (rows × cols). */
export const MAX_ARRAY_CELLS = 1_000_000;

/** Maximum characters a text function may return. */
export const MAX_TEXT_LENGTH = 32_767;

/** Maximum characters in one criteria string. */
export const MAX_CRITERIA_LENGTH = 512;

/** Maximum criteria_range/criterion pairs for COUNTIFS / SUMIFS / AVERAGEIFS. */
export const MAX_CRITERIA_PAIRS = 32;

/** Maximum sort_index/order pairs accepted by SORT. */
export const MAX_SORT_KEYS = 8;

/** Maximum repetitions REPT-style growth may request (guards string blow-up). */
export const MAX_JOIN_ITEMS = MAX_RANGE_CELLS;

// ---------------------------------------------------------------------------
// Coercion
// ---------------------------------------------------------------------------

/**
 * Parse text as a number using the documented rule: surrounding whitespace is
 * ignored and the remainder must be a complete finite JavaScript numeric
 * literal. An empty or whitespace-only string is not a number.
 *
 * `Number('')` is 0 and `Number('  ')` is 0 in JavaScript, which is why the
 * empty check comes first — treating `""` as zero would make `=""+1` equal 1
 * instead of the `#VALUE!` a spreadsheet produces.
 */
export function parseNumericText(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') {
    return null;
  }
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/** Coerce to a number per the module's documented rules, or null. */
export function coerceToNumber(value: FormulaValue): number | null {
  switch (value.type) {
    case 'number':
      return value.value;
    case 'boolean':
      return value.value ? 1 : 0;
    case 'empty':
      return 0;
    case 'string':
      return parseNumericText(value.value);
    case 'error':
      return null;
  }
}

/**
 * Render a number the way the grid shows it: the shortest decimal string that
 * round-trips. This is `String(n)` — JavaScript already guarantees the
 * shortest round-tripping form — with the exponent spelling left as-is.
 */
export function numberToText(value: number): string {
  return String(value);
}

/** Coerce to text per the module's documented rules, or null for an error. */
export function coerceToText(value: FormulaValue): string | null {
  switch (value.type) {
    case 'string':
      return value.value;
    case 'number':
      return numberToText(value.value);
    case 'boolean':
      return value.value ? 'TRUE' : 'FALSE';
    case 'empty':
      return '';
    case 'error':
      return null;
  }
}

/**
 * Coerce to a boolean per the module's documented rules, or null.
 *
 * Text never coerces — not even `"TRUE"`. Conventional spreadsheets reject it
 * in a logical position, and accepting it would make `=AND(A1)` depend on
 * whether a cell holds the *word* TRUE or the boolean.
 */
export function coerceToBoolean(value: FormulaValue): boolean | null {
  switch (value.type) {
    case 'boolean':
      return value.value;
    case 'number':
      return value.value !== 0;
    case 'empty':
      return false;
    case 'string':
    case 'error':
      return null;
  }
}

/** Render a formula value for display in the grid. */
export function formatValue(value: FormulaValue): string {
  switch (value.type) {
    case 'number':
      return numberToText(value.value);
    case 'string':
      return value.value;
    case 'boolean':
      return value.value ? 'TRUE' : 'FALSE';
    case 'empty':
      return '';
    case 'error':
      return value.code;
  }
}

/**
 * Coerce a literal cell string to a formula value: numeric-looking strings
 * become numbers, empty strings the blank value, everything else text.
 *
 * Error codes typed literally into a cell stay **text**. A cell reading
 * `#REF!` because the user typed it is data, not a propagating error; only the
 * engine creates error values.
 */
export function literalToValue(input: string): FormulaValue {
  if (input === '') {
    return EMPTY_VALUE;
  }
  const n = parseNumericText(input);
  return n === null ? { type: 'string', value: input } : { type: 'number', value: n };
}

/**
 * Compare two values for sorting and for `=`/`<`/`>` comparisons, using the
 * documented total order across types:
 *
 *   numbers < text < booleans < errors < blanks
 *
 * Within a kind: numbers compare numerically; text compares by UTF-16 code
 * unit (case-sensitively — `"a"` and `"A"` are distinct); `FALSE < TRUE`;
 * errors compare by their position in {@link ERROR_CODES}; blanks are equal.
 *
 * This order is used by `SORT`, `UNIQUE`, `MODE.SNGL`, `RANK.EQ`, and
 * `MATCH`. It is a *total* order, so sorting is deterministic for any mix of
 * types — conventional spreadsheets leave mixed-type ordering unspecified.
 */
export function compareValues(a: FormulaValue, b: FormulaValue): number {
  const ra = typeRank(a);
  const rb = typeRank(b);
  if (ra !== rb) {
    return ra < rb ? -1 : 1;
  }
  switch (a.type) {
    case 'number':
      return cmpNumber(a.value, (b as { type: 'number'; value: number }).value);
    case 'string': {
      const s = (b as { type: 'string'; value: string }).value;
      return a.value < s ? -1 : a.value > s ? 1 : 0;
    }
    case 'boolean': {
      const other = (b as { type: 'boolean'; value: boolean }).value;
      return a.value === other ? 0 : a.value ? 1 : -1;
    }
    case 'error': {
      const ia = ERROR_CODES.indexOf(a.code);
      const ib = ERROR_CODES.indexOf((b as { type: 'error'; code: ErrorCode }).code);
      return cmpNumber(ia, ib);
    }
    case 'empty':
      return 0;
  }
}

function cmpNumber(a: number, b: number): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function typeRank(value: FormulaValue): number {
  switch (value.type) {
    case 'number':
      return 0;
    case 'string':
      return 1;
    case 'boolean':
      return 2;
    case 'error':
      return 3;
    case 'empty':
      return 4;
  }
}

/**
 * Equality used by lookup and de-duplication (`XLOOKUP`, `VLOOKUP`, `MATCH`,
 * `UNIQUE`, `COUNTIF` with a plain value).
 *
 * Text matches **case-insensitively**, which is what conventional spreadsheets
 * do for lookups and criteria and is the one place the engine deliberately
 * departs from {@link compareValues}'s case-sensitive ordering. A blank equals
 * another blank, and equals the empty string. Errors never match anything,
 * including an identical error — an error is a failure, not a key.
 */
export function valuesEqual(a: FormulaValue, b: FormulaValue): boolean {
  if (a.type === 'error' || b.type === 'error') {
    return false;
  }
  const aBlank = a.type === 'empty' || (a.type === 'string' && a.value === '');
  const bBlank = b.type === 'empty' || (b.type === 'string' && b.value === '');
  if (aBlank || bBlank) {
    return aBlank && bBlank;
  }
  if (a.type === 'string' && b.type === 'string') {
    return foldCase(a.value) === foldCase(b.value);
  }
  if (a.type === 'boolean' || b.type === 'boolean') {
    return a.type === b.type && a.type === 'boolean' && a.value === (b as typeof a).value;
  }
  const na = a.type === 'number' ? a.value : null;
  const nb = b.type === 'number' ? b.value : null;
  if (na !== null && nb !== null) {
    return na === nb;
  }
  // A number never equals text in a lookup, matching conventional spreadsheets
  // (a numeric-looking *string* key does not find a numeric cell).
  return false;
}

/**
 * The case-folding used for lookup and criteria matching. `toLowerCase()`
 * without a locale is deliberate: a locale-sensitive fold would make a
 * workbook's results depend on the host's language, which the offline,
 * portable-file guarantee forbids.
 */
export function foldCase(text: string): string {
  return text.toLowerCase();
}

/**
 * A key that groups values which {@link valuesEqual} considers equal, for
 * de-duplication in `UNIQUE` and `MODE.SNGL`. Values with no key (errors)
 * return null and must be handled explicitly by the caller.
 */
export function equalityKey(value: FormulaValue): string | null {
  switch (value.type) {
    case 'error':
      return null;
    case 'empty':
      return 's:';
    case 'string':
      return value.value === '' ? 's:' : `s:${foldCase(value.value)}`;
    case 'number':
      return `n:${value.value}`;
    case 'boolean':
      return `b:${value.value ? 1 : 0}`;
  }
}
