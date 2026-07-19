// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
    explainRcsvSave: vi.fn(async () => true),
    chooseExportCsv: vi.fn(async () => ({
      encoding: 'utf-8' as const,
      bom: false,
      lineEnding: 'lf' as const,
    })),
    chooseInsertShift: vi.fn(async () => null),
    confirm: vi.fn(async () => true),
    showMessage: asyncNoop,
    notify: noop,
    openFindBar: noop,
    findNext: noop,
    showAbout: noop,
    showFormulaHelp: noop,
    chooseSettings: vi.fn(async () => null),
    setBusy: noop,
  };
}

function grid5x3() {
  const state = new AppState();
  const commands = new Commands(state, stubUi(), document);
  const grid = new Grid(state, commands);
  Object.defineProperty(grid.element, 'clientHeight', { value: 520, configurable: true });
  Object.defineProperty(grid.element, 'clientWidth', { value: 900, configurable: true });
  document.body.append(grid.element);
  const tab = state.addTab('s.csv', doc('a,b,c\nd,e,f\ng,h,i\nj,k,l\nm,n,o\n'), null);
  grid.refresh();
  return { state, grid, tab };
}

function rowHead(grid: Grid, row: number): HTMLElement {
  return grid.element.querySelector<HTMLElement>(`[data-rowhead="${row}"]`)!;
}
function colHead(grid: Grid, col: number): HTMLElement {
  return grid.element.querySelector<HTMLElement>(`[data-colhead="${col}"]`)!;
}
function mousedown(el: HTMLElement, opts: MouseEventInit = {}): void {
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, ...opts }));
}
function mousemove(el: HTMLElement): void {
  el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
}
function mouseup(): void {
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
}

beforeEach(() => {
  document.body.textContent = '';
});

describe('whole-row selection', () => {
  it('clicking a row header selects the entire row', () => {
    const { state, grid, tab } = grid5x3();
    mousedown(rowHead(grid, 1));
    mouseup();
    expect(tab.selectionKind).toBe('row');
    expect(state.selectedRange(tab)).toEqual({ top: 1, bottom: 1, left: 0, right: 2 });
  });

  it('dragging across row headers selects a span of rows', () => {
    const { state, grid, tab } = grid5x3();
    mousedown(rowHead(grid, 1));
    mousemove(rowHead(grid, 3));
    mouseup();
    expect(tab.selectionKind).toBe('row');
    expect(state.selectedRange(tab)).toEqual({ top: 1, bottom: 3, left: 0, right: 2 });
  });

  it('Shift+Click on a row header extends from the anchor row', () => {
    const { state, grid, tab } = grid5x3();
    mousedown(rowHead(grid, 1));
    mouseup();
    mousedown(rowHead(grid, 4), { shiftKey: true });
    mouseup();
    expect(state.selectedRange(tab)).toEqual({ top: 1, bottom: 4, left: 0, right: 2 });
  });
});

describe('whole-column selection', () => {
  it('clicking a column header selects the entire column', () => {
    const { state, grid, tab } = grid5x3();
    mousedown(colHead(grid, 1));
    mouseup();
    expect(tab.selectionKind).toBe('col');
    expect(state.selectedRange(tab)).toEqual({ top: 0, bottom: 4, left: 1, right: 1 });
  });

  it('dragging across column headers selects a span of columns', () => {
    const { state, grid, tab } = grid5x3();
    mousedown(colHead(grid, 0));
    mousemove(colHead(grid, 2));
    mouseup();
    expect(tab.selectionKind).toBe('col');
    expect(state.selectedRange(tab)).toEqual({ top: 0, bottom: 4, left: 0, right: 2 });
  });
});

describe('distinct rendering of selection roles', () => {
  it('marks the active cell, the anchor cell, and the range distinctly', () => {
    const { state, grid, tab } = grid5x3();
    // A cell range from (0,0) anchor to (2,2) active.
    state.setSelection(tab, { row: 2, col: 2 }, { row: 0, col: 0 });
    grid.refreshSelection();
    const active = grid.element.querySelector('[data-row="2"][data-col="2"]')!;
    const anchor = grid.element.querySelector('[data-row="0"][data-col="0"]')!;
    const mid = grid.element.querySelector('[data-row="1"][data-col="1"]')!;
    expect(active.classList.contains('selected')).toBe(true);
    expect(anchor.classList.contains('anchor')).toBe(true);
    expect(anchor.classList.contains('selected')).toBe(false);
    expect(mid.classList.contains('in-range')).toBe(true);
  });

  it('highlights the intersecting headers and flags whole-row selections', () => {
    const { grid } = grid5x3();
    mousedown(rowHead(grid, 2));
    mouseup();
    grid.refreshSelection();
    expect(grid.element.classList.contains('sel-rows')).toBe(true);
    expect(rowHead(grid, 2).classList.contains('hdr-sel')).toBe(true);
    expect(rowHead(grid, 0).classList.contains('hdr-sel')).toBe(false);
  });
});

describe('selection is preserved for downstream operations', () => {
  it('selectedRange feeds copy/fill/statistics unchanged for row selections', () => {
    const { state, grid, tab } = grid5x3();
    mousedown(rowHead(grid, 0));
    mousemove(rowHead(grid, 1));
    mouseup();
    // The range covers both rows and every column, ready for range operations.
    const range = state.selectedRange(tab)!;
    expect((range.bottom - range.top + 1) * (range.right - range.left + 1)).toBe(6);
  });
});
