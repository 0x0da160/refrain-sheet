// SPDX-License-Identifier: MIT
/**
 * The dynamic-array spill engine.
 *
 * A formula that returns a rectangular array writes its result across the
 * worksheet starting at the formula cell. That cell is the **spill anchor**;
 * the rest of the rectangle are **derived cells**.
 *
 * ## The one design decision everything follows from
 *
 * Derived cells are **never stored**. A worksheet holds exactly what the user
 * typed; the spill map is recomputed from those inputs whenever the workbook
 * changes. That single choice is what makes the rest fall out for free:
 *
 * - **Persistence.** A `.rsf` file records the anchor formula and nothing else,
 *   so no derived value can go stale on disk and no format change is needed to
 *   store one. Older readers see a normal formula cell.
 * - **Undo/redo.** Undo restores *inputs*; the spill is recomputed from them.
 *   There is no separate spill state to keep in sync with history.
 * - **Structural edits.** Inserting or deleting a row moves the anchor and
 *   rewrites its references exactly like any other formula; the spill follows.
 * - **CSV export, filters, search.** All of them read displayed values, which
 *   already consult the spill map.
 *
 * The cost is that a spill must be recomputed after every mutation. That is
 * bounded by {@link canSpill}, a static check that skips any formula which
 * cannot possibly return an array, and by {@link MAX_SPILL_ANCHORS}.
 *
 * ## Placement rules
 *
 * Anchors are placed in **row-major order** — top-to-bottom, left-to-right —
 * and the first one to claim a cell keeps it. An anchor is **blocked**, showing
 * `#SPILL!` and writing nothing at all, when:
 *
 * 1. the rectangle would extend past the worksheet's last row or column
 *    (spilling never silently grows the grid), or
 * 2. any cell it covers other than the anchor itself holds a value, or
 * 3. any cell it covers is already an anchor or a derived cell of an earlier
 *    spill.
 *
 * Blocking is all-or-nothing: a blocked anchor never writes a partial result.
 *
 * ## What a spilling formula can see
 *
 * A dynamic-array formula reads derived cells as **blank**. Anchors are all
 * evaluated before any of them is placed, so the answer cannot depend on the
 * order two spills happen to sit in, and there is no way to build a spill that
 * feeds itself. Ordinary formulas — `SUM`, `IF`, everything that is not itself
 * an array formula — see spilled values normally. To chain one dynamic array
 * into another, reference the *anchor* cell.
 */

import type { AstNode } from './formula';
import { lookupFunction } from './formula-functions';
import type { ValueGrid } from './formula-value';

/**
 * Maximum spill anchors evaluated per worksheet. Past this the remaining
 * anchors report `#SPILL!` rather than being silently ignored, so a file
 * crafted with thousands of array formulas cannot make a recalculation
 * unbounded.
 */
export const MAX_SPILL_ANCHORS = 512;

/** Maximum cells all spills on one worksheet may occupy together. */
export const MAX_SPILL_CELLS = 1_000_000;

/** A placed spill: the anchor cell, its rectangle, and the values it holds. */
export interface SpillAnchor {
  readonly row: number;
  readonly col: number;
  /** Inclusive last row of the rectangle. */
  readonly bottom: number;
  /** Inclusive last column of the rectangle. */
  readonly right: number;
  readonly grid: ValueGrid;
}

/**
 * The spill state of one worksheet. Empty maps are the overwhelmingly common
 * case and cost nothing to consult.
 */
export interface SpillMap {
  /** Placed anchors, keyed `"row,col"`. */
  readonly anchors: ReadonlyMap<string, SpillAnchor>;
  /** Derived cells, keyed `"row,col"`, mapped to their anchor's key. */
  readonly derived: ReadonlyMap<string, string>;
  /** Anchors that could not spill, keyed `"row,col"`; these show `#SPILL!`. */
  readonly blocked: ReadonlySet<string>;
}

/** An empty spill map; shared, so worksheets without arrays allocate nothing. */
export const EMPTY_SPILL_MAP: SpillMap = {
  anchors: new Map(),
  derived: new Map(),
  blocked: new Set(),
};

export function cellKey(row: number, col: number): string {
  return `${row},${col}`;
}

/** True when the map holds nothing at all. */
export function isEmptySpillMap(map: SpillMap): boolean {
  return map.anchors.size === 0 && map.blocked.size === 0;
}

/**
 * Static, cheap test for whether a parsed formula could return an array.
 *
 * Only calls to functions the registry marks `dynamic` can, so a workbook full
 * of ordinary `SUM` formulas costs one AST walk per formula and no evaluation
 * at all. The walk is conservative: it says yes whenever a dynamic function
 * appears anywhere, even somewhere its result would be collapsed to a scalar.
 * A false yes only costs one evaluation; a false *no* would lose a spill, so
 * the bias is deliberate.
 */
