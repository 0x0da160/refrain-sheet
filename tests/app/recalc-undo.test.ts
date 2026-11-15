// SPDX-License-Identifier: MIT
/**
 * Undo and redo over a workbook whose results are kept across cell changes
 * (see tests/core/recalc-incremental.test.ts). Each history entry — one cell,
 * a pasted block, inserted or deleted rows — is applied through the history
 * layer; every step back or forward must show exactly the values that state
 * showed the first time, which are also what a workbook freshly built from
 * the same inputs shows.
 */
import { describe, expect, it } from 'vitest';
import { AppState } from '../../src/app/state';
import { RsfDocument } from '../../src/core/workbook/rsf-document';
import { differences, freshCopy, pick, seededRandom, workbookValues } from '../workbook-values';

const DETAIL_ROWS = 1100;
const CATEGORIES = ['x', 'y', 'z', 'w'];

function salesWorkbook(rand: () => number): RsfDocument {
  const doc = RsfDocument.empty('book.rsf', DETAIL_ROWS, 5, 'Data');
  const data = doc.sheets[0];
  for (let row = 0; row < DETAIL_ROWS; row++) {
    const r = row + 1;
    doc.setCellOn(data.id, row, 0, pick(rand, CATEGORIES));
    doc.setCellOn(data.id, row, 1, String(1 + Math.floor(rand() * 9)));
    doc.setCellOn(data.id, row, 2, pick(rand, ['100', '250', '0.1', '19.99']));
    doc.setCellOn(data.id, row, 3, `=B${r}*C${r}`);
    doc.setCellOn(data.id, row, 4, r === 1 ? '=D1' : `=E${r - 1}+D${r}`);
  }
  const calc = doc.createWorksheet('Calc', 8, 5);
  doc.insertSheetAt(1, calc);
  CATEGORIES.forEach((category, row) => {
    const r = row + 1;
    doc.setCellOn(calc.id, row, 0, category);
    doc.setCellOn(calc.id, row, 1, `=SUMIFS(Data!D:D,Data!A:A,A${r})`);
    doc.setCellOn(calc.id, row, 2, `=COUNTIFS(Data!A:A,A${r},Data!B:B,">="&$E$1)`);
    doc.setCellOn(calc.id, row, 3, `=IFERROR(B${r}/C${r},0)`);
  });
  doc.setCellOn(calc.id, 0, 4, '5');
  doc.setCellOn(calc.id, 5, 0, '=SUM(B1:B4)');
  doc.setCellOn(calc.id, 5, 1, '=MAX(Data!E:E)');
  return doc;
}

function expectValues(doc: RsfDocument, want: readonly string[], when: string): void {
  const differing = differences(workbookValues(doc), want);
  if (differing.length > 0) {
    expect({ when, differing }).toEqual({ when, differing: [] });
  }
}

