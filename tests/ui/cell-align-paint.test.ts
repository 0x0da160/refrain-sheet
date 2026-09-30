// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/** A cell's alignment reaches the grid cell, in a single-line and a wrapped (flex) row alike. */
import { describe, expect, it } from 'vitest';
import { RsfDocument } from '../../src/core/workbook/rsf-document';
import { paintCellStyle } from '../../src/ui/grid/cell-paint';

describe('cell alignment on the grid', () => {
  it('sets text-align and justify-content, and clears them when the alignment is removed', () => {
    const book = RsfDocument.empty('book.rsf', 2, 2, 'Sheet1');
    book.setCellStyleOn(undefined, 0, 0, { horizontalAlign: 'right' });
    const cell = document.createElement('div');
    paintCellStyle(cell, book, 0, 0);
    expect(cell.style.textAlign).toBe('right');
    expect(cell.style.justifyContent).toBe('flex-end');
    book.setCellStyleOn(undefined, 0, 0, null);
    paintCellStyle(cell, book, 0, 0);
    expect(cell.style.textAlign).toBe('');
    expect(cell.style.justifyContent).toBe('');
  });
});
