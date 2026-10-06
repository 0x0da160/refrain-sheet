// SPDX-License-Identifier: MIT
/**
 * A worksheet's print area: reading and writing it as A1 text, how
 * inserted, deleted and moved rows and columns move it, and how the file
 * keeps it (`printArea`).
 */
import { describe, expect, it } from 'vitest';
import {
  clipPrintArea,
  movePrintArea,
  parsePrintArea,
  printAreasEqual,
  printAreaToText,
  shiftPrintAreaForDelete,
  shiftPrintAreaForInsert,
} from '../../src/core/workbook/print-area';
import { RsfDocument } from '../../src/core/workbook/rsf-document';
import { decodeRsf, encodeRsf, rsfFromTree, rsfTree, type RsfData } from '../rsf-single-sheet';

const area = (top: number, left: number, bottom: number, right: number) => ({ top, left, bottom, right });

describe('print area text', () => {
  it('reads a range in any corner order, with $ or lower case, and a single cell', () => {
    expect(parsePrintArea('A1:F40')).toEqual(area(0, 0, 39, 5));
    expect(parsePrintArea(' f40:a1 ')).toEqual(area(0, 0, 39, 5));
    expect(parsePrintArea('$B$2')).toEqual(area(1, 1, 1, 1));
    expect(parsePrintArea('')).toBeNull();
    expect(parsePrintArea('A1:')).toBeNull();
    expect(parsePrintArea('A1:B2:C3')).toBeNull();
    expect(parsePrintArea('hello')).toBeNull();
  });

  it('writes upper case without $, a single cell still as a range', () => {
    expect(printAreaToText(area(0, 0, 39, 5))).toBe('A1:F40');
    expect(printAreaToText(area(1, 1, 1, 1))).toBe('B2:B2');
  });

  it('cuts an area to the sheet, and drops one wholly outside it', () => {
    expect(clipPrintArea(area(2, 1, 50, 9), 10, 4)).toEqual(area(2, 1, 9, 3));
    expect(clipPrintArea(area(12, 0, 15, 1), 10, 4)).toBeNull();
    expect(printAreasEqual(area(0, 0, 1, 1), area(0, 0, 1, 1))).toBe(true);
    expect(printAreasEqual(area(0, 0, 1, 1), null)).toBe(false);
    expect(printAreasEqual(null, null)).toBe(true);
  });
});

describe('print area through structural changes', () => {
  it('moves with inserts before it and grows with inserts inside it', () => {
    expect(shiftPrintAreaForInsert(area(2, 0, 5, 3), 'row', 0, 2)).toEqual(area(4, 0, 7, 3));
    expect(shiftPrintAreaForInsert(area(2, 0, 5, 3), 'row', 3, 2)).toEqual(area(2, 0, 7, 3));
    expect(shiftPrintAreaForInsert(area(2, 0, 5, 3), 'row', 6, 2)).toEqual(area(2, 0, 5, 3));
    expect(shiftPrintAreaForInsert(area(0, 1, 5, 2), 'col', 0, 1)).toEqual(area(0, 2, 5, 3));
    expect(shiftPrintAreaForInsert(null, 'row', 0, 1)).toBeNull();
  });

  it('shrinks with deletes inside it, and is gone when all of it is deleted', () => {
    expect(shiftPrintAreaForDelete(area(2, 0, 5, 3), 'row', 0, 1)).toEqual(area(1, 0, 4, 3));
    expect(shiftPrintAreaForDelete(area(2, 0, 5, 3), 'row', 3, 2)).toEqual(area(2, 0, 3, 3));
    expect(shiftPrintAreaForDelete(area(2, 0, 5, 3), 'row', 1, 3)).toEqual(area(1, 0, 2, 3));
    expect(shiftPrintAreaForDelete(area(2, 0, 5, 3), 'row', 2, 4)).toBeNull();
    expect(shiftPrintAreaForDelete(area(0, 2, 5, 3), 'col', 0, 2)).toEqual(area(0, 0, 5, 1));
  });

  it('moves with the moved rows when it lies inside them', () => {
    // Rows 2–3 hold the whole area; moved to before row 8, they land at 6–7.
    expect(movePrintArea(area(2, 0, 3, 1), 'row', 2, 2, 8)).toEqual(area(6, 0, 7, 1));
    // An area below the moved rows shifts up when they move past it.
    expect(movePrintArea(area(5, 0, 6, 1), 'row', 0, 2, 9)).toEqual(area(3, 0, 4, 1));
  });

  it('follows rows and columns inserted and deleted on the worksheet', () => {
    const doc = RsfDocument.empty('t.rsf', 10, 5);
    doc.setPrintAreaOn(undefined, area(2, 1, 5, 3));
    doc.insertRows(0, [[]]);
    expect(doc.activeSheet.printArea).toEqual(area(3, 1, 6, 3));
    doc.deleteCols(0, 1);
    expect(doc.activeSheet.printArea).toEqual(area(3, 0, 6, 2));
    expect(doc.activeSheet.clone('s2', 'Copy').printArea).toEqual(area(3, 0, 6, 2));
  });
});

describe('codec: printArea', () => {
  const base: RsfData = { name: 'S', delimiter: ',', rowCount: 10, columnCount: 4, cells: [[0, 0, 'x']] };
  function withArea(value: unknown): Uint8Array {
    const tree = rsfTree(encodeRsf(base));
    tree.sheets[0].printArea = value;
    return rsfFromTree(tree);
  }

  it('round-trips as A1 text, and is left out when none is set', () => {
    const doc = RsfDocument.empty('t.rsf', 10, 4);
    expect(rsfTree(doc.toBytes()).sheets[0].printArea).toBeUndefined();
    doc.setPrintAreaOn(undefined, area(1, 0, 7, 2));
    expect(rsfTree(doc.toBytes()).sheets[0].printArea).toBe('A2:C8');
    const back = RsfDocument.fromBytes(doc.toBytes(), 't.rsf');
    expect(back.ok && back.doc.activeSheet.printArea).toEqual(area(1, 0, 7, 2));
  });

  it('cuts an area past the sheet, drops one outside it, and fails a malformed one', () => {
    const cut = RsfDocument.fromBytes(withArea('B2:Z99'), 't.rsf');
    expect(cut.ok && cut.doc.activeSheet.printArea).toEqual(area(1, 1, 9, 3));
    const outside = RsfDocument.fromBytes(withArea('A20:B30'), 't.rsf');
    expect(outside.ok && outside.doc.activeSheet.printArea).toBeNull();
    expect(decodeRsf(withArea('a1:b2')).ok).toBe(false);
    expect(decodeRsf(withArea('B2:A1')).ok).toBe(false);
    expect(decodeRsf(withArea('$A$1:$B$2')).ok).toBe(false);
    expect(decodeRsf(withArea('A1')).ok).toBe(false);
    expect(decodeRsf(withArea(5)).ok).toBe(false);
  });
});
