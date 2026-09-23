// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { centeredScrollOffset } from '../src/ui/grid/center-scroll';

describe('centeredScrollOffset', () => {
  it('puts the middle of the band at the middle of the view', () => {
    // A 26px row at y=1000 in a 300px view: 1000 + 13 - 150.
    expect(centeredScrollOffset(1000, 26, 300, 10_000)).toBe(863);
  });

  it('clamps at the top, so a row near the start never scrolls past 0', () => {
    expect(centeredScrollOffset(26, 26, 300, 10_000)).toBe(0);
  });

  it('clamps at the bottom of the scrollable range', () => {
    expect(centeredScrollOffset(9_900, 26, 300, 9_700)).toBe(9_700);
  });

  it('treats a negative scroll range (content shorter than the view) as 0', () => {
    expect(centeredScrollOffset(100, 26, 300, -50)).toBe(0);
  });
});
