// SPDX-License-Identifier: MIT
/**
 * The tree-walking evaluator: turns AST nodes into lazy, memoized `FnArg`
 * accessors and hands them to the function registry. Laziness is a
 * correctness requirement (see knowledge/architecture/dependency-rules.md).
 */
import { DEFAULT_DISPLAY_LANGUAGE, type DisplayLanguageId } from '../workbook/display-language';
import {
  type FnArg,
  type FnContext,
  type FnResult,
  type GridResult,
  isGrid,
  lookupFunction,
} from './functions';
import type { AstNode } from './parser';
import {
  coerceToNumber,
  coerceToText,
  EMPTY_VALUE,
  errorValue,
  firstError,
  type FormulaValue,
  makeGrid,
  MAX_RANGE_CELLS,
  MAX_TEXT_LENGTH,
  numberValue,
  scalarGrid,
  type ValueGrid,
} from './value';

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

export interface EvalContext {
  /** Resolve a cell on the *current* worksheet (already computed for formula cells). */
  getCell(row: number, col: number): FormulaValue;
  /**
   * Used-grid bounds. Whole-column (`A:A`) and whole-row (`1:1`) ranges are
   * clamped to these so they cover only the actual sheet, never an unbounded
   * space. When omitted (e.g. a bare cell context in tests) whole-column/row
   * ranges resolve to empty.
   */
  rowCount?: number;
  columnCount?: number;
  /**
   * Resolve a cell on another worksheet of the same workbook, for
   * worksheet-qualified references (`Sheet1!A1`). Supplied by the workbook,
   * which owns the shared evaluation memo and the in-progress set — that is
   * what makes circular references detectable *across* worksheets. When this
   * is omitted (a single-sheet context) any qualified reference is #REF!.
   */
  getSheetCell?(sheet: string, row: number, col: number): FormulaValue;
  /**
   * Used-grid bounds of another worksheet, resolved by name (case-insensitively,
   * matching the worksheet-name uniqueness policy). Returns null when no such
   * worksheet exists, which makes the whole reference #REF! — a deleted or
   * unknown worksheet is never silently redirected to another one.
   */
  getSheetBounds?(sheet: string): { rowCount: number; columnCount: number } | null;
  /**
   * The wall-clock instant this recalculation pass reads, in milliseconds
   * since the Unix epoch. Supplied by the workbook and held fixed for the
   * whole pass so every `TODAY()` / `NOW()` in a workbook agrees. Omitted in
   * bare test contexts, where it reads as the epoch — deliberately, so a test
   * that forgets to set it fails loudly rather than depending on the clock.
   */
  nowMs?: number;
  /**
   * The workbook's stored display language, read by `TEXT()`'s `ddd`/`dddd`
   * weekday-name tokens (`formula-text-format.ts`). Supplied by the workbook;
   * omitted in bare test contexts, where it falls back to
   * {@link DEFAULT_DISPLAY_LANGUAGE}.
   */
  displayLanguage?: DisplayLanguageId;
}

/**
 * The clock (and other per-pass settings) a recalculation pass reads.
 * Supplied by the workbook so every volatile function in one pass agrees, and
 * injectable so tests never depend on the wall clock.
 */
function contextClock(ctx: EvalContext): FnContext {
  return { nowMs: ctx.nowMs ?? 0, displayLanguage: ctx.displayLanguage ?? DEFAULT_DISPLAY_LANGUAGE };
}

/**
 * Evaluate a parsed formula to a single value. Scalar semantics:
 * - arithmetic coerces numbers, booleans (1/0), empties (0), and numeric
 *   strings; other strings produce #VALUE!,
 * - division by zero produces #DIV/0!,
 * - a bare range in scalar context produces #VALUE!,
 * - errors propagate,
 * - references outside the sheet evaluate as empty cells.
 *
 * When the formula produces an **array**, this returns its top-left value —
 * what the spill anchor itself displays. Use {@link evaluateAstArray} to get
 * the whole array for spilling.
 */
