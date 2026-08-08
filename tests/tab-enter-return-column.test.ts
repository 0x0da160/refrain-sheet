// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * Tab-then-Enter row entry (issue #344): after typing across a row with Tab
 * between cells, Enter returns to the column where that row's typing began
 * instead of merely moving one row down from wherever the last Tab landed —
 * matching Excel/Sheets/Calc. A click, an arrow key, or opening a menu
 * interrupts the tracked start column so a later plain Enter behaves as
 * before (same column, next row).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tab } from '../src/app/app-state';
import { AppState } from '../src/app/app-state';
import { Commands, type UiPort } from '../src/app/commands';
import { Grid } from '../src/ui/grid';
import { doc } from './helpers';

function stubUi(): UiPort {
  const noop = vi.fn();
  const asyncNoop = vi.fn(async () => undefined);
  return {
    confirmValidation: vi.fn(async () => true),
    confirmUnsaved: vi.fn(async () => 'discard' as const),
    chooseSaveOptions: vi.fn(async () => null),
    confirmUnrepresentable: vi.fn(async () => false),
    notifyNcr: asyncNoop,
    confirmUndecodableEdit: vi.fn(async () => true),
    chooseReopen: vi.fn(async () => null),
    confirmConvert: vi.fn(async () => true),
    explainRsfSave: vi.fn(async () => true),
    chooseRsfSave: vi.fn(async () => 2),
    chooseExportCsv: vi.fn(async () => null),
    confirmExportXlsx: vi.fn(async () => true),
    chooseInsertShift: vi.fn(async () => null),
    confirmFlashFill: vi.fn(async () => false),
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
    showMessage: asyncNoop,
    notify: noop,
    openFindBar: noop,
    findNext: noop,
    showAbout: noop,
    showFormulaHelp: noop,
    showSqlQuery: vi.fn(async () => undefined),
    showDiff: vi.fn(async () => undefined),
    chooseSettings: vi.fn(async () => null),
    chooseTimezone: vi.fn(async () => null),
    chooseDisplayLanguage: vi.fn(async () => null),
    chooseTextColor: vi.fn(async () => null),
    chooseBackgroundColor: vi.fn(async () => null),
    chooseBorders: vi.fn(async () => null),
    chooseNumberFormat: vi.fn(async () => null),
    setBusy: noop,
  };
}

function setupGrid(csv: string) {
  const state = new AppState();
  const commands = new Commands(state, stubUi(), document);
  const grid = new Grid(state, commands);
  Object.defineProperty(grid.element, 'clientHeight', { value: 400, configurable: true });
  Object.defineProperty(grid.element, 'clientWidth', { value: 800, configurable: true });
  document.body.append(grid.element);
  state.subscribe((e) => (e === 'selection' ? grid.refreshSelection() : grid.refresh()));
  const tab = state.addTab('t.csv', doc(csv), null);
  grid.refresh();
  return { state, grid, commands, tab };
}

/**
 * Type a value into the cell editor and press Tab or Enter. Each Tab/Enter
 * commits and closes the editor without reopening it (matching the real
 * grid), so if no editor is currently open this opens a fresh empty one at
 * the active cell first — exactly what a real keystroke would do via the
 * "type starts a fresh edit" path (`beginsTextEntry`, `grid.ts` ~3438).
 */
function typeAndKey(grid: Grid, tab: Tab, value: string, key: 'Tab' | 'Enter', shiftKey = false): void {
  if (!grid.element.querySelector('.cell-editor')) {
    const sel = tab.selection!;
    grid.openEditor(tab, sel.row, sel.col, '');
  }
  const input = grid.element.querySelector<HTMLTextAreaElement>('.cell-editor')!;
  input.value = value;
  input.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }));
}

beforeEach(() => {
  document.body.textContent = '';
});

