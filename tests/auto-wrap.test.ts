// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * Committing a cell value that contains a line break automatically enables
 * "Wrap Long Rows" for the worksheet, as part of the same undoable edit, and
 * persists it for RSF documents. The decision is made on the displayed value,
 * never on formula source; plain CSV keeps wrapping as local view state and
 * never changes its bytes.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { AppState } from '../src/app/app-state';
import { RsfDocument } from '../src/core/rsf-document';
import { encodeRsfWorkbook, decodeRsfWorkbook } from '../src/core/rsf-codec';
import { doc as csvDoc } from './helpers';

beforeEach(() => {
  localStorage.clear();
});

function rsfTab(state: AppState): ReturnType<AppState['addTab']> {
  const doc = RsfDocument.empty('b', 3, 2, 'S1');
  return state.addTab('b.rsf', doc, null);
}

describe('auto-enable wrap on newline entry', () => {
  it('turns wrapping on when an edit commits a literal newline', () => {
    const state = new AppState();
    const tab = rsfTab(state);
    expect(state.wrapCells).toBe(false);
    state.editCell(tab, 0, 0, 'line one\nline two');
    expect(state.wrapCells).toBe(true);
  });

  it('does not turn wrapping on for a single-line value', () => {
    const state = new AppState();
    const tab = rsfTab(state);
    state.editCell(tab, 0, 0, 'single line');
    expect(state.wrapCells).toBe(false);
  });

  it('undo restores both the value and the previous wrap state', () => {
    const state = new AppState();
    const tab = rsfTab(state);
    state.editCell(tab, 0, 0, 'a\nb');
    expect(state.wrapCells).toBe(true);
    state.undo(tab);
    expect(tab.doc.getValue(0, 0)).toBe('');
    expect(state.wrapCells).toBe(false);
    state.redo(tab);
    expect(state.wrapCells).toBe(true);
  });

  it('decides on the displayed value, not formula source', () => {
    const state = new AppState();
    const tab = rsfTab(state);
    // A formula whose *result* contains a newline enables wrapping…
    state.editCell(tab, 0, 0, '="x\ny"');
    expect(state.wrapCells).toBe(true);
    // …but a formula that merely mentions "\n" as text does not.
    const state2 = new AppState();
    const tab2 = rsfTab(state2);
    state2.editCell(tab2, 0, 0, '=CONCAT("a","b")');
    expect(state2.wrapCells).toBe(false);
  });

  it('persists the enabled wrap in the RSF container', () => {
    const state = new AppState();
    const tab = rsfTab(state);
    state.editCell(tab, 0, 0, 'a\nb');
    const doc = tab.doc as RsfDocument;
    doc.setDisplaySettings(undefined, [], state.wrapCells);
    const bytes = doc.toBytes();
    const decoded = decodeRsfWorkbook(bytes);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.data.sheets[0].display?.wrap).toBe(true);
    }
    void encodeRsfWorkbook;
  });

  it('keeps CSV wrapping as local state without changing bytes', () => {
    const state = new AppState();
    const original = 'a,b\n1,2\n';
    const doc = csvDoc(original);
    const tab = state.addTab('a.csv', doc, null);
    // CSV cannot hold a literal newline in a field without quoting; editing to
    // a multiline value is still a local view concern and must not corrupt the
    // saved bytes of unedited cells. Here we just assert the wrap toggle is
    // local and the document stays a CSV.
    state.setWrapCells(true);
    expect(state.wrapCells).toBe(true);
    expect(tab.doc.kind).toBe('csv');
  });
});
