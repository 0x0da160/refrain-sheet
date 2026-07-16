// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { AppState } from '../src/app/app-state';
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
