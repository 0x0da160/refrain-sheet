// SPDX-License-Identifier: MIT
/**
 * Row heights a person set on an RSF worksheet: the map helpers, how
 * inserted and deleted rows move them, and how the file keeps them
 * (`rowHeights`, by 1-based row number).
 */
import { describe, expect, it } from 'vitest';
import {
  clampRowHeight,
  deleteRowHeights,
  insertRowHeights,
  MAX_ROW_HEIGHT,
  MIN_ROW_HEIGHT,
  rowHeightsAt,
  withRowHeights,
} from '../../src/core/workbook/row-heights';
import { RsfDocument } from '../../src/core/workbook/rsf-document';
import { decodeRsf, encodeRsf, rsfFromTree, rsfTree, type RsfData } from '../rsf-single-sheet';

const base: RsfData = { name: 'S', delimiter: ',', rowCount: 5, columnCount: 2, cells: [[0, 0, 'x']] };

describe('row height helpers', () => {
  it('clamps, sets and clears heights without changing the map they were given', () => {
    expect(clampRowHeight(2)).toBe(MIN_ROW_HEIGHT);
    expect(clampRowHeight(10_000)).toBe(MAX_ROW_HEIGHT);
    const start = new Map([[1, 30]]);
    const set = withRowHeights(start, [2, 3], 40.4);
    expect([...set]).toEqual([
      [1, 30],
      [2, 40],
      [3, 40],
    ]);
    expect([...withRowHeights(set, [1], null)]).toEqual([
      [2, 40],
      [3, 40],
    ]);
    expect([...start]).toEqual([[1, 30]]);
  });

  it('moves heights with inserted and deleted rows, and gives deleted ones back', () => {
    const heights = new Map([
      [1, 30],
      [4, 50],
    ]);
    expect([...insertRowHeights(heights, 2, 2)]).toEqual([
      [1, 30],
      [6, 50],
    ]);
    expect([...deleteRowHeights(heights, 1, 2)]).toEqual([[2, 50]]);
    expect(rowHeightsAt(heights, 0, 2)).toEqual([0, 30]);
    expect([...insertRowHeights(deleteRowHeights(heights, 1, 1), 1, 1, [30])].sort()).toEqual([
      [1, 30],
      [4, 50],
    ]);
  });
});

describe('codec: rowHeights', () => {
  function withHeights(heights: Record<string, unknown> | unknown): Uint8Array {
    const tree = rsfTree(encodeRsf(base));
    tree.sheets[0].rowHeights = heights;
    return rsfFromTree(tree);
  }

  it('round-trips through the document, keyed by row number', () => {
    const doc = RsfDocument.empty('t.rsf', 5, 2);
    doc.activeSheet.rowHeights = new Map([
      [0, 40],
      [3, 12],
    ]);
    const tree = rsfTree(doc.toBytes());
    expect(tree.sheets[0].rowHeights).toEqual({ '1': 40, '4': 12 });
    const back = RsfDocument.fromBytes(doc.toBytes(), 't.rsf');
    expect(back.ok && [...back.doc.activeSheet.rowHeights]).toEqual([
      [0, 40],
      [3, 12],
    ]);
  });

  it('clamps heights and drops rows past the end; a malformed entry fails the file', () => {
    const decoded = RsfDocument.fromBytes(withHeights({ '2': 1, '3': 5000, '99': 30 }), 't.rsf');
    expect(decoded.ok && [...decoded.doc.activeSheet.rowHeights]).toEqual([
      [1, MIN_ROW_HEIGHT],
      [2, MAX_ROW_HEIGHT],
    ]);
    expect(decodeRsf(withHeights({ '0': 30 })).ok).toBe(false);
    expect(decodeRsf(withHeights({ A: 30 })).ok).toBe(false);
    expect(decodeRsf(withHeights({ '2': '30' })).ok).toBe(false);
    expect(decodeRsf(withHeights([30])).ok).toBe(false);
  });

  it('leaves the key out when no height is set', () => {
    expect(rsfTree(RsfDocument.empty('t.rsf', 3, 2).toBytes()).sheets[0].rowHeights).toBeUndefined();
  });

  it('moves heights when rows are inserted or deleted', () => {
    const doc = RsfDocument.empty('t.rsf', 5, 2);
    doc.activeSheet.rowHeights = new Map([[3, 40]]);
    doc.insertRows(1, [[], []]);
    expect([...doc.activeSheet.rowHeights]).toEqual([[5, 40]]);
    doc.deleteRows(0, 2);
    expect([...doc.activeSheet.rowHeights]).toEqual([[3, 40]]);
  });
});