export function evaluateAst(ast: AstNode, ctx: EvalContext): FormulaValue {
  const result = evalNode(ast, ctx);
  if (result.kind === 'range') {
    return errorValue('#VALUE!');
  }
  if (result.kind === 'grid') {
    return result.grid.cells[0]?.[0] ?? EMPTY_VALUE;
  }
  return result.value;
}

/**
 * Evaluate a parsed formula, keeping an array result intact.
 *
 * Returns a {@link ValueGrid} only when the formula genuinely produced a
 * multi-cell array; a single value comes back as `null` grid with the value
 * set, so callers can spill only what needs spilling. A bare range
 * (`=A1:B2`) is **not** an array result — it is `#VALUE!`, exactly as before,
 * because implicit range-to-array promotion would change the meaning of every
 * existing formula.
 */
export function evaluateAstArray(
  ast: AstNode,
  ctx: EvalContext,
): { value: FormulaValue; grid: ValueGrid | null } {
  const result = evalNode(ast, ctx);
  if (result.kind === 'range') {
    return { value: errorValue('#VALUE!'), grid: null };
  }
  if (result.kind === 'grid') {
    const grid = result.grid;
    const top = grid.cells[0]?.[0] ?? EMPTY_VALUE;
    return { value: top, grid: grid.rows === 1 && grid.cols === 1 ? null : grid };
  }
  return { value: result.value, grid: null };
}

/**
 * A range result carries already-normalized, inclusive, used-grid-clamped
 * numeric bounds. An empty range (a whole-column/row range with no used grid,
 * or a column/row beyond the used bounds) has `top > bottom` or `left > right`.
 */
type EvalResult =
  | { kind: 'scalar'; value: FormulaValue }
  | {
      kind: 'range';
      top: number;
      bottom: number;
      left: number;
      right: number;
      /** Worksheet the range belongs to, for a qualified range (`Sheet1!A1:B10`). */
      sheet?: string;
    }
  /** A computed array, produced only by a dynamic-array function. */
  | { kind: 'grid'; grid: ValueGrid };

function scalar(value: FormulaValue): EvalResult {
  return { kind: 'scalar', value };
}

function range(top: number, bottom: number, left: number, right: number, sheet?: string): EvalResult {
  return sheet === undefined
    ? { kind: 'range', top, bottom, left, right }
    : { kind: 'range', top, bottom, left, right, sheet };
}

/**
 * Resolve the used-grid bounds a reference should be clamped to. Returns null
 * when the reference names a worksheet that cannot be resolved (deleted,
 * renamed, or absent), which makes the whole reference #REF!.
 */
function boundsFor(sheet: string | undefined, ctx: EvalContext): { rows: number; cols: number } | null {
  if (sheet === undefined) {
    return { rows: ctx.rowCount ?? 0, cols: ctx.columnCount ?? 0 };
  }
  const resolved = ctx.getSheetCell && ctx.getSheetBounds ? ctx.getSheetBounds(sheet) : null;
  return resolved ? { rows: resolved.rowCount, cols: resolved.columnCount } : null;
}

/** The cell reader for a (possibly worksheet-qualified) reference. */
function cellReaderFor(
  sheet: string | undefined,
  ctx: EvalContext,
): (row: number, col: number) => FormulaValue {
  if (sheet === undefined) {
    return (row, col) => ctx.getCell(row, col);
  }
  const getSheetCell = ctx.getSheetCell;
  if (!getSheetCell) {
    return () => errorValue('#REF!');
  }
  return (row, col) => getSheetCell(sheet, row, col);
}

