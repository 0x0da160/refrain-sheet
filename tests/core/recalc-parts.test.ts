// SPDX-License-Identifier: MIT
/**
 * The parts the recalculation engine keeps results in and follows changes
 * with: the paged cell memo, the typed column store, and the search for the
 * formula cells a change can reach.
 */
import { describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  type FormulaValue,
  KIND_BOOLEAN,
  KIND_EMPTY,
  KIND_ERROR,
  KIND_NUMBER,
  KIND_STRING,
} from '../../src/core/formula/value';
import { CellMemo } from '../../src/core/workbook/cell-memo';
import { ColumnStore } from '../../src/core/workbook/column-store';
import { type CellRect, formulaCellsReading } from '../../src/core/workbook/recalc-dependents';
import { RsfDocument } from '../../src/core/workbook/rsf-document';
import type { Worksheet } from '../../src/core/workbook/worksheet';
import { seededRandom } from '../workbook-values';

describe('CellMemo', () => {
  it('stores and forgets by cell, across page boundaries', () => {
    const memo = new CellMemo<string>();
    expect(memo.get(0, 0)).toBeUndefined();
    expect(memo.get(5000, 3)).toBeUndefined();
    for (const row of [0, 1, 1023, 1024, 1025, 2047, 2048, 5000]) {
      memo.set(row, 2, `v${row}`);
    }
    memo.set(7, 0, 'other column');
    expect(memo.get(1024, 2)).toBe('v1024');
    expect(memo.get(1024, 1)).toBeUndefined();
    memo.clearRows(2, 1023, 2047);
    expect([0, 1, 1023, 1024, 1025, 2047, 2048, 5000].map((row) => memo.get(row, 2))).toEqual([
      'v0',
      'v1',
      undefined,
      undefined,
      undefined,
      undefined,
      'v2048',
      'v5000',
    ]);
    expect(memo.get(7, 0)).toBe('other column');
    memo.set(1, 2, undefined);
    expect(memo.get(1, 2)).toBeUndefined();
    memo.set(9000, 9, undefined); // forgetting what was never stored is a no-op
    memo.clearRows(4, 0, 100);
    memo.clearRows(2, 0, 1_000_000);
    expect(memo.get(5000, 2)).toBeUndefined();
  });

  it('agrees with a plain map through random use', () => {
    const rand = seededRandom(9);
    const memo = new CellMemo<number>();
    const model = new Map<string, number>();
    for (let step = 0; step < 4000; step++) {
      const col = Math.floor(rand() * 3);
      const row = Math.floor(rand() * 5000);
      if (rand() < 0.7) {
        memo.set(row, col, step);
        model.set(`${row},${col}`, step);
      } else {
        const bottom = row + Math.floor(rand() * 1500);
        memo.clearRows(col, row, bottom);
        for (const key of [...model.keys()]) {
          const [r, c] = key.split(',').map(Number);
          if (c === col && r >= row && r <= bottom) model.delete(key);
        }
      }
    }
    for (let col = 0; col < 3; col++) {
      for (let row = 0; row < 6600; row++) {
        expect(memo.get(row, col)).toBe(model.get(`${row},${col}`));
      }
    }
  });
});

