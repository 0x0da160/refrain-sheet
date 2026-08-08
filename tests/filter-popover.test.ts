// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * The column-filter popover (`Dialogs.chooseFilter`): a non-modal, anchored
 * surface (not a native `<dialog>`/backdrop) with Escape/outside-click
 * dismissal and manual focus handling, plus select-all/deselect-all for the
 * distinct-value list acting on the currently search-narrowed values rather
 * than the column's full value set. See issue #121.
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

describe('the column-filter popover', () => {
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
    document.querySelectorAll('.filter-popover').forEach((n) => n.remove());
  });

  it('is a plain positioned element, not a native modal <dialog>', async () => {
    const dialogs = new Dialogs();
    const promise = dialogs.chooseFilter(filterInput());
    const popover = document.querySelector<HTMLElement>('.filter-popover');
    expect(popover).not.toBeNull();
    expect(popover!.tagName).toBe('DIV');
    expect(popover!.getAttribute('role')).toBe('dialog');
    expect(popover!.getAttribute('aria-modal')).toBe('false');
    expect(document.querySelector('dialog')).toBeNull();

    popover!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(await promise).toBeNull();
    expect(document.querySelector('.filter-popover')).toBeNull();
  });

  it('closes and resolves null (cancel) on an outside pointer interaction', async () => {
    const dialogs = new Dialogs();
    const promise = dialogs.chooseFilter(filterInput());
    expect(document.querySelector('.filter-popover')).not.toBeNull();

    document.body.dispatchEvent(new Event('mousedown', { bubbles: true }));
    expect(await promise).toBeNull();
    expect(document.querySelector('.filter-popover')).toBeNull();
  });

  it('selects all narrows to the current search term, not the full value list', async () => {
    const dialogs = new Dialogs();
    // Start with an explicit, empty restriction so every checkbox begins
    // unchecked (allValues off, nothing pre-selected).
    const input = filterInput({ existing: { col: 1, join: 'and', conditions: [], values: [] } });
    const promise = dialogs.chooseFilter(input);
    const popover = document.querySelector<HTMLElement>('.filter-popover')!;

    const search = popover.querySelector<HTMLInputElement>('input[type="search"]')!;
    search.value = 'a'; // matches apple, banana; not cherry
    search.dispatchEvent(new Event('input', { bubbles: true }));

    popoverButton(popover, t('dialog.filter.selectAllValues')).click();
    popoverButton(popover, t('dialog.filter.apply')).click();

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
    const popover = document.querySelector<HTMLElement>('.filter-popover')!;

    const search = popover.querySelector<HTMLInputElement>('input[type="search"]')!;
    search.value = 'a'; // matches apple, banana; not cherry
    search.dispatchEvent(new Event('input', { bubbles: true }));

    popoverButton(popover, t('dialog.filter.deselectAllValues')).click();
    popoverButton(popover, t('dialog.filter.apply')).click();

    const result = await promise;
    expect(result).toMatchObject({ action: 'apply', column: { values: ['cherry'] } });
  });

  it('anchors below the triggering column header when it is currently rendered', async () => {
    const header = document.createElement('div');
    header.setAttribute('data-colhead', '1');
    header.getBoundingClientRect = () =>
      ({ left: 300, top: 40, right: 360, bottom: 60, width: 60, height: 20 }) as DOMRect;
    document.body.append(header);

    const dialogs = new Dialogs();
    const promise = dialogs.chooseFilter(filterInput({ col: 1 }));
    const popover = document.querySelector<HTMLElement>('.filter-popover')!;
    expect(popover.style.left).toBe('300px');
    expect(popover.style.top).toBe('60px');

    popover.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await promise;
  });

  it('falls back to a centered position when the column header is not currently rendered', async () => {
    const dialogs = new Dialogs();
    // No element with data-colhead="1" exists (e.g. scrolled out of the
    // virtualized grid window), so there is nothing to anchor to.
    const promise = dialogs.chooseFilter(filterInput({ col: 1 }));
    const popover = document.querySelector<HTMLElement>('.filter-popover')!;
    expect(popover.style.left).toBe('500px'); // 1000 / 2
    expect(popover.style.top).toBe('267px'); // round(800 / 3)

    popover.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await promise;
  });

  // See #296: an incomplete condition used to be silently dropped from the
  // applied filter with no feedback anywhere in the dialog.
  describe('an incomplete condition', () => {
    it('leaves Apply enabled and shows no error while the default row is untouched', async () => {
      const dialogs = new Dialogs();
      const promise = dialogs.chooseFilter(filterInput());
      const popover = document.querySelector<HTMLElement>('.filter-popover')!;

      const applyBtn = popoverButton(popover, t('dialog.filter.apply'));
      expect(applyBtn.disabled).toBe(false);
      expect(popover.querySelector('.dialog-error')?.textContent).toBe('');

      applyBtn.click();
      const result = await promise;
      expect(result).toMatchObject({ action: 'apply', column: null });
    });

    it('disables Apply and shows an error once a numeric condition is touched but left blank', async () => {
      const dialogs = new Dialogs();
      const promise = dialogs.chooseFilter(filterInput());
      const popover = document.querySelector<HTMLElement>('.filter-popover')!;

      const opSelect = popover.querySelector<HTMLSelectElement>(
        `[aria-label="${t('dialog.filter.condition')}"]`,
      )!;
      opSelect.value = 'numGreater';
      opSelect.dispatchEvent(new Event('change', { bubbles: true }));

      const applyBtn = popoverButton(popover, t('dialog.filter.apply'));
      expect(applyBtn.disabled).toBe(true);
      expect(popover.querySelector('.dialog-error')?.textContent).toBe(
        t('dialog.filter.conditionIncomplete'),
      );

      const valueInput = popover.querySelector<HTMLInputElement>(
        `[aria-label="${t('dialog.filter.value')}"]`,
      )!;
      valueInput.value = '5';
      valueInput.dispatchEvent(new Event('input', { bubbles: true }));
      expect(applyBtn.disabled).toBe(false);
      expect(popover.querySelector('.dialog-error')?.textContent).toBe('');

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
      const popover = document.querySelector<HTMLElement>('.filter-popover')!;

      const opSelect = popover.querySelector<HTMLSelectElement>(
        `[aria-label="${t('dialog.filter.condition')}"]`,
      )!;
      opSelect.value = 'numGreater';
      opSelect.dispatchEvent(new Event('change', { bubbles: true }));
      const valueInput = popover.querySelector<HTMLInputElement>(
        `[aria-label="${t('dialog.filter.value')}"]`,
      )!;
      valueInput.value = 'not a number';
      valueInput.dispatchEvent(new Event('input', { bubbles: true }));

      const applyBtn = popoverButton(popover, t('dialog.filter.apply'));
      expect(applyBtn.disabled).toBe(true);
      expect(popover.querySelector('.dialog-error')?.textContent).toBe(
        t('dialog.filter.conditionIncomplete'),
      );

      popover.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await promise;
    });

    it('disables Apply once a text condition is touched but left blank', async () => {
      const dialogs = new Dialogs();
      const promise = dialogs.chooseFilter(filterInput());
      const popover = document.querySelector<HTMLElement>('.filter-popover')!;

      const opSelect = popover.querySelector<HTMLSelectElement>(
        `[aria-label="${t('dialog.filter.condition')}"]`,
      )!;
      opSelect.value = 'equals';
      opSelect.dispatchEvent(new Event('change', { bubbles: true }));

      const applyBtn = popoverButton(popover, t('dialog.filter.apply'));
      expect(applyBtn.disabled).toBe(true);
      expect(popover.querySelector('.dialog-error')?.textContent).toBe(
        t('dialog.filter.conditionIncomplete'),
      );

      popover.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await promise;
    });

    it('does not require a value for the no-value blank/notBlank operators', async () => {
      const dialogs = new Dialogs();
      const promise = dialogs.chooseFilter(filterInput());
      const popover = document.querySelector<HTMLElement>('.filter-popover')!;

      const opSelect = popover.querySelector<HTMLSelectElement>(
        `[aria-label="${t('dialog.filter.condition')}"]`,
      )!;
      opSelect.value = 'notBlank';
      opSelect.dispatchEvent(new Event('change', { bubbles: true }));

      const applyBtn = popoverButton(popover, t('dialog.filter.apply'));
      expect(applyBtn.disabled).toBe(false);
      expect(popover.querySelector('.dialog-error')?.textContent).toBe('');

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
      const popover = document.querySelector<HTMLElement>('.filter-popover')!;

      const valueInput = popover.querySelector<HTMLInputElement>(
        `[aria-label="${t('dialog.filter.value')}"]`,
      )!;
      valueInput.value = '';
      valueInput.dispatchEvent(new Event('input', { bubbles: true }));

      const applyBtn = popoverButton(popover, t('dialog.filter.apply'));
      expect(applyBtn.disabled).toBe(true);
      expect(popover.querySelector('.dialog-error')?.textContent).toBe(
        t('dialog.filter.conditionIncomplete'),
      );

      popover.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await promise;
    });
  });
});