function evalNode(ast: AstNode, ctx: EvalContext): EvalResult {
  switch (ast.kind) {
    case 'number':
      return scalar(numberValue(ast.value));
    case 'string':
      return scalar({ type: 'string', value: ast.value });
    case 'boolean':
      return scalar({ type: 'boolean', value: ast.value });
    case 'blank':
      return scalar(EMPTY_VALUE);
    case 'error':
      return scalar(errorValue(ast.code));
    case 'ref': {
      // A worksheet-qualified reference must resolve to a real worksheet;
      // an unknown name is #REF!, never silently redirected.
      if (ast.sheet !== undefined && boundsFor(ast.sheet, ctx) === null) {
        return scalar(errorValue('#REF!'));
      }
      return scalar(cellReaderFor(ast.sheet, ctx)(ast.row, ast.col));
    }
    case 'range': {
      if (ast.sheet !== undefined && boundsFor(ast.sheet, ctx) === null) {
        return scalar(errorValue('#REF!'));
      }
      const top = Math.min(ast.from.row, ast.to.row);
      const bottom = Math.max(ast.from.row, ast.to.row);
      const left = Math.min(ast.from.col, ast.to.col);
      const right = Math.max(ast.from.col, ast.to.col);
      return range(top, bottom, left, right, ast.sheet);
    }
    case 'colrange': {
      // A:C over the used grid: all used rows, columns clamped to used bounds.
      const bounds = boundsFor(ast.sheet, ctx);
      if (!bounds) {
        return scalar(errorValue('#REF!'));
      }
      const left = Math.min(ast.fromCol, ast.toCol);
      const right = Math.min(Math.max(ast.fromCol, ast.toCol), bounds.cols - 1);
      return range(0, bounds.rows - 1, left, right, ast.sheet);
    }
    case 'rowrange': {
      // 1:10 over the used grid: all used columns, rows clamped to used bounds.
      const bounds = boundsFor(ast.sheet, ctx);
      if (!bounds) {
        return scalar(errorValue('#REF!'));
      }
      const top = Math.min(ast.fromRow, ast.toRow);
      const bottom = Math.min(Math.max(ast.fromRow, ast.toRow), bounds.rows - 1);
      return range(top, bottom, 0, bounds.cols - 1, ast.sheet);
    }
    case 'unary': {
      const operand = asScalar(evalNode(ast.operand, ctx));
      if (operand === null) {
        return scalar(errorValue('#VALUE!'));
      }
      const err = firstError(operand);
      if (err) {
        return scalar(err);
      }
      const n = coerceToNumber(operand);
      if (n === null) {
        return scalar(errorValue('#VALUE!'));
      }
      return scalar(numberValue(ast.op === '-' ? -n : n));
    }
    case 'binary':
      return evalBinary(ast.op, ast.left, ast.right, ctx);
    case 'call':
      return evalCall(ast.name, ast.args, ctx);
  }
}

/**
 * The single value an evaluation result stands for in scalar position, or null
 * when it has none.
 *
 * A range never has one — `=A1:B2 + 1` is `#VALUE!`, unchanged. A computed
 * array collapses only when it holds exactly one cell; a genuine multi-cell
 * array in an arithmetic position is `#VALUE!` rather than being broadcast,
 * because element-wise broadcasting would silently turn `=SEQUENCE(3)+1` into
 * a spilling formula and change what an existing workbook computes. This
 * limitation is documented in the help dialog and `knowledge/formats/rsf/index.md`.
 */
function asScalar(result: EvalResult): FormulaValue | null {
  if (result.kind === 'scalar') {
    return result.value;
  }
  if (result.kind === 'grid' && result.grid.rows === 1 && result.grid.cols === 1) {
    return result.grid.cells[0][0];
  }
  return null;
}

const COMPARISON_OPS: readonly string[] = ['=', '<>', '<', '>', '<=', '>='];

