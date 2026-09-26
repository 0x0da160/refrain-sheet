// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { AppState, type Tab } from '../src/app/app-state';
import { RsfDocument } from '../src/core/rsf-document';
import { doc, utf8 } from './helpers';

describe('tabs', () => {
  it('newly opened files become the active tab', () => {
    const state = new AppState();
    const first = state.addTab('one.csv', doc('a\n'), null);
    expect(state.activeTabId).toBe(first.id);
    const second = state.addTab('two.csv', doc('b\n'), null);
    expect(state.activeTabId).toBe(second.id);
    expect(state.tabs.length).toBe(2);
  });

  it('activating and cycling tabs', () => {
    const state = new AppState();
    const a = state.addTab('a.csv', doc('a\n'), null);
    const b = state.addTab('b.csv', doc('b\n'), null);
    state.activateTab(a.id);
    expect(state.activeTab?.name).toBe('a.csv');
    state.cycleTab(1);
    expect(state.activeTab?.id).toBe(b.id);
    state.cycleTab(1);
    expect(state.activeTab?.id).toBe(a.id);
    state.cycleTab(-1);
    expect(state.activeTab?.id).toBe(b.id);
  });

  it('closing the active tab activates a neighbour', () => {
    const state = new AppState();
    const a = state.addTab('a.csv', doc('a\n'), null);
    const b = state.addTab('b.csv', doc('b\n'), null);
    const c = state.addTab('c.csv', doc('c\n'), null);
    state.activateTab(b.id);
    state.closeTab(b.id);
    expect(state.tabs.map((t) => t.id)).toEqual([a.id, c.id]);
    expect(state.activeTabId).toBe(c.id);
    state.closeTab(c.id);
    expect(state.activeTabId).toBe(a.id);
    state.closeTab(a.id);
    expect(state.activeTabId).toBeNull();
  });

  it('finds an already-open file by name and identical bytes', () => {
    const state = new AppState();
    const tab = state.addTab('same.csv', doc('a,b\n'), null);
    expect(state.findTabForFile('same.csv', utf8('a,b\n'))).toBe(tab);
    expect(state.findTabForFile('same.csv', utf8('a,c\n'))).toBeNull();
    expect(state.findTabForFile('other.csv', utf8('a,b\n'))).toBeNull();
  });

  it('emits events for state changes', () => {
    const state = new AppState();
    const events: string[] = [];
    state.subscribe((e) => events.push(e));
    const tab = state.addTab('a.csv', doc('a,b\n'), null);
    state.editCell(tab, 0, 0, 'x');
    state.setSelection(tab, { row: 0, col: 1 });
    expect(events).toEqual(['tabs', 'doc', 'selection']);
  });
});

describe('dirty state', () => {
  it('tracks edits and reverts', () => {
    const state = new AppState();
    const tab = state.addTab('a.csv', doc('a,b\n'), null);
    expect(tab.doc.isDirty).toBe(false);
    state.editCell(tab, 0, 0, 'x');
    expect(tab.doc.isDirty).toBe(true);
    state.editCell(tab, 0, 0, 'a'); // typing the original value back
    expect(tab.doc.isDirty).toBe(false);
  });
});

describe('CSV structural edits require "never saved" (#479)', () => {
  it('insertRows/deleteRows/insertCols/deleteCols refuse a CSV tab that is not marked never-saved', () => {
    const state = new AppState();
    const tab = state.addTab('a.csv', doc('a,b\nc,d\n'), null);
    expect(tab.neverSaved).toBe(false);
    expect(state.insertRows(tab, 0, 1)).toBe(false);
    expect(state.deleteRows(tab, 0, 1)).toBe(false);
    expect(state.insertCols(tab, 0, 1)).toBe(false);
    expect(state.deleteCols(tab, 0, 1)).toBe(false);
    expect(tab.doc.kind).toBe('csv');
    expect(tab.doc.rowCount).toBe(2);
    expect(tab.doc.columnCount).toBe(2);
  });

  it('insertRows/deleteRows/insertCols/deleteCols work directly on a never-saved CSV tab', () => {
    const state = new AppState();
    const tab = state.addTab('a.csv', doc('a,b\nc,d\n'), null);
    tab.neverSaved = true;
    expect(state.insertRows(tab, 0, 1)).toBe(true);
    expect(tab.doc.kind).toBe('csv');
    expect(tab.doc.rowCount).toBe(3);
    expect(state.insertCols(tab, 0, 1)).toBe(true);
    expect(tab.doc.columnCount).toBe(3);
    expect(state.deleteCols(tab, 0, 1)).toBe(true);
    expect(tab.doc.columnCount).toBe(2);
    expect(state.deleteRows(tab, 0, 1)).toBe(true);
    expect(tab.doc.rowCount).toBe(2);
    expect(tab.doc.getValue(0, 0)).toBe('a');
  });
});

