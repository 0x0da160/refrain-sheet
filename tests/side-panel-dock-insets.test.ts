// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * The docked side panel's top/bottom inset and space reservation (#399): a
 * top-docked panel sits below the menu bar and a bottom-docked one above the
 * status bar — both always-visible chrome — instead of covering them, and
 * the split-view space it reserves is scoped so the menu bar/status bar
 * never move. Left/right docking is unaffected (unchanged since #396).
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

function stubHeight(el: HTMLElement, height: number): void {
  el.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      right: 0,
      bottom: height,
      width: 0,
      height,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
}

/** Mounts the same `#app > (menu bar, #app-body, status bar)` shape main.ts builds. */
function mountAppShell(): {
  app: HTMLElement;
  appBody: HTMLElement;
  menuBar: HTMLElement;
  statusBar: HTMLElement;
} {
  const app = document.createElement('div');
  app.id = 'app';
  const menuBar = document.createElement('div');
  menuBar.className = 'menu-bar';
  stubHeight(menuBar, 40);
  const appBody = document.createElement('div');
  appBody.id = 'app-body';
  appBody.className = 'app-body';
  const statusBar = document.createElement('div');
  statusBar.className = 'status-bar';
  stubHeight(statusBar, 24);
  app.append(menuBar, appBody, statusBar);
  document.body.append(app);
  return { app, appBody, menuBar, statusBar };
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

  it('insets a top-docked panel below the menu bar, reserving space on #app-body only', async () => {
    const { app, appBody } = mountAppShell();
    const promise = new Dialogs().chooseFilter(filterInput());
    const panel = document.querySelector<HTMLElement>('.side-panel')!;
    dockAt(panel, 'top');

    expect(panel.style.top).toBe('40px');
    expect(panel.style.left).toBe('0px');
    expect(panel.style.right).toBe('0px');
    expect(appBody.style.paddingTop).not.toBe('');
    expect(app.style.paddingTop).toBe('');

    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await promise;
    // Closing releases the reservation.
    expect(appBody.style.paddingTop).toBe('');
  });

  it('insets a bottom-docked panel above the status bar, reserving space on #app-body only', async () => {
    const { app, appBody } = mountAppShell();
    const promise = new Dialogs().chooseFilter(filterInput());
    const panel = document.querySelector<HTMLElement>('.side-panel')!;
    dockAt(panel, 'bottom');

    expect(panel.style.bottom).toBe('24px');
    expect(appBody.style.paddingBottom).not.toBe('');
    expect(app.style.paddingBottom).toBe('');

    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await promise;
  });

  it('left/right docking is unaffected: full height, reservation stays on #app', async () => {
    const { app, appBody } = mountAppShell();
    const promise = new Dialogs().chooseFilter(filterInput());
    const panel = document.querySelector<HTMLElement>('.side-panel')!;
    dockAt(panel, 'right');

    expect(panel.style.top).toBe('0px');
    expect(panel.style.bottom).toBe('0px');
    expect(app.style.paddingRight).not.toBe('');
    expect(appBody.style.paddingTop).toBe('');
    expect(appBody.style.paddingBottom).toBe('');

    dockAt(panel, 'left');
    expect(app.style.paddingLeft).not.toBe('');
    expect(app.style.paddingRight).toBe('');

    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await promise;
  });

  it('falls back to no inset when the menu bar/status bar are not mounted (e.g. a unit test)', async () => {
    // No mountAppShell() here — mirrors dialog-drag-resize.test.ts's plain jsdom body.
    const promise = new Dialogs().chooseFilter(filterInput());
    const panel = document.querySelector<HTMLElement>('.side-panel')!;
    dockAt(panel, 'top');
    expect(panel.style.top).toBe('0px');

    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await promise;
  });
});