/**
 * Element-wise comparison of a range or array against a scalar, or against
 * another range or array of the same shape.
 *
 * This is the **only** operator that spreads over a range, and it exists
 * because `FILTER(data, range > 5)` — the way a condition is written — needs
 * it. Arithmetic deliberately does not spread: `=A1:A3 + 1` stays `#VALUE!`,
 * because making it spill would change what an existing formula does, whereas
 * `=A1:A3 > 5` is `#VALUE!` today and so has no behaviour to preserve.
 *
 * Mismatched shapes are `#VALUE!` rather than being recycled or truncated.
 */
function compareGrids(
  op: string,
  left: ValueGrid | FormulaValue,
  right: ValueGrid | FormulaValue,
): EvalResult {
  const leftGrid = isValueGrid(left) ? left : null;
  const rightGrid = isValueGrid(right) ? right : null;
  const rows = leftGrid?.rows ?? rightGrid?.rows ?? 1;
  const cols = leftGrid?.cols ?? rightGrid?.cols ?? 1;
  if (leftGrid && rightGrid && (leftGrid.rows !== rightGrid.rows || leftGrid.cols !== rightGrid.cols)) {
    return scalar(errorValue('#VALUE!'));
  }
  const cells: FormulaValue[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: FormulaValue[] = [];
    for (let c = 0; c < cols; c++) {
      const a = leftGrid ? leftGrid.cells[r][c] : (left as FormulaValue);
      const b = rightGrid ? rightGrid.cells[r][c] : (right as FormulaValue);
      const err = firstError(a, b);
      row.push(err ?? evalComparison(op, a, b));
    }
    cells.push(row);
  }
  if (rows === 1 && cols === 1) {
    return scalar(cells[0][0]);
  }
  return { kind: 'grid', grid: makeGrid(cells) };
}

function isValueGrid(value: ValueGrid | FormulaValue): value is ValueGrid {
  return (value as ValueGrid).cells !== undefined;
}

/**
 * An evaluation result as either a single value or a multi-cell grid, or the
 * error that stopped it from being either.
 */
function materialize(
  result: EvalResult,
  ctx: EvalContext,
): { ok: true; value: ValueGrid | FormulaValue } | { ok: false; error: FormulaValue } {
  if (result.kind === 'scalar') {
    return { ok: true, value: result.value };
  }
  if (result.kind === 'grid') {
    return { ok: true, value: result.grid };
  }
  const grid = rangeToGrid(result, ctx);
  return grid.ok ? { ok: true, value: grid.grid } : { ok: false, error: grid.error };
}

function evalBinary(op: string, leftAst: AstNode, rightAst: AstNode, ctx: EvalContext): EvalResult {
  const leftResult = evalNode(leftAst, ctx);
  const rightResult = evalNode(rightAst, ctx);
  if (COMPARISON_OPS.includes(op) && (leftResult.kind !== 'scalar' || rightResult.kind !== 'scalar')) {
    const a = materialize(leftResult, ctx);
    if (!a.ok) {
      return scalar(a.error);
    }
    const b = materialize(rightResult, ctx);
    if (!b.ok) {
      return scalar(b.error);
    }
    return compareGrids(op, a.value, b.value);
  }
  return scalar(evalScalarBinary(op, leftResult, rightResult));
}

function evalScalarBinary(op: string, leftResult: EvalResult, rightResult: EvalResult): FormulaValue {
  const left = asScalar(leftResult);
  const right = asScalar(rightResult);
  if (left === null || right === null) {
    return errorValue('#VALUE!');
  }
  const err = firstError(left, right);
  if (err) {
    return err;
  }
  if (COMPARISON_OPS.includes(op)) {
    return evalComparison(op, left, right);
  }
  if (op === '&') {
    // Each side as CONCAT would write it; errors were handled above.
    const text = (coerceToText(left) ?? '') + (coerceToText(right) ?? '');
    return text.length > MAX_TEXT_LENGTH ? errorValue('#VALUE!') : { type: 'string', value: text };
  }
  const a = coerceToNumber(left);
  const b = coerceToNumber(right);
  if (a === null || b === null) {
    return errorValue('#VALUE!');
  }
  switch (op) {
    case '+':
      return numberValue(a + b);
    case '-':
      return numberValue(a - b);
    case '*':
      return numberValue(a * b);
    case '/':
      if (b === 0) {
        return errorValue('#DIV/0!');
      }
      return numberValue(a / b);
    default:
      return errorValue('#ERROR!');
  }
}