describe('read-only protection', () => {
  it('defaults to unprotected unless addTab is told otherwise', () => {
    const state = new AppState();
    expect(state.addTab('a.csv', doc('a\n'), null).readOnly).toBe(false);
    expect(state.addTab('b.csv', doc('b\n'), null, true).readOnly).toBe(true);
  });

  it('refuses editCell, bulkEdit, and pushEntry on a protected CSV tab, warning why', () => {
    const state = new AppState();
    const tab = state.addTab('a.csv', doc('a,b\n'), null, true);
    const warnings: Array<{ tab: Tab; scope: 'book' | 'sheet' }> = [];
    state.warnBlocked = (blockedTab, scope) => warnings.push({ tab: blockedTab, scope });

    expect(state.editCell(tab, 0, 0, 'x')).toBe(false);
    expect(tab.doc.isDirty).toBe(false);
    expect(state.bulkEdit(tab, [{ row: 0, col: 0, before: null, after: 'x' }], 'history.editCell')).toBe(
      false,
    );
    expect(tab.doc.isDirty).toBe(false);
    expect(warnings).toEqual([
      { tab, scope: 'book' },
      { tab, scope: 'book' },
    ]);
  });

  it('passes a retry that finishes the refused edit once the tab is unprotected', () => {
    const state = new AppState();
    const tab = state.addTab('a.rsf', RsfDocument.blank('a.rsf', 5, 3, 'Sheet1'), null, true);
    const retries: Array<() => void> = [];
    state.warnBlocked = (_tab, _scope, retry) => retries.push(retry);

    expect(state.editCell(tab, 0, 0, 'x')).toBe(false);
    expect(state.insertRows(tab, 0, 1)).toBe(false);
    expect(retries).toHaveLength(2);
    state.setReadOnly(tab, false);
    retries.forEach((retry) => retry());
    expect(tab.doc.rowCount).toBe(6);
    expect(tab.doc.getValue(1, 0)).toBe('x');
  });

  it('refuses structural and worksheet-lifecycle operations on a protected RSF tab', () => {
    const state = new AppState();
    const tab = state.addTab('a.rsf', RsfDocument.blank('a.rsf', 5, 3, 'Sheet1'), null, true);
    expect(state.insertRows(tab, 0, 1)).toBe(false);
    expect(state.addSheet(tab, 'Sheet2')).toBeNull();
    expect(tab.doc.rowCount).toBe(5);
  });

  it('toggling read-only off allows edits again, and back on refuses them again', () => {
    const state = new AppState();
    const tab = state.addTab('a.csv', doc('a,b\n'), null, true);
    expect(state.editCell(tab, 0, 0, 'x')).toBe(false);
    state.setReadOnly(tab, false);
    expect(tab.readOnly).toBe(false);
    expect(state.editCell(tab, 0, 0, 'x')).toBe(true);
    expect(tab.doc.isDirty).toBe(true);
    state.setReadOnly(tab, true);
    expect(state.editCell(tab, 0, 1, 'y')).toBe(false);
  });

  it('emits a tabs event when toggled, but not when set to its current value', () => {
    const state = new AppState();
    const tab = state.addTab('a.csv', doc('a\n'), null, true);
    const events: string[] = [];
    state.subscribe((e) => events.push(e));
    state.setReadOnly(tab, true); // no-op: already protected
    expect(events).toEqual([]);
    state.setReadOnly(tab, false);
    expect(events).toEqual(['tabs']);
  });
});

