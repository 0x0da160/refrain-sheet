// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * Touch/pen support for the grid's drag gestures — resize, fill handle,
 * range-move handle, and cell-range selection via a press-and-hold fallback
 * — see issue #290. The handle-anchored drags start immediately on touch,
 * same as a mouse press; plain cell/header drags need a brief hold first so
 * a quick tap (and ordinary scrolling) keep working unchanged.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/app/app-state';
import { Commands, type UiPort } from '../src/app/commands';
import { RsfDocument } from '../src/core/rsf-document';
import { Grid, COL_WIDTH } from '../src/ui/grid';
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
    chooseExportCsv: vi.fn(async () => ({
      encoding: 'utf-8' as const,
      bom: false,
      lineEnding: 'lf' as const,
    })),
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

const VIEW_HEIGHT = 520;
const VIEW_WIDTH = 900;
const LONG_PRESS_MS = 400;

function bigCsv(rows: number, cols: number): string {
  const lines: string[] = [];
  for (let r = 0; r < rows; r++) {
    const parts: string[] = [];
    for (let c = 0; c < cols; c++) {
      parts.push(`r${r}c${c}`);
    }
    lines.push(parts.join(','));
  }
  return lines.join('\n') + '\n';
}

function setupCsv(rows: number, cols: number) {
  const state = new AppState();
  const commands = new Commands(state, stubUi(), document);
  const grid = new Grid(state, commands);
  Object.defineProperty(grid.element, 'clientHeight', { value: VIEW_HEIGHT, configurable: true });
  Object.defineProperty(grid.element, 'clientWidth', { value: VIEW_WIDTH, configurable: true });
  document.body.append(grid.element);
  const tab = state.addTab('big.csv', doc(bigCsv(rows, cols)), null);
  grid.refresh();
  return { state, commands, grid, tab };
}

function setupRsf(rows: number, cols: number) {
  const state = new AppState();
  const commands = new Commands(state, stubUi(), document);
  const grid = new Grid(state, commands);
  Object.defineProperty(grid.element, 'clientHeight', { value: VIEW_HEIGHT, configurable: true });
  Object.defineProperty(grid.element, 'clientWidth', { value: VIEW_WIDTH, configurable: true });
  document.body.append(grid.element);
  const rsf = RsfDocument.empty('book', rows, cols, 'Sheet1');
  rsf.setCell(0, 0, 'x');
  const tab = state.addTab('book.rsf', rsf, null);
  grid.refresh();
  return { state, commands, grid, tab };
}

function cellEl(grid: Grid, row: number, col: number): HTMLElement {
  const cell = grid.element.querySelector<HTMLElement>(`[data-row="${row}"][data-col="${col}"]`);
  expect(cell, `cell ${row},${col} should be rendered`).not.toBeNull();
  return cell!;
}

/** jsdom has no PointerEvent constructor, so a MouseEvent stands in with
 * `pointerId`/`pointerType` grafted on — the only extra properties grid.ts reads. */
function pointerEvent(
  type: string,
  opts: MouseEventInit & { pointerId?: number; pointerType?: string } = {},
): Event {
  const { pointerId = 1, pointerType = 'touch', ...mouseInit } = opts;
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...mouseInit });
  Object.defineProperty(event, 'pointerId', { value: pointerId, configurable: true });
  Object.defineProperty(event, 'pointerType', { value: pointerType, configurable: true });
  return event;
}

type TouchOpts = MouseEventInit & { pointerId?: number; pointerType?: string };

function touchDown(el: HTMLElement, opts: TouchOpts = {}): void {
  el.dispatchEvent(pointerEvent('pointerdown', opts));
}
function touchMove(el: HTMLElement, opts: TouchOpts = {}): void {
  el.dispatchEvent(pointerEvent('pointermove', opts));
}
function touchUp(el: HTMLElement, opts: TouchOpts = {}): void {
  el.dispatchEvent(pointerEvent('pointerup', opts));
}

