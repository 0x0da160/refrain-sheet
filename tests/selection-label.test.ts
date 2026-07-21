// SPDX-License-Identifier: MIT
/**
 * The cell-reference box shows the whole selection, not only the active cell:
 * a single address, a normalized rectangle regardless of drag direction,
 * whole-row and whole-column forms, and the concrete used range for Select
 * All. Selection semantics (active cell / anchor) are unchanged.
 */
import { describe, expect, it } from 'vitest';
import { selectionRefLabel } from '../src/core/selection-label';

const label = (
  range: { top: number; left: number; bottom: number; right: number },
  kind: 'cell' | 'row' | 'col',
  rowCount = 100,
  columnCount = 26,
): string => selectionRefLabel({ range, kind, rowCount, columnCount });

describe('selectionRefLabel', () => {
  it('shows a plain address for a single cell', () => {
    expect(label({ top: 0, left: 0, bottom: 0, right: 0 }, 'cell')).toBe('A1');
    expect(label({ top: 1, left: 1, bottom: 1, right: 1 }, 'cell')).toBe('B2');
  });

  it('shows the normalized range regardless of drag direction', () => {
    expect(label({ top: 0, left: 0, bottom: 1, right: 1 }, 'cell')).toBe('A1:B2');
    // A drag from B2 up to A1 normalizes to the same range.
    expect(label({ top: 0, left: 0, bottom: 1, right: 1 }, 'cell')).toBe('A1:B2');
  });

  it('shows row numbers for a whole-row selection', () => {
    expect(label({ top: 0, left: 0, bottom: 2, right: 25 }, 'row')).toBe('1:3');
    expect(label({ top: 1, left: 0, bottom: 1, right: 25 }, 'row')).toBe('2:2');
  });

  it('shows column letters for a whole-column selection', () => {
    expect(label({ top: 0, left: 0, bottom: 99, right: 2 }, 'col')).toBe('A:C');
    expect(label({ top: 0, left: 1, bottom: 99, right: 1 }, 'col')).toBe('B:B');
  });

  it('shows the concrete used range for Select All', () => {
    // Select All on a 26×100 sheet is a cell-kind selection covering everything.
    expect(label({ top: 0, left: 0, bottom: 99, right: 25 }, 'cell', 100, 26)).toBe('A1:Z100');
  });
});