/**
 * Comparison semantics: numbers (and coercible values) compare numerically,
 * strings compare case-sensitively by code point. A number compared with a
 * non-numeric string is unequal ('=' false, '<>' true); ordering across
 * incomparable types produces #VALUE!.
 */
function evalComparison(op: string, left: FormulaValue, right: FormulaValue): FormulaValue {
  const bool = (v: boolean): FormulaValue => ({ type: 'boolean', value: v });
  if (left.type === 'string' && right.type === 'string') {
    const cmp = left.value < right.value ? -1 : left.value > right.value ? 1 : 0;
    return compareResult(op, cmp, bool);
  }
  const a = coerceToNumber(left);
  const b = coerceToNumber(right);
  if (a !== null && b !== null) {
    return compareResult(op, a < b ? -1 : a > b ? 1 : 0, bool);
  }
  // Treat empty as equal to the empty string.
  if (
    (left.type === 'empty' && right.type === 'string') ||
    (left.type === 'string' && right.type === 'empty')
  ) {
    const s = left.type === 'string' ? left.value : (right as { type: 'string'; value: string }).value;
    const cmp = s === '' ? 0 : -1;
    if (op === '=') return bool(cmp === 0);
    if (op === '<>') return bool(cmp !== 0);
    return errorValue('#VALUE!');
  }
  if (op === '=') {
    return bool(false);
  }
  if (op === '<>') {
    return bool(true);
  }
  return errorValue('#VALUE!');
}

function compareResult(op: string, cmp: number, bool: (v: boolean) => FormulaValue): FormulaValue {
  switch (op) {
    case '=':
      return bool(cmp === 0);
    case '<>':
      return bool(cmp !== 0);
    case '<':
      return bool(cmp < 0);
    case '>':
      return bool(cmp > 0);
    case '<=':
      return bool(cmp <= 0);
    case '>=':
      return bool(cmp >= 0);
    default:
      return errorValue('#ERROR!');
  }
}

/**
 * Per-context cache of materialized range grids, so a range read by many
 * formula cells (a copied-down VLOOKUP/XLOOKUP table is the common case)
 * builds its rows×cols array once instead of once per reader. Keyed by
 * {@link EvalContext} identity rather than stored on the interface itself,
 * so the cache is invisible to (and never has to be wired up by) callers
 * that build a bare context — it simply never gets populated for them.
 *
 * The workbook is responsible for handing out one context per worksheet per
 * revision and dropping it on every mutation, which is what makes this
 * cache revision-scoped; see `rsf-document.ts`'s `evalContexts` field.
 */
const rangeGridCaches = new WeakMap<EvalContext, Map<string, GridResult>>();

/**
 * Materialize a range result as a grid, bounded by {@link MAX_RANGE_CELLS}.
 *
 * An empty range — a whole-column range on a sheet with no used grid, or a
 * span entirely beyond the used bounds — becomes a 1×1 blank rather than a
 * zero-sized grid, so aggregation over it contributes nothing instead of
 * erroring.
 */