export function canSpill(ast: AstNode): boolean {
  switch (ast.kind) {
    case 'call': {
      if (lookupFunction(ast.name)?.dynamic === true) {
        return true;
      }
      return ast.args.some(canSpill);
    }
    case 'unary':
      return canSpill(ast.operand);
    case 'binary':
      // A comparison against a range is the one operator that spreads
      // element-wise, so `=A1:A3>5` really can produce an array.
      if (COMPARISON_OPS.has(ast.op) && (isRangeNode(ast.left) || isRangeNode(ast.right))) {
        return true;
      }
      return canSpill(ast.left) || canSpill(ast.right);
    default:
      return false;
  }
}

const COMPARISON_OPS = new Set(['=', '<>', '<', '>', '<=', '>=']);

function isRangeNode(ast: AstNode): boolean {
  return ast.kind === 'range' || ast.kind === 'colrange' || ast.kind === 'rowrange';
}

/** What the spill builder needs from a worksheet. */
export interface SpillSource {
  readonly rowCount: number;
  readonly columnCount: number;
  /** The raw input of a cell (empty string for an empty cell). */
  getValue(row: number, col: number): string;
  /**
   * Every formula cell that {@link canSpill} accepts, in row-major order,
   * already evaluated to its array result — or null when this evaluation did
   * not produce one (a scalar, or an error).
   */
  listArrayResults(): Array<{ row: number; col: number; grid: ValueGrid | null }>;
}

/**
 * Place every array result on the worksheet, resolving collisions by the
 * documented rules. Pure: it reads the source and returns a new map.
 */
export function buildSpillMap(source: SpillSource): SpillMap {
  const results = source.listArrayResults();
  if (results.length === 0) {
    return EMPTY_SPILL_MAP;
  }
  const anchors = new Map<string, SpillAnchor>();
  const derived = new Map<string, string>();
  const blocked = new Set<string>();
  let placedCells = 0;
  let considered = 0;

  for (const entry of results) {
    if (entry.grid === null) {
      continue;
    }
    const key = cellKey(entry.row, entry.col);
    considered += 1;
    if (considered > MAX_SPILL_ANCHORS) {
      blocked.add(key);
      continue;
    }
    const bottom = entry.row + entry.grid.rows - 1;
    const right = entry.col + entry.grid.cols - 1;
    if (bottom >= source.rowCount || right >= source.columnCount) {
      blocked.add(key);
      continue;
    }
    if (placedCells + entry.grid.rows * entry.grid.cols > MAX_SPILL_CELLS) {
      blocked.add(key);
      continue;
    }
    let clear = true;
    for (let r = entry.row; r <= bottom && clear; r++) {
      for (let c = entry.col; c <= right; c++) {
        const target = cellKey(r, c);
        if (r === entry.row && c === entry.col) {
          continue; // the anchor holds the formula itself
        }
        if (source.getValue(r, c) !== '' || derived.has(target) || anchors.has(target)) {
          clear = false;
          break;
        }
      }
    }
    if (!clear) {
      blocked.add(key);
      continue;
    }
    anchors.set(key, { row: entry.row, col: entry.col, bottom, right, grid: entry.grid });
    for (let r = entry.row; r <= bottom; r++) {
      for (let c = entry.col; c <= right; c++) {
        if (r === entry.row && c === entry.col) {
          continue;
        }
        derived.set(cellKey(r, c), key);
      }
    }
    placedCells += entry.grid.rows * entry.grid.cols;
  }
  if (anchors.size === 0 && blocked.size === 0) {
    return EMPTY_SPILL_MAP;
  }
  return { anchors, derived, blocked };
}

/** The anchor a derived cell belongs to, or null when the cell is ordinary. */
export function anchorOfDerived(map: SpillMap, row: number, col: number): SpillAnchor | null {
  const anchorKey = map.derived.get(cellKey(row, col));
  return anchorKey === undefined ? null : (map.anchors.get(anchorKey) ?? null);
}

/**
 * The value a derived cell displays, or null when the cell is not derived.
 * Reading is O(1): the anchor's grid is indexed directly by the offset.
 */
export function derivedValue(
  map: SpillMap,
  row: number,
  col: number,
): ValueGrid['cells'][number][number] | null {
  const anchor = anchorOfDerived(map, row, col);
  if (!anchor) {
    return null;
  }
  return anchor.grid.cells[row - anchor.row][col - anchor.col];
}

/** True when the cell is a derived spill cell (not the anchor). */
export function isDerivedCell(map: SpillMap, row: number, col: number): boolean {
  return map.derived.has(cellKey(row, col));
}

/** True when the anchor at this cell could not spill and shows `#SPILL!`. */
export function isBlockedAnchor(map: SpillMap, row: number, col: number): boolean {
  return map.blocked.has(cellKey(row, col));
}
