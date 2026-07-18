// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import {
  computeSelectionStats,
  numericCellValue,
  emptySelectionStats,
  type StatsRange,
} from '../src/core/stats';

/** Build a readDisplay from a dense grid of strings. */
function reader(grid: string[][]): (r: number, c: number) => string {
  return (r, c) => grid[r]?.[c] ?? '';
}

const whole = (grid: string[][]): StatsRange => ({
  top: 0,
  left: 0,
  bottom: grid.length - 1,
  right: Math.max(0, ...grid.map((row) => row.length - 1)),
});

describe('numericCellValue', () => {
  it('accepts finite numbers only', () => {
    expect(numericCellValue('42')).toBe(42);
    expect(numericCellValue('  -3.5 ')).toBe(-3.5);
    expect(numericCellValue('1e3')).toBe(1000);
    expect(numericCellValue('')).toBeNull();
    expect(numericCellValue('   ')).toBeNull();
    expect(numericCellValue('text')).toBeNull();
    expect(numericCellValue('TRUE')).toBeNull();
    expect(numericCellValue('#DIV/0!')).toBeNull();
    expect(numericCellValue('Infinity')).toBeNull();
    expect(numericCellValue('NaN')).toBeNull();
  });
});

describe('computeSelectionStats', () => {
  it('is empty for an empty selection helper', () => {
    expect(emptySelectionStats()).toEqual({
      count: 0,
      nonEmpty: 0,
      numeric: 0,
      sum: 0,
      average: null,
      min: null,
      max: null,
    });
  });

  it('counts and aggregates a numeric block', () => {
    const grid = [
      ['1', '2'],
      ['3', '4'],
    ];
    const stats = computeSelectionStats(whole(grid), reader(grid));
    expect(stats.count).toBe(4);
    expect(stats.nonEmpty).toBe(4);
    expect(stats.numeric).toBe(4);
    expect(stats.sum).toBe(10);
    expect(stats.average).toBe(2.5);
    expect(stats.min).toBe(1);
    expect(stats.max).toBe(4);
  });

  it('ignores blanks, text, and error codes for numeric aggregates', () => {
    const grid = [
      ['1', 'text', ''],
      ['#DIV/0!', '5', 'TRUE'],
    ];
    const stats = computeSelectionStats(whole(grid), reader(grid));
    expect(stats.count).toBe(6);
    expect(stats.nonEmpty).toBe(5); // everything except the blank
    expect(stats.numeric).toBe(2); // 1 and 5
    expect(stats.sum).toBe(6);
    expect(stats.average).toBe(3);
    expect(stats.min).toBe(1);
    expect(stats.max).toBe(5);
  });

  it('reports no numeric aggregates when nothing is numeric', () => {
    const grid = [['a', 'b', '']];
    const stats = computeSelectionStats(whole(grid), reader(grid));
    expect(stats.count).toBe(3);
    expect(stats.nonEmpty).toBe(2);
    expect(stats.numeric).toBe(0);
    expect(stats.sum).toBe(0);
    expect(stats.average).toBeNull();
    expect(stats.min).toBeNull();
    expect(stats.max).toBeNull();
  });

  it('counts positions beyond a ragged row as empty cells', () => {
    // Row 1 has only one field; the second column position is empty.
    const grid = [['10', '20'], ['30']];
    const fieldCount = (r: number) => grid[r].length;
    const stats = computeSelectionStats({ top: 0, left: 0, bottom: 1, right: 1 }, reader(grid), fieldCount);
    expect(stats.count).toBe(4); // full 2x2 rectangle
    expect(stats.nonEmpty).toBe(3); // the missing field is empty
    expect(stats.numeric).toBe(3);
    expect(stats.sum).toBe(60);
  });

  it('handles a very large numeric selection efficiently', () => {
    // 1..1000 down a single synthetic column via readDisplay.
    const n = 1000;
    const range: StatsRange = { top: 0, left: 0, bottom: n - 1, right: 0 };
    const stats = computeSelectionStats(range, (r) => String(r + 1));
    expect(stats.count).toBe(n);
    expect(stats.numeric).toBe(n);
    expect(stats.sum).toBe((n * (n + 1)) / 2);
    expect(stats.min).toBe(1);
    expect(stats.max).toBe(n);
    expect(stats.average).toBe((n + 1) / 2);
  });
});