describe('worksheet lock', () => {
  it('defaults to unlocked', () => {
    const workbook = RsfDocument.blank('a.rsf', 5, 3, 'Sheet1');
    expect(workbook.activeSheet.locked).toBe(false);
  });

  it('refuses editCell, bulkEdit, and pushEntry on a locked worksheet, warning why', () => {
    const state = new AppState();
    const workbook = RsfDocument.blank('a.rsf', 5, 3, 'Sheet1');
    const tab = state.addTab('a.rsf', workbook, null);
    expect(state.setSheetLocked(tab, workbook.activeSheetId, true)).toBe(true);
    const warnings: Array<{ tab: Tab; scope: 'book' | 'sheet' }> = [];
    state.warnBlocked = (blockedTab, scope) => warnings.push({ tab: blockedTab, scope });

    expect(state.editCell(tab, 0, 0, 'x')).toBe(false);
    expect(state.bulkEdit(tab, [{ row: 0, col: 0, before: null, after: 'x' }], 'history.editCell')).toBe(
      false,
    );
    expect(state.insertRows(tab, 0, 1)).toBe(false);
    expect(workbook.rowCount).toBe(5);
    expect(warnings).toEqual([
      { tab, scope: 'sheet' },
      { tab, scope: 'sheet' },
      { tab, scope: 'sheet' },
    ]);
  });

  it('names the locked worksheet and retries the edit after it is unlocked', () => {
    const state = new AppState();
    const workbook = RsfDocument.blank('a.rsf', 5, 3, 'Sheet1');
    const tab = state.addTab('a.rsf', workbook, null);
    state.setSheetLocked(tab, workbook.activeSheetId, true);
    const calls: Array<{ retry: () => void; sheetId?: string }> = [];
    state.warnBlocked = (_tab, _scope, retry, sheetId) => calls.push({ retry, sheetId });

    expect(state.editCell(tab, 0, 0, 'x')).toBe(false);
    expect(calls[0]?.sheetId).toBe(workbook.activeSheetId);
    state.setSheetLocked(tab, workbook.activeSheetId, false);
    calls[0]?.retry();
    expect(workbook.getValue(0, 0)).toBe('x');
  });

  it('locking one worksheet leaves every other worksheet in the workbook editable', () => {
    const state = new AppState();
    const workbook = RsfDocument.blank('a.rsf', 5, 3, 'Sheet1');
    const other = workbook.createWorksheet('Sheet2', 5, 3);
    workbook.insertSheetAt(1, other);
    const tab = state.addTab('a.rsf', workbook, null);
    state.setSheetLocked(tab, workbook.activeSheetId, true);

    state.setActiveSheet(tab, other.id);
    expect(state.editCell(tab, 0, 0, 'x')).toBe(true);
    expect(workbook.sheetById(other.id)!.getValue(0, 0)).toBe('x');
  });

  it('toggling the lock off allows edits again, and back on refuses them again', () => {
    const state = new AppState();
    const workbook = RsfDocument.blank('a.rsf', 5, 3, 'Sheet1');
    const tab = state.addTab('a.rsf', workbook, null);
    const sheetId = workbook.activeSheetId;
    state.setSheetLocked(tab, sheetId, true);
    expect(state.editCell(tab, 0, 0, 'x')).toBe(false);

    state.setSheetLocked(tab, sheetId, false);
    expect(state.editCell(tab, 0, 0, 'x')).toBe(true);
    expect(workbook.isDirty).toBe(true);

    state.setSheetLocked(tab, sheetId, true);
    expect(state.editCell(tab, 0, 1, 'y')).toBe(false);
  });

  it('marks the workbook dirty and emits a sheets event, but not when set to its current value', () => {
    const state = new AppState();
    const workbook = RsfDocument.blank('a.rsf', 5, 3, 'Sheet1');
    workbook.markSaved();
    const tab = state.addTab('a.rsf', workbook, null);
    const sheetId = workbook.activeSheetId;
    const events: string[] = [];
    state.subscribe((e) => events.push(e));

    expect(state.setSheetLocked(tab, sheetId, false)).toBe(false); // no-op: already unlocked
    expect(events).toEqual([]);
    expect(workbook.isDirty).toBe(false);

    expect(state.setSheetLocked(tab, sheetId, true)).toBe(true);
    expect(events).toEqual(['sheets']);
    expect(workbook.isDirty).toBe(true);
  });

  it('is not itself undoable, unlike an ordinary cell edit', () => {
    const state = new AppState();
    const workbook = RsfDocument.blank('a.rsf', 5, 3, 'Sheet1');
    const tab = state.addTab('a.rsf', workbook, null);
    state.setSheetLocked(tab, workbook.activeSheetId, true);
    expect(state.undo(tab)).toBeNull();
  });

  it('round-trips through save and load', () => {
    const workbook = RsfDocument.empty('a.rsf', 5, 3, 'Sheet1');
    const second = workbook.createWorksheet('Sheet2', 2, 2);
    workbook.insertSheetAt(1, second);
    workbook.setLockedOn(second.id, true);
    const reloaded = RsfDocument.fromBytes(workbook.toBytes(), 'a.rsf');
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) return;
    expect(reloaded.doc.sheets[0].locked).toBe(false);
    expect(reloaded.doc.sheets[1].locked).toBe(true);
  });
});
