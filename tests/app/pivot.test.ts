// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * Data > Pivot Table…: the panel reads the active table, and Create in New
 * Sheet puts the summary into a new worksheet (one undoable step) or, for a CSV
 * tab, a new spreadsheet tab. The source is never changed.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { AppState } from '../../src/app/state';
import {
  Commands,
  type PivotCreateOutcome,
  type PivotDialogInput,
  type UiPort,
} from '../../src/app/commands';
import { setLocale } from '../../src/app/i18n';
import { LosslessDocument } from '../../src/core/csv/lossless-document';
import { RsfDocument } from '../../src/core/workbook/rsf-document';
import { utf8 } from '../helpers';

beforeAll(() => {
  setLocale('en');
});

/** Opens the pivot table panel on the active tab and hands back what the panel would get. */
async function openPanel(state: AppState): Promise<PivotDialogInput> {
  let captured: PivotDialogInput | null = null;
  const ui = {
    showPivot: vi.fn(async (input: PivotDialogInput) => {
      captured = input;
    }),
    notify: vi.fn(),
  } as unknown as UiPort;
  await new Commands(state, ui, document).run('data.pivotTable');
  return captured!;
}

/** A workbook: a header row, then four sales. The first amount is formatted with a thousands separator. */
function salesBook(): { state: AppState; doc: RsfDocument } {
  const state = new AppState();
  const doc = RsfDocument.blank('sales.rsf');
  const rows = [
    ['region', 'item', 'amount'],
    ['East', 'pen', '1200'],
    ['West', 'pen', '50'],
    ['East', 'ink', '25'],
    ['West', 'ink', 'n/a'],
  ];
  rows.forEach((row, r) => row.forEach((value, c) => doc.setCell(r, c, value)));
  doc.setCellStyleOn(undefined, 1, 2, { numberFormat: { kind: 'number', decimals: 0, thousands: true } });
  state.addTab('sales.rsf', doc, null);
  return { state, doc };
}

/** The displayed text of a cell on the active sheet of `doc`. */
function readActive(doc: RsfDocument, r: number, c: number): string {
  return doc.getSheetDisplayValue(doc.activeSheetId, r, c);
}

