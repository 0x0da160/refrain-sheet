// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { AppState } from '../src/app/app-state';
import { Commands, type UiPort } from '../src/app/commands';
import { extractFormulaRefs } from '../src/core/formula';
import { Grid } from '../src/ui/grid';
import { doc } from './helpers';

describe('extractFormulaRefs (tolerant text scan)', () => {
  it('extracts single-cell references', () => {
    expect(extractFormulaRefs('=A1+B2')).toMatchObject([
      { top: 0, left: 0, bottom: 0, right: 0, text: 'A1' },
      { top: 1, left: 1, bottom: 1, right: 1, text: 'B2' },
    ]);
  });

  it('extracts rectangular ranges (normalized)', () => {
    expect(extractFormulaRefs('=SUM(C10:A1)')).toMatchObject([
      { top: 0, left: 0, bottom: 9, right: 2, text: 'C10:A1' },
    ]);
  });

  it('extracts whole-column and whole-row ranges with unbounded flags', () => {
    const cols = extractFormulaRefs('=SUM(A:C)');
    expect(cols).toMatchObject([{ left: 0, right: 2, wholeCols: true, top: 0 }]);
    const rows = extractFormulaRefs('=SUM(2:10)');
    expect(rows).toMatchObject([{ top: 1, bottom: 9, wholeRows: true, left: 0 }]);
  });

  it('handles multiple references in one formula and deduplicates repeats', () => {
    const refs = extractFormulaRefs('=A1+A1+SUM(B1:B3)+C:C');
    expect(refs).toHaveLength(3);
    expect(refs.map((r) => r.text)).toEqual(['A1', 'B1:B3', 'C:C']);
  });

  it('is safe on incomplete formulas mid-edit', () => {
    expect(extractFormulaRefs('=SUM(A1:')).toMatchObject([{ top: 0, left: 0, text: 'A1' }]);
    expect(extractFormulaRefs('=SUM(A1:B')).toMatchObject([{ text: 'A1' }]);
    expect(extractFormulaRefs('=')).toEqual([]);
  });

  it('never throws on invalid syntax and returns nothing for non-formulas', () => {
    expect(extractFormulaRefs('=@@#!')).toEqual([]);
    expect(extractFormulaRefs('plain text A1')).toEqual([]);
    expect(extractFormulaRefs('')).toEqual([]);
  });

  it('ignores references inside string literals and function names', () => {
    expect(extractFormulaRefs('="A1 not a ref"')).toEqual([]);
    expect(extractFormulaRefs('=SUM(1)')).toEqual([]);
    // The `1.5` decimal never becomes a whole-row range.
    expect(extractFormulaRefs('=1.5:2')).toEqual([]);
  });
});

const noopUi: UiPort = {
  confirmValidation: async () => true,
  confirmUnsaved: async () => 'discard',
  chooseSaveOptions: async () => null,
  confirmUnrepresentable: async () => false,
  notifyNcr: async () => undefined,
  confirmUndecodableEdit: async () => true,
  chooseReopen: async () => null,
  confirmConvert: async () => true,
  explainRsfSave: async () => true,
  chooseRsfSave: async () => 2,
  chooseExportCsv: async () => null,
  chooseInsertShift: async () => null,
  confirmFlashFill: async () => false,
  chooseFilter: async () => null,
  promptSheetName: async () => null,
  confirmDeleteSheet: async () => true,
  chooseExportSheet: async () => null,
  confirm: async () => true,
  showMessage: async () => undefined,
  notify: () => undefined,
  openFindBar: () => undefined,
  findNext: () => undefined,
  showAbout: () => undefined,
  showFormulaHelp: () => undefined,
  chooseSettings: async () => null,
  setBusy: () => undefined,
};

beforeEach(() => {
  // Each Grid owns a floating .ref-indicator on <body>; start tests clean.
  document.body.textContent = '';
});

function setup(csv: string) {
  const state = new AppState();
  const commands = new Commands(state, noopUi, document);
  const grid = new Grid(state, commands);
  Object.defineProperty(grid.element, 'clientHeight', { value: 520, configurable: true });
  Object.defineProperty(grid.element, 'clientWidth', { value: 900, configurable: true });
  document.body.append(grid.element);
  const tab = state.addTab('refs.csv', doc(csv), null);
  grid.refresh();
  return { state, commands, grid, tab };
}