beforeEach(() => {
  document.body.textContent = '';
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('touch/pointer drag support (#290)', () => {
  it('resizes a column by touch-dragging its resize handle, starting immediately', () => {
    const { grid, tab } = setupCsv(10, 3);
    const handle = grid.element.querySelector<HTMLElement>('[data-colresize="0"]');
    expect(handle).not.toBeNull();
    touchDown(handle!, { clientX: 200 });
    touchMove(grid.element, { clientX: 260 });
    touchUp(grid.element);
    expect(tab.colWidths[0]).toBe(COL_WIDTH + 60);
  });

  it('runs a fill-handle drag by touch, starting immediately', () => {
    const { commands, grid, tab } = setupCsv(10, 3);
    touchDown(cellEl(grid, 0, 0));
    touchUp(grid.element);
    const handle = grid.element.querySelector<HTMLElement>('[data-fillhandle]');
    expect(handle).not.toBeNull();
    touchDown(handle!);
    touchMove(cellEl(grid, 3, 0));
    expect(grid.element.querySelectorAll('.fill-target').length).toBeGreaterThan(0);
    const applyFill = vi.spyOn(commands, 'applyFill');
    touchUp(grid.element);
    expect(applyFill).toHaveBeenCalled();
    void tab;
  });

  it('runs a range-move drag by touch, starting immediately (RSF)', () => {
    const { grid, tab } = setupRsf(10, 4);
    touchDown(cellEl(grid, 0, 0));
    touchUp(grid.element);
    const handle = grid.element.querySelector<HTMLElement>('[data-movehandle]');
    expect(handle).not.toBeNull();
    touchDown(handle!);
    touchMove(cellEl(grid, 2, 2));
    expect(grid.element.classList.contains('moving-range')).toBe(true);
    touchUp(grid.element);
    expect(tab.doc.getDisplayValue(0, 0)).toBe('');
    expect(tab.doc.getDisplayValue(2, 2)).toBe('x');
  });

  it('extends a cell-range selection by touch after a press-and-hold, not on a quick tap', () => {
    const { state, grid, tab } = setupCsv(10, 3);
    touchDown(cellEl(grid, 0, 0));
    // A quick release before the hold completes never arms a drag; a plain
    // tap is left entirely to the browser's own synthetic click, so the
    // selection stays the single cell `addTab` starts on.
    vi.advanceTimersByTime(LONG_PRESS_MS - 50);
    touchUp(grid.element);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    touchMove(cellEl(grid, 2, 0));
    expect(state.selectedRange(tab)).toEqual({ top: 0, left: 0, bottom: 0, right: 0 });
  });

  it('extends a cell-range selection by touch once the press-and-hold completes', () => {
    const { state, grid, tab } = setupCsv(10, 3);
    touchDown(cellEl(grid, 0, 0));
    vi.advanceTimersByTime(LONG_PRESS_MS);
    touchMove(cellEl(grid, 2, 0));
    touchUp(grid.element);
    const range = state.selectedRange(tab);
    expect(range).toEqual({ top: 0, left: 0, bottom: 2, right: 0 });
  });

  it('cancels the pending press-and-hold on real movement, leaving the touch to scroll', () => {
    const { state, grid, tab } = setupCsv(10, 3);
    touchDown(cellEl(grid, 0, 0), { clientX: 0, clientY: 0 });
    // Movement well past the tolerance before the hold completes reads as
    // the start of a scroll and cancels the pending drag.
    touchMove(grid.element, { clientX: 0, clientY: 40 });
    vi.advanceTimersByTime(LONG_PRESS_MS);
    touchMove(cellEl(grid, 2, 0));
    touchUp(grid.element);
    expect(state.selectedRange(tab)).toEqual({ top: 0, left: 0, bottom: 0, right: 0 });
  });

  it('ignores pointer events whose pointerType is "mouse" (the mouse listeners own those)', () => {
    const { state, grid, tab } = setupCsv(10, 3);
    touchDown(cellEl(grid, 0, 0), { pointerType: 'mouse' });
    vi.advanceTimersByTime(LONG_PRESS_MS);
    touchMove(cellEl(grid, 2, 0), { pointerType: 'mouse' });
    touchUp(grid.element, { pointerType: 'mouse' });
    expect(state.selectedRange(tab)).toEqual({ top: 0, left: 0, bottom: 0, right: 0 });
  });
});
