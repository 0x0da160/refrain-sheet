// SPDX-License-Identifier: MIT
/**
 * Setting a sheet's print area: undoable on a workbook (and carried through
 * row and column deletes and moves), remembered by the tab for a CSV
 * table, and refused on a protected file.
 */
import { describe, expect, it } from 'vitest';
import { AppState } from '../../src/app/state';
import {
  canHoldPrintArea,
  printAreaOf,
  selectionPrintArea,
  setPrintArea,
} from '../../src/app/state/print-area';
import { RsfDocument } from '../../src/core/workbook/rsf-document';
import { doc as csvDoc } from '../helpers';

const area = (top: number, left: number, bottom: number, right: number) => ({ top, left, bottom, right });

function book() {
  const state = new AppState();
  const doc = RsfDocument.empty('b.rsf', 10, 5, 'Sheet1');
  const tab = state.addTab('b.rsf', doc, null);
  tab.readOnly = false;
  return { state, doc, tab };
}

describe('print area on a workbook', () => {
  it('sets, clears, and undoes as one entry each, marking the file changed', () => {
    const { state, doc, tab } = book();
    expect(setPrintArea(state, tab, area(1, 0, 4, 2))).toBe(true);
    expect(doc.isDirty).toBe(true);
    expect(printAreaOf(tab)).toEqual(area(1, 0, 4, 2));
    expect(setPrintArea(state, tab, area(1, 0, 4, 2))).toBe(false);
    expect(setPrintArea(state, tab, null)).toBe(true);
    expect(printAreaOf(tab)).toBeNull();
    state.undo(tab);
    expect(printAreaOf(tab)).toEqual(area(1, 0, 4, 2));
    state.undo(tab);
    expect(printAreaOf(tab)).toBeNull();
    state.redo(tab);
    expect(printAreaOf(tab)).toEqual(area(1, 0, 4, 2));
  });

  it('cuts an area to the sheet, and refuses one wholly outside it', () => {
    const { state, tab } = book();
    expect(setPrintArea(state, tab, area(8, 3, 40, 40))).toBe(true);
    expect(printAreaOf(tab)).toEqual(area(8, 3, 9, 4));
    expect(setPrintArea(state, tab, area(20, 0, 30, 1))).toBe(false);
  });

  it('gives back an area a row delete removed, on undo', () => {
    const { state, tab } = book();
    setPrintArea(state, tab, area(2, 0, 3, 1));
    expect(state.deleteRows(tab, 2, 2)).toBe(true);
    expect(printAreaOf(tab)).toBeNull();
    state.undo(tab);
    expect(printAreaOf(tab)).toEqual(area(2, 0, 3, 1));
  });

  it('moves with moved rows, and undo puts it back', () => {
    const { state, tab } = book();
    setPrintArea(state, tab, area(2, 0, 3, 1));
    expect(state.moveAxis(tab, 'row', 2, 2, 8)).toBe(true);
    expect(printAreaOf(tab)).toEqual(area(6, 0, 7, 1));
    state.undo(tab);
    expect(printAreaOf(tab)).toEqual(area(2, 0, 3, 1));
    state.redo(tab);
    expect(printAreaOf(tab)).toEqual(area(6, 0, 7, 1));
  });

  it('is refused on a protected file and a text sheet', () => {
    const { state, tab } = book();
    tab.readOnly = true;
    expect(setPrintArea(state, tab, area(0, 0, 1, 1))).toBe(false);
    expect(printAreaOf(tab)).toBeNull();
    tab.readOnly = false;
    state.addTextSheet(tab, 'Notes');
    expect(canHoldPrintArea(tab)).toBe(false);
    expect(setPrintArea(state, tab, area(0, 0, 0, 0))).toBe(false);
  });
});

describe('print area on a CSV table', () => {
  it('is kept by the tab, outside the file and its undo history', () => {
    const state = new AppState();
    const doc = csvDoc('a,b\n1,2\n3,4\n');
    const tab = state.addTab('t.csv', doc, null);
    expect(canHoldPrintArea(tab)).toBe(true);
    expect(setPrintArea(state, tab, area(0, 0, 1, 1))).toBe(true);
    expect(printAreaOf(tab)).toEqual(area(0, 0, 1, 1));
    expect(doc.isDirty).toBe(false);
    expect(tab.history.canUndo).toBe(false);
  });

  it('takes the selection, top to bottom, as the area', () => {
    const state = new AppState();
    const tab = state.addTab('t.csv', csvDoc('a,b\n1,2\n3,4\n'), null);
    state.setSelection(tab, { row: 0, col: 0 }, { row: 2, col: 1 });
    expect(selectionPrintArea(state, tab)).toEqual(area(0, 0, 2, 1));
  });
});
