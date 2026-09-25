// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * Header-row filter buttons: Sheet > Filter & Sort > Filter Buttons on Header
 * Row turns a data block's first row into filter/sort buttons; each button
 * opens the column menu (`src/ui/column-menu.ts`), whose result the command
 * layer applies through the existing filter (undoable) and view-only sort.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/app/app-state';
import { Commands, type ColumnMenuInput, type ColumnMenuResult, type UiPort } from '../src/app/commands';
import { getLocale, setLocale } from '../src/app/i18n';
import { RsfDocument } from '../src/core/rsf-document';
import { openColumnMenu } from '../src/ui/column-menu';
import { Grid } from '../src/ui/grid';

function stubUi(overrides: Partial<UiPort> = {}): UiPort {
  const target: Record<string | symbol, unknown> = {
    confirmConvert: vi.fn(async () => true),
    notify: vi.fn(),
    setBusy: vi.fn(),
    ...overrides,
  };
  return new Proxy(target, {
    get: (t, key) => {
      if (!(key in t)) {
        t[key] = vi.fn(async () => null);
      }
      return t[key];
    },
  }) as unknown as UiPort;
}

const DATA = [
  ['fruit', 'qty', 'color', ''],
  ['apple', '10', 'red', ''],
  ['banana', '3', 'yellow', ''],
  ['cherry', '20', 'red', ''],
  ['date', '7', 'brown', ''],
];

function sheet(ui: UiPort = stubUi()) {
  const state = new AppState();
  const commands = new Commands(state, ui, document);
  const doc = RsfDocument.empty('t.rsf', DATA.length + 2, 4);
  for (let r = 0; r < DATA.length; r++) {
    for (let c = 0; c < 4; c++) {
      doc.setCell(r, c, DATA[r][c]);
    }
  }
  doc.markSaved();
  const tab = state.addTab('t.rsf', doc, null);
  state.setSelection(tab, { row: 1, col: 0 }, null);
  return { state, commands, tab, doc, ui };
}

describe('Filter Buttons on Header Row', () => {
  it('turns on over the data block with a header row and no criteria, trimmed to the last header cell', async () => {
    const { commands, tab, doc, state } = sheet();
    expect(await commands.toggleHeaderFilter(tab)).toBe(true);
    expect(doc.filter).toEqual({ top: 0, left: 0, bottom: 4, right: 2, headerRow: true, columns: [] });
    expect(state.hiddenRows(tab)?.size ?? 0).toBe(0);
    expect(commands.hasFilter(tab)).toBe(true);
  });

  it('turns off by removing the filter, and each step is undoable', async () => {
    const { commands, tab, doc, state } = sheet();
    await commands.toggleHeaderFilter(tab);
    await commands.toggleHeaderFilter(tab);
    expect(doc.filter).toBeNull();
    state.undo(tab);
    expect(doc.filter).not.toBeNull();
    state.undo(tab);
    expect(doc.filter).toBeNull();
  });
});

