// SPDX-License-Identifier: MIT
/**
 * The pivot table fingerprint: `summaryDigest` tells an update whether the
 * summary is still the one a link describes, and `pivotRecordsEqual` compares
 * the records a file keeps.
 */
import { describe, expect, it } from 'vitest';
import { pivotRecordsEqual, summaryDigest, type PivotRecord } from '../../src/core/pivot';

function digestOf(rows: string[][], cols: number): string {
  return summaryDigest(rows.length, cols, (r, c) => rows[r][c] ?? '');
}

const record: PivotRecord = {
  sourceId: 's1',
  request: { rowField: 0, columnField: null, valueField: 2, aggregation: 'sum' },
  rows: 2,
  cols: 2,
  digest: '0123456789abcdef',
};

describe('summaryDigest', () => {
  it('is the same for the same cells, as 16 lowercase hex digits', () => {
    const digest = digestOf(
      [
        ['a', 'b'],
        ['c', ''],
      ],
      2,
    );
    expect(digest).toMatch(/^[0-9a-f]{16}$/);
    expect(
      digestOf(
        [
          ['a', 'b'],
          ['c', ''],
        ],
        2,
      ),
    ).toBe(digest);
  });

  it('changes when a cell changes, or when a value moves to another cell', () => {
    const digest = digestOf(
      [
        ['a', 'b'],
        ['c', 'd'],
      ],
      2,
    );
    expect(
      digestOf(
        [
          ['a', 'b'],
          ['c', 'e'],
        ],
        2,
      ),
    ).not.toBe(digest);
    expect(
      digestOf(
        [
          ['b', 'a'],
          ['c', 'd'],
        ],
        2,
      ),
    ).not.toBe(digest);
  });

  it('counts cell boundaries, so "ab" then "" differs from "a" then "b"', () => {
    expect(
      digestOf(
        [
          ['ab', ''],
          ['', ''],
        ],
        2,
      ),
    ).not.toBe(
      digestOf(
        [
          ['a', 'b'],
          ['', ''],
        ],
        2,
      ),
    );
  });

  it('reads a missing cell as blank', () => {
    expect(summaryDigest(1, 2, (_r, c) => (c === 0 ? 'x' : ''))).toBe(digestOf([['x', '']], 2));
  });
});

describe('pivotRecordsEqual', () => {
  it('compares every field, and treats two missing records as equal', () => {
    expect(pivotRecordsEqual(record, { ...record })).toBe(true);
    expect(pivotRecordsEqual(record, { ...record, digest: 'fedcba9876543210' })).toBe(false);
    expect(pivotRecordsEqual(record, { ...record, request: { ...record.request, aggregation: 'max' } })).toBe(
      false,
    );
    expect(pivotRecordsEqual(null, undefined)).toBe(true);
    expect(pivotRecordsEqual(record, null)).toBe(false);
  });
});
