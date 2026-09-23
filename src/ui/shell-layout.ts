// SPDX-License-Identifier: MIT

/**
 * The narrowest the document tab strip may get when it shares the menu
 * bar's row; any less and the tabs keep their own row instead.
 */
export const MIN_SHARED_TAB_STRIP_PX = 240;

/** Set on `#app` while the document tabs sit in the menu bar's row. */
export const TABS_IN_MENU_ROW_CLASS = 'tabs-in-menu-row';

/**
 * Decides whether the document tab strip fits beside the menu names in the
 * menu bar's row (#596) and sets `TABS_IN_MENU_ROW_CLASS` on `#app` to match;
 * the CSS in tabs.css does the rest (desktop widths only — phones keep their
 * own layout). It fits when the app's content width, which a left/right
 * docked side panel narrows through `#app`'s padding, leaves at least
 * `MIN_SHARED_TAB_STRIP_PX` after the menu bar's own natural width — so a
 * narrowed window puts the tabs back on their own row instead of wrapping
 * the menu names or squeezing the tabs away.
 *
 * Synchronous, so a caller that changes `#app`'s padding (docking a side
 * panel) can re-run it and then measure the resulting layout at once. A
 * no-op outside a full app shell.
 */
export function updateShellLayout(): void {
  const app = document.getElementById('app');
  const menuBar = app?.querySelector<HTMLElement>(':scope > .menu-bar');
  const menuRow = menuBar?.querySelector<HTMLElement>('.menu-row');
  if (!app || !menuBar || !menuRow) {
    return;
  }
  const style = getComputedStyle(app);
  const px = (value: string): number => Number.parseFloat(value) || 0;
  const available = app.clientWidth - px(style.paddingLeft) - px(style.paddingRight);
  // The menu row never wraps on a desktop, so its right edge (plus the
  // bar's own end padding) is the bar's natural width in either layout.
  const menuRight = menuRow.getBoundingClientRect().right - menuBar.getBoundingClientRect().left;
  const natural = menuRight + px(getComputedStyle(menuBar).paddingRight);
  app.classList.toggle(TABS_IN_MENU_ROW_CLASS, available - natural >= MIN_SHARED_TAB_STRIP_PX);
}

/**
 * Keeps `updateShellLayout` current as the window resizes and as the menu
 * names change width (a language switch). Side-panel docking calls
 * `updateShellLayout` itself, synchronously.
 */
export function installShellLayout(): void {
  updateShellLayout();
  const app = document.getElementById('app');
  const menuRow = app?.querySelector<HTMLElement>(':scope > .menu-bar .menu-row');
  if (!app || !menuRow || typeof ResizeObserver === 'undefined') {
    return;
  }
  const observer = new ResizeObserver(() => updateShellLayout());
  observer.observe(app);
  observer.observe(menuRow);
}
