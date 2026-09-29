// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * Data > Run SQL Query… > Put Results in New Sheet: the result goes into a
 * new worksheet (one undoable step) or, for a CSV tab, a new spreadsheet tab;
 * the source is never changed.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { AppState } from '../../src/app/state';
import { Commands, type SqlQueryDialogInput, type UiPort } from '../../src/app/commands';
import { setLocale } from '../../src/app/i18n';
import { initSqlEngine } from '../../src/core/sql-engine';
import { buildSqlQuery, EMPTY_SQL_BUILDER_SPEC } from '../../src/core/sql-builder';
import { LosslessDocument } from '../../src/core/csv/lossless-document';
import { RsfDocument } from '../../src/core/workbook/rsf-document';
import { utf8 } from '../helpers';

beforeAll(async () => {
  setLocale('en');
  await initSqlEngine();
});

/** Opens the SQL panel on the active tab and hands back what the panel would get. */
async function openPanel(state: AppState): Promise<SqlQueryDialogInput> {
  let captured: SqlQueryDialogInput | null = null;
  const ui = {
    showSqlQuery: vi.fn(async (input: SqlQueryDialogInput) => {
      captured = input;
    }),
    notify: vi.fn(),
  } as unknown as UiPort;
  await new Commands(state, ui, document).run('data.runSqlQuery');
  return captured!;
}

function salesBook(): { state: AppState; doc: RsfDocument } {
  const state = new AppState();
  const doc = RsfDocument.blank('sales.rsf');
  const rows = [
    ['dept', 'amount'],
    ['Sales', '100'],
    ['Sales', '50'],
    ['Ops', '75'],
  ];
  rows.forEach((row, r) => row.forEach((value, c) => doc.setCell(r, c, value)));
  state.addTab('sales.rsf', doc, null);
  return { state, doc };
}

describe('Put Results in New Sheet', () => {
  it('adds a worksheet holding the header row and the result rows, undoably', async () => {
    const { state, doc } = salesBook();
    const input = await openPanel(state);
    const sourceId = doc.activeSheetId;
    const query = buildSqlQuery(
      {
        ...EMPTY_SQL_BUILDER_SPEC,
        groupBy: ['dept'],
        totals: [{ fn: 'sum', column: 'amount' }],
        sort: { column: 'dept', descending: false },
      },
      input.columns(sourceId),
    );
    const outcome = await input.runQuery(sourceId, query);
    if (!outcome.ok) throw outcome.error;

    const name = input.writeResult(outcome.result);
    expect(name).toBe('Query Result');
    expect(doc.sheetCount).toBe(2);
    expect(doc.activeSheet.name).toBe('Query Result');
    const read = (r: number, c: number): string => doc.getSheetDisplayValue(doc.activeSheetId, r, c);
    expect([read(0, 0), read(0, 1)]).toEqual(['dept', 'SUM(amount)']);
    expect([read(1, 0), read(1, 1)]).toEqual(['Ops', '75']);
    expect([read(2, 0), read(2, 1)]).toEqual(['Sales', '150']);
    // The source sheet is untouched.
    expect(doc.getSheetDisplayValue(sourceId, 1, 1)).toBe('100');

    // A second result gets its own name.
    expect(input.writeResult(outcome.result)).toBe('Query Result (2)');

    state.undo(state.activeTab!);
    state.undo(state.activeTab!);
    expect(doc.sheetCount).toBe(1);
  });

  it('opens a new unsaved spreadsheet tab for a CSV source', async () => {
    const state = new AppState();
    state.addTab('people.csv', LosslessDocument.fromBytes(utf8('name,age\nAi,30\nBo,25\n')), null);
    const input = await openPanel(state);
    const outcome = await input.runQuery('csv', 'SELECT name FROM data WHERE age > 26');
    if (!outcome.ok) throw outcome.error;

    expect(input.writeResult(outcome.result)).toBe('Query Result');
    expect(state.tabs).toHaveLength(2);
    const tab = state.activeTab!;
    expect(tab.name).toBe('people-Query Result.rsf');
    const book = tab.doc as RsfDocument;
    expect(book.isDirty).toBe(true);
    expect(book.getSheetDisplayValue(book.activeSheetId, 0, 0)).toBe('name');
    expect(book.getSheetDisplayValue(book.activeSheetId, 1, 0)).toBe('Ai');
  });
});
