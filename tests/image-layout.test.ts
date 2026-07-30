// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { layoutRangeForImage } from '../src/core/image-layout';
import { doc } from './helpers';

const OPTIONS = { cellPaddingX: 4, rowHeight: 20, minColWidth: 10, maxColWidth: 100 };
const charWidthMeasure = (text: string): number => text.length * 6;

describe('layoutRangeForImage', () => {
  it('extracts the display-value matrix of the range', () => {
    const d = doc('a,b,c\n1,2,3\n');
    const layout = layoutRangeForImage(
      d,
      { top: 0, left: 0, bottom: 1, right: 2 },
      null,
      charWidthMeasure,
      OPTIONS,
    );
    expect(layout.matrix).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
    expect(layout.rowHeight).toBe(20);
  });

  it('excludes rows hidden by an active filter, matching copyRows', () => {
    const d = doc('a\nb\nc\n');
    const layout = layoutRangeForImage(
      d,
      { top: 0, left: 0, bottom: 2, right: 0 },
      new Set([1]),
      charWidthMeasure,
      OPTIONS,
    );
    expect(layout.matrix).toEqual([['a'], ['c']]);
  });

  it('sizes each column to its widest cell plus padding', () => {
    const d = doc('x,short\nlongervalue,y\n');
    const layout = layoutRangeForImage(
      d,
      { top: 0, left: 0, bottom: 1, right: 1 },
      null,
      charWidthMeasure,
      OPTIONS,
    );
    // col 0: widest is "longervalue" (11 chars) => 11*6 + 4*2 = 74
    expect(layout.colWidths[0]).toBe(74);
    // col 1: widest is "short" (5 chars) => 5*6 + 4*2 = 38
    expect(layout.colWidths[1]).toBe(38);
  });

  it('clamps column width to [minColWidth, maxColWidth]', () => {
    const d = doc(',\n');
    const layout = layoutRangeForImage(
      d,
      { top: 0, left: 0, bottom: 0, right: 1 },
      null,
      charWidthMeasure,
      OPTIONS,
    );
    // Both cells are empty: width would be 0 + padding, clamped up to minColWidth.
    expect(layout.colWidths[0]).toBe(10);

    const wide = doc('averyverylongvaluethatexceedsmaxwidthforsure\n');
    const wideLayout = layoutRangeForImage(
      wide,
      { top: 0, left: 0, bottom: 0, right: 0 },
      null,
      charWidthMeasure,
      OPTIONS,
    );
    expect(wideLayout.colWidths[0]).toBe(100);
  });

  it('returns an empty matrix when every row in the range is hidden', () => {
    const d = doc('a\nb\n');
    const layout = layoutRangeForImage(
      d,
      { top: 0, left: 0, bottom: 1, right: 0 },
      new Set([0, 1]),
      charWidthMeasure,
      OPTIONS,
    );
    expect(layout.matrix).toEqual([]);
  });
});