describe('ColumnStore', () => {
  const number = (value: number): FormulaValue => ({ type: 'number', value });

  it('holds each kind of value in its typed form', () => {
    const cells: FormulaValue[] = [
      number(1.5),
      { type: 'string', value: 'a' },
      { type: 'boolean', value: true },
      { type: 'boolean', value: false },
      { type: 'empty' },
      { type: 'error', code: '#N/A' },
      { type: 'string', value: 'a' },
      { type: 'string', value: '' },
    ];
    const view = new ColumnStore(2).view(0, cells.length - 1, (row) => cells[row]);
    expect(view.length).toBe(cells.length);
    expect(view.offset).toBe(0);
    expect([...view.kinds.subarray(0, cells.length)]).toEqual([
      KIND_NUMBER,
      KIND_STRING,
      KIND_BOOLEAN,
      KIND_BOOLEAN,
      KIND_EMPTY,
      KIND_ERROR,
      KIND_STRING,
      KIND_STRING,
    ]);
    expect(view.nums[0]).toBe(1.5);
    expect([view.nums[2], view.nums[3]]).toEqual([1, 0]);
    expect(view.strings[view.ids[1]]).toBe('a');
    expect(view.ids[6]).toBe(view.ids[1]); // equal texts share one entry
    expect(view.strings[view.ids[7]]).toBe('');
    expect(ERROR_CODES[view.ids[5]]).toBe('#N/A');
  });

  it('reads only the rows asked for, and each of them once until it is invalidated', () => {
    const reads: number[] = [];
    const read = (row: number): FormulaValue => {
      reads.push(row);
      return number(row);
    };
    const store = new ColumnStore(100);
    store.view(10, 19, read);
    expect(reads).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
    reads.length = 0;
    store.view(12, 15, read);
    expect(reads).toEqual([]);
    const wider = store.view(5, 24, read);
    expect(reads).toEqual([5, 6, 7, 8, 9, 20, 21, 22, 23, 24]);
    expect(wider.offset).toBe(5);
    expect(wider.length).toBe(20);
    reads.length = 0;
    store.invalidate(8, 12);
    store.invalidate(40, 50); // rows never read
    store.view(0, 30, read);
    expect(reads).toEqual([0, 1, 2, 3, 4, 8, 9, 10, 11, 12, 25, 26, 27, 28, 29, 30]);
    reads.length = 0;
    store.view(150, 152, read); // beyond the size it was created with
    expect(reads).toEqual([150, 151, 152]);
    expect(store.view(0, 152, () => number(-1)).nums[151]).toBe(151);
  });

  it('drops what scans derived from the rows when any row changes', () => {
    const store = new ColumnStore(10);
    const view = store.view(0, 9, (row) => number(row));
    view.derived?.set('mask', new Uint32Array(1));
    expect(store.view(0, 9, () => number(0)).derived?.size).toBe(1);
    store.invalidate(3, 3);
    expect(store.view(0, 9, (row) => number(row)).derived?.size).toBe(0);
  });

  it('reads a row again while its cell is only a circular-reference placeholder', () => {
    let settled = false;
    const read = (row: number): FormulaValue =>
      row === 2 && !settled ? { type: 'error', code: '#CYCLE!' } : number(row);
    const store = new ColumnStore(5);
    expect(store.view(0, 4, read).kinds[2]).toBe(KIND_ERROR);
    settled = true;
    const again = store.view(0, 4, read);
    expect(again.kinds[2]).toBe(KIND_NUMBER);
    expect(again.nums[2]).toBe(2);
  });

  it('survives a read that asks the same store for more rows', () => {
    const store = new ColumnStore(4);
    let nested = false;
    const read = (row: number): FormulaValue => {
      if (row === 3 && !nested) {
        nested = true;
        // A formula in this column reading further down the same column.
        expect(store.view(0, 4000, read).nums[3999]).toBe(3999);
      }
      return number(row);
    };
    const view = store.view(0, 9, read);
    expect([...view.nums.subarray(0, 10)]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect([...view.kinds.subarray(0, 10)]).toEqual(new Array(10).fill(KIND_NUMBER));
  });

  it('agrees with reading every row through random views and invalidations', () => {
    const rand = seededRandom(77);
    const values = Array.from({ length: 600 }, (_, row) => row);
    const store = new ColumnStore(50);
    for (let step = 0; step < 500; step++) {
      const top = Math.floor(rand() * 550);
      const bottom = top + Math.floor(rand() * 50);
      if (rand() < 0.4) {
        for (let row = top; row <= bottom; row++) values[row] += 1000;
        store.invalidate(top, bottom);
      } else {
        const view = store.view(top, bottom, (row) => number(values[row]));
        for (let row = top; row <= bottom; row++) {
          expect(view.nums[row]).toBe(values[row]);
        }
      }
    }
  });
});

// ----- Which formula cells a change reaches -----

/** A workbook from A1-style inputs per worksheet; every worksheet is 30 rows by 6 columns. */
function workbook(sheets: Record<string, Record<string, string>>): RsfDocument {
  const names = Object.keys(sheets);
  const doc = RsfDocument.empty('book.rsf', 30, 6, names[0]);
  names.slice(1).forEach((name) => doc.insertSheetAt(doc.sheets.length, doc.createWorksheet(name, 30, 6)));
  doc.sheets.forEach((sheet) => {
    for (const [a1, input] of Object.entries(sheets[sheet.name])) {
      doc.setCellOn(sheet.id, Number(a1.slice(1)) - 1, a1.charCodeAt(0) - 65, input);
    }
  });
  return doc;
}

/** A column of formulas filled down from 1-based row `from` to `to`. */
function fill(
  column: string,
  from: number,
  to: number,
  formula: (r: number) => string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (let r = from; r <= to; r++) out[`${column}${r}`] = formula(r);
  return out;
}

/** The reached cells as `Sheet!A1:A9` labels, sorted. */
function reachedBy(doc: RsfDocument, changed: string, budget = 1_000_000): string[] | null {
  const [sheetName, a1] = changed.split('!');
  const sheet = doc.sheetByName(sheetName) as Worksheet;
  const row = Number(a1.slice(1)) - 1;
  const col = a1.charCodeAt(0) - 65;
  const rect: CellRect = { sheet, top: row, bottom: row, left: col, right: col };
  const reached = formulaCellsReading([rect], doc.sheets, (name) => doc.sheetByName(name), budget);
  return (
    reached
      ?.map((r) => {
        const column = String.fromCharCode(65 + r.left);
        return `${r.sheet.name}!${column}${r.top + 1}:${column}${r.bottom + 1}`;
      })
      .sort() ?? null
  );
}

describe('formulaCellsReading', () => {
  it('finds the one row of a filled-down formula that reads a changed cell', () => {
    const doc = workbook({ S: fill('C', 2, 20, (r) => `=A${r}*B${r}`) });
    expect(reachedBy(doc, 'S!A7')).toEqual(['S!C7:C7']);
    expect(reachedBy(doc, 'S!B20')).toEqual(['S!C20:C20']);
    expect(reachedBy(doc, 'S!A1')).toEqual([]);
    expect(reachedBy(doc, 'S!D7')).toEqual([]);
  });

  it('follows absolute, mixed and offset references', () => {
    const doc = workbook({
      S: {
        ...fill('B', 1, 10, () => '=$A$3'),
        ...fill('C', 1, 10, (r) => `=SUM(A$1:A${r})`),
        ...fill('D', 3, 10, (r) => `=A${r - 2}+A${r}`),
        ...fill('E', 1, 10, (r) => `=SUM(A${r}:A$5)`),
      },
    });
    expect(reachedBy(doc, 'S!A3')).toEqual(['S!B1:B10', 'S!C3:C10', 'S!D3:D5', 'S!E1:E3']);
    expect(reachedBy(doc, 'S!A8')).toEqual(['S!C8:C10', 'S!D8:D10', 'S!E8:E10']);
    expect(reachedBy(doc, 'S!A1')).toEqual(['S!C1:C10', 'S!D3:D3', 'S!E1:E1']);
  });

  it('follows whole-column and whole-row ranges and other worksheets', () => {
    const doc = workbook({
      Data: fill('B', 1, 9, (r) => `=A${r}+1`),
      Calc: {
        A1: '=SUM(Data!B:B)',
        A2: '=SUM(Data!4:4)',
        A3: "=Data!B2+'Far away'!A1",
        A4: '=A1*2',
        A5: '=Gone!A1',
      },
      'Far away': { B1: '=Calc!A4' },
    });
    expect(reachedBy(doc, 'Data!A4')).toEqual([
      'Calc!A1:A1',
      'Calc!A2:A2',
      'Calc!A4:A4',
      'Data!B4:B4',
      'Far away!B1:B1',
    ]);
    expect(reachedBy(doc, 'Data!A2')).toEqual([
      'Calc!A1:A1',
      'Calc!A3:A3',
      'Calc!A4:A4',
      'Data!B2:B2',
      'Far away!B1:B1',
    ]);
    expect(reachedBy(doc, 'Far away!A1')).toEqual(['Calc!A3:A3']);
  });

  it('takes a running total from the changed row to its end, not above it', () => {
    const doc = workbook({ S: { B1: '=A1', ...fill('B', 2, 30, (r) => `=B${r - 1}+A${r}`), C1: '=B30' } });
    expect(reachedBy(doc, 'S!A12')).toEqual(['S!B12:B30', 'S!C1:C1']);
    expect(reachedBy(doc, 'S!A1')).toEqual(['S!B1:B1', 'S!B2:B30', 'S!C1:C1']);
  });

  it('ends on a circular reference', () => {
    const doc = workbook({ S: { A1: '=B1', B1: '=A1+C1', D1: '=A1' } });
    expect(reachedBy(doc, 'S!C1')).toEqual(['S!A1:A1', 'S!B1:B1', 'S!D1:D1']);
  });

  it('gives up when the search would cost more than its budget', () => {
    const doc = workbook({ S: { B1: '=A1', ...fill('B', 2, 30, (r) => `=B${r - 1}+A${r}`) } });
    expect(reachedBy(doc, 'S!A1', 1)).toBeNull();
    expect(reachedBy(doc, 'S!A1', 1000)).not.toBeNull();
  });
});
