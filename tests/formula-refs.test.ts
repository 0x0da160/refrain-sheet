// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { AppState } from '../src/app/app-state';
import { Commands, type UiPort } from '../src/app/commands';
import { extractFormulaRefs } from '../src/core/formula';
import {
  clampFormulaRefs,
  formulaRefsExceedViewport,
  Grid,
  matchFormulaRefCell,
  type ClampedFormulaRef,
} from '../src/ui/grid';
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

describe('clampFormulaRefs (pure, no DOM)', () => {
  it('assigns a cycling color index per reference in order', () => {
    const refs = extractFormulaRefs('=A1+B2+C3+D4+E5');
    const clamped = clampFormulaRefs(refs, 10, 10);
    expect(clamped.map((r) => r.idx)).toEqual([0, 1, 2, 3, 0]);
  });

  it('clamps a whole-column reference to the used grid and drops what falls outside it', () => {
    const refs = extractFormulaRefs('=SUM(B:B)');
    expect(clampFormulaRefs(refs, 5, 3)).toEqual([{ top: 0, left: 1, bottom: 4, right: 1, idx: 0 }]);
  });

  it('drops a reference left empty after clamping (fully outside the used grid)', () => {
    const refs = extractFormulaRefs('=D1');
    expect(clampFormulaRefs(refs, 5, 2)).toEqual([]);
  });

  it('normalizes negative top/left (never seen from extractFormulaRefs, but defensive)', () => {
    expect(clampFormulaRefs([{ top: -3, left: -1, bottom: 2, right: 2, text: 'A1' }], 10, 10)).toEqual([
      { top: 0, left: 0, bottom: 2, right: 2, idx: 0 },
    ]);
  });
});

describe('matchFormulaRefCell (pure, no DOM)', () => {
  const ranges: ClampedFormulaRef[] = [
    { top: 1, left: 1, bottom: 2, right: 2, idx: 1 },
    { top: 5, left: 5, bottom: 5, right: 5, idx: 2 },
  ];

  it('returns null for a cell outside every range', () => {
    expect(matchFormulaRefCell(0, 0, ranges)).toBeNull();
  });

  it('reports the color index and which edges a corner cell sits on', () => {
    expect(matchFormulaRefCell(1, 1, ranges)).toEqual({
      idx: 1,
      top: true,
      bottom: false,
      left: true,
      right: false,
    });
    expect(matchFormulaRefCell(2, 2, ranges)).toEqual({
      idx: 1,
      top: false,
      bottom: true,
      left: false,
      right: true,
    });
  });

  it('reports all four edges true for a single-cell range', () => {
    expect(matchFormulaRefCell(5, 5, ranges)).toEqual({
      idx: 2,
      top: true,
      bottom: true,
      left: true,
      right: true,
    });
  });

  it('matches the first containing range when ranges overlap', () => {
    const overlapping: ClampedFormulaRef[] = [
      { top: 0, left: 0, bottom: 3, right: 3, idx: 0 },
      { top: 1, left: 1, bottom: 2, right: 2, idx: 1 },
    ];
    expect(matchFormulaRefCell(1, 1, overlapping)?.idx).toBe(0);
  });
});

describe('formulaRefsExceedViewport (pure, no DOM)', () => {
  const view = { firstRow: 2, lastRow: 8, colStart: 1, colEnd: 4 };

  it('is false when every range is fully inside the viewport', () => {
    const ranges: ClampedFormulaRef[] = [{ top: 3, left: 1, bottom: 4, right: 2, idx: 0 }];
    expect(formulaRefsExceedViewport(ranges, view)).toBe(false);
  });

  it('is false with no ranges', () => {
    expect(formulaRefsExceedViewport([], view)).toBe(false);
  });

  it('is true when a range extends above, below, left of, or right of the viewport', () => {
    expect(formulaRefsExceedViewport([{ top: 0, left: 1, bottom: 3, right: 2, idx: 0 }], view)).toBe(true);
    expect(formulaRefsExceedViewport([{ top: 3, left: 1, bottom: 20, right: 2, idx: 0 }], view)).toBe(true);
    expect(formulaRefsExceedViewport([{ top: 3, left: 0, bottom: 4, right: 2, idx: 0 }], view)).toBe(true);
    expect(formulaRefsExceedViewport([{ top: 3, left: 1, bottom: 4, right: 4, idx: 0 }], view)).toBe(true);
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
  confirmExportXlsx: async () => true,
  chooseInsertShift: async () => null,
  confirmFlashFill: async () => false,
  chooseFilter: async () => null,
  chooseSort: async () => null,
  promptSheetName: async () => null,
  confirmDeleteSheet: async () => true,
  chooseExportSheet: async () => null,
  confirmReplaceAllWorkbook: async () => true,
  confirmRangeMoveOverwrite: async () => true,
  promptMoveTarget: async () => null,
  confirm: async () => true,
  showMessage: async () => undefined,
  notify: () => undefined,
  openFindBar: () => undefined,
  findNext: () => undefined,
  showAbout: () => undefined,
  showFormulaHelp: () => undefined,
  showSqlQuery: vi.fn(async () => undefined),
  chooseSettings: async () => null,
  chooseTimezone: async () => null,
  chooseDisplayLanguage: async () => null,
  chooseTextColor: async () => null,
  chooseBackgroundColor: async () => null,
  chooseBorders: async () => null,
  chooseNumberFormat: async () => null,
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
