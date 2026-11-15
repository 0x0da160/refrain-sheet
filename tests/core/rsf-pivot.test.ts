// SPDX-License-Identifier: MIT
/**
 * The `pivot` key of a worksheet (a pivot table sheet's link): it round-trips
 * through the codec, and a hand-edited value of the wrong shape fails the file.
 */
import { describe, expect, it } from 'vitest';
import type { PivotRecord } from '../../src/core/pivot';
import {
  decodeRsfWorkbook,
  encodeRsfWorkbook,
  packRsfJsonText,
  unpackRsfJsonText,
  type RsfWorkbookData,
  type RsfWorksheetData,
} from '../../src/core/workbook/rsf-codec';

const pivot: PivotRecord = {
  sourceId: 's1',
  request: { rowField: 0, columnField: 1, valueField: 2, aggregation: 'average' },
  rows: 4,
  cols: 3,
  digest: '0123456789abcdef',
};

const sourceSheet: RsfWorksheetData = {
  id: 's1',
  name: 'Sales',
  rowCount: 5,
  columnCount: 3,
  cells: [[0, 0, 'region']],
};
const pivotSheet: RsfWorksheetData = {
  id: 's2',
  name: 'Pivot Table',
  rowCount: 4,
  columnCount: 3,
  cells: [],
  pivot,
};
const book: RsfWorkbookData = { delimiter: ',', activeSheetId: 's2', sheets: [sourceSheet, pivotSheet] };

/** The book's file with the pivot table sheet's `pivot` replaced by `value`, decoded again. */
function decodeWithPivot(value: unknown) {
  const json = JSON.parse(unpackRsfJsonText(encodeRsfWorkbook(book))!) as {
    sheets: Array<{ pivot?: unknown }>;
  };
  json.sheets[1].pivot = value;
  return decodeRsfWorkbook(packRsfJsonText(JSON.stringify(json)));
}

describe('.rsf codec: a pivot table sheet’s link', () => {
  it('round-trips the link on its worksheet, and leaves other sheets without one', () => {
    const decoded = decodeRsfWorkbook(encodeRsfWorkbook(book));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.data.sheets[1].pivot).toEqual(pivot);
    expect(decoded.data.sheets[0].pivot).toBeUndefined();
  });

  it('keeps a missing column field as null', () => {
    const noColumn: PivotRecord = { ...pivot, request: { ...pivot.request, columnField: null } };
    const decoded = decodeRsfWorkbook(
      encodeRsfWorkbook({ ...book, sheets: [sourceSheet, { ...pivotSheet, pivot: noColumn }] }),
    );
    expect(decoded.ok && decoded.data.sheets[1].pivot).toEqual(noColumn);
  });

  it('fails the file for a value of the wrong shape', () => {
    const cases: Array<[string, unknown]> = [
      ['an unknown aggregation', { ...pivot, request: { ...pivot.request, aggregation: 'median' } }],
      ['a column field equal to the row field', { ...pivot, request: { ...pivot.request, columnField: 0 } }],
      ['a digest that is not 16 hex digits', { ...pivot, digest: 'xyz' }],
      ['a summary with no rows', { ...pivot, rows: 0 }],
      ['a source that is not text', { ...pivot, sourceId: undefined, source: 7 }],
      ['a value that is not an object', 'pivot'],
    ];
    for (const [label, value] of cases) {
      expect(decodeWithPivot(value), label).toMatchObject({ ok: false, error: 'bad-shape' });
    }
  });
});
