// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * Several open side panels share the dock as an accordion (#598): the most
 * recently opened one is expanded, the others collapse to their title bar
 * (stacked above or below it instead of lying on top of each other), a
 * collapsed title bar expands its panel, and the dock's space stays
 * reserved until the last panel closes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FilterDialogInput } from '../src/app/commands';
import { getLocale, setLocale, t } from '../src/app/i18n';
import { Dialogs } from '../src/ui/dialogs';

function filterInput(): FilterDialogInput {
  return {
    col: 0,
    colLetter: 'A',
    header: 'name',
    rangeLabel: 'A1:A3',
    headerRow: true,
    hasActiveFilter: false,
    existing: null,
    otherColumns: 0,
    values: ['x', 'y'],
    valuesTruncated: false,
  };
}

function mountApp(): HTMLElement {
  const app = document.createElement('div');
  app.id = 'app';
  const content = document.createElement('div');
  content.id = 'app-content';
  app.append(content);
  document.body.append(app);
  return app;
}

function panels(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.side-panel'));
}

function escape(panel: HTMLElement): void {
  panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}

describe('side panel accordion', () => {
  const locale = getLocale();

  beforeEach(() => {
    document.body.textContent = '';
    setLocale('en');
    vi.stubGlobal('innerWidth', 1000);
    vi.stubGlobal('innerHeight', 800);
  });

  afterEach(() => {
    setLocale(locale);
    document.body.textContent = '';
  });

  it('collapses the earlier panel to its title bar and stacks the panels in the dock', async () => {
    const app = mountApp();
    const dialogs = new Dialogs();
    const first = dialogs.chooseFilter(filterInput());
    const second = dialogs.chooseFilter(filterInput());
    const [a, b] = panels();

    expect(a.classList.contains('collapsed')).toBe(true);
    expect(b.classList.contains('collapsed')).toBe(false);
    // Right dock: stacked top to bottom in the order opened, never overlapping.
    expect(a.style.top).toBe('0px');
    const aHeight = Number.parseFloat(a.style.height);
    expect(aHeight).toBeGreaterThan(0);
    expect(b.style.top).toBe(`${aHeight}px`);
    expect(Number.parseFloat(b.style.height)).toBe(800 - aHeight);
    expect(a.querySelector('.side-panel-title')!.getAttribute('aria-expanded')).toBe('false');
    expect(app.style.paddingRight).toBe('380px');

    // A collapsed title bar expands its panel and collapses the other.
    a.querySelector<HTMLElement>('.side-panel-title')!.click();
    expect(a.classList.contains('collapsed')).toBe(false);
    expect(b.classList.contains('collapsed')).toBe(true);

    escape(b);
    await second;
    // The remaining panel is a lone, uncollapsed panel again; space stays reserved.
    expect(a.classList.contains('collapsed')).toBe(false);
    expect(a.style.top).toBe('0px');
    expect(a.style.bottom).toBe('0px');
    expect(a.querySelector('.side-panel-title')!.hasAttribute('aria-expanded')).toBe(false);
    expect(app.style.paddingRight).toBe('380px');

    escape(a);
    await first;
    expect(app.style.paddingRight).toBe('');
  });

  it('moves every open panel when one of them switches the dock side', async () => {
    mountApp();
    const dialogs = new Dialogs();
    const first = dialogs.chooseFilter(filterInput());
    const second = dialogs.chooseFilter(filterInput());
    const [a, b] = panels();

    b.querySelector<HTMLButtonElement>(`[title="${t('dialog.sidePanel.position.left')}"]`)!.click();
    expect(a.dataset.sidePanelPosition).toBe('left');
    expect(b.dataset.sidePanelPosition).toBe('left');
    // The collapsed panel's header shows the new side as well.
    const aLeft = a.querySelector(`[title="${t('dialog.sidePanel.position.left')}"]`)!;
    expect(aLeft.getAttribute('aria-pressed')).toBe('true');

    // Put the dock back on the right for the other tests (it is remembered).
    b.querySelector<HTMLButtonElement>(`[title="${t('dialog.sidePanel.position.right')}"]`)!.click();
    escape(b);
    escape(a);
    await Promise.all([first, second]);
  });

  it('expands a collapsed panel from the keyboard', async () => {
    mountApp();
    const dialogs = new Dialogs();
    const first = dialogs.chooseFilter(filterInput());
    const second = dialogs.chooseFilter(filterInput());
    const [a, b] = panels();
    const title = a.querySelector<HTMLElement>('.side-panel-title')!;
    expect(title.tabIndex).toBe(0);
    title.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(a.classList.contains('collapsed')).toBe(false);
    expect(b.classList.contains('collapsed')).toBe(true);
    escape(b);
    escape(a);
    await Promise.all([first, second]);
  });
});