describe('the column menu command', () => {
  async function withMenu(result: ColumnMenuResult | null, col = 2) {
    const chooseColumnMenu = vi.fn(async (_input: ColumnMenuInput) => result);
    const env = sheet(stubUi({ chooseColumnMenu }));
    await env.commands.toggleHeaderFilter(env.tab);
    await env.commands.columnMenu(env.tab, col, null);
    return { ...env, chooseColumnMenu };
  }

  it('offers the column header, distinct values, and current state', async () => {
    const { chooseColumnMenu } = await withMenu(null);
    const input = chooseColumnMenu.mock.calls[0][0];
    expect(input).toMatchObject({
      col: 2,
      colLetter: 'C',
      header: 'color',
      values: ['brown', 'red', 'yellow'],
      selected: null,
      hasColumnFilter: false,
      sorted: null,
    });
  });

  it('applies a values list as an undoable filter that hides the other rows', async () => {
    const { state, tab, doc } = await withMenu({ action: 'apply', values: ['red'] });
    expect(doc.filter?.columns).toEqual([{ col: 2, join: 'and', conditions: [], values: ['red'] }]);
    expect([...(state.hiddenRows(tab) ?? [])].sort()).toEqual([2, 4]);
    state.undo(tab);
    expect(doc.filter?.columns).toEqual([]);
  });

  it('lists only values the other columns still let through', async () => {
    const chooseColumnMenu = vi
      .fn<(input: ColumnMenuInput) => Promise<ColumnMenuResult | null>>()
      .mockResolvedValueOnce({ action: 'apply', values: ['red'] })
      .mockResolvedValueOnce(null);
    const { commands, tab } = sheet(stubUi({ chooseColumnMenu }));
    await commands.toggleHeaderFilter(tab);
    await commands.columnMenu(tab, 2, null);
    await commands.columnMenu(tab, 0, null);
    expect(chooseColumnMenu.mock.calls[1][0].values).toEqual(['apple', 'cherry']);
  });

  it('clearing the only narrowed column keeps the buttons (the filter range) in place', async () => {
    const chooseColumnMenu = vi
      .fn<(input: ColumnMenuInput) => Promise<ColumnMenuResult | null>>()
      .mockResolvedValueOnce({ action: 'apply', values: ['red'] })
      .mockResolvedValueOnce({ action: 'clearColumn' });
    const { commands, tab, doc, state } = sheet(stubUi({ chooseColumnMenu }));
    await commands.toggleHeaderFilter(tab);
    await commands.columnMenu(tab, 2, null);
    expect(chooseColumnMenu.mock.calls.length).toBe(1);
    await commands.columnMenu(tab, 2, null);
    expect(chooseColumnMenu.mock.calls[1][0].hasColumnFilter).toBe(true);
    expect(doc.filter).not.toBeNull();
    expect(doc.filter?.columns).toEqual([]);
    expect(state.hiddenRows(tab)?.size ?? 0).toBe(0);
  });

  it('orders the data rows by the column (header row stays first) and reports it back', async () => {
    const chooseColumnMenu = vi
      .fn<(input: ColumnMenuInput) => Promise<ColumnMenuResult | null>>()
      .mockResolvedValueOnce({ action: 'sort', ascending: false })
      .mockResolvedValueOnce({ action: 'clearSort' });
    const { commands, tab, doc } = sheet(stubUi({ chooseColumnMenu }));
    await commands.toggleHeaderFilter(tab);
    await commands.columnMenu(tab, 1, null);
    expect(doc.sort).toMatchObject({
      top: 0,
      bottom: 4,
      headerRow: true,
      keys: [{ col: 1, ascending: false }],
    });
    const order = commands.sortOrder(tab)!;
    expect(order.slice(0, 5).map((r) => doc.getDisplayValue(r, 1))).toEqual(['qty', '20', '10', '7', '3']);
    await commands.columnMenu(tab, 1, null);
    expect(chooseColumnMenu.mock.calls[1][0].sorted).toBe('desc');
    expect(doc.sort).toBeNull();
  });

  it('re-orders rows a later filter change shows again', async () => {
    const chooseColumnMenu = vi
      .fn<(input: ColumnMenuInput) => Promise<ColumnMenuResult | null>>()
      .mockResolvedValueOnce({ action: 'apply', values: ['red'] })
      .mockResolvedValueOnce({ action: 'sort', ascending: true })
      .mockResolvedValueOnce({ action: 'clearColumn' });
    const { commands, tab, doc } = sheet(stubUi({ chooseColumnMenu }));
    await commands.toggleHeaderFilter(tab);
    await commands.columnMenu(tab, 2, null);
    await commands.columnMenu(tab, 1, null);
    await commands.columnMenu(tab, 2, null);
    const order = commands.sortOrder(tab)!;
    expect(order.slice(1, 5).map((r) => doc.getDisplayValue(r, 1))).toEqual(['3', '7', '10', '20']);
  });

  it('hands over to the Filter panel for conditions', async () => {
    const chooseFilter = vi.fn(async () => null);
    const chooseColumnMenu = vi.fn(async () => ({ action: 'more' }) as const);
    const { commands, tab } = sheet(stubUi({ chooseFilter, chooseColumnMenu }));
    await commands.toggleHeaderFilter(tab);
    await commands.columnMenu(tab, 1, null);
    expect(chooseFilter).toHaveBeenCalledWith(
      expect.objectContaining({ col: 1, hasActiveFilter: true }),
      expect.anything(),
    );
  });
});

