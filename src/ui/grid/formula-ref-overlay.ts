// SPDX-License-Identifier: MIT
// Pure geometry for the formula-reference highlight overlay (no DOM): clamp
// the references of the formula being edited to the sheet and map cells to
// the highlight range and edges they fall on.
import type { FormulaRefRange } from '../../core/formula';

/** A formula-reference range clamped to the document bounds and tagged with
 *  its highlight color/border-pattern index (0-3, see the `fref-N` CSS
 *  classes), in cycling order over the original reference list. */
export interface ClampedFormulaRef {
  top: number;
  left: number;
  bottom: number;
  right: number;
  idx: number;
}

/**
 * Clamp formula-reference ranges to the current document (whole-column/-row
 * references extend to the used grid's edge) and drop any range left empty
 * by clamping, assigning each survivor a highlight index that cycles through
 * four color/border-pattern pairs. Pure so the highlighted-range set is
 * unit-testable without a DOM (real rendering applies these to cells).
 */
export function clampFormulaRefs(
  refs: FormulaRefRange[],
  rowCount: number,
  colCount: number,
): ClampedFormulaRef[] {
  return refs
    .map((ref, i) => ({
      top: Math.max(0, ref.top),
      left: Math.max(0, ref.left),
      bottom: Math.min(ref.bottom, rowCount - 1),
      right: Math.min(ref.right, colCount - 1),
      idx: i % 4,
    }))
    .filter((r) => r.top <= r.bottom && r.left <= r.right);
}

/** Which formula-reference range (if any) a cell falls in, and whether it
 *  sits on that range's top/bottom/left/right edge (for border styling). */
export interface FormulaRefCellMatch {
  idx: number;
  top: boolean;
  bottom: boolean;
  left: boolean;
  right: boolean;
}

/**
 * Find the first clamped range containing (row, col) and report its edges.
 * Pure so per-cell highlight state is unit-testable without a DOM.
 */
export function matchFormulaRefCell(
  row: number,
  col: number,
  ranges: ClampedFormulaRef[],
): FormulaRefCellMatch | null {
  for (const r of ranges) {
    if (row >= r.top && row <= r.bottom && col >= r.left && col <= r.right) {
      return {
        idx: r.idx,
        top: row === r.top,
        bottom: row === r.bottom,
        left: col === r.left,
        right: col === r.right,
      };
    }
  }
  return null;
}

/**
 * True when at least one clamped range extends beyond the given rendered
 * viewport (first/last materialized row, visible column range) — drives the
 * "reference extends beyond the visible area" status note. Pure so this
 * decision is unit-testable without a DOM.
 */
export function formulaRefsExceedViewport(
  ranges: ClampedFormulaRef[],
  view: { firstRow: number; lastRow: number; colStart: number; colEnd: number },
): boolean {
  for (const r of ranges) {
    if (
      r.top < view.firstRow ||
      r.bottom > view.lastRow ||
      r.left < view.colStart ||
      r.right > view.colEnd - 1
    ) {
      return true;
    }
  }
  return false;
}