function rangeToGrid(result: Extract<EvalResult, { kind: 'range' }>, ctx: EvalContext): GridResult {
  const { top, bottom, left, right, sheet } = result;
  if (bottom < top || right < left) {
    return { ok: true, grid: scalarGrid(EMPTY_VALUE) };
  }
  const cellCount = (bottom - top + 1) * (right - left + 1);
  if (cellCount > MAX_RANGE_CELLS) {
    return { ok: false, error: errorValue('#VALUE!') };
  }
  const cacheKey = `${sheet ?? ''}|${top}|${bottom}|${left}|${right}`;
  let cache = rangeGridCaches.get(ctx);
  const cached = cache?.get(cacheKey);
  if (cached) {
    return cached;
  }
  const readCell = cellReaderFor(sheet, ctx);
  const cells: FormulaValue[][] = [];
  // A cell still on the in-progress stack (a self-reference read through this
  // range, typically caught by IFERROR) reads back as a transient #CYCLE!
  // placeholder that is never what the cell settles to. Such a grid must not
  // be cached under the range's key, or a later, independent read of the same
  // range would see the placeholder instead of the cell's real, memoized
  // value — see the "self-referential range" regression test.
  let sawTransientCycle = false;
  for (let r = top; r <= bottom; r++) {
    const row: FormulaValue[] = [];
    for (let c = left; c <= right; c++) {
      const value = readCell(r, c);
      if (value.type === 'error' && value.code === '#CYCLE!') {
        sawTransientCycle = true;
      }
      row.push(value);
    }
    cells.push(row);
  }
  const built: GridResult = { ok: true, grid: makeGrid(cells) };
  if (!sawTransientCycle) {
    if (!cache) {
      cache = new Map();
      rangeGridCaches.set(ctx, cache);
    }
    cache.set(cacheKey, built);
  }
  return built;
}

/**
 * Build the lazy, memoized accessor a function sees for one argument.
 *
 * Laziness is not an optimization here, it is a correctness requirement: `IF`
 * and `IFERROR` must be able to *not* evaluate a branch whose evaluation would
 * raise an error the formula exists to avoid. Memoization then guarantees that
 * a function reading the same argument as both a value and a grid evaluates
 * it once.
 */
function makeArg(node: AstNode, ctx: EvalContext): FnArg {
  let evaluated: EvalResult | null = null;
  const resolve = (): EvalResult => (evaluated ??= evalNode(node, ctx));
  let gridCache: GridResult | null = null;
  const isRangeNode = node.kind === 'range' || node.kind === 'colrange' || node.kind === 'rowrange';
  return {
    value(): FormulaValue {
      return asScalar(resolve()) ?? errorValue('#VALUE!');
    },
    grid(): GridResult {
      if (gridCache) {
        return gridCache;
      }
      const result = resolve();
      if (result.kind === 'range') {
        gridCache = rangeToGrid(result, ctx);
      } else if (result.kind === 'grid') {
        gridCache = { ok: true, grid: result.grid };
      } else if (result.value.type === 'error') {
        gridCache = { ok: false, error: result.value };
      } else {
        gridCache = { ok: true, grid: scalarGrid(result.value) };
      }
      return gridCache;
    },
    isRange(): boolean {
      return isRangeNode;
    },
    isOmitted(): boolean {
      return node.kind === 'blank';
    },
  };
}

/**
 * Dispatch a call through the registry. The registry owns names, arity, and
 * semantics; this function owns only the plumbing between AST nodes and
 * {@link FnArg} accessors.
 *
 * A grid result becomes a `grid` evaluation result, which the workbook turns
 * into a spill. Everything else is a scalar.
 */
function evalCall(name: string, args: AstNode[], ctx: EvalContext): EvalResult {
  const fn = lookupFunction(name);
  if (!fn) {
    return scalar(errorValue('#NAME?'));
  }
  if (args.length < fn.minArgs || args.length > fn.maxArgs) {
    return scalar(errorValue('#ERROR!'));
  }
  const accessors = args.map((node) => makeArg(node, ctx));
  let result: FnResult;
  try {
    result = fn.call(accessors, contextClock(ctx));
  } catch {
    // A function must not be able to take the whole application down. Any
    // unexpected throw (a host limit such as string length, or a bug) becomes
    // an ordinary formula error in that one cell.
    return scalar(errorValue('#VALUE!'));
  }
  return isGrid(result) ? { kind: 'grid', grid: result } : scalar(result);
}
