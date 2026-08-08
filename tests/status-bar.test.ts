// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { AppState } from '../src/app/app-state';
import { StatusBar } from '../src/ui/status-bar';
import { doc } from './helpers';

beforeEach(() => {
  document.body.textContent = '';
});

describe('StatusBar selection stats', () => {
  it('hides the Sum stat (as well as Average/Min/Max) when a multi-cell selection has no numeric cells', () => {
    const state = new AppState();
    const tab = state.addTab('names.csv', doc('alice\nbob\ncarol\n'), null);
    const statusBar = new StatusBar(state, () => undefined);
    state.setSelection(tab, { row: 2, col: 0 }, { row: 0, col: 0 });
    statusBar.render();
    const text = statusBar.element.textContent ?? '';
    expect(text).toContain('Numeric 0');
    expect(text).not.toContain('Sum');
    expect(text).not.toContain('Avg');
    expect(text).not.toContain('Min');
    expect(text).not.toContain('Max');
  });

  it('shows the Sum stat when the selection has at least one numeric cell', () => {
    const state = new AppState();
    const tab = state.addTab('mixed.csv', doc('alice,1\nbob,2\ncarol,3\n'), null);
    const statusBar = new StatusBar(state, () => undefined);
    state.setSelection(tab, { row: 2, col: 1 }, { row: 0, col: 1 });
    statusBar.render();
    const text = statusBar.element.textContent ?? '';
    expect(text).toContain('Sum 6');
  });
});
