// SPDX-License-Identifier: MIT
/**
 * Moving a rectangular cell range to another location (RSF worksheets only).
 *
 * This module is pure and DOM-free: it plans a move as a list of cell changes
 * plus the formula-reference rewrites the move implies, and reports what the
 * move would overwrite. Nothing here mutates a document — the command layer
 * applies the plan as one atomic history entry after the user has confirmed
 * anything that needs confirming.
 *
 * ## Reference semantics
 *
 * A move is not a copy. The rule, matching established spreadsheet behavior
 * and applied uniformly to every formula in the **whole workbook**:
 *
 * > A reference to a cell that is being moved follows it to its new location.
 * > Every other reference is left exactly as written.
 *
 * Three consequences, all of them tested:
 *
 * - A formula **inside** the moved range keeps pointing at the same data. Its
 *   references to cells outside the range do not shift (unlike a copy, where
 *   relative references move with the formula); its references to cells that
 *   are *also* inside the range follow them, so an internal relationship such
 *   as `=A1+A2` stays intact.
 * - A formula **elsewhere** that referenced a moved cell — on this worksheet or
 *   through a cross-sheet reference such as `Sheet1!B2` — is updated to the new
 *   location, so it keeps reading the value the user pointed it at.
 * - `$` absolute markers are preserved: only the coordinates are rewritten, so
 *   relative, absolute, and mixed references all keep their kind.
 *
 * A **range** reference (`A1:B10`) follows the move only when the whole range
 * lies inside the moved rectangle. A range that merely overlaps it is left
 * unchanged: shrinking, splitting, or stretching it would all be guesses, and a
 * silent guess about what a formula means is worse than leaving it alone.
 * Whole-column and whole-row references are never rewritten by a move for the
 * same reason.
 */
import { normalizeRange, type CellRange } from './clipboard';
import { isFormula, rewriteFormulaRefs, MAX_REF_COLUMN, MAX_REF_ROW, type CellRefEx } from './formula';
import type { CellChange } from './history';

/** The minimal worksheet surface a move needs (satisfied by `Worksheet`). */
export interface MovableSheet {
  readonly id: string;
  readonly name: string;
  readonly rowCount: number;
  readonly columnCount: number;
  getValue(row: number, col: number): string;
  contains(row: number, col: number): boolean;
  listFormulaCells(): Array<{ row: number; col: number; src: string }>;
}

/** Why a destination is not a legal move target. */
export type RangeMoveRejection = 'out-of-bounds' | 'no-op';

export interface RangeMoveTarget {
  /** Destination rectangle (same size as the source). */
  range: CellRange;
  deltaRow: number;
  deltaCol: number;
}

/** Compute the destination rectangle for a source range and an offset. */
export function moveTarget(source: CellRange, deltaRow: number, deltaCol: number): RangeMoveTarget {
  const range = shiftRange(source, deltaRow, deltaCol);
  return { range, deltaRow, deltaCol };
}

/** Translate a rectangle by an offset, keeping it normalized. */
function shiftRange(range: CellRange, deltaRow: number, deltaCol: number): CellRange {
  return normalizeRange(
    { row: range.top + deltaRow, col: range.left + deltaCol },
    { row: range.bottom + deltaRow, col: range.right + deltaCol },
  );
}

/**
 * Whether a destination is valid. A move must land entirely inside the
 * worksheet — a move is never allowed to grow it, because that would silently
 * change the document's shape as a side effect of a drag — and must actually
 * move something.
 */
export function validateMove(
  sheet: MovableSheet,
  source: CellRange,
  target: RangeMoveTarget,
): RangeMoveRejection | null {
  if (target.deltaRow === 0 && target.deltaCol === 0) {
    return 'no-op';
  }
  const { range } = target;
  if (range.top < 0 || range.left < 0 || range.bottom >= sheet.rowCount || range.right >= sheet.columnCount) {
    return 'out-of-bounds';
  }
  void source;
  return null;
}

/** True when (row, col) lies inside a rectangle. */
function inside(range: CellRange, row: number, col: number): boolean {
  return row >= range.top && row <= range.bottom && col >= range.left && col <= range.right;
}

export interface RangeMovePlan {
  source: CellRange;
  target: CellRange;
  /** Cell writes on the moved worksheet: the destination values and the vacated cells. */
  changes: CellChange[];
  /**
   * Formula rewrites on **other** worksheets whose references pointed at moved
   * cells, keyed by worksheet id.
   */
  otherSheetChanges: Map<string, CellChange[]>;
  /** Non-empty destination cells (outside the source) that would be replaced. */
  overwriteCount: number;
  /** Cells actually carried across (the source rectangle's area). */
  movedCells: number;
}

/**
 * Rewrite one formula for a move: references to cells inside `source` (on the
 * moved worksheet) are shifted by the move delta; everything else is untouched.
 *
 * `homeSheetName` is the moved worksheet's name; `qualifiedOnly` is true when
 * rewriting a formula that lives on a *different* worksheet, where only
 * `Name!`-qualified references can possibly point at the moved cells.
 */
