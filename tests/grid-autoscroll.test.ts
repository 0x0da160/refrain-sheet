// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * Dragging past the grid's visible edge (range selection, the fill handle,
 * column resize, and range-move) should nudge the viewport toward the
 * pointer until it re-enters the grid — see issue #285.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/app/app-state';
import { Commands, type UiPort } from '../src/app/commands';
import { RsfDocument } from '../src/core/rsf-document';
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
// Matches the grid's own AUTO_SCROLL_EDGE_PX/INTERVAL so a mousemove just
// past the edge reliably starts nudging within a couple of ticks.
const BEYOND_EDGE = 40;
const TICK_MS = 60;

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
  mockLaidOutRect(grid);
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
  const tab = state.addTab('book.rsf', rsf, null);
  grid.refresh();
  mockLaidOutRect(grid);
  return { state, commands, grid, tab };
}

/** A zero-size rect (jsdom's default, no real layout) never triggers auto-scroll. */
function mockLaidOutRect(grid: Grid): void {
  vi.spyOn(grid.element, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    right: VIEW_WIDTH,
    bottom: VIEW_HEIGHT,
    width: VIEW_WIDTH,
    height: VIEW_HEIGHT,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
}

/** Always resolves to the last row currently rendered in column 0 — i.e. the
 * cell nearest the bottom edge — mimicking a pointer parked just past it. */
function stubElementFromPointNearBottom(grid: Grid): void {
  document.elementFromPoint = ((): Element | null => {
    const cells = grid.element.querySelectorAll<HTMLElement>('[data-row][data-col="0"]');
    return cells.length > 0 ? cells[cells.length - 1] : null;
  }) as typeof document.elementFromPoint;
}

/** Always resolves to the rightmost currently rendered cell in row 0. */
function stubElementFromPointNearRight(grid: Grid): void {
  document.elementFromPoint = ((): Element | null => {
    const cells = grid.element.querySelectorAll<HTMLElement>('[data-row="0"][data-col]');
    return cells.length > 0 ? cells[cells.length - 1] : null;
  }) as typeof document.elementFromPoint;
}

function cellEl(grid: Grid, row: number, col: number): HTMLElement {
  const cell = grid.element.querySelector<HTMLElement>(`[data-row="${row}"][data-col="${col}"]`);
  expect(cell, `cell ${row},${col} should be rendered`).not.toBeNull();
  return cell!;
}

function mousedown(el: HTMLElement, opts: MouseEventInit = {}): void {
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, ...opts }));
}
function moveAt(clientX: number, clientY: number): void {
  document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX, clientY }));
}
function mouseup(): void {
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
}

beforeEach(() => {
  document.body.textContent = '';
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.elementFromPoint = undefined as unknown as typeof document.elementFromPoint;
});

