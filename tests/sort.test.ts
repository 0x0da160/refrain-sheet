// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * RSF sorting: the deterministic, view-only display-order core (compound
 * compare, header row, filter interaction) and the command-level flow —
 * dialog build/apply, clear, CSV-mode restriction, sorted-range write
 * protection, structural-edit interaction, and non-undoable/non-dirty
 * session-only behavior.
 */
import { describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/app/app-state';
import { Commands, type SortDialogResult, type UiPort } from '../src/app/commands';
import { type ColumnFilter, type SheetFilter } from '../src/core/filter';
import { RsfDocument } from '../src/core/rsf-document';
import {
  compareSortValues,
  computeSortOrder,
  sortDataTop,
  sortsEqual,
  validateSort,
  MAX_SHEET_SORT_KEYS,
  MAX_SHEET_SORT_COLUMNS,
  type SheetSort,
} from '../src/core/sort';
import { doc as csvDoc } from './helpers';

function stubUi(overrides: Partial<UiPort> = {}): UiPort {
  return {
    confirmValidation: vi.fn(async () => true),
    confirmUnsaved: vi.fn(async () => 'discard' as const),
    chooseSaveOptions: vi.fn(async () => null),
    confirmUnrepresentable: vi.fn(async () => false),
    notifyNcr: vi.fn(async () => undefined),
    confirmUndecodableEdit: vi.fn(async () => true),
    chooseReopen: vi.fn(async () => null),
    confirmConvert: vi.fn(async () => true),
    explainRsfSave: vi.fn(async () => true),
    chooseRsfSave: vi.fn(async () => 2),
    chooseExportCsv: vi.fn(async () => null),
    confirmExportXlsx: vi.fn(async () => true),
    chooseInsertShift: vi.fn(async () => 'down' as const),
    confirmFlashFill: vi.fn(async () => true),
    chooseFilter: vi.fn(async () => null),
    chooseSort: vi.fn(async () => null),
    chooseDataValidation: vi.fn(async () => null),
    chooseConditionalFormat: vi.fn(async () => null),
    chooseCellComment: vi.fn(async () => null),
    promptSheetName: vi.fn(async () => null),
    confirmDeleteSheet: vi.fn(async () => true),
    chooseExportSheet: vi.fn(async () => null),
    confirmReplaceAllWorkbook: vi.fn(async () => true),
    confirmRangeMoveOverwrite: vi.fn(async () => true),
    promptMoveTarget: vi.fn(async () => null),
    promptGoToCell: vi.fn(async () => null),
    confirm: vi.fn(async () => true),
    showMessage: vi.fn(async () => undefined),
    notify: vi.fn(),
    openFindBar: vi.fn(),
    findNext: vi.fn(),
    showAbout: vi.fn(),
    showFormulaHelp: vi.fn(),
    showSqlQuery: vi.fn(async () => undefined),
    showDiff: vi.fn(async () => undefined),
    chooseSettings: vi.fn(async () => null),
    chooseTimezone: vi.fn(async () => null),
    chooseDisplayLanguage: vi.fn(async () => null),
    chooseTextColor: vi.fn(async () => null),
    chooseBackgroundColor: vi.fn(async () => null),
    chooseBorders: vi.fn(async () => null),
    chooseNumberFormat: vi.fn(async () => null),
    setBusy: vi.fn(),
    ...overrides,
  };
}

function sheet(values: string[][], ui: UiPort = stubUi()) {
  const state = new AppState();
  const commands = new Commands(state, ui, document);
  const doc = RsfDocument.empty('t.rsf', values.length, values[0].length);
  for (let r = 0; r < values.length; r++) {
    for (let c = 0; c < values[r].length; c++) {
      doc.setCell(r, c, values[r][c]);
    }
  }
  doc.markSaved();
  const tab = state.addTab('t.rsf', doc, null);
  return { state, commands, tab, doc, ui };
}

const textCol = (col: number, conditions: ColumnFilter['conditions']): ColumnFilter => ({
  col,
  join: 'and',
  conditions,
  values: null,
});

describe('sort value comparison', () => {
  it('compares numbers numerically, not lexicographically', () => {
    expect(compareSortValues('2', '10')).toBeLessThan(0);
    expect(compareSortValues('10', '2')).toBeGreaterThan(0);
    expect(compareSortValues('5', '5')).toBe(0);
  });

  it('falls back to code-point order for non-numeric text', () => {
    expect(compareSortValues('apple', 'banana')).toBeLessThan(0);
    expect(compareSortValues('banana', 'apple')).toBeGreaterThan(0);
    expect(compareSortValues('a', 'a')).toBe(0);
  });

  it('blank values always sort after every non-blank value, both directions', () => {
    expect(compareSortValues('', 'apple')).toBeGreaterThan(0);
    expect(compareSortValues('apple', '')).toBeLessThan(0);
    expect(compareSortValues('  ', '')).toBe(0); // both blank (whitespace-only counts as blank)
  });
});

describe('sortDataTop', () => {
  it('skips the header row only when headerRow is set', () => {
    const base: SheetSort = {
      top: 2,
      left: 0,
      bottom: 5,
      right: 0,
      headerRow: false,
      keys: [{ col: 0, ascending: true }],
    };
    expect(sortDataTop(base)).toBe(2);
    expect(sortDataTop({ ...base, headerRow: true })).toBe(3);
  });
});

describe('computeSortOrder', () => {
  const values = [
    ['name', 'qty'],
    ['banana', '3'],
    ['apple', '10'],
    ['cherry', '10'],
  ];
  const get = (r: number, c: number): string => values[r]?.[c] ?? '';

  it('rows outside the sort range map to themselves', () => {
    const sort: SheetSort = {
      top: 1,
      left: 0,
      bottom: 2,
      right: 1,
      headerRow: false,
      keys: [{ col: 0, ascending: true }],
    };
    const order = computeSortOrder(sort, 4, null, get);
    expect(order[0]).toBe(0);
    expect(order[3]).toBe(3);
  });

  it('sorts ascending and descending by a single key, skipping the header row', () => {
    const asc: SheetSort = {
      top: 0,
      left: 0,
      bottom: 3,
      right: 1,
      headerRow: true,
      keys: [{ col: 0, ascending: true }],
    };
    const orderAsc = computeSortOrder(asc, 4, null, get);
    expect(orderAsc[0]).toBe(0); // header stays put
    expect(orderAsc.slice(1).map((r) => values[r][0])).toEqual(['apple', 'banana', 'cherry']);

    const desc: SheetSort = { ...asc, keys: [{ col: 0, ascending: false }] };
    const orderDesc = computeSortOrder(desc, 4, null, get);
    expect(orderDesc.slice(1).map((r) => values[r][0])).toEqual(['cherry', 'banana', 'apple']);
  });

  it('compound keys break ties on later keys', () => {
    const sort: SheetSort = {
      top: 0,
      left: 0,
      bottom: 3,
      right: 1,
      headerRow: true,
      keys: [
        { col: 1, ascending: true }, // qty: 3, 10, 10
        { col: 0, ascending: true }, // name breaks the qty=10 tie
      ],
    };
    const order = computeSortOrder(sort, 4, null, get);
    expect(order.slice(1).map((r) => values[r][0])).toEqual(['banana', 'apple', 'cherry']);
  });

  it('is stable: rows tying on every key keep their original relative order', () => {
    const tied = [
      ['x', 'a'],
      ['x', 'b'],
      ['x', 'c'],
    ];
    const g = (r: number, c: number): string => tied[r]?.[c] ?? '';
    const sort: SheetSort = {
      top: 0,
      left: 0,
      bottom: 2,
      right: 1,
      headerRow: false,
      keys: [{ col: 0, ascending: true }],
    };
    expect(computeSortOrder(sort, 3, null, g)).toEqual([0, 1, 2]);
  });

  it('rows hidden by an active filter stay at their own position; only visible rows reorder', () => {
    const sort: SheetSort = {
      top: 0,
      left: 0,
      bottom: 3,
      right: 1,
      headerRow: true,
      keys: [{ col: 0, ascending: true }],
    };
    const hidden = new Set([2]); // 'apple' (row 2) is hidden by a filter
    const order = computeSortOrder(sort, 4, hidden, get);
    expect(order[2]).toBe(2); // hidden row untouched
    // Only the visible data rows (1 and 3: 'banana', 'cherry') are reordered among themselves.
    const visibleSlots = [1, 3].map((slot) => values[order[slot]][0]);
    expect(visibleSlots).toEqual(['banana', 'cherry']);
  });

  it('an empty key list or an empty range leaves every row in document order', () => {
    const noKeys: SheetSort = { top: 0, left: 0, bottom: 3, right: 1, headerRow: true, keys: [] };
    expect(computeSortOrder(noKeys, 4, null, get)).toEqual([0, 1, 2, 3]);
    const allHeader: SheetSort = {
      top: 0,
      left: 0,
      bottom: 0,
      right: 1,
      headerRow: true,
      keys: [{ col: 0, ascending: true }],
    };
    expect(computeSortOrder(allHeader, 1, null, get)).toEqual([0]);
  });
});

describe('validateSort', () => {
  const base = { top: 0, left: 0, bottom: 3, right: 2, headerRow: true };

  it('accepts an in-bounds sort with distinct key columns', () => {
    const ok: SheetSort = {
      ...base,
      keys: [
        { col: 0, ascending: true },
        { col: 1, ascending: false },
      ],
    };
    expect(validateSort(ok, 4, 3)).not.toBeNull();
  });

  it('rejects out-of-range coordinates and top > bottom / left > right', () => {
    const ok: SheetSort = { ...base, keys: [{ col: 0, ascending: true }] };
    expect(validateSort({ ...ok, bottom: 99 }, 4, 3)).toBeNull();
    expect(validateSort({ ...ok, right: 99 }, 4, 3)).toBeNull();
    expect(validateSort({ ...ok, top: 5, bottom: 1 }, 4, 3)).toBeNull();
  });

  it('rejects an empty key list, too many keys, and a key column outside the range', () => {
    const noKeys: SheetSort = { ...base, keys: [] };
    expect(validateSort(noKeys, 4, 3)).toBeNull();
    const tooMany: SheetSort = {
      ...base,
      keys: Array.from({ length: MAX_SHEET_SORT_KEYS + 1 }, (_, i) => ({ col: i % 3, ascending: true })),
    };
    expect(validateSort(tooMany, 10, MAX_SHEET_SORT_KEYS + 1)).toBeNull();
    const outside: SheetSort = { ...base, keys: [{ col: 5, ascending: true }] };
    expect(validateSort(outside, 4, 6)).toBeNull();
  });

  it('rejects duplicate key columns', () => {
    const dup: SheetSort = {
      ...base,
      keys: [
        { col: 0, ascending: true },
        { col: 0, ascending: false },
      ],
    };
    expect(validateSort(dup, 4, 3)).toBeNull();
  });

  it('rejects a range wider than MAX_SHEET_SORT_COLUMNS', () => {
    const wide: SheetSort = {
      top: 0,
      left: 0,
      bottom: 3,
      right: MAX_SHEET_SORT_COLUMNS,
      headerRow: true,
      keys: [{ col: 0, ascending: true }],
    };
    expect(validateSort(wide, 4, MAX_SHEET_SORT_COLUMNS + 1)).toBeNull();
  });
});

describe('sortsEqual', () => {
  const a: SheetSort = {
    top: 0,
    left: 0,
    bottom: 3,
    right: 1,
    headerRow: true,
    keys: [{ col: 0, ascending: true }],
  };

  it('null-safe and structural', () => {
    expect(sortsEqual(null, null)).toBe(true);
    expect(sortsEqual(a, null)).toBe(false);
    expect(sortsEqual(a, { ...a })).toBe(true);
    expect(sortsEqual(a, { ...a, keys: [{ col: 0, ascending: false }] })).toBe(false);
    expect(sortsEqual(a, { ...a, bottom: 4 })).toBe(false);
  });
});

describe('sort command flow', () => {
  it('applies via the dialog route, computes a display order, and reports it in the status', async () => {
    const applied: SortDialogResult = {
      action: 'apply',
      headerRow: true,
      keys: [{ col: 0, ascending: true }],
    };
    const ui = stubUi({ chooseSort: vi.fn(async () => applied) });
    const { state, commands, tab, doc } = sheet(
      [
        ['name', 'qty'],
        ['banana', '3'],
        ['apple', '10'],
      ],
      ui,
    );
    state.setSelection(tab, { row: 0, col: 0 }, { row: 2, col: 1 });
    const ok = await commands.sortDialog(tab);
    expect(ok).toBe(true);
    expect(ui.chooseSort).toHaveBeenCalled();
    expect(doc.sort).not.toBeNull();
    // Display order: header stays at slot 0, data rows reorder to apple, banana.
    const order = state.sortOrder(tab);
    expect(order).not.toBeNull();
    expect(order?.[0]).toBe(0);
    expect(doc.getValue(order![1], 0)).toBe('apple');
    expect(doc.getValue(order![2], 0)).toBe('banana');
    // docRow/sortSlot are inverses of each other.
    expect(state.docRow(tab, 1)).toBe(order![1]);
    expect(state.sortSlot(tab, order![1])).toBe(1);
    expect(ui.notify).toHaveBeenCalled();
  });

  it('CSV documents refuse to sort with a localized explanation', async () => {
    const ui = stubUi();
    const state = new AppState();
    const commands = new Commands(state, ui, document);
    const tab = state.addTab('t.csv', csvDoc('a,b\n1,2\n'), null);
    state.setSelection(tab, { row: 0, col: 0 }, null);
    const result = await commands.sortDialog(tab);
    expect(result).toBe(false);
    expect(ui.showMessage).toHaveBeenCalled();
    expect(ui.chooseSort).not.toHaveBeenCalled();
  });

  it('clearSort restores document order (notified) and clears state.sortOrder', () => {
    const { state, tab, doc } = sheet([['name'], ['b'], ['a']]);
    const sort: SheetSort = {
      top: 0,
      left: 0,
      bottom: 2,
      right: 0,
      headerRow: true,
      keys: [{ col: 0, ascending: true }],
    };
    expect(state.setSort(tab, sort)).toBe(true);
    expect(doc.sort).not.toBeNull();
    expect(state.sortOrder(tab)).not.toBeNull();
    expect(state.setSort(tab, null)).toBe(true);
    expect(doc.sort).toBeNull();
    expect(state.sortOrder(tab)).toBeNull();
  });

  it('refuses editing a cell inside the sorted data range but allows editing the header row', () => {
    const { state, tab, doc } = sheet([['name'], ['b'], ['a']]);
    const announced: string[] = [];
    state.announce = (message) => announced.push(message);
    const sort: SheetSort = {
      top: 0,
      left: 0,
      bottom: 2,
      right: 0,
      headerRow: true,
      keys: [{ col: 0, ascending: true }],
    };
    expect(state.setSort(tab, sort)).toBe(true);
    expect(state.editCell(tab, 1, 0, 'z')).toBe(false); // inside sorted data range
    expect(announced.length).toBeGreaterThan(0);
    expect(doc.getValue(1, 0)).toBe('b'); // unchanged
    expect(state.editCell(tab, 0, 0, 'header')).toBe(true); // header row: not sorted, editable
    expect(doc.getValue(0, 0)).toBe('header');
  });

  it('refuses a bulk edit that touches any cell inside the sorted range, all-or-nothing', () => {
    const { state, tab, doc } = sheet([['b'], ['a'], ['c']]);
    const sort: SheetSort = {
      top: 0,
      left: 0,
      bottom: 2,
      right: 0,
      headerRow: false,
      keys: [{ col: 0, ascending: true }],
    };
    expect(state.setSort(tab, sort)).toBe(true);
    const applied = state.bulkEdit(
      tab,
      [
        { row: 0, col: 0, before: 'b', after: 'x' },
        { row: 1, col: 0, before: 'a', after: 'y' },
      ],
      'history.paste',
    );
    expect(applied).toBe(false);
    expect(doc.getValue(0, 0)).toBe('b');
    expect(doc.getValue(1, 0)).toBe('a');
  });

  it('structural row/column edits drop the active sort', () => {
    const { state, tab, doc } = sheet([['b'], ['a'], ['c']]);
    const sort: SheetSort = {
      top: 0,
      left: 0,
      bottom: 2,
      right: 0,
      headerRow: false,
      keys: [{ col: 0, ascending: true }],
    };
    expect(state.setSort(tab, sort)).toBe(true);
    expect(state.insertRows(tab, 0, 1)).toBe(true);
    expect(doc.sort).toBeNull();
  });

  it('Sheet > Insert Row (the menu-driven structural command) notifies when it drops an active sort', async () => {
    const ui = stubUi();
    const { state, commands, tab, doc } = sheet([['b'], ['a'], ['c']], ui);
    const sort: SheetSort = {
      top: 0,
      left: 0,
      bottom: 2,
      right: 0,
      headerRow: false,
      keys: [{ col: 0, ascending: true }],
    };
    expect(state.setSort(tab, sort)).toBe(true);
    state.setSelection(tab, { row: 0, col: 0 }, null);
    await commands.run('sheet.insertRowAbove');
    expect(doc.sort).toBeNull();
    expect(ui.notify).toHaveBeenCalledWith(expect.stringContaining('sort'), 'info');
  });

  it('sorting is session-only view state: not undoable and does not mark the document dirty', () => {
    const { state, tab, doc } = sheet([['b'], ['a'], ['c']]);
    expect(doc.isDirty).toBe(false);
    const sort: SheetSort = {
      top: 0,
      left: 0,
      bottom: 2,
      right: 0,
      headerRow: false,
      keys: [{ col: 0, ascending: true }],
    };
    expect(state.setSort(tab, sort)).toBe(true);
    expect(doc.isDirty).toBe(false); // applying a sort never dirties the document
    expect(tab.history.canUndo).toBe(false); // not pushed as a history entry
    state.undo(tab); // no-op: nothing to undo
    expect(doc.sort).not.toBeNull(); // the sort survives, since it was never history-tracked
  });

  it('sort combines with an active filter: hidden rows stay put, only visible rows reorder', () => {
    const { state, tab, doc } = sheet([
      ['name'],
      ['banana'],
      ['durian'], // will be filtered out
      ['apple'],
    ]);
    const filter: SheetFilter = {
      top: 0,
      left: 0,
      bottom: 3,
      right: 0,
      headerRow: true,
      columns: [textCol(0, [{ kind: 'text', op: 'notEquals', value: 'durian' }])],
    };
    expect(state.setFilter(tab, filter)).toBe(true);
    expect(state.isRowHidden(tab, 2)).toBe(true);
    const sort: SheetSort = {
      top: 0,
      left: 0,
      bottom: 3,
      right: 0,
      headerRow: true,
      keys: [{ col: 0, ascending: true }],
    };
    expect(state.setSort(tab, sort)).toBe(true);
    const order = state.sortOrder(tab);
    expect(order).not.toBeNull();
    expect(order?.[2]).toBe(2); // hidden 'durian' row untouched
    expect(doc.getValue(order![1], 0)).toBe('apple');
    expect(doc.getValue(order![3], 0)).toBe('banana');
  });
});
