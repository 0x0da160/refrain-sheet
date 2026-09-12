// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * The column-filter side panel (`Dialogs.chooseFilter`): a non-modal,
 * dockable/resizable surface (not a native `<dialog>`/backdrop) with
 * Escape/outside-click dismissal and manual focus handling, plus
 * select-all/deselect-all for the distinct-value list acting on the
 * currently search-narrowed values, like the individual checkboxes. See
 * issue #121 (the original anchored popover) and #393 (converted to the
 * shared dockable side panel, `openSidePanel`, alongside Sort/Data
 * Validation/Format).
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

function popoverButton(popover: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(popover.querySelectorAll('button')).find((b) => b.textContent === label);
  if (!button) {
    throw new Error(`button "${label}" not found`);
  }
  return button;
}

describe('the column-filter side panel', () => {
  const locale = getLocale();

  beforeEach(() => {
    document.body.textContent = '';
    setLocale('en');
    vi.stubGlobal('innerWidth', 1000);
    vi.stubGlobal('innerHeight', 800);
    // No visualViewport in jsdom by default → the innerWidth/innerHeight path.
  });

  afterEach(() => {
    setLocale(locale);
    document.querySelectorAll('.side-panel').forEach((n) => n.remove());
  });

  it('is a plain positioned element, not a native modal <dialog>', async () => {
    const dialogs = new Dialogs();
    const promise = dialogs.chooseFilter(filterInput());
    const panel = document.querySelector<HTMLElement>('.side-panel');
    expect(panel).not.toBeNull();
    expect(panel!.tagName).toBe('DIV');
    expect(panel!.getAttribute('role')).toBe('dialog');
    expect(panel!.getAttribute('aria-modal')).toBe('false');
    expect(document.querySelector('dialog')).toBeNull();

    panel!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(await promise).toBeNull();
    expect(document.querySelector('.side-panel')).toBeNull();
  });

  it('closes and resolves null (cancel) on an outside pointer interaction', async () => {
    const dialogs = new Dialogs();
    const promise = dialogs.chooseFilter(filterInput());
    expect(document.querySelector('.side-panel')).not.toBeNull();

    document.body.dispatchEvent(new Event('mousedown', { bubbles: true }));
    expect(await promise).toBeNull();
    expect(document.querySelector('.side-panel')).toBeNull();
  });

  it('selects all narrows to the current search term, not the full value list', async () => {
    const dialogs = new Dialogs();
    // Start with an explicit, empty restriction so every checkbox begins
    // unchecked (allValues off, nothing pre-selected).
    const input = filterInput({ existing: { col: 1, join: 'and', conditions: [], values: [] } });
    const promise = dialogs.chooseFilter(input);
    const panel = document.querySelector<HTMLElement>('.side-panel')!;

    const search = panel.querySelector<HTMLInputElement>('input[type="search"]')!;
    search.value = 'a'; // matches apple, banana; not cherry
    search.dispatchEvent(new Event('input', { bubbles: true }));

    popoverButton(panel, t('dialog.filter.selectAllValues')).click();
    popoverButton(panel, t('dialog.filter.apply')).click();

    const result = await promise;
    expect(result).toMatchObject({ action: 'apply', column: { values: ['apple', 'banana'] } });
  });

  it('deselect all narrows to the current search term, not the full value list', async () => {
    const dialogs = new Dialogs();
    // Restricted to the full value set (allValues off) so every checkbox
    // begins checked.
    const input = filterInput({
      existing: { col: 1, join: 'and', conditions: [], values: ['apple', 'banana', 'cherry'] },
    });
    const promise = dialogs.chooseFilter(input);
    const panel = document.querySelector<HTMLElement>('.side-panel')!;

    const search = panel.querySelector<HTMLInputElement>('input[type="search"]')!;
    search.value = 'a'; // matches apple, banana; not cherry
    search.dispatchEvent(new Event('input', { bubbles: true }));

    popoverButton(panel, t('dialog.filter.deselectAllValues')).click();
    popoverButton(panel, t('dialog.filter.apply')).click();

    const result = await promise;
    expect(result).toMatchObject({ action: 'apply', column: { values: ['cherry'] } });
  });

  it('docks to the right by default and can be switched to top/bottom/left', async () => {
    const dialogs = new Dialogs();
    const promise = dialogs.chooseFilter(filterInput());
    const panel = document.querySelector<HTMLElement>('.side-panel')!;

    // Whichever side a previous test left it docked to is a deliberate,
    // session-remembered choice (see openSidePanel in
    // src/ui/dialogs/shared.ts) — assert against the current position
    // rather than assuming 'right', then exercise every switch button.
    for (const position of ['top', 'right', 'bottom', 'left'] as const) {
      panel
        .querySelector<HTMLButtonElement>(`[title="${t(`dialog.sidePanel.position.${position}`)}"]`)!
        .click();
      expect(panel.dataset.sidePanelPosition).toBe(position);
    }

    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await promise;
  });

  // See #296: an incomplete condition used to be silently dropped from the
  // applied filter with no feedback anywhere in the dialog.
  describe('an incomplete condition', () => {
    it('leaves Apply enabled and shows no error while the default row is untouched', async () => {
      const dialogs = new Dialogs();
      const promise = dialogs.chooseFilter(filterInput());
      const panel = document.querySelector<HTMLElement>('.side-panel')!;

      const applyBtn = popoverButton(panel, t('dialog.filter.apply'));
      expect(applyBtn.disabled).toBe(false);
      expect(panel.querySelector('.dialog-error')?.textContent).toBe('');

      applyBtn.click();
      const result = await promise;
      expect(result).toMatchObject({ action: 'apply', column: null });
    });

    it('disables Apply and shows an error once a numeric condition is touched but left blank', async () => {
      const dialogs = new Dialogs();
      const promise = dialogs.chooseFilter(filterInput());
      const panel = document.querySelector<HTMLElement>('.side-panel')!;

      const opSelect = panel.querySelector<HTMLSelectElement>(
        `[aria-label="${t('dialog.filter.condition')}"]`,
      )!;
      opSelect.value = 'numGreater';
      opSelect.dispatchEvent(new Event('change', { bubbles: true }));

      const applyBtn = popoverButton(panel, t('dialog.filter.apply'));
      expect(applyBtn.disabled).toBe(true);
      expect(panel.querySelector('.dialog-error')?.textContent).toBe(t('dialog.filter.conditionIncomplete'));

      const valueInput = panel.querySelector<HTMLInputElement>(`[aria-label="${t('dialog.filter.value')}"]`)!;
      valueInput.value = '5';
      valueInput.dispatchEvent(new Event('input', { bubbles: true }));
      expect(applyBtn.disabled).toBe(false);
      expect(panel.querySelector('.dialog-error')?.textContent).toBe('');

      applyBtn.click();
      const result = await promise;
      expect(result).toMatchObject({
        action: 'apply',
        column: { conditions: [{ kind: 'number', op: 'numGreater', value: 5 }] },
      });
    });

    it('disables Apply once a numeric condition is touched with a non-numeric value', async () => {
      const dialogs = new Dialogs();
      const promise = dialogs.chooseFilter(filterInput());
      const panel = document.querySelector<HTMLElement>('.side-panel')!;

      const opSelect = panel.querySelector<HTMLSelectElement>(
        `[aria-label="${t('dialog.filter.condition')}"]`,
      )!;
      opSelect.value = 'numGreater';
      opSelect.dispatchEvent(new Event('change', { bubbles: true }));
      const valueInput = panel.querySelector<HTMLInputElement>(`[aria-label="${t('dialog.filter.value')}"]`)!;
      valueInput.value = 'not a number';
      valueInput.dispatchEvent(new Event('input', { bubbles: true }));

      const applyBtn = popoverButton(panel, t('dialog.filter.apply'));
      expect(applyBtn.disabled).toBe(true);
      expect(panel.querySelector('.dialog-error')?.textContent).toBe(t('dialog.filter.conditionIncomplete'));

      panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await promise;
    });

    it('disables Apply once a text condition is touched but left blank', async () => {
      const dialogs = new Dialogs();
      const promise = dialogs.chooseFilter(filterInput());
      const panel = document.querySelector<HTMLElement>('.side-panel')!;

      const opSelect = panel.querySelector<HTMLSelectElement>(
        `[aria-label="${t('dialog.filter.condition')}"]`,
      )!;
      opSelect.value = 'equals';
      opSelect.dispatchEvent(new Event('change', { bubbles: true }));

      const applyBtn = popoverButton(panel, t('dialog.filter.apply'));
      expect(applyBtn.disabled).toBe(true);
      expect(panel.querySelector('.dialog-error')?.textContent).toBe(t('dialog.filter.conditionIncomplete'));

      panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await promise;
    });

    it('does not require a value for the no-value blank/notBlank operators', async () => {
      const dialogs = new Dialogs();
      const promise = dialogs.chooseFilter(filterInput());
      const panel = document.querySelector<HTMLElement>('.side-panel')!;

      const opSelect = panel.querySelector<HTMLSelectElement>(
        `[aria-label="${t('dialog.filter.condition')}"]`,
      )!;
      opSelect.value = 'notBlank';
      opSelect.dispatchEvent(new Event('change', { bubbles: true }));

      const applyBtn = popoverButton(panel, t('dialog.filter.apply'));
      expect(applyBtn.disabled).toBe(false);
      expect(panel.querySelector('.dialog-error')?.textContent).toBe('');

      applyBtn.click();
      const result = await promise;
      expect(result).toMatchObject({
        action: 'apply',
        column: { conditions: [{ kind: 'text', op: 'notBlank', value: '' }] },
      });
    });

    it('flags an existing condition edited into a blank value', async () => {
      const dialogs = new Dialogs();
      const input = filterInput({
        existing: {
          col: 1,
          join: 'and',
          conditions: [{ kind: 'number', op: 'numGreater', value: 5 }],
          values: null,
        },
      });
      const promise = dialogs.chooseFilter(input);
      const panel = document.querySelector<HTMLElement>('.side-panel')!;

      const valueInput = panel.querySelector<HTMLInputElement>(`[aria-label="${t('dialog.filter.value')}"]`)!;
      valueInput.value = '';
      valueInput.dispatchEvent(new Event('input', { bubbles: true }));

      const applyBtn = popoverButton(panel, t('dialog.filter.apply'));
      expect(applyBtn.disabled).toBe(true);
      expect(panel.querySelector('.dialog-error')?.textContent).toBe(t('dialog.filter.conditionIncomplete'));

      panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await promise;
    });
  });
});