describe('drag auto-scroll past the grid edge', () => {
  it('extends a range selection and scrolls down while the pointer holds past the bottom edge', () => {
    const { state, grid, tab } = setupCsv(500, 4);
    stubElementFromPointNearBottom(grid);
    mousedown(cellEl(grid, 0, 0));
    expect(tab.selection).toEqual({ row: 0, col: 0 });

    moveAt(VIEW_WIDTH / 2, VIEW_HEIGHT + BEYOND_EDGE);
    vi.advanceTimersByTime(TICK_MS * 20);

    expect(grid.element.scrollTop).toBeGreaterThan(0);
    const range = state.selectedRange(tab);
    expect(range).not.toBeNull();
    expect(range!.bottom).toBeGreaterThan(10);

    mouseup();
  });

  it('stops scrolling once the pointer returns inside the grid', () => {
    const { grid } = setupCsv(500, 4);
    stubElementFromPointNearBottom(grid);
    mousedown(cellEl(grid, 0, 0));

    moveAt(VIEW_WIDTH / 2, VIEW_HEIGHT + BEYOND_EDGE);
    vi.advanceTimersByTime(TICK_MS * 5);
    const scrolledSoFar = grid.element.scrollTop;
    expect(scrolledSoFar).toBeGreaterThan(0);

    moveAt(VIEW_WIDTH / 2, 100); // back inside the viewport
    vi.advanceTimersByTime(TICK_MS * 20);
    expect(grid.element.scrollTop).toBe(scrolledSoFar);

    mouseup();
  });

  it('stops scrolling once the drag ends on mouseup', () => {
    const { grid } = setupCsv(500, 4);
    stubElementFromPointNearBottom(grid);
    mousedown(cellEl(grid, 0, 0));

    moveAt(VIEW_WIDTH / 2, VIEW_HEIGHT + BEYOND_EDGE);
    vi.advanceTimersByTime(TICK_MS * 5);
    const scrolledSoFar = grid.element.scrollTop;
    expect(scrolledSoFar).toBeGreaterThan(0);

    mouseup();
    vi.advanceTimersByTime(TICK_MS * 20);
    expect(grid.element.scrollTop).toBe(scrolledSoFar);
  });

  it('extends the fill preview and scrolls down while dragging the fill handle past the bottom edge', () => {
    const { commands, grid, tab } = setupCsv(500, 4);
    // Select A1 so the fill handle renders on its corner.
    mousedown(cellEl(grid, 0, 0));
    mouseup();
    const handle = grid.element.querySelector<HTMLElement>('[data-fillhandle]');
    expect(handle).not.toBeNull();
    stubElementFromPointNearBottom(grid);
    mousedown(handle!);

    moveAt(VIEW_WIDTH / 2, VIEW_HEIGHT + BEYOND_EDGE);
    vi.advanceTimersByTime(TICK_MS * 20);
    expect(grid.element.scrollTop).toBeGreaterThan(0);

    const applyFill = vi.spyOn(commands, 'applyFill');
    mouseup();
    expect(applyFill).toHaveBeenCalledTimes(1);
    const dest = applyFill.mock.calls[0][2];
    expect(dest.bottom).toBeGreaterThan(10);
    void tab;
  });

  it('scrolls right and continues a range-move drag while the pointer holds past the right edge', () => {
    const { commands, grid, tab } = setupRsf(20, 300);
    // Select A1 so the move handle renders on its corner.
    mousedown(cellEl(grid, 0, 0));
    mouseup();
    const handle = grid.element.querySelector<HTMLElement>('[data-movehandle]');
    expect(handle).not.toBeNull();
    stubElementFromPointNearRight(grid);
    mousedown(handle!);

    moveAt(VIEW_WIDTH + BEYOND_EDGE, VIEW_HEIGHT / 2);
    vi.advanceTimersByTime(TICK_MS * 20);
    expect(grid.element.scrollLeft).toBeGreaterThan(0);

    const moveRange = vi.spyOn(commands, 'moveRange');
    mouseup();
    expect(moveRange).toHaveBeenCalledTimes(1);
    const deltaCol = moveRange.mock.calls[0][3];
    expect(deltaCol).toBeGreaterThan(5);
    void tab;
  });

  it('scrolls right while a column resize drag holds past the right edge', () => {
    const { grid, tab } = setupCsv(20, 300);
    const handle = grid.element.querySelector<HTMLElement>('[data-colresize="0"]');
    expect(handle).not.toBeNull();
    mousedown(handle!, { clientX: 100 });

    moveAt(VIEW_WIDTH + BEYOND_EDGE, VIEW_HEIGHT / 2);
    vi.advanceTimersByTime(TICK_MS * 10);

    expect(grid.element.scrollLeft).toBeGreaterThan(0);
    // Width tracks the raw pointer distance from where the drag started, so
    // it keeps following the resize handle even as the view scrolls under it.
    expect(tab.colWidths[0]).toBeGreaterThan(100);

    mouseup();
  });

  it('never scrolls when the grid has no real layout (e.g. hidden, or an unmocked test)', () => {
    const state = new AppState();
    const commands = new Commands(state, stubUi(), document);
    const grid = new Grid(state, commands);
    Object.defineProperty(grid.element, 'clientHeight', { value: VIEW_HEIGHT, configurable: true });
    Object.defineProperty(grid.element, 'clientWidth', { value: VIEW_WIDTH, configurable: true });
    document.body.append(grid.element);
    state.addTab('big.csv', doc(bigCsv(500, 4)), null);
    grid.refresh();
    // getBoundingClientRect is left at jsdom's zero-size default.
    stubElementFromPointNearBottom(grid);
    mousedown(cellEl(grid, 0, 0));

    moveAt(VIEW_WIDTH / 2, VIEW_HEIGHT + BEYOND_EDGE);
    vi.advanceTimersByTime(TICK_MS * 20);

    expect(grid.element.scrollTop).toBe(0);
    mouseup();
  });
});
