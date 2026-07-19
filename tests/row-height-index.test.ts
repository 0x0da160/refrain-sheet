// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { RowHeightIndex } from '../src/core/row-height-index';

describe('RowHeightIndex', () => {
  it('behaves like a uniform grid when no row overrides the base', () => {
    const idx = new RowHeightIndex(26);
    expect(idx.isUniform).toBe(true);
    expect(idx.heightOf(0)).toBe(26);
    expect(idx.offsetOf(0)).toBe(0);
    expect(idx.offsetOf(5)).toBe(5 * 26);
    expect(idx.totalHeight(100)).toBe(100 * 26);
    expect(idx.rowAtOffset(3 * 26, 100)).toBe(3);
    // A y inside row 3's band still resolves to row 3.
    expect(idx.rowAtOffset(3 * 26 + 10, 100)).toBe(3);
  });

  it('offsets, total height, and rowAtOffset account for taller rows', () => {
    const idx = new RowHeightIndex(26);
    idx.set(2, 60); // +34 extra
    idx.set(5, 44); // +18 extra
    expect(idx.heightOf(2)).toBe(60);
    expect(idx.heightOf(3)).toBe(26);
    // Offset before any override is unchanged.
    expect(idx.offsetOf(2)).toBe(2 * 26);
    // Rows after the first override are pushed down by its extra height.
    expect(idx.offsetOf(3)).toBe(3 * 26 + 34);
    expect(idx.offsetOf(6)).toBe(6 * 26 + 34 + 18);
    expect(idx.totalHeight(10)).toBe(10 * 26 + 34 + 18);
    expect(idx.rangeHeight(2, 6)).toBe(idx.offsetOf(6) - idx.offsetOf(2));
  });

  it('maps a scroll offset back to the correct row across variable bands', () => {
    const idx = new RowHeightIndex(26);
    idx.set(2, 60);
    // Row 2 spans [52, 112); its interior and the row after resolve correctly.
    expect(idx.rowAtOffset(idx.offsetOf(2), 10)).toBe(2);
    expect(idx.rowAtOffset(idx.offsetOf(2) + 59, 10)).toBe(2);
    expect(idx.rowAtOffset(idx.offsetOf(3), 10)).toBe(3);
    expect(idx.rowAtOffset(0, 10)).toBe(0);
  });

  it('set() reports changes and removes overrides at or below the base', () => {
    const idx = new RowHeightIndex(26);
    expect(idx.set(4, 50)).toBe(true);
    expect(idx.set(4, 50)).toBe(false); // unchanged
    expect(idx.isUniform).toBe(false);
    // Shrinking back to (or below) the base clears the override.
    expect(idx.set(4, 26)).toBe(true);
    expect(idx.isUniform).toBe(true);
    expect(idx.heightOf(4)).toBe(26);
  });

  it('clear() restores the uniform grid', () => {
    const idx = new RowHeightIndex(26);
    idx.set(1, 80);
    idx.set(3, 52);
    idx.clear();
    expect(idx.isUniform).toBe(true);
    expect(idx.offsetOf(5)).toBe(5 * 26);
    expect(idx.totalHeight(6)).toBe(6 * 26);
  });

  it('ignores stale overrides left beyond the current row count', () => {
    const idx = new RowHeightIndex(26);
    idx.set(8, 80); // becomes stale if the document shrinks to 5 rows
    // totalHeight/offsetOf over the shorter range must not count row 8's extra.
    expect(idx.totalHeight(5)).toBe(5 * 26);
    expect(idx.offsetOf(5)).toBe(5 * 26);
  });
});
