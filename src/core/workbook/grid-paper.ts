// SPDX-License-Identifier: MIT
/**
 * Grid-paper sheets: a worksheet kind of its own for forms, screen mock-ups
 * and wireframes. It is a grid worksheet with `paper` set (the side of one
 * square, px at 100% zoom), so it keeps everything a grid has for objects;
 * the app draws every row and column one square wide, keeps its cells
 * empty (text goes in text boxes that span squares) and snaps objects to
 * the squares. Stored as the worksheet's optional `paper` key, so a release
 * without grid paper still opens the file and shows the objects on an
 * ordinary grid.
 */
import type { WorksheetKind } from './worksheet';

/** What the Add Sheet dialog offers: every worksheet kind, and grid paper. */
export type NewSheetKind = WorksheetKind | 'paper';

/** A worksheet's kind as the user sees it (a grid-paper sheet is its own). */
export function sheetKindOf(sheet: { kind: WorksheetKind; paper?: number }): NewSheetKind {
  return sheet.kind === 'grid' && sheet.paper !== undefined ? 'paper' : sheet.kind;
}

/** A new grid-paper sheet's square, and the sizes a file may set. */
export const PAPER_SQUARE = 20;
const MIN_PAPER_SQUARE = 8;
const MAX_PAPER_SQUARE = 64;

/** A new grid-paper sheet's size in squares (rows × columns). */
export const PAPER_ROWS = 200;
export const PAPER_COLUMNS = 80;

/** Whether `value` is a square side a file may hold. */
export function isPaperSquare(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_PAPER_SQUARE &&
    value <= MAX_PAPER_SQUARE
  );
}

/**
 * `size` (px) rounded to whole squares, at least one: where an object's
 * edge lands on grid paper.
 */
export function toSquares(size: number, square: number): number {
  return Math.max(1, Math.round(size / square)) * square;
}