describe('undo and redo with results kept across changes', () => {
  for (const seed of [31, 32]) {
    it(`shows each earlier state exactly, step by step (seed ${seed})`, () => {
      const rand = seededRandom(seed);
      const doc = salesWorkbook(rand);
      const [data, calc] = doc.sheets;
      const state = new AppState();
      const tab = state.addTab('book.rsf', doc, null);

      const operation = (): boolean => {
        const roll = rand();
        if (roll < 0.45) {
          state.setActiveSheet(tab, data.id);
          const row = Math.floor(rand() * data.rowCount);
          const col = Math.floor(rand() * 3);
          const value =
            col === 0 ? pick(rand, [...CATEGORIES, 'other']) : pick(rand, ['1', '4', '9', '0.5', '']);
          return state.editCell(tab, row, col, value);
        }
        if (roll < 0.6) {
          state.setActiveSheet(tab, calc.id);
          return rand() < 0.5
            ? state.editCell(tab, 0, 4, pick(rand, ['1', '3', '5', '8']))
            : state.editCell(tab, Math.floor(rand() * 4), 0, pick(rand, [...CATEGORIES, 'other']));
        }
        if (roll < 0.8) {
          // A pasted block: several rows of the detail sheet in one entry.
          state.setActiveSheet(tab, data.id);
          const top = Math.floor(rand() * (data.rowCount - 40));
          const height = rand() < 0.1 ? 800 : 1 + Math.floor(rand() * 30);
          const changes = [];
          for (let row = top; row < Math.min(data.rowCount, top + height); row++) {
            for (let col = 0; col < 3; col++) {
              const after = col === 0 ? pick(rand, CATEGORIES) : String(1 + Math.floor(rand() * 9));
              changes.push({ row, col, before: data.getValue(row, col), after });
            }
          }
          return state.bulkEdit(tab, changes, 'history.paste');
        }
        if (roll < 0.87) {
          // Overwrite a filled-down formula, or put one back.
          state.setActiveSheet(tab, data.id);
          const row = Math.floor(rand() * data.rowCount);
          return state.editCell(tab, row, 3, pick(rand, ['7', `=B${row + 1}*C${row + 1}`, `=B${row + 1}+1`]));
        }
        state.setActiveSheet(tab, data.id);
        const index = Math.floor(rand() * data.rowCount);
        return rand() < 0.5 ? state.insertRows(tab, index, 1) : state.deleteRows(tab, index, 1);
      };

      // What the workbook shows after 0, 1, 2, … history entries.
      const shown: string[][] = [workbookValues(doc)];
      expectValues(freshCopy(doc), shown[0], 'the starting workbook, freshly built');
      while (shown.length <= 30) {
        if (!operation()) {
          continue;
        }
        const values = workbookValues(doc);
        expectValues(freshCopy(doc), values, `entry ${shown.length}, freshly built`);
        shown.push(values);
      }
      const entries = shown.length - 1;

      for (let at = entries - 1; at >= 0; at--) {
        expect(state.undo(tab), `undo to ${at}`).not.toBeNull();
        expectValues(doc, shown[at], `after undo to entry ${at}`);
      }
      expect(state.undo(tab)).toBeNull();
      for (let at = 1; at <= entries; at++) {
        expect(state.redo(tab), `redo to ${at}`).not.toBeNull();
        expectValues(doc, shown[at], `after redo to entry ${at}`);
      }
      expect(state.redo(tab)).toBeNull();

      // Back and forth at random, sometimes several steps between two looks.
      let at = entries;
      for (let step = 0; step < 60; step++) {
        const moves = 1 + Math.floor(rand() * 3);
        for (let i = 0; i < moves; i++) {
          if (at > 0 && (at === entries || rand() < 0.55)) {
            state.undo(tab);
            at -= 1;
          } else {
            state.redo(tab);
            at += 1;
          }
        }
        expectValues(doc, shown[at], `after walking to entry ${at}`);
      }
    });
  }

  it('undoes a pasted block as one step, with every dependent result restored', () => {
    const doc = salesWorkbook(seededRandom(5));
    const [data, calc] = doc.sheets;
    const state = new AppState();
    const tab = state.addTab('book.rsf', doc, null);
    const before = workbookValues(doc);
    const total = doc.evaluateInSheet(calc, 5, 0);

    state.setActiveSheet(tab, data.id);
    const changes = [];
    for (let row = 100; row < 130; row++) {
      changes.push({ row, col: 1, before: data.getValue(row, 1), after: '1000' });
    }
    expect(state.bulkEdit(tab, changes, 'history.paste')).toBe(true);
    expect(doc.evaluateInSheet(calc, 5, 0)).not.toEqual(total);
    expect(doc.evaluateInSheet(data, 100, 3).type).toBe('number');

    expect(state.undo(tab)).not.toBeNull();
    expectValues(doc, before, 'after undoing the paste');
    expect(state.undo(tab)).toBeNull(); // it was one entry
    expect(state.redo(tab)).not.toBeNull();
    expectValues(freshCopy(doc), workbookValues(doc), 'after redoing the paste, freshly built');
  });
});
