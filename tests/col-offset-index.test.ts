// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { ColOffsetIndex } from '../src/core/col-offset-index';

describe('ColOffsetIndex', () => {
  it('answers offsets and total width from uniform widths', () => {
    const idx = new ColOffsetIndex(5, () => 100);
    expect(idx.columnCount).toBe(5);
    expect(idx.offsetOf(0)).toBe(0);
    expect(idx.offsetOf(3)).toBe(300);
    expect(idx.totalWidth).toBe(500);
  });

  it('accounts for per-column width overrides', () => {
    const widths = [80, 200, 60, 150];
    const idx = new ColOffsetIndex(widths.length, (c) => widths[c]);
    expect(idx.offsetOf(0)).toBe(0);
    expect(idx.offsetOf(1)).toBe(80);
    expect(idx.offsetOf(2)).toBe(280);
    expect(idx.offsetOf(3)).toBe(340);
    expect(idx.totalWidth).toBe(490);
  });

  it('clamps offsetOf to [0, totalWidth] for out-of-range columns', () => {
    const idx = new ColOffsetIndex(3, () => 100);
    expect(idx.offsetOf(-5)).toBe(0);
    expect(idx.offsetOf(3)).toBe(300);
    expect(idx.offsetOf(100)).toBe(300);
  });

  it('treats a columnCount of 0 as a single default-width column, like the grid does', () => {
    const idx = new ColOffsetIndex(0, () => 132);
    expect(idx.columnCount).toBe(1);
    expect(idx.totalWidth).toBe(132);
  });

  it('colAtOrBefore finds the column band containing an offset', () => {
    const widths = [80, 200, 60, 150]; // bands: [0,80) [80,280) [280,340) [340,490)
    const idx = new ColOffsetIndex(widths.length, (c) => widths[c]);
    expect(idx.colAtOrBefore(0)).toBe(0);
    expect(idx.colAtOrBefore(79)).toBe(0);
    expect(idx.colAtOrBefore(80)).toBe(1);
    expect(idx.colAtOrBefore(279)).toBe(1);
    expect(idx.colAtOrBefore(280)).toBe(2);
    expect(idx.colAtOrBefore(489)).toBe(3);
    // Past every column's right edge: clamps to columnCount, matching a
    // linear scan that walks off the end of the array.
    expect(idx.colAtOrBefore(490)).toBe(4);
    expect(idx.colAtOrBefore(10_000)).toBe(4);
  });

  it('colAtOrAfter finds the first column whose left edge reaches an offset', () => {
    const widths = [80, 200, 60, 150];
    const idx = new ColOffsetIndex(widths.length, (c) => widths[c]);
    expect(idx.colAtOrAfter(0)).toBe(0);
    expect(idx.colAtOrAfter(1)).toBe(1);
    expect(idx.colAtOrAfter(80)).toBe(1);
    expect(idx.colAtOrAfter(281)).toBe(3);
    expect(idx.colAtOrAfter(340)).toBe(3);
    // Past the total width: clamps to columnCount.
    expect(idx.colAtOrAfter(341)).toBe(4);
    expect(idx.colAtOrAfter(10_000)).toBe(4);
  });

  /** Reference implementation mirroring the grid's pre-caching linear scan. */
  function linearWindow(widths: number[], scrollLeft: number, viewW: number) {
    const totalCols = Math.max(1, widths.length);
    const widthOf = (c: number) => widths[c] ?? 132;
    let firstVisible = 0;
    let x = 0;
    while (firstVisible < totalCols && x + widthOf(firstVisible) <= scrollLeft) {
      x += widthOf(firstVisible);
      firstVisible += 1;
    }
    const limit = scrollLeft + viewW;
    let lastVisible = firstVisible;
    while (lastVisible < totalCols && x < limit) {
      x += widthOf(lastVisible);
      lastVisible += 1;
    }
    return { firstVisible, lastVisible };
  }

  function indexWindow(widths: number[], scrollLeft: number, viewW: number) {
    const idx = new ColOffsetIndex(widths.length, (c) => widths[c] ?? 132);
    const firstVisible = idx.colAtOrBefore(scrollLeft);
    const lastVisible = idx.colAtOrAfter(scrollLeft + viewW);
    return { firstVisible, lastVisible };
  }

  it('matches a linear scan across randomized widths, scroll positions, and viewport widths', () => {
    for (let trial = 0; trial < 200; trial++) {
      const colCount = 1 + Math.floor(Math.random() * 40);
      const widths = Array.from({ length: colCount }, () => 40 + Math.floor(Math.random() * 300));
      const totalWidth = widths.reduce((a, b) => a + b, 0);
      // Include scroll positions/viewports beyond the content extent.
      const scrollLeft = Math.floor(Math.random() * (totalWidth + 200));
      const viewW = Math.floor(Math.random() * (totalWidth + 200));
      expect(indexWindow(widths, scrollLeft, viewW)).toEqual(linearWindow(widths, scrollLeft, viewW));
    }
  });

  it('matches a linear scan at the exact boundary of the scrollable content', () => {
    const widths = [100, 100, 100];
    const totalWidth = 300;
    expect(indexWindow(widths, totalWidth, 0)).toEqual(linearWindow(widths, totalWidth, 0));
    expect(indexWindow(widths, totalWidth - 1, 1)).toEqual(linearWindow(widths, totalWidth - 1, 1));
  });
});