export function rewriteForMove(
  src: string,
  source: CellRange,
  deltaRow: number,
  deltaCol: number,
  homeSheetName: string,
  qualifiedOnly: boolean,
): string {
  if (!isFormula(src)) {
    return src;
  }
  const shift = (ref: CellRefEx): { row: number; col: number } | 'REF_ERROR' => {
    if (!inside(source, ref.row, ref.col)) {
      return { row: ref.row, col: ref.col };
    }
    const row = ref.row + deltaRow;
    const col = ref.col + deltaCol;
    if (row < 0 || col < 0 || row > MAX_REF_ROW || col > MAX_REF_COLUMN) {
      return 'REF_ERROR';
    }
    return { row, col };
  };
  return rewriteFormulaRefs(
    src,
    shift,
    (from, to) => {
      // A range follows the move only when it lies wholly inside it; a partial
      // overlap is left exactly as written (see the module comment).
      const whole = inside(source, from.row, from.col) && inside(source, to.row, to.col);
      if (!whole) {
        return { from: { row: from.row, col: from.col }, to: { row: to.row, col: to.col } };
      }
      const a = shift(from);
      const b = shift(to);
      if (a === 'REF_ERROR' || b === 'REF_ERROR') {
        return 'REF_ERROR';
      }
      return { from: a, to: b };
    },
    // Whole-column / whole-row spans are never rewritten by a move.
    undefined,
    undefined,
    {
      // On another worksheet the formula's own sheet is deliberately unknown,
      // so an *unqualified* reference is never treated as pointing here.
      homeSheet: qualifiedOnly ? undefined : homeSheetName,
      shouldMapCoords: (sheetName) =>
        sheetName !== null && sheetName.toLocaleLowerCase() === homeSheetName.toLocaleLowerCase(),
    },
  );
}

/**
 * Plan a move of `source` by (deltaRow, deltaCol) on `sheet`.
 *
 * The plan is built entirely from current values before anything is applied,
 * which is what makes the whole move a single atomic change: the caller either
 * applies every change or none of them. Source cells that the destination
 * overlaps are *not* cleared — a self-overlapping move keeps the cells the
 * destination reuses, which is the only reading of an overlap that loses no
 * data.
 *
 * `otherSheets` are the workbook's remaining worksheets, scanned so that
 * cross-sheet references to the moved cells are updated in the same operation.
 */
export function planRangeMove(
  sheet: MovableSheet,
  source: CellRange,
  deltaRow: number,
  deltaCol: number,
  otherSheets: readonly MovableSheet[] = [],
): RangeMovePlan {
  const target = shiftRange(source, deltaRow, deltaCol);
  const changes: CellChange[] = [];
  let overwriteCount = 0;
  // 1. Write the moved values into the destination, rewriting the formulas
  //    they carry so their references still mean the same thing.
  for (let r = source.top; r <= source.bottom; r++) {
    for (let c = source.left; c <= source.right; c++) {
      const value = sheet.getValue(r, c);
      const moved = rewriteForMove(value, source, deltaRow, deltaCol, sheet.name, false);
      const dr = r + deltaRow;
      const dc = c + deltaCol;
      const before = sheet.getValue(dr, dc);
      if (!inside(source, dr, dc) && before !== '') {
        overwriteCount += 1;
      }
      if (before !== moved) {
        changes.push({ row: dr, col: dc, before, after: moved });
      }
    }
  }
  // 2. Clear the vacated cells (everything in the source the destination does
  //    not cover).
  for (let r = source.top; r <= source.bottom; r++) {
    for (let c = source.left; c <= source.right; c++) {
      if (inside(target, r, c)) {
        continue;
      }
      const before = sheet.getValue(r, c);
      if (before !== '') {
        changes.push({ row: r, col: c, before, after: '' });
      }
    }
  }
  // 3. Formulas *outside* the moved rectangle keep pointing at the cells they
  //    named, on this worksheet and through cross-sheet references.
  for (const cell of sheet.listFormulaCells()) {
    if (inside(source, cell.row, cell.col) || inside(target, cell.row, cell.col)) {
      // Inside the source: already rewritten as part of the move itself.
      // Inside the destination: about to be overwritten by the moved value.
      continue;
    }
    const rewritten = rewriteForMove(cell.src, source, deltaRow, deltaCol, sheet.name, false);
    if (rewritten !== cell.src) {
      changes.push({ row: cell.row, col: cell.col, before: cell.src, after: rewritten });
    }
  }
  const otherSheetChanges = new Map<string, CellChange[]>();
  for (const other of otherSheets) {
    if (other.id === sheet.id) {
      continue;
    }
    const list: CellChange[] = [];
    for (const cell of other.listFormulaCells()) {
      const rewritten = rewriteForMove(cell.src, source, deltaRow, deltaCol, sheet.name, true);
      if (rewritten !== cell.src) {
        list.push({ row: cell.row, col: cell.col, before: cell.src, after: rewritten });
      }
    }
    if (list.length > 0) {
      otherSheetChanges.set(other.id, list);
    }
  }
  const movedCells = (source.bottom - source.top + 1) * (source.right - source.left + 1);
  return { source, target, changes, otherSheetChanges, overwriteCount, movedCells };
}
