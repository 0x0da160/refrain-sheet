// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * A smartphone held in portrait defaults new dockable side panels
 * (`openSidePanel`, shared by the Filter/Sort/Format/SQL Query/Compare-Diff
 * dialogs and the comments panel) to the bottom edge instead of the
 * desktop-oriented right edge — there is little usable width for a
 * left/right split on a narrow, tall viewport (#459). This is only the
 * *default*: once the user explicitly picks a side via the header switcher,
 * that choice is remembered for the rest of the session exactly as before,
 * regardless of viewport.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FilterDialogInput } from '../src/app/commands';
import { getLocale, setLocale, t } from '../src/app/i18n';
import { Dialogs } from '../src/ui/dialogs';

function filterInput(): FilterDialogInput {
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
  };
}

function stubMatchMedia(matchesMobilePortrait: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query === '(max-width: 700px) and (orientation: portrait)' && matchesMobilePortrait,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => true,
    })),
  );
}

describe('side panel default dock on a smartphone in portrait (#459)', () => {
  const locale = getLocale();

  beforeEach(() => {
    document.body.textContent = '';
    setLocale('en');
  });

  afterEach(() => {
    setLocale(locale);
    document.querySelectorAll('.side-panel').forEach((n) => n.remove());
    vi.unstubAllGlobals();
  });

  it('docks to the bottom by default on a narrow, portrait viewport', async () => {
    stubMatchMedia(true);
    const dialogs = new Dialogs();
    const promise = dialogs.chooseFilter(filterInput());
    const panel = document.querySelector<HTMLElement>('.side-panel')!;
    expect(panel.dataset.sidePanelPosition).toBe('bottom');
    expect(
      panel.querySelector(`[title="${t('dialog.sidePanel.position.bottom')}"]`)!.getAttribute('aria-pressed'),
    ).toBe('true');

    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await promise;
  });

  it('keeps the right-docked default outside of the mobile-portrait case', async () => {
    stubMatchMedia(false);
    const dialogs = new Dialogs();
    const promise = dialogs.chooseFilter(filterInput());
    const panel = document.querySelector<HTMLElement>('.side-panel')!;
    expect(panel.dataset.sidePanelPosition).toBe('right');

    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await promise;
  });

  it('an explicit user choice overrides the viewport-based default for the rest of the session', async () => {
    stubMatchMedia(true);
    const dialogs = new Dialogs();
    const firstPromise = dialogs.chooseFilter(filterInput());
    const firstPanel = document.querySelector<HTMLElement>('.side-panel')!;
    firstPanel.querySelector<HTMLButtonElement>(`[title="${t('dialog.sidePanel.position.left')}"]`)!.click();
    expect(firstPanel.dataset.sidePanelPosition).toBe('left');
    firstPanel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await firstPromise;

    // Still portrait/mobile, but the explicit "left" choice now wins over
    // what would otherwise default to "bottom".
    const secondPromise = dialogs.chooseFilter(filterInput());
    const secondPanel = document.querySelector<HTMLElement>('.side-panel')!;
    expect(secondPanel.dataset.sidePanelPosition).toBe('left');
    secondPanel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await secondPromise;
  });
});
