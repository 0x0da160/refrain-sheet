// SPDX-License-Identifier: MIT
/**
 * The pivot table engine (`src/core/pivot.ts`): grouping, label order, each
 * aggregation, blanks and non-numeric values, totals, rounding, and the bounds.
 */
import { describe, expect, it } from 'vitest';
import {
  buildPivotTable,
  PIVOT_MAX_COLUMN_GROUPS,
  PIVOT_MAX_ROW_GROUPS,
  PIVOT_MAX_SOURCE_ROWS,
  type PivotBuildOutcome,
  type PivotRequest,
  type PivotTable,
} from '../../src/core/pivot';

const headers = ['region', 'item', 'amount'];
const rows = [
  ['East', 'pen', '100'],
  ['West', 'pen', '50'],
  ['East', 'ink', '25'],
  ['West', 'ink', ''],
  ['East', 'pen', 'n/a'],
];

function build(
  request: Partial<PivotRequest>,
  source: string[][] = rows,
  head: string[] = headers,
): PivotBuildOutcome {
  return buildPivotTable(head, source, {
    rowField: 0,
    columnField: 1,
    valueField: 2,
    aggregation: 'sum',
    ...request,
  });
}

function table(request: Partial<PivotRequest> = {}, source: string[][] = rows): PivotTable {
  const outcome = build(request, source);
  if (!outcome.ok) {
    throw new Error(`unexpected ${outcome.error.code}`);
  }
  return outcome.table;
}

describe('buildPivotTable: grouping and totals', () => {
  it('sums by row and column, with row, column, and grand totals', () => {
    const result = table({ aggregation: 'sum' });
    expect(result.rowLabels).toEqual(['East', 'West']);
    expect(result.columnLabels).toEqual(['ink', 'pen']);
    expect(result.cells).toEqual([
      [25, 100], // East: ink, pen (the "n/a" is left out)
      [null, 50], // West: its ink value is blank, so there is nothing to add
    ]);
    expect(result.rowTotals).toEqual([125, 50]);
    expect(result.columnTotals).toEqual([25, 150]);
    expect(result.grandTotal).toBe(175);
    expect(result.ignoredValues).toBe(1);
  });

  it('counts the non-blank values of each group, so a group of blanks counts zero', () => {
    const result = table({ aggregation: 'count' });
    expect(result.cells).toEqual([
      [1, 2], // East: one ink; two pens (the "n/a" is a value, so it counts)
      [0, 1], // West: a blank ink, and one pen
    ]);
    expect(result.rowTotals).toEqual([3, 1]);
    expect(result.grandTotal).toBe(4);
    expect(result.ignoredValues).toBe(0);
  });

  it('averages, and takes the minimum and maximum, of the numbers only', () => {
    const average = table({ columnField: null, aggregation: 'average' });
    expect(average.rowLabels).toEqual(['East', 'West']);
    expect(average.columnLabels).toEqual([]);
    expect(average.cells).toEqual([[62.5], [50]]);
    expect(average.columnTotals).toEqual([average.grandTotal]);
    expect(average.grandTotal).toBe(Number((175 / 3).toPrecision(15)));
    expect(table({ columnField: null, aggregation: 'min' }).cells).toEqual([[25], [50]]);
    expect(table({ columnField: null, aggregation: 'max' }).cells).toEqual([[100], [50]]);
  });

  it('puts a blank field value in one group, labelled null and listed last', () => {
    const result = table({ columnField: null, valueField: 2, aggregation: 'sum' }, [
      ['', 'x', '4'],
      ['  ', 'x', '6'],
      ['East', 'x', '1'],
    ]);
    expect(result.rowLabels).toEqual(['East', null]);
    expect(result.cells).toEqual([[1], [10]]);
  });

  it('lists numbers first in numeric order, then text in natural order, then the blank group', () => {
    const source = [
      ['10', 'x', '1'],
      ['9', 'x', '1'],
      ['item 10', 'x', '1'],
      ['alpha', 'x', '1'],
      ['item 2', 'x', '1'],
      ['', 'x', '1'],
    ];
    const result = table({ columnField: null, valueField: 2, aggregation: 'count' }, source);
    expect(result.rowLabels).toEqual(['9', '10', 'alpha', 'item 2', 'item 10', null]);
  });

  it('reads a row shorter than the header as blank in its missing fields', () => {
    const result = table({ columnField: null, valueField: 2, aggregation: 'count' }, [
      ['East', 'pen', '5'],
      ['East'],
    ]);
    expect(result.cells).toEqual([[1]]);
    expect(result.grandTotal).toBe(1);
  });

  it('adds decimals without binary floating-point noise', () => {
    const result = table({ rowField: 0, columnField: null, valueField: 1, aggregation: 'sum' }, [
      ['a', '0.1'],
      ['a', '0.2'],
    ]);
    expect(result.cells).toEqual([[0.3]]);
  });

  it('does not read a formatted number such as "1,200" as a number', () => {
    // The command layer reads amounts as plain digits, so this rule matters
    // only for text that really is typed with separators.
    const result = table({ rowField: 0, columnField: null, valueField: 1, aggregation: 'sum' }, [
      ['a', '1,200'],
      ['a', '300'],
    ]);
    expect(result.cells).toEqual([[300]]);
    expect(result.ignoredValues).toBe(1);
  });

  it('shows null, not zero, for a cell or total with no number to summarize', () => {
    const result = table({ aggregation: 'sum' }, [['a', 'x', 'n/a']]);
    expect(result.cells).toEqual([[null]]);
    expect(result.rowTotals).toEqual([null]);
    expect(result.grandTotal).toBeNull();
    expect(result.ignoredValues).toBe(1);
  });

  it('does not change the source rows', () => {
    const source = rows.map((row) => [...row]);
    table({}, source);
    expect(source).toEqual(rows);
  });
});

