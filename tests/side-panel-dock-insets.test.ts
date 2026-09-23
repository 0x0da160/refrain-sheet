// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * The docked side panel's top/bottom inset and space reservation (#399,
 * #541): a top-docked panel sits below the menu bar *and* the book tab
 * strip, and a bottom-docked one sits above the status bar *and* the
 * worksheet tab strip — all always-visible chrome — instead of covering any
 * of it, and the split-view space it reserves is scoped to `#app-content` so
 * neither tab strip (nor the menu bar/status bar) ever moves. Left/right
 * docking is unaffected (unchanged since #396).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FilterDialogInput } from '../src/app/commands';
import { getLocale, setLocale, t } from '../src/app/i18n';
import { Dialogs } from '../src/ui/dialogs';

function filterInput(overrides: Partial<FilterDialogInput> = {}): FilterDialogInput {
  return {
    col: 1,
    colLetter: 'B',
    header: 'name',
    rangeLabel: 'A1:B4',
    headerRow: true,
    hasActiveFilter: false,
    existing: null,
    otherColumns: 0,
    values: ['apple', 'banana', 'cherry'],
    valuesTruncated: false,
    ...overrides,
  };
}

function stubHeight(el: HTMLElement, height: number, top = 0): void {
  el.getBoundingClientRect = () =>
    ({
      left: 0,
      top,
      right: 0,
      bottom: top + height,
      width: 0,
      height,
      x: 0,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect;
}

/** Mounts the same `#app > (menu bar, #app-body > (tab bar, #app-content,
 * sheet bar), status bar)` shape main.ts builds. */
function mountAppShell(): {
  app: HTMLElement;
  appBody: HTMLElement;
  appContent: HTMLElement;
  menuBar: HTMLElement;
  statusBar: HTMLElement;
  tabBar: HTMLElement;
  sheetBar: HTMLElement;
} {
  const app = document.createElement('div');
  app.id = 'app';
  const menuBar = document.createElement('div');
  menuBar.className = 'menu-bar';
  stubHeight(menuBar, 40);
  const appBody = document.createElement('div');
  appBody.id = 'app-body';
  appBody.className = 'app-body';
  const tabBar = document.createElement('div');
  tabBar.className = 'tab-bar';
  stubHeight(tabBar, 32, 40);
  const appContent = document.createElement('div');
  appContent.id = 'app-content';
  appContent.className = 'app-content';
  // Stacked: the tab strip below the 40px menu bar, content below both.
  stubHeight(appContent, 600, 72);
  const sheetBar = document.createElement('div');
  sheetBar.className = 'sheet-bar';
  stubHeight(sheetBar, 28);
  const statusBar = document.createElement('div');
  statusBar.className = 'status-bar';
  stubHeight(statusBar, 24);
  appBody.append(tabBar, appContent, sheetBar);
  app.append(menuBar, appBody, statusBar);
  document.body.append(app);
  return { app, appBody, appContent, menuBar, statusBar, tabBar, sheetBar };
}

function dockAt(panel: HTMLElement, position: 'top' | 'right' | 'bottom' | 'left'): void {
  panel.querySelector<HTMLButtonElement>(`[title="${t(`dialog.sidePanel.position.${position}`)}"]`)!.click();
}

describe('side panel dock insets and app-edge reservation', () => {
  const locale = getLocale();

  beforeEach(() => {
    document.body.textContent = '';
    setLocale('en');
    vi.stubGlobal('innerWidth', 1000);
    vi.stubGlobal('innerHeight', 800);
  });

  afterEach(() => {
    setLocale(locale);
    document.body.innerHTML = '';
  });

  it('insets a top-docked panel below the menu bar and the book tab strip, reserving space on #app-content only', async () => {
    const { app, appBody, appContent } = mountAppShell();
    const promise = new Dialogs().chooseFilter(filterInput());
    const panel = document.querySelector<HTMLElement>('.side-panel')!;
    dockAt(panel, 'top');

    expect(panel.style.top).toBe('72px'); // 40px menu bar + 32px tab bar
    expect(panel.style.left).toBe('0px');
    expect(panel.style.right).toBe('0px');
    expect(appContent.style.paddingTop).not.toBe('');
    expect(appBody.style.paddingTop).toBe('');
    expect(app.style.paddingTop).toBe('');

    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await promise;
    // Closing releases the reservation.
    expect(appContent.style.paddingTop).toBe('');
  });

  it('insets a top-docked panel below the shared menu/tab row when the tabs sit beside the menus (#596)', async () => {
    const { appContent } = mountAppShell();
    // Wide window: tabs share the 40px menu row, so content starts at 40px.
    stubHeight(appContent, 632, 40);
    const promise = new Dialogs().chooseFilter(filterInput());
    const panel = document.querySelector<HTMLElement>('.side-panel')!;
    dockAt(panel, 'top');

    expect(panel.style.top).toBe('40px');

    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await promise;
  });

  it('insets a bottom-docked panel above the status bar and the worksheet tab strip, reserving space on #app-content only', async () => {
    const { app, appContent } = mountAppShell();
    const promise = new Dialogs().chooseFilter(filterInput());
    const panel = document.querySelector<HTMLElement>('.side-panel')!;
    dockAt(panel, 'bottom');

    expect(panel.style.bottom).toBe('52px'); // 24px status bar + 28px sheet bar
    expect(appContent.style.paddingBottom).not.toBe('');
    expect(app.style.paddingBottom).toBe('');

    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await promise;
  });

  it('a hidden worksheet tab strip (e.g. a plain CSV document) contributes no bottom inset', async () => {
    const { sheetBar } = mountAppShell();
    sheetBar.hidden = true;
    const promise = new Dialogs().chooseFilter(filterInput());
    const panel = document.querySelector<HTMLElement>('.side-panel')!;
    dockAt(panel, 'bottom');

    expect(panel.style.bottom).toBe('24px'); // status bar only

    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await promise;
  });

  it('left/right docking is unaffected: full height, reservation stays on #app', async () => {
    const { app, appBody, appContent } = mountAppShell();
    const promise = new Dialogs().chooseFilter(filterInput());
    const panel = document.querySelector<HTMLElement>('.side-panel')!;
    dockAt(panel, 'right');

    expect(panel.style.top).toBe('0px');
    expect(panel.style.bottom).toBe('0px');
    expect(app.style.paddingRight).not.toBe('');
    expect(appBody.style.paddingTop).toBe('');
    expect(appContent.style.paddingTop).toBe('');
    expect(appContent.style.paddingBottom).toBe('');

    dockAt(panel, 'left');
    expect(app.style.paddingLeft).not.toBe('');
    expect(app.style.paddingRight).toBe('');

    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await promise;
  });

  it('falls back to no inset when no chrome is mounted (e.g. a unit test)', async () => {
    // No mountAppShell() here — mirrors dialog-drag-resize.test.ts's plain jsdom body.
    const promise = new Dialogs().chooseFilter(filterInput());
    const panel = document.querySelector<HTMLElement>('.side-panel')!;
    dockAt(panel, 'top');
    expect(panel.style.top).toBe('0px');

    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await promise;
  });
});