describe('Enter returns to the Tab-entry start column', () => {
  it('returns to the row-start column after typing across a row with Tab, for every subsequent row', () => {
    const { grid, tab } = setupGrid('a,b,c\nd,e,f\ng,h,i\nj,k,l\n');
    typeAndKey(grid, tab, 'Name', 'Tab');
    typeAndKey(grid, tab, 'Score', 'Tab');
    typeAndKey(grid, tab, 'Date', 'Enter');
    expect(tab.selection).toEqual({ row: 1, col: 0 });

    typeAndKey(grid, tab, 'Alice', 'Tab');
    typeAndKey(grid, tab, '90', 'Tab');
    typeAndKey(grid, tab, '2026-01-01', 'Enter');
    expect(tab.selection).toEqual({ row: 2, col: 0 });

    typeAndKey(grid, tab, 'Bob', 'Tab');
    typeAndKey(grid, tab, '75', 'Tab');
    typeAndKey(grid, tab, '2026-02-01', 'Enter');
    expect(tab.selection).toEqual({ row: 3, col: 0 });

    expect(tab.doc.getValue(0, 0)).toBe('Name');
    expect(tab.doc.getValue(1, 0)).toBe('Alice');
    expect(tab.doc.getValue(2, 0)).toBe('Bob');
  });

  it('does not change plain Enter with no preceding Tab (same column, next row)', () => {
    const { grid, tab } = setupGrid('a,b,c\nd,e,f\n');
    grid.select(tab, 0, 1);
    typeAndKey(grid, tab, 'x', 'Enter');
    expect(tab.selection).toEqual({ row: 1, col: 1 });
  });

  it('an arrow key after Tab interrupts tracking, so the next Enter uses the current column', () => {
    const { grid, tab } = setupGrid('a,b,c\nd,e,f\ng,h,i\n');
    typeAndKey(grid, tab, 'x', 'Tab'); // now at (0, 1); tracked start column is 0
    expect(tab.selection).toEqual({ row: 0, col: 1 });

    grid.element.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
    );
    expect(tab.selection).toEqual({ row: 0, col: 2 });

    typeAndKey(grid, tab, 'y', 'Enter');
    // Tracking was cleared by the arrow key: Enter just moves down one row in
    // the current column (2), not back to the pre-arrow-key Tab column (0).
    expect(tab.selection).toEqual({ row: 1, col: 2 });
  });

  it('a mouse click on a different cell interrupts tracking', () => {
    const { grid, tab } = setupGrid('a,b,c\nd,e,f\ng,h,i\n');
    typeAndKey(grid, tab, 'x', 'Tab'); // tracked start column is 0, now at (0, 1)

    const other = grid.element.querySelector<HTMLElement>('[data-row="0"][data-col="2"]');
    expect(other).not.toBeNull();
    other!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    expect(tab.selection).toEqual({ row: 0, col: 2 });

    typeAndKey(grid, tab, 'y', 'Enter');
    expect(tab.selection).toEqual({ row: 1, col: 2 });
  });

  it('Shift+Tab (moving left) still tracks the row-start column for Enter', () => {
    const { grid, tab } = setupGrid('a,b,c\nd,e,f\n');
    grid.select(tab, 0, 2);
    typeAndKey(grid, tab, 'x', 'Tab', true); // Shift+Tab: now at (0, 1); tracked column is 2
    expect(tab.selection).toEqual({ row: 0, col: 1 });

    typeAndKey(grid, tab, 'y', 'Enter');
    expect(tab.selection).toEqual({ row: 1, col: 2 });
  });

  it('the already-committed (non-editing) Enter also honors the tracked column', () => {
    const { grid, tab } = setupGrid('a,b,c\nd,e,f\n');
    typeAndKey(grid, tab, 'x', 'Tab'); // tracked column 0, now editing (0, 1)
    grid.cancelEditing(); // close the editor without another Tab or Enter
    expect(tab.selection).toEqual({ row: 0, col: 1 });

    grid.element.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    expect(tab.selection).toEqual({ row: 1, col: 0 });
  });
});
