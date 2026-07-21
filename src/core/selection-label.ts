// SPDX-License-Identifier: MIT
import { cellLabel, columnLabel } from './formula';

/**
 * The reference-box label for a selection — a full representation of what is
 * selected, not just the active cell. Kept separate from the selection
 * *semantics* (active cell, anchor, range) so the display never influences
 * behavior:
 *
 * - A single cell shows a normal address: `A1`.
 * - A rectangular range shows the normalized bounds regardless of drag
 *   direction: `A1:B2`.
 * - A whole-row selection shows the row numbers: `1:3` (single row `2:2`).
 * - A whole-column selection shows the column letters: `A:C` (single `B:B`).
 * - A whole-sheet / used-range selection shows the actual normalized used
 *   range, e.g. `A1:Z100`.
 *
 * `kind` distinguishes whole-row / whole-column selections (the range alone
 * cannot, since a header-drag selection is a rectangle spanning every column
 * or row). `rowCount`/`columnCount` bound whole-row/column and whole-sheet
 * detection.
 */
export interface SelectionLabelInput {
  /** Normalized selected rectangle (inclusive). */
  range: { top: number; left: number; bottom: number; right: number };
  /** How the selection was made. */
  kind: 'cell' | 'row' | 'col';
  rowCount: number;
  columnCount: number;
}

export function selectionRefLabel(input: SelectionLabelInput): string {
  const { range, kind } = input;
  // Whole-row selection (header drag / row-header click): show row numbers.
  if (kind === 'row') {
    return `${range.top + 1}:${range.bottom + 1}`;
  }
  // Whole-column selection: show column letters.
  if (kind === 'col') {
    return `${columnLabel(range.left)}:${columnLabel(range.right)}`;
  }
  // A single cell shows a plain address; any wider rectangle — including a
  // Select All / used-range selection — shows its concrete normalized bounds
  // (e.g. Select All on a 26×100 sheet → A1:Z100).
  if (range.top === range.bottom && range.left === range.right) {
    return cellLabel(range.top, range.left);
  }
  return `${cellLabel(range.top, range.left)}:${cellLabel(range.bottom, range.right)}`;
}
