// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * The pivot table panel (`PivotDialogs.showPivot`). Opened on a pivot table
 * sheet, it starts from that sheet's settings and offers Update This Sheet;
 * opened anywhere else, it offers only Create in New Sheet.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PivotDialogInput } from '../../src/app/commands';
import { getLocale, setLocale } from '../../src/app/i18n';
import type { PivotRequest } from '../../src/core/pivot';
import { PivotDialogs } from '../../src/ui/dialogs/pivot';

const COLUMNS = ['region', 'item', 'amount'];

function pivotInput(overrides: Partial<PivotDialogInput> = {}): PivotDialogInput {
  return {
    columns: COLUMNS,
    initial: null,
    create: vi.fn(() => ({ ok: true as const, sheetName: 'Pivot Table', ignored: 0 })),
    update: null,
    ...overrides,
  };
}

/** The panel's selects in order: row field, column field, value field, and summary. */
function selectsOf(panel: Element): HTMLSelectElement[] {
  return Array.from(panel.querySelectorAll('select'));
}

function buttonNamed(panel: Element, label: string): HTMLButtonElement | undefined {
  return Array.from(panel.querySelectorAll('button')).find((button) => button.textContent === label);
}

/** Dismisses the panel the way a person does, so the promise settles. */
async function close(panel: Element, promise: Promise<void>): Promise<void> {
  panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await promise;
}

describe('PivotDialogs.showPivot', () => {
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

  it('starts a new summary with the last column as the value, and offers Create only', async () => {
    const promise = new PivotDialogs().showPivot(pivotInput());
    const panel = document.querySelector('.side-panel')!;
    const [row, column, value, aggregation] = selectsOf(panel);
    expect(row.value).toBe('0');
    expect(column.value).toBe('');
    expect(value.value).toBe('2');
    expect(aggregation.value).toBe('sum');
    expect(buttonNamed(panel, 'Update This Sheet')).toBeUndefined();
    expect(buttonNamed(panel, 'Create in New Sheet')).not.toBeUndefined();
    await close(panel, promise);
  });

  it('reopens a pivot table sheet with its settings, and updates it from the panel', async () => {
    const initial: PivotRequest = { rowField: 0, columnField: 1, valueField: 2, aggregation: 'sum' };
    const update = vi.fn(() => ({
      ok: true as const,
      sheetName: 'Pivot Table',
      ignored: 0,
      mode: 'updated' as const,
    }));
    const promise = new PivotDialogs().showPivot(pivotInput({ initial, update }));
    const panel = document.querySelector('.side-panel')!;
    expect(panel.querySelector('.dialog-note')!.textContent).toBe('');
    const [, column, , aggregation] = selectsOf(panel);
    expect(column.value).toBe('1');
    expect(aggregation.value).toBe('sum');

    aggregation.value = 'average';
    buttonNamed(panel, 'Update This Sheet')!.click();
    expect(update).toHaveBeenCalledWith({
      rowField: 0,
      columnField: 1,
      valueField: 2,
      aggregation: 'average',
    });
    expect(panel.querySelector('.dialog-note')!.textContent).toBe(
      'Updated the pivot table on “Pivot Table”.',
    );
    await close(panel, promise);
  });

  it('starts from the defaults when the sheet’s fields no longer exist in the table', async () => {
    const initial: PivotRequest = { rowField: 9, columnField: null, valueField: 2, aggregation: 'max' };
    const promise = new PivotDialogs().showPivot(pivotInput({ initial, update: vi.fn() }));
    const panel = document.querySelector('.side-panel')!;
    const [row, column, value, aggregation] = selectsOf(panel);
    expect(row.value).toBe('0');
    expect(column.value).toBe('');
    expect(value.value).toBe('2');
    expect(aggregation.value).toBe('sum');
    await close(panel, promise);
  });

  it('reports an unchanged pivot table, and a refused update, in the status line', async () => {
    const initial: PivotRequest = { rowField: 0, columnField: null, valueField: 2, aggregation: 'sum' };
    const update = vi
      .fn()
      .mockReturnValueOnce({
        ok: true as const,
        sheetName: 'Pivot Table',
        ignored: 0,
        mode: 'unchanged' as const,
      })
      .mockReturnValueOnce({ ok: false as const, error: { code: 'updateFailed', params: {} } });
    const promise = new PivotDialogs().showPivot(pivotInput({ initial, update }));
    const panel = document.querySelector('.side-panel')!;
    const status = panel.querySelector('.dialog-note') as HTMLElement;

    buttonNamed(panel, 'Update This Sheet')!.click();
    expect(status.textContent).toBe('The pivot table already shows the current data.');
    expect(status.getAttribute('role')).toBe('status');

    buttonNamed(panel, 'Update This Sheet')!.click();
    expect(status.textContent).toBe(
      'The pivot table could not be updated. The sheet may be locked, or the file may be read-only.',
    );
    expect(status.getAttribute('role')).toBe('alert');
    await close(panel, promise);
  });
});