describe('Data > Pivot Table…', () => {
  it('lists the active table’s field names for the pickers', async () => {
    const { state } = salesBook();
    const input = await openPanel(state);
    expect(input.columns).toEqual(['region', 'item', 'amount']);
  });

  it('gives a blank header its column letter', async () => {
    const state = new AppState();
    const doc = RsfDocument.blank('letters.rsf');
    doc.setCell(0, 0, 'name');
    doc.setCell(0, 2, 'score');
    state.addTab('letters.rsf', doc, null);
    const input = await openPanel(state);
    expect(input.columns).toEqual(['name', 'B', 'score']);
  });

  it('puts the summary in a new worksheet, reading a formatted amount as its number', async () => {
    const { state, doc } = salesBook();
    const input = await openPanel(state);
    const sourceId = doc.activeSheetId;
    // The first amount is shown with a separator, so the source reads "1,200".
    expect(doc.getSheetDisplayValue(sourceId, 1, 2)).toBe('1,200');

    const outcome: PivotCreateOutcome = input.create({
      rowField: 0,
      columnField: 1,
      valueField: 2,
      aggregation: 'sum',
    });
    expect(outcome).toEqual({ ok: true, sheetName: 'Pivot Table', ignored: 1 });
    expect(doc.sheetCount).toBe(2);
    expect(doc.activeSheet.name).toBe('Pivot Table');
    expect([0, 1, 2, 3, 4].map((r) => [0, 1, 2, 3].map((c) => readActive(doc, r, c)))).toEqual([
      ['Sum of amount', '', '', ''],
      ['region', 'ink', 'pen', 'Total'],
      ['East', '25', '1200', '1225'],
      ['West', '', '50', '50'],
      ['Total', '25', '1250', '1275'],
    ]);
    // The source sheet is untouched, formatting and all.
    expect(doc.getSheetDisplayValue(sourceId, 1, 2)).toBe('1,200');
    expect(doc.getSheetDisplayValue(sourceId, 4, 2)).toBe('n/a');
  });

  it('is one undoable step, and a second summary gets its own sheet name', async () => {
    const { state, doc } = salesBook();
    const input = await openPanel(state);
    const request = { rowField: 0, columnField: null, valueField: 2, aggregation: 'count' as const };
    expect(input.create(request)).toMatchObject({ ok: true, sheetName: 'Pivot Table' });
    expect(input.create(request)).toMatchObject({ ok: true, sheetName: 'Pivot Table (2)' });
    expect(doc.sheetCount).toBe(3);

    state.undo(state.activeTab!);
    state.undo(state.activeTab!);
    expect(doc.sheetCount).toBe(1);
  });

  it('opens a new unsaved spreadsheet tab for a CSV source', async () => {
    const state = new AppState();
    state.addTab(
      'people.csv',
      LosslessDocument.fromBytes(utf8('region,amount\nEast,10\nWest,5\nEast,2.5\n')),
      null,
    );
    const input = await openPanel(state);
    const outcome = input.create({ rowField: 0, columnField: null, valueField: 1, aggregation: 'sum' });
    expect(outcome).toEqual({ ok: true, sheetName: 'Pivot Table', ignored: 0 });

    expect(state.tabs).toHaveLength(2);
    const tab = state.activeTab!;
    expect(tab.name).toBe('people-Pivot Table.rsf');
    const book = tab.doc as RsfDocument;
    expect(book.isDirty).toBe(true);
    expect(book.getSheetDisplayValue(book.activeSheetId, 0, 0)).toBe('Sum of amount');
    expect(book.getSheetDisplayValue(book.activeSheetId, 2, 0)).toBe('East');
    expect(book.getSheetDisplayValue(book.activeSheetId, 2, 1)).toBe('12.5');
    expect(book.getSheetDisplayValue(book.activeSheetId, 4, 1)).toBe('17.5');
  });

  it('reports the chosen fields as an error, and adds no sheet, when they clash', async () => {
    const { state, doc } = salesBook();
    const input = await openPanel(state);
    expect(input.create({ rowField: 0, columnField: 0, valueField: 2, aggregation: 'sum' })).toEqual({
      ok: false,
      error: { code: 'sameField', params: {} },
    });
    expect(doc.sheetCount).toBe(1);
  });

  it('reports an empty sheet as having no columns', async () => {
    const state = new AppState();
    state.addTab('empty.rsf', RsfDocument.blank('empty.rsf'), null);
    const input = await openPanel(state);
    expect(input.columns).toEqual([]);
    expect(input.create({ rowField: 0, columnField: null, valueField: 0, aggregation: 'sum' })).toEqual({
      ok: false,
      error: { code: 'noColumns', params: {} },
    });
  });
});

