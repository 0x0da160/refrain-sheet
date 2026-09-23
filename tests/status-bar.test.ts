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
    const statusBar = new StatusBar(
      state,
      () => undefined,
      () => undefined,
    );
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
    const statusBar = new StatusBar(
      state,
      () => undefined,
      () => undefined,
    );
    state.setSelection(tab, { row: 2, col: 1 }, { row: 0, col: 1 });
    statusBar.render();
    const text = statusBar.element.textContent ?? '';
    expect(text).toContain('Sum 6');
  });
});

describe('StatusBar file details (#594)', () => {
  it('marks the file details and keeps the Details toggle state across re-renders', () => {
    const state = new AppState();
    state.addTab('names.csv', doc('alice\nbob\n'), null);
    const statusBar = new StatusBar(
      state,
      () => undefined,
      () => undefined,
    );
    const details = statusBar.element.querySelectorAll('.status-detail');
    // Kind, encoding, delimiter, line endings, size, engine, and version.
    expect(details.length).toBe(7);
    expect(statusBar.element.querySelector('.status-selection')?.classList.contains('status-detail')).toBe(
      false,
    );

    const toggle = statusBar.element.querySelector<HTMLButtonElement>('.status-details-toggle')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    expect(statusBar.element.classList.contains('details-open')).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    statusBar.render();
    const again = statusBar.element.querySelector('.status-details-toggle')!;
    expect(statusBar.element.classList.contains('details-open')).toBe(true);
    expect(again.getAttribute('aria-expanded')).toBe('true');
  });

  it('shows the version on its own, not as a detail, when no document is open', () => {
    const statusBar = new StatusBar(
      new AppState(),
      () => undefined,
      () => undefined,
    );
    expect(statusBar.element.querySelector('.status-version')?.classList.contains('status-detail')).toBe(
      false,
    );
    expect(statusBar.element.querySelector('.status-details-toggle')).toBeNull();
  });
});
