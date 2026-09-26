// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { onRangeEdge } from '../src/ui/grid/range-edge';

const range = { top: 1, left: 1, bottom: 3, right: 2 };
const box = (x: number, y: number) => ({ x, y, width: 100, height: 24 });

describe('onRangeEdge', () => {
  it('hits the band along each outer edge of the range', () => {
    expect(onRangeEdge(range, 1, 2, box(50, 2), 4)).toBe(true); // top
    expect(onRangeEdge(range, 3, 1, box(50, 22), 4)).toBe(true); // bottom
    expect(onRangeEdge(range, 2, 1, box(3, 12), 4)).toBe(true); // left
    expect(onRangeEdge(range, 2, 2, box(97, 12), 4)).toBe(true); // right
  });

  it('misses inner cell boundaries and cell middles', () => {
    expect(onRangeEdge(range, 2, 1, box(97, 12), 4)).toBe(false); // B3's right side is inside the range
    expect(onRangeEdge(range, 2, 2, box(50, 2), 4)).toBe(false); // C3's top is inside the range
    expect(onRangeEdge(range, 1, 1, box(50, 12), 4)).toBe(false);
  });

  it('ignores cells outside the range', () => {
    expect(onRangeEdge(range, 0, 1, box(50, 23), 4)).toBe(false);
    expect(onRangeEdge(range, 1, 3, box(1, 12), 4)).toBe(false);
  });

  it('never lets the band cover more than a quarter of a small cell', () => {
    const tiny = { top: 0, left: 0, bottom: 0, right: 0 };
    expect(onRangeEdge(tiny, 0, 0, { x: 8, y: 8, width: 16, height: 16 }, 6)).toBe(false);
    expect(onRangeEdge(tiny, 0, 0, { x: 3, y: 8, width: 16, height: 16 }, 6)).toBe(true);
  });
});