describe('Data > Pivot Table… on a pivot table sheet', () => {
  const byRegion = { rowField: 0, columnField: null, valueField: 2, aggregation: 'sum' as const };

  /** The displayed text of the top-left `rows` by `cols` cells of the active sheet. */
  function block(doc: RsfDocument, rows: number, cols: number): string[][] {
    return Array.from({ length: rows }, (_, r) =>
      Array.from({ length: cols }, (_, c) => readActive(doc, r, c)),
    );
  }

  it('reopens on the pivot table sheet with the settings it was made with', async () => {
    const { state, doc } = salesBook();
    const created = await openPanel(state);
    expect(created.initial).toBeNull();
    expect(created.update).toBeNull();
    created.create(byRegion);
    const pivotId = doc.activeSheetId;

    const reopened = await openPanel(state);
    expect(doc.activeSheetId).toBe(pivotId);
    expect(reopened.initial).toEqual(byRegion);
    expect(reopened.columns).toEqual(['region', 'item', 'amount']);
    expect(reopened.update).not.toBeNull();
  });

  it('rebuilds the sheet from the current data, and one undo brings back its values and settings', async () => {
    const { state, doc } = salesBook();
    const sourceId = doc.activeSheetId;
    (await openPanel(state)).create(byRegion);
    // After the summary was made, the second West pen changes from 50 to 500.
    doc.setCellOn(sourceId, 2, 2, '500');

    const panel = await openPanel(state);
    const average = { ...byRegion, aggregation: 'average' as const };
    expect(panel.update!(average)).toEqual({
      ok: true,
      sheetName: 'Pivot Table',
      ignored: 1,
      mode: 'updated',
    });
    const averaged = [
      ['Average of amount', ''],
      ['region', 'amount'],
      ['East', '612.5'],
      ['West', '500'],
      ['Total', '575'],
    ];
    expect(block(doc, 5, 2)).toEqual(averaged);

    state.undo(state.activeTab!);
    expect(block(doc, 5, 2)).toEqual([
      ['Sum of amount', ''],
      ['region', 'amount'],
      ['East', '1225'],
      ['West', '50'],
      ['Total', '1275'],
    ]);
    expect((await openPanel(state)).initial).toEqual(byRegion);

    state.redo(state.activeTab!);
    expect(block(doc, 5, 2)).toEqual(averaged);
    expect((await openPanel(state)).initial).toEqual(average);

    // The same settings over the same data change nothing, and the panel says so.
    expect(panel.update!(average)).toEqual({
      ok: true,
      sheetName: 'Pivot Table',
      ignored: 1,
      mode: 'unchanged',
    });
  });

  it('grows the sheet for a larger summary, and clears what a smaller one no longer needs', async () => {
    const { state, doc } = salesBook();
    const sourceId = doc.activeSheetId;
    (await openPanel(state)).create(byRegion);
    const pivotId = doc.activeSheetId;
    // Thirty more items, each once in the East: more columns than a new sheet starts with.
    for (let i = 1; i <= 30; i++) {
      doc.setCellOn(sourceId, 4 + i, 0, 'East');
      doc.setCellOn(sourceId, 4 + i, 1, `item ${i}`);
      doc.setCellOn(sourceId, 4 + i, 2, '1');
    }

    const panel = await openPanel(state);
    const byItem = { rowField: 0, columnField: 1, valueField: 2, aggregation: 'sum' as const };
    expect(panel.update!(byItem)).toEqual({
      ok: true,
      sheetName: 'Pivot Table',
      ignored: 1,
      mode: 'updated',
    });
    expect(doc.activeSheetId).toBe(pivotId);
    expect(doc.sheetById(pivotId)!.columnCount).toBe(34);
    expect(readActive(doc, 1, 0)).toBe('region');
    expect(readActive(doc, 1, 2)).toBe('item 1');
    expect(readActive(doc, 1, 33)).toBe('Total');
    expect(readActive(doc, 2, 33)).toBe('1255');
    expect(readActive(doc, 4, 33)).toBe('1305');

    expect(panel.update!(byRegion)).toEqual({
      ok: true,
      sheetName: 'Pivot Table',
      ignored: 1,
      mode: 'updated',
    });
    expect(block(doc, 5, 3)).toEqual([
      ['Sum of amount', '', ''],
      ['region', 'amount', ''],
      ['East', '1255', ''],
      ['West', '50', ''],
      ['Total', '1305', ''],
    ]);
    expect(readActive(doc, 4, 33)).toBe('');
  });

  it('says so when the source sheet is gone, and leaves the pivot table as it was', async () => {
    const { state, doc } = salesBook();
    const sourceId = doc.activeSheetId;
    (await openPanel(state)).create(byRegion);
    const panel = await openPanel(state);

    expect(state.deleteSheet(state.activeTab!, sourceId)).toBe(true);
    expect(panel.update!(byRegion)).toEqual({ ok: false, error: { code: 'sourceMissing', params: {} } });
    expect(block(doc, 5, 2)).toEqual([
      ['Sum of amount', ''],
      ['region', 'amount'],
      ['East', '1225'],
      ['West', '50'],
      ['Total', '1275'],
    ]);
    expect((await openPanel(state)).update).toBeNull();
  });

  it('rebuilds a summary of a CSV tab on its spreadsheet tab, and leaves the CSV tab alone', async () => {
    const state = new AppState();
    const csvTab = state.addTab(
      'people.csv',
      LosslessDocument.fromBytes(utf8('region,amount\nEast,10\nWest,5\nEast,2.5\n')),
      null,
    );
    (await openPanel(state)).create({ rowField: 0, columnField: null, valueField: 1, aggregation: 'sum' });
    const book = state.activeTab!.doc as RsfDocument;
    // After the summary was made, the West amount changes from 5 to 50.
    state.editCell(csvTab, 2, 1, '50');

    const panel = await openPanel(state);
    expect(panel.update).not.toBeNull();
    expect(panel.update!({ rowField: 0, columnField: null, valueField: 1, aggregation: 'sum' })).toEqual({
      ok: true,
      sheetName: 'Pivot Table',
      ignored: 0,
      mode: 'updated',
    });
    expect([0, 1, 2, 3, 4].map((r) => [0, 1].map((c) => readActive(book, r, c)))).toEqual([
      ['Sum of amount', ''],
      ['region', 'amount'],
      ['East', '12.5'],
      ['West', '50'],
      ['Total', '62.5'],
    ]);
    expect(state.tabs).toHaveLength(2);
    expect(csvTab.doc.rowCount).toBe(4);
  });
});