function csvOf(rows: number, cols: number): string {
  return (
    Array.from({ length: rows }, (_, r) =>
      Array.from({ length: cols }, (_, c) => `r${r}c${c}`).join(','),
    ).join('\n') + '\n'
  );
}

function cellEl(grid: Grid, row: number, col: number): HTMLElement {
  return grid.element.querySelector<HTMLElement>(`[data-row="${row}"][data-col="${col}"]`)!;
}

describe('grid formula-reference highlighting', () => {
  it('highlights referenced cells and range perimeters, then clears', () => {
    const { grid } = setup(csvOf(10, 4));
    grid.setFormulaRefs(extractFormulaRefs('=A1+SUM(B2:C3)'));
    expect(cellEl(grid, 0, 0).classList.contains('fref')).toBe(true);
    expect(cellEl(grid, 0, 0).classList.contains('fref-0')).toBe(true);
    // The second reference cycles to the next distinct style.
    expect(cellEl(grid, 1, 1).classList.contains('fref-1')).toBe(true);
    expect(cellEl(grid, 1, 1).classList.contains('fref-top')).toBe(true);
    expect(cellEl(grid, 1, 1).classList.contains('fref-left')).toBe(true);
    expect(cellEl(grid, 2, 2).classList.contains('fref-bottom')).toBe(true);
    expect(cellEl(grid, 2, 2).classList.contains('fref-right')).toBe(true);
    // An interior/other cell is not highlighted.
    expect(cellEl(grid, 5, 3).classList.contains('fref')).toBe(false);
    grid.setFormulaRefs([]);
    expect(cellEl(grid, 0, 0).classList.contains('fref')).toBe(false);
  });

  it('clamps whole-column references to the used grid and highlights rendered cells', () => {
    const { grid } = setup(csvOf(10, 4));
    grid.setFormulaRefs(extractFormulaRefs('=SUM(B:B)'));
    expect(cellEl(grid, 0, 1).classList.contains('fref')).toBe(true);
    expect(cellEl(grid, 9, 1).classList.contains('fref')).toBe(true);
    expect(cellEl(grid, 9, 1).classList.contains('fref-bottom')).toBe(true);
    expect(cellEl(grid, 0, 0).classList.contains('fref')).toBe(false);
  });

  it('is independent from the ordinary selection classes', () => {
    const { state, grid, tab } = setup(csvOf(10, 4));
    state.setSelection(tab, { row: 2, col: 2 }, { row: 1, col: 1 });
    grid.refreshSelection();
    grid.setFormulaRefs(extractFormulaRefs('=B2'));
    const cell = cellEl(grid, 1, 1);
    // Both stylings coexist: selection range + formula reference.
    expect(cell.classList.contains('in-range')).toBe(true);
    expect(cell.classList.contains('fref')).toBe(true);
    grid.setFormulaRefs([]);
    expect(cell.classList.contains('in-range')).toBe(true);
  });

  it('shows the beyond-viewport indicator only for ranges extending past the rendered window', () => {
    const { grid } = setup(csvOf(5000, 4));
    const indicator = document.querySelector<HTMLElement>('.ref-indicator')!;
    expect(indicator).not.toBeNull();
    grid.setFormulaRefs(extractFormulaRefs('=A1'));
    expect(indicator.hidden).toBe(true);
    // A whole-column reference reaches far beyond the rendered rows.
    grid.setFormulaRefs(extractFormulaRefs('=SUM(A:A)'));
    expect(indicator.hidden).toBe(false);
    grid.setFormulaRefs([]);
    expect(indicator.hidden).toBe(true);
  });

  it('typing in the inline editor updates the highlight live', () => {
    const { grid, tab } = setup(csvOf(10, 4));
    grid.openEditor(tab, 5, 0, '=');
    const input = grid.element.querySelector<HTMLInputElement>('.cell-editor')!;
    input.value = '=B2+C3';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(cellEl(grid, 1, 1).classList.contains('fref')).toBe(true);
    expect(cellEl(grid, 2, 2).classList.contains('fref')).toBe(true);
    // Editing the text updates highlights (C3 removed).
    input.value = '=B2';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(cellEl(grid, 2, 2).classList.contains('fref')).toBe(false);
    // Closing the editor clears every highlight.
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(cellEl(grid, 1, 1).classList.contains('fref')).toBe(false);
  });
});
