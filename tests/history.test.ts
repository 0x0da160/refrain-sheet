// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { AppState } from '../src/app/app-state';
import { History } from '../src/core/history';
import { doc } from './helpers';

function setup(csv = 'a,b,c\n1,2,3\n') {
  const state = new AppState();
  const tab = state.addTab('test.csv', doc(csv), null);
  return { state, tab };
}

describe('History', () => {
  it('push/undo/redo basics', () => {
    const history = new History();
    expect(history.canUndo).toBe(false);
    history.push({ label: 'x', changes: [{ row: 0, col: 0, before: null, after: 'v' }] });
    expect(history.canUndo).toBe(true);
    expect(history.canRedo).toBe(false);
    expect(history.undo()?.label).toBe('x');
    expect(history.canRedo).toBe(true);
    expect(history.redo()?.label).toBe('x');
  });

  it('a new edit clears the redo stack', () => {
    const history = new History();
    history.push({ label: 'a', changes: [{ row: 0, col: 0, before: null, after: '1' }] });
    history.undo();
    history.push({ label: 'b', changes: [{ row: 0, col: 0, before: null, after: '2' }] });
    expect(history.canRedo).toBe(false);
  });

  it('ignores empty entries', () => {
    const history = new History();
    history.push({ label: 'empty', changes: [] });
    expect(history.canUndo).toBe(false);
  });
});

describe('undo/redo through AppState', () => {
  it('undoing an edit restores the original value and dirty state', () => {
    const { state, tab } = setup();
    state.editCell(tab, 0, 1, 'X');
    expect(tab.doc.getValue(0, 1)).toBe('X');
    expect(tab.doc.isDirty).toBe(true);
    state.undo(tab);
    expect(tab.doc.getValue(0, 1)).toBe('b');
    expect(tab.doc.isDirty).toBe(false);
    state.redo(tab);
    expect(tab.doc.getValue(0, 1)).toBe('X');
  });

  it('one commit of a cell edit is one undo step (typing is grouped per commit)', () => {
    const { state, tab } = setup();
    state.editCell(tab, 0, 0, 'typed value at commit');
    state.editCell(tab, 1, 0, 'second cell');
    state.undo(tab);
    expect(tab.doc.getValue(1, 0)).toBe('1');
    expect(tab.doc.getValue(0, 0)).toBe('typed value at commit');
    state.undo(tab);
    expect(tab.doc.getValue(0, 0)).toBe('a');
  });

  it('revert cell is undoable', () => {
    const { state, tab } = setup();
    state.editCell(tab, 0, 0, 'X');
    state.revertCell(tab, 0, 0);
    expect(tab.doc.getValue(0, 0)).toBe('a');
    state.undo(tab);
    expect(tab.doc.getValue(0, 0)).toBe('X');
  });

  it('revert all is a single atomic undo step', () => {
    const { state, tab } = setup();
    state.editCell(tab, 0, 0, 'X');
    state.editCell(tab, 0, 1, 'Y');
    state.editCell(tab, 1, 2, 'Z');
    state.revertAll(tab);
    expect(tab.doc.isDirty).toBe(false);
    state.undo(tab);
    expect(tab.doc.getValue(0, 0)).toBe('X');
    expect(tab.doc.getValue(0, 1)).toBe('Y');
    expect(tab.doc.getValue(1, 2)).toBe('Z');
    expect(tab.doc.editCount).toBe(3);
  });

  it('bulk edits (Replace All) undo as one operation', () => {
    const { state, tab } = setup('x,x\nx,y\n');
    state.bulkEdit(
      tab,
      [
        { row: 0, col: 0, before: null, after: 'z' },
        { row: 0, col: 1, before: null, after: 'z' },
        { row: 1, col: 0, before: null, after: 'z' },
      ],
      'history.replaceAll',
    );
    expect(tab.doc.editCount).toBe(3);
    state.undo(tab);
    expect(tab.doc.editCount).toBe(0);
    state.redo(tab);
    expect(tab.doc.editCount).toBe(3);
  });

  it('history is cleared when a saved baseline is set', () => {
    const { state, tab } = setup();
    state.editCell(tab, 0, 0, 'X');
    state.setBaseline(tab, doc('new,baseline\n'));
    expect(tab.history.canUndo).toBe(false);
    expect(tab.doc.isDirty).toBe(false);
  });
});
