// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { AppState } from '../src/app/app-state';
import { t } from '../src/app/i18n';
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

describe('read-only protection', () => {
  it('defaults to unprotected unless addTab is told otherwise', () => {
    const state = new AppState();
    expect(state.addTab('a.csv', doc('a\n'), null).readOnly).toBe(false);
    expect(state.addTab('b.csv', doc('b\n'), null, true).readOnly).toBe(true);
  });

  it('refuses editCell, bulkEdit, and pushEntry on a protected CSV tab, announcing why', () => {
    const state = new AppState();
    const tab = state.addTab('a.csv', doc('a,b\n'), null, true);
    const announced: string[] = [];
    state.announce = (message) => announced.push(message);

    expect(state.editCell(tab, 0, 0, 'x')).toBe(false);
    expect(tab.doc.isDirty).toBe(false);
    expect(state.bulkEdit(tab, [{ row: 0, col: 0, before: null, after: 'x' }], 'history.editCell')).toBe(
      false,
    );
    expect(tab.doc.isDirty).toBe(false);
    expect(announced).toEqual([t('notify.readOnlyProtected'), t('notify.readOnlyProtected')]);
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
