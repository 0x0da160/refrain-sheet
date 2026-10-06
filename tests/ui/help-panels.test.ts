// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * Help, Keyboard Shortcuts, Formula Help, File Version History and Compare /
 * Diff open as side panels beside the sheet (design system D-46): each only
 * once at a time, Version History answering through its Save Settings and
 * Restore buttons, and Compare staying open to run again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiffDialogInput } from '../../src/app/commands';
import { getLocale, setLocale, t } from '../../src/app/i18n';
import { DiffError } from '../../src/core/diff-engine';
import { Dialogs } from '../../src/ui/dialogs';

const locale = getLocale();
beforeEach(() => setLocale('en'));
afterEach(() => {
  setLocale(locale);
  document.querySelectorAll('dialog, .side-panel').forEach((d) => d.remove());
});

const panels = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>('.side-panel'));
const titleOf = (panel: HTMLElement): string | null =>
  panel.querySelector('.side-panel-title-label')?.textContent ?? null;

describe('Help panels', () => {
  it('open beside the sheet rather than over it, each only once', async () => {
    const dialogs = new Dialogs();
    void dialogs.showAbout('shortcuts');
    void dialogs.showFormulaHelp();
    expect(document.querySelector('dialog')).toBeNull();
    expect(panels().map(titleOf)).toEqual([t('dialog.shortcuts.title'), t('dialog.formulaHelp.title')]);

    // Asking again expands the open one; no second copy appears.
    await dialogs.showAbout('shortcuts');
    expect(panels()).toHaveLength(2);
    expect(panels()[0].classList.contains('collapsed')).toBe(false);
  });

  it('filters formula help by the search box', () => {
    void new Dialogs().showFormulaHelp();
    const search = document.querySelector<HTMLInputElement>('.formula-help-search')!;
    const shownFunctions = (): number =>
      Array.from(document.querySelectorAll<HTMLElement>('.help-fn')).filter((row) => !row.hidden).length;
    const all = shownFunctions();
    expect(all).toBeGreaterThan(10);
    search.value = 'xlookup';
    search.dispatchEvent(new Event('input'));
    expect(shownFunctions()).toBeGreaterThanOrEqual(1);
    expect(shownFunctions()).toBeLessThan(all);
    search.value = 'zzzz-nothing';
    search.dispatchEvent(new Event('input'));
    expect(shownFunctions()).toBe(0);
    expect(document.querySelector<HTMLElement>('.formula-help .dialog-note:last-child')?.hidden).toBe(false);
  });
});

describe('File Version History panel', () => {
  const snapshot = { timestamp: Date.UTC(2026, 0, 1), bytes: new Uint8Array() };

  it('saves the settings with Save Settings and closes', async () => {
    const result = new Dialogs().chooseVersionHistory(false, undefined, [snapshot]);
    const panel = panels()[0];
    const checkbox = panel.querySelector<HTMLInputElement>('.form-check input[type="checkbox"]')!;
    checkbox.checked = true;
    panel.querySelector<HTMLInputElement>('input[value="unlimited"]')!.checked = true;
    const save = Array.from(panel.querySelectorAll<HTMLButtonElement>('.dialog-buttons button')).find(
      (b) => b.textContent === t('dialog.versionHistory.ok'),
    )!;
    save.click();
    await expect(result).resolves.toEqual({ kind: 'save', enabled: true, maxOverride: null });
    expect(panels()).toHaveLength(0);
  });

  it('answers a version’s Restore with its index, and × with nothing', async () => {
    const dialogs = new Dialogs();
    const restored = dialogs.chooseVersionHistory(true, undefined, [snapshot, { ...snapshot, timestamp: 2 }]);
    // Newest first: the first Restore is the second (index 1) version.
    const restore = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.version-history-entry-actions button'),
    ).filter((b) => b.textContent === t('dialog.versionHistory.restore'))[0];
    restore.click();
    await expect(restored).resolves.toEqual({ kind: 'restore', index: 1 });

    const closed = dialogs.chooseVersionHistory(true, undefined, []);
    panels()[0].querySelector<HTMLButtonElement>('.side-panel-close-btn')!.click();
    await expect(closed).resolves.toBeNull();
  });
});

describe('Compare / Diff panel', () => {
  it('runs from the footer and stays open to run again', () => {
    const runDiff = vi.fn<DiffDialogInput['runDiff']>(() => ({
      ok: false,
      error: new DiffError('noKeyColumns', 'no key'),
    }));
    const input = {
      currentTabName: 'now.csv',
      currentColumns: ['id', 'name'],
      tabs: [{ id: 't1', name: 'before.csv' }],
      columnsForTab: () => ['id', 'name'],
      runDiff,
      exportCsv: vi.fn(async () => true),
    } as unknown as DiffDialogInput;
    void new Dialogs().showDiff(input);
    const panel = panels()[0];
    expect(titleOf(panel)).toBe(t('dialog.diff.title'));
    const footer = Array.from(panel.querySelectorAll<HTMLButtonElement>('.dialog-buttons button'));
    expect(footer.map((b) => b.textContent)).toEqual([t('dialog.diff.exportCsv'), t('dialog.diff.run')]);
    panel.querySelector<HTMLInputElement>('input[type="checkbox"][value="id"]')!.checked = true;
    footer[1].click();
    expect(runDiff).toHaveBeenCalledWith('t1', expect.objectContaining({ keyColumns: ['id'] }));
    expect(panel.isConnected).toBe(true);
  });
});
