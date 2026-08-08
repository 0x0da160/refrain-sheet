// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { AppState } from '../src/app/app-state';
import { SqlCommands } from '../src/app/commands/sql';
import { NEW_DOC_COLS, NEW_DOC_ROWS, RsfDocument } from '../src/core/rsf-document';
import { Worksheet } from '../src/core/worksheet';

describe('Worksheet.usedExtent', () => {
  it('reports zero for a worksheet with no content', () => {
    const sheet = Worksheet.empty('s1', 'Sheet1', NEW_DOC_ROWS, NEW_DOC_COLS);
    expect(sheet.usedExtent()).toEqual({ rows: 0, cols: 0 });
  });

  it('trims to one past the last non-empty row and column', () => {
    const sheet = Worksheet.empty('s1', 'Sheet1', NEW_DOC_ROWS, NEW_DOC_COLS);
    sheet.setCell(0, 0, 'Name');
    sheet.setCell(0, 1, 'Score');
    sheet.setCell(0, 2, 'Date');
    sheet.setCell(1, 0, 'Alice');
    sheet.setCell(2, 0, 'Bob');
    sheet.setCell(3, 0, 'Cy');
    expect(sheet.usedExtent()).toEqual({ rows: 4, cols: 3 });
  });

  it('counts a formula cell as used even when it displays as empty', () => {
    const sheet = Worksheet.empty('s1', 'Sheet1', 2, 2);
    sheet.setCell(0, 1, '=""');
    expect(sheet.usedExtent()).toEqual({ rows: 1, cols: 2 });
  });
});

describe('SqlCommands.readTable: worksheet used-range trimming', () => {
  it('reads only the used range of a newly created RSF worksheet, not its full allocated grid', () => {
    const state = new AppState();
    const tab = state.addTab('book.rsf', RsfDocument.blank('book.rsf'), null);
    const doc = tab.doc;
    expect(doc.kind).toBe('rsf');
    if (doc.kind !== 'rsf') throw new Error('unreachable');
    expect(doc.rowCount).toBe(NEW_DOC_ROWS);
    expect(doc.columnCount).toBe(NEW_DOC_COLS);

    doc.setCell(0, 0, 'Name');
    doc.setCell(0, 1, 'Score');
    doc.setCell(0, 2, 'Date');
    doc.setCell(1, 0, 'Alice');
    doc.setCell(1, 1, '90');
    doc.setCell(1, 2, '2026-01-01');
    doc.setCell(2, 0, 'Bob');
    doc.setCell(2, 1, '80');
    doc.setCell(2, 2, '2026-01-02');
    doc.setCell(3, 0, 'Cy');
    doc.setCell(3, 1, '70');
    doc.setCell(3, 2, '2026-01-03');

    const sql = new SqlCommands();
    const table = sql.readTable(tab, doc.activeSheetId);

    expect(table.headers).toEqual(['Name', 'Score', 'Date']);
    expect(table.rows).toHaveLength(3);
    for (const row of table.rows) {
      expect(row).toHaveLength(3);
    }

    expect(sql.listColumns(tab, doc.activeSheetId)).toEqual(['Name', 'Score', 'Date']);
  });

  it('returns an empty table for a worksheet with no content at all', () => {
    const state = new AppState();
    const tab = state.addTab('book.rsf', RsfDocument.blank('book.rsf'), null);
    const doc = tab.doc;
    if (doc.kind !== 'rsf') throw new Error('unreachable');

    const sql = new SqlCommands();
    const table = sql.readTable(tab, doc.activeSheetId);
    expect(table.headers).toEqual([]);
    expect(table.rows).toEqual([]);
  });
});
