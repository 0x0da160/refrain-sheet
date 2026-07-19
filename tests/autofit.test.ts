// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { autoFitWidth, MAX_COL_WIDTH, MIN_COL_WIDTH } from '../src/ui/grid';

describe('autoFitWidth (grow and shrink)', () => {
  it('expands to fit content wider than a narrow column', () => {
    // A column previously 60px wide with 200px of content fits to 200px.
    expect(autoFitWidth([200])).toBe(200);
  });

  it('shrinks to fit when content is narrower than the current width', () => {
    // A column previously 300px wide whose widest content is 80px shrinks.
    const fitted = autoFitWidth([80]);
    expect(fitted).toBe(80);
    expect(fitted).toBeLessThan(300);
  });

  it('takes the widest of all measured content (cells + header)', () => {
    expect(autoFitWidth([50, 120, 90])).toBe(120);
  });

  it('clamps to the minimum and maximum widths', () => {
    expect(autoFitWidth([10])).toBe(MIN_COL_WIDTH);
    expect(autoFitWidth([99999])).toBe(MAX_COL_WIDTH);
  });

  it('falls back to the minimum width when nothing was measured', () => {
    expect(autoFitWidth([])).toBe(MIN_COL_WIDTH);
  });
});