describe('buildPivotTable: rejected requests', () => {
  it('rejects a table with no columns, and one with no data rows', () => {
    expect(build({}, rows, [])).toMatchObject({ ok: false, error: { code: 'noColumns' } });
    expect(build({}, [])).toMatchObject({ ok: false, error: { code: 'noRows' } });
  });

  it('rejects a field outside the header, and the same field for both rows and columns', () => {
    expect(build({ rowField: 3 })).toMatchObject({ ok: false, error: { code: 'fieldOutOfRange' } });
    expect(build({ valueField: -1 })).toMatchObject({ ok: false, error: { code: 'fieldOutOfRange' } });
    expect(build({ columnField: 7 })).toMatchObject({ ok: false, error: { code: 'fieldOutOfRange' } });
    expect(build({ rowField: 0, columnField: 0 })).toMatchObject({ ok: false, error: { code: 'sameField' } });
  });

  it('rejects more source rows than the engine reads, rather than summarizing a cut-off table', () => {
    const row = ['a', 'b', '1'];
    const many = new Array<string[]>(PIVOT_MAX_SOURCE_ROWS + 1).fill(row);
    expect(build({ columnField: null }, many)).toMatchObject({
      ok: false,
      error: { code: 'tooManyRows', params: { max: PIVOT_MAX_SOURCE_ROWS } },
    });
  });

  it('rejects more distinct row or column values than the output can hold', () => {
    const manyRows = Array.from({ length: PIVOT_MAX_ROW_GROUPS + 1 }, (_, i) => [`r${i}`, 'x', '1']);
    expect(build({ columnField: null }, manyRows)).toMatchObject({
      ok: false,
      error: { code: 'tooManyRowGroups', params: { max: PIVOT_MAX_ROW_GROUPS } },
    });
    const manyColumns = Array.from({ length: PIVOT_MAX_COLUMN_GROUPS + 1 }, (_, i) => ['a', `c${i}`, '1']);
    expect(build({}, manyColumns)).toMatchObject({
      ok: false,
      error: { code: 'tooManyColumnGroups', params: { max: PIVOT_MAX_COLUMN_GROUPS } },
    });
  });
});
