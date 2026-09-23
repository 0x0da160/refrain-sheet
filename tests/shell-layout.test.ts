// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * The document tabs share the menu bar's row only while they fit beside the
 * menu names (#596): `updateShellLayout` compares `#app`'s content width —
 * which a left/right-docked side panel narrows through padding — with the
 * menu bar's natural width.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { MIN_SHARED_TAB_STRIP_PX, TABS_IN_MENU_ROW_CLASS, updateShellLayout } from '../src/ui/shell-layout';

function rect(left: number, right: number): DOMRect {
  return {
    left,
    right,
    top: 0,
    bottom: 32,
    width: right - left,
    height: 32,
    x: left,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect;
}

/** `#app > .menu-bar > .menu-row`, with the menu names ending at 540px. */
function mountShell(appWidth: number): HTMLElement {
  const app = document.createElement('div');
  app.id = 'app';
  Object.defineProperty(app, 'clientWidth', { configurable: true, get: () => appWidth });
  const menuBar = document.createElement('div');
  menuBar.className = 'menu-bar';
  menuBar.style.paddingRight = '4px';
  menuBar.getBoundingClientRect = () => rect(0, appWidth);
  const menuRow = document.createElement('div');
  menuRow.className = 'menu-row';
  menuRow.getBoundingClientRect = () => rect(100, 540);
  menuBar.append(menuRow);
  app.append(menuBar);
  document.body.append(app);
  return app;
}

beforeEach(() => {
  document.body.textContent = '';
});

describe('updateShellLayout', () => {
  it('puts the tabs in the menu row when enough width is left beside the menu names', () => {
    const app = mountShell(1280);
    updateShellLayout();
    expect(app.classList.contains(TABS_IN_MENU_ROW_CLASS)).toBe(true);
  });

  it('keeps the tabs on their own row when a docked side panel narrows the app', () => {
    const app = mountShell(1280);
    updateShellLayout();
    // 1280 - 700 of reserved panel space leaves 580px: 544px of menu bar
    // plus 36px, under the minimum tab strip width.
    app.style.paddingRight = '700px';
    updateShellLayout();
    expect(app.classList.contains(TABS_IN_MENU_ROW_CLASS)).toBe(false);

    app.style.paddingRight = '';
    updateShellLayout();
    expect(app.classList.contains(TABS_IN_MENU_ROW_CLASS)).toBe(true);
  });

  it('switches exactly at the minimum tab strip width', () => {
    // Natural menu bar width: 540px row edge + 4px end padding.
    const fits = mountShell(544 + MIN_SHARED_TAB_STRIP_PX);
    updateShellLayout();
    expect(fits.classList.contains(TABS_IN_MENU_ROW_CLASS)).toBe(true);

    document.body.textContent = '';
    const tooNarrow = mountShell(544 + MIN_SHARED_TAB_STRIP_PX - 1);
    updateShellLayout();
    expect(tooNarrow.classList.contains(TABS_IN_MENU_ROW_CLASS)).toBe(false);
  });

  it('does nothing without an app shell', () => {
    expect(() => updateShellLayout()).not.toThrow();
  });
});