describe('the column menu popover', () => {
  const locale = getLocale();
  beforeEach(() => {
    document.body.textContent = '';
    setLocale('en');
  });
  afterEach(() => setLocale(locale));

  const input = (overrides: Partial<ColumnMenuInput> = {}): ColumnMenuInput => ({
    col: 2,
    colLetter: 'C',
    header: 'color',
    anchor: { left: 10, top: 10, right: 30, bottom: 30 },
    values: ['', 'brown', 'red'],
    valuesTruncated: false,
    selected: null,
    hasConditions: false,
    hasColumnFilter: false,
    sorted: null,
    ...overrides,
  });
  const menu = (): HTMLElement => document.querySelector<HTMLElement>('.column-menu')!;
  const button = (label: string): HTMLButtonElement =>
    [...menu().querySelectorAll('button')].find((b) => b.textContent === label)!;
  const boxes = (): HTMLInputElement[] => [
    ...menu().querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
  ];

  it('shows the column, every value checked, and the blank value by name', async () => {
    const promise = openColumnMenu(input());
    expect(menu().getAttribute('role')).toBe('dialog');
    expect(menu().textContent).toContain('color');
    expect(boxes().every((b) => b.checked)).toBe(true);
    expect(menu().textContent).toContain('(blank)');
    menu().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(await promise).toBeNull();
    expect(document.querySelector('.column-menu')).toBeNull();
  });

  it('applies the checked values; all checked means no value limit', async () => {
    let promise = openColumnMenu(input());
    button('Apply').click();
    expect(await promise).toEqual({ action: 'apply', values: null });

    promise = openColumnMenu(input());
    const [, , brown] = boxes();
    brown.checked = false;
    brown.dispatchEvent(new Event('change'));
    expect(boxes()[0].indeterminate).toBe(true);
    button('Apply').click();
    expect(await promise).toEqual({ action: 'apply', values: ['', 'red'] });
  });

  it('the all box follows the search and Apply is disabled with nothing checked', async () => {
    const promise = openColumnMenu(input({ selected: ['red'] }));
    const search = menu().querySelector<HTMLInputElement>('input[type="search"]')!;
    search.value = 'r';
    search.dispatchEvent(new Event('input'));
    expect(menu().textContent).toContain('All matches (2)');
    const all = boxes()[0];
    all.checked = false;
    all.dispatchEvent(new Event('change'));
    expect(button('Apply').disabled).toBe(true);
    document.body.dispatchEvent(new Event('mousedown', { bubbles: true }));
    expect(await promise).toBeNull();
  });

  it('sort buttons resolve at once; pressing the active direction clears the order', async () => {
    let promise = openColumnMenu(input());
    button('Descending').click();
    expect(await promise).toEqual({ action: 'sort', ascending: false });
    promise = openColumnMenu(input({ sorted: 'asc' }));
    expect(button('Ascending').getAttribute('aria-pressed')).toBe('true');
    button('Ascending').click();
    expect(await promise).toEqual({ action: 'clearSort' });
  });
});

describe('header-row filter buttons in the grid', () => {
  it('appear in the header row cells of the range, and not in column-letter headers', async () => {
    document.body.textContent = '';
    const chooseColumnMenu = vi.fn(async () => null);
    const { state, commands, tab } = sheet(stubUi({ chooseColumnMenu }));
    const grid = new Grid(state, commands);
    Object.defineProperty(grid.element, 'clientHeight', { value: 400, configurable: true });
    Object.defineProperty(grid.element, 'clientWidth', { value: 800, configurable: true });
    document.body.append(grid.element);
    await commands.toggleHeaderFilter(tab);
    grid.refresh();
    const buttons = grid.element.querySelectorAll<HTMLButtonElement>('.header-filter-button');
    expect([...buttons].map((b) => b.dataset.headerfilter)).toEqual(['0', '1', '2']);
    expect(grid.element.querySelector('.filter-indicator')).toBeNull();
    const cell = grid.element.querySelector<HTMLElement>('[data-row="0"][data-col="1"]')!;
    expect(cell.firstChild?.textContent).toBe('qty');
    buttons[1].click();
    await Promise.resolve();
    expect(chooseColumnMenu).toHaveBeenCalledWith(expect.objectContaining({ col: 1, header: 'qty' }));
  });
});
