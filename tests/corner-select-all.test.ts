// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/app/app-state';
import { Commands, type UiPort } from '../src/app/commands';
import { setLocale, t } from '../src/app/i18n';
import { rangeToTsv } from '../src/core/clipboard';
import { Grid } from '../src/ui/grid';
import { doc } from './helpers';

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
    chooseInsertShift: vi.fn(async () => null),
    confirm: vi.fn(async () => true),
    showMessage: vi.fn(async () => undefined),
    notify: vi.fn(),
    openFindBar: vi.fn(),
    findNext: vi.fn(),
    showAbout: vi.fn(),
    showFormulaHelp: vi.fn(),
    chooseSettings: vi.fn(async () => null),
    setBusy: vi.fn(),
    ...overrides,
  };
}

/** Wire the grid to state events exactly like the real app (main.ts). */
function wire(state: AppState, grid: Grid): void {
  state.subscribe((event) => {
    if (event === 'selection') {
      grid.refreshSelection();
    } else {
      grid.refresh();
    }
  });
}

function makeGrid(ui: UiPort = stubUi()) {
  const state = new AppState();
  const commands = new Commands(state, ui, document);
  const grid = new Grid(state, commands);
  Object.defineProperty(grid.element, 'clientHeight', { value: 520, configurable: true });
  Object.defineProperty(grid.element, 'clientWidth', { value: 900, configurable: true });
  document.body.append(grid.element);
  wire(state, grid);
  return { state, grid, commands };
}

function setup(csv: string, ui: UiPort = stubUi()) {
  const { state, grid, commands } = makeGrid(ui);
  const tab = state.addTab('t.csv', doc(csv), null);
  grid.refresh();
  return { state, grid, commands, tab };
}

const corner = (grid: Grid): HTMLButtonElement => grid.element.querySelector<HTMLButtonElement>('.vcorner')!;

beforeEach(() => {
  document.body.textContent = '';
  localStorage.clear();
});
afterEach(() => setLocale('en'));

describe('top-left corner Select All control', () => {
  it('is a keyboard-reachable button with a localized accessible name', () => {
    const { grid } = setup('a,b\nc,d\n');
    const button = corner(grid);
    // A real <button> is in the tab order and activates on Enter/Space natively.
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('type')).toBe('button');
    expect(button.getAttribute('aria-label')).toBe(t('grid.selectAllCorner'));
    expect(button.getAttribute('aria-label')).toBe('Select all cells');
    setLocale('ja');
    grid.refresh();
    expect(corner(grid).getAttribute('aria-label')).toBe('すべてのセルを選択');
  });

  it('selects the used range on pointer activation and marks the sheet selected', () => {
    const { grid, state, tab } = setup('a,b,c\nd,e,f\ng,h,i\n');
    corner(grid).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(state.selectedRange(tab)).toEqual({ top: 0, left: 0, bottom: 2, right: 2 });
    // Whole-sheet selection is a distinct state (not row/column/range).
    expect(grid.element.classList.contains('sel-all')).toBe(true);
    expect(grid.element.classList.contains('sel-rows')).toBe(false);
    expect(grid.element.classList.contains('sel-cols')).toBe(false);
    // The control announces its resulting selected state to assistive tech.
    expect(corner(grid).getAttribute('aria-pressed')).toBe('true');
  });

  it('activates the same command a keyboard click triggers (Enter/Space → click)', () => {
    const { grid, commands } = setup('a,b\nc,d\n');
    const run = vi.spyOn(commands, 'run');
    // Enter/Space on a focused button dispatch a native click; simulate that.
    corner(grid).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(run).toHaveBeenCalledWith('edit.selectAll');
  });

  it('selects the whole logical grid of a blank RSF document from the corner', () => {
    const { state, grid, commands } = makeGrid();
    const tab = commands.newDocument();
    grid.refresh();
    corner(grid).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const range = state.selectedRange(tab)!;
    expect(range).toEqual({ top: 0, left: 0, bottom: tab.doc.rowCount - 1, right: tab.doc.columnCount - 1 });
    expect(grid.element.classList.contains('sel-all')).toBe(true);
  });

  it('shows the no-data grid state (no corner) for an empty CSV; the command reports it', async () => {
    const notify = vi.fn();
    const { grid, state, tab, commands } = setup('', stubUi({ notify }));
    // An empty document renders the no-data message, so there is no corner to
    // click; Select All via the command path reports the empty state instead.
    expect(grid.element.querySelector('.vcorner')).toBeNull();
    await commands.run('edit.selectAll');
    expect(notify).toHaveBeenCalledWith(t('notify.selectAllEmpty'), 'info');
    expect(state.selectedRange(tab)).toBeNull();
  });

  it('selects the whole sheet of a large virtualized document without materializing all cells', () => {
    const rows = 10_000;
    const csv = Array.from({ length: rows }, (_, r) => `r${r},1,2`).join('\n') + '\n';
    const { grid, state, tab } = setup(csv);
    corner(grid).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(grid.element.querySelectorAll('[data-row][data-col]').length).toBeLessThan(500);
    expect(state.selectedRange(tab)).toEqual({ top: 0, left: 0, bottom: rows - 1, right: 2 });
    expect(grid.element.classList.contains('sel-all')).toBe(true);
  });

  it('copies the whole document after a corner Select All', () => {
    const { grid, state, tab } = setup('a,b\nc,d\n');
    corner(grid).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(rangeToTsv(tab.doc, state.selectedRange(tab)!)).toBe('a\tb\nc\td');
  });

  it('coexists with formula-reference highlighting', () => {
    const { grid, tab } = setup('a,b\nc,d\n');
    corner(grid).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    // A formula-reference highlight uses its own classes and does not clear the
    // whole-sheet selection state.
    grid.setFormulaRefs([{ top: 0, left: 0, bottom: 0, right: 0, text: 'A1' }]);
    const cell = grid.element.querySelector('[data-row="0"][data-col="0"]')!;
    expect(cell.classList.contains('fref')).toBe(true);
    expect(cell.classList.contains('selected')).toBe(true);
    expect(grid.element.classList.contains('sel-all')).toBe(true);
    void tab;
  });
});
