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
    promptDriveName: async () => null,
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
      delimiter: 'keep' as const,
      quoteStyle: 'minimal' as const,
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
    showMarkdownEditor: vi.fn(async () => undefined),
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
const DOUBLE_TAP_MS = 300;

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
    touchDown(cellEl(grid, 0, 0), { clientX: 0, clientY: 0 });
    vi.advanceTimersByTime(LONG_PRESS_MS);
    touchMove(cellEl(grid, 2, 0), { clientX: 0, clientY: 52 });
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

describe('long-press opens the context menu on touch, a right-click equivalent (#406)', () => {
  it('opens the context menu once a press-and-hold completes and lifts with no movement', () => {
    const { grid } = setupCsv(10, 3);
    touchDown(cellEl(grid, 1, 1));
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(document.querySelector('.context-menu')).toBeNull();
    touchUp(grid.element);
    expect(document.querySelector('.context-menu')).not.toBeNull();
  });

  it('does not open the context menu on a quick tap (hold never completes)', () => {
    const { grid } = setupCsv(10, 3);
    touchDown(cellEl(grid, 1, 1));
    vi.advanceTimersByTime(LONG_PRESS_MS - 50);
    touchUp(grid.element);
    expect(document.querySelector('.context-menu')).toBeNull();
  });

  it('does not open the context menu once the completed hold turns into a drag', () => {
    const { grid } = setupCsv(10, 3);
    touchDown(cellEl(grid, 0, 0), { clientX: 0, clientY: 0 });
    vi.advanceTimersByTime(LONG_PRESS_MS);
    touchMove(cellEl(grid, 2, 0), { clientX: 0, clientY: 52 });
    touchUp(grid.element);
    expect(document.querySelector('.context-menu')).toBeNull();
  });

  it("keeps the pending context menu through a held finger's small pointermove jitter (#475)", () => {
    // Real touch input keeps reporting tiny coordinate jitter even while a
    // finger is held still; a completed hold must not read that jitter as
    // the start of a drag and cancel the pending context menu.
    const { grid } = setupCsv(10, 3);
    touchDown(cellEl(grid, 1, 1), { clientX: 100, clientY: 100 });
    vi.advanceTimersByTime(LONG_PRESS_MS);
    touchMove(cellEl(grid, 1, 1), { clientX: 103, clientY: 101 });
    expect(document.querySelector('.context-menu')).toBeNull();
    touchUp(grid.element);
    expect(document.querySelector('.context-menu')).not.toBeNull();
  });

  it('does not open the context menu when the gesture is cancelled instead of lifted', () => {
    const { grid } = setupCsv(10, 3);
    touchDown(cellEl(grid, 1, 1));
    vi.advanceTimersByTime(LONG_PRESS_MS);
    cellEl(grid, 1, 1).dispatchEvent(pointerEvent('pointercancel'));
    expect(document.querySelector('.context-menu')).toBeNull();
  });

  it('opens the context menu for a completed hold on a row header, same as right-click', () => {
    const { grid } = setupCsv(10, 3);
    const rowHead = grid.element.querySelector<HTMLElement>('[data-rowhead="0"]');
    expect(rowHead).not.toBeNull();
    touchDown(rowHead!);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    touchUp(grid.element);
    expect(document.querySelector('.context-menu')).not.toBeNull();
  });
});

describe('double-tap opens the inline editor on touch (#458)', () => {
  it('opens the editor when a second quick tap lands on the same cell within the window', () => {
    const { grid } = setupCsv(10, 3);
    const cell = cellEl(grid, 1, 1);
    touchDown(cell);
    touchUp(cell);
    vi.advanceTimersByTime(DOUBLE_TAP_MS - 50);
    touchDown(cell);
    touchUp(cell);
    expect(grid.element.querySelector('.cell-editor')).not.toBeNull();
  });

  it('does not open the editor when the second tap lands on a different cell', () => {
    const { grid } = setupCsv(10, 3);
    touchDown(cellEl(grid, 1, 1));
    touchUp(cellEl(grid, 1, 1));
    vi.advanceTimersByTime(DOUBLE_TAP_MS - 50);
    touchDown(cellEl(grid, 2, 1));
    touchUp(cellEl(grid, 2, 1));
    expect(grid.element.querySelector('.cell-editor')).toBeNull();
  });

  it('does not open the editor when the second tap arrives after the double-tap window', () => {
    const { grid } = setupCsv(10, 3);
    const cell = cellEl(grid, 1, 1);
    touchDown(cell);
    touchUp(cell);
    vi.advanceTimersByTime(DOUBLE_TAP_MS + 50);
    touchDown(cell);
    touchUp(cell);
    expect(grid.element.querySelector('.cell-editor')).toBeNull();
  });

  it('does not treat a completed press-and-hold release as the first tap of a pair', () => {
    const { grid } = setupCsv(10, 3);
    const cell = cellEl(grid, 1, 1);
    touchDown(cell);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    touchUp(cell);
    vi.advanceTimersByTime(DOUBLE_TAP_MS - 50);
    touchDown(cell);
    touchUp(cell);
    expect(grid.element.querySelector('.cell-editor')).toBeNull();
  });

  it('leaves mouse double-clicks unaffected (existing dblclick path still opens the editor)', () => {
    const { grid } = setupCsv(10, 3);
    const cell = cellEl(grid, 1, 1);
    cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    expect(grid.element.querySelector('.cell-editor')).not.toBeNull();
  });
});

describe('a touch tap-to-select does not pop the on-screen keyboard (#469)', () => {
  /** Spies on the sink's `.focus()` calls, recording whether it was marked
   * `readOnly` — the standard technique for moving DOM focus without
   * triggering a mobile on-screen keyboard — at the moment each call fired. */
  function spyOnSinkFocus(sink: HTMLTextAreaElement): {
    readOnlyAtEachFocus: boolean[];
    restore: () => void;
  } {
    const readOnlyAtEachFocus: boolean[] = [];
    const focusSpy = vi.spyOn(HTMLTextAreaElement.prototype, 'focus').mockImplementation(function (
      this: HTMLTextAreaElement,
    ) {
      if (this === sink) {
        readOnlyAtEachFocus.push(this.readOnly);
      }
    });
    return { readOnlyAtEachFocus, restore: () => focusSpy.mockRestore() };
  }

  it('focuses the sink read-only for a touch tap-to-select, then restores it', () => {
    const { grid } = setupCsv(10, 3);
    const sink = grid.element.querySelector<HTMLTextAreaElement>('textarea.grid-sink')!;
    const { readOnlyAtEachFocus, restore } = spyOnSinkFocus(sink);
    const cell = cellEl(grid, 1, 1);
    touchDown(cell);
    touchUp(cell);
    // The browser's own synthetic mousedown/click compatibility events (not
    // reproduced by the `touchDown`/`touchUp` helpers above, which only
    // dispatch pointer events) are what actually drive plain tap-to-select —
    // see `onMouseDown` and the comment at the top of this file's "Touch /
    // pen" section in grid.ts.
    cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
    expect(readOnlyAtEachFocus).toEqual([true]);
    expect(sink.readOnly).toBe(false);
    restore();
  });

  it('focuses the sink normally (not read-only) for a mouse click', () => {
    const { grid } = setupCsv(10, 3);
    const sink = grid.element.querySelector<HTMLTextAreaElement>('textarea.grid-sink')!;
    const { readOnlyAtEachFocus, restore } = spyOnSinkFocus(sink);
    const cell = cellEl(grid, 1, 1);
    cell.dispatchEvent(pointerEvent('pointerdown', { pointerType: 'mouse' }));
    cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
    expect(readOnlyAtEachFocus).toEqual([false]);
    restore();
  });

  it('still shows the keyboard once a double-tap actually opens the editor', () => {
    const { grid } = setupCsv(10, 3);
    const sink = grid.element.querySelector<HTMLTextAreaElement>('textarea.grid-sink')!;
    const { readOnlyAtEachFocus, restore } = spyOnSinkFocus(sink);
    const cell = cellEl(grid, 1, 1);
    touchDown(cell);
    touchUp(cell);
    vi.advanceTimersByTime(DOUBLE_TAP_MS - 50);
    touchDown(cell);
    touchUp(cell);
    expect(grid.element.querySelector('.cell-editor')).not.toBeNull();
    // The tap-to-select focus this double-tap started with was suppressed,
    // but the final focus call — the one that actually opens the editor —
    // was not, so the on-screen keyboard appears exactly when editing starts.
    expect(readOnlyAtEachFocus.length).toBeGreaterThan(0);
    expect(readOnlyAtEachFocus[readOnlyAtEachFocus.length - 1]).toBe(false);
    restore();
  });

  it('re-shows the keyboard on a real double-tap, where the first tap already focused the sink (#487)', () => {
    // `touchDown`/`touchUp` only dispatch pointer events; a real touch also
    // drives the browser's own synthetic mousedown for each tap (see the
    // comment on the test above), which is what actually focuses the sink
    // read-only after tap one. Reproducing both taps' synthetic mousedown is
    // what exposes the regression: without it, the sink never becomes
    // `document.activeElement` before the second tap opens the editor, so the
    // second tap's `.focus()` call looks like a no-op fix either way.
    const { grid } = setupCsv(10, 3);
    const sink = grid.element.querySelector<HTMLTextAreaElement>('textarea.grid-sink')!;
    const calls: string[] = [];
    const focusSpy = vi.spyOn(HTMLTextAreaElement.prototype, 'focus').mockImplementation(function (
      this: HTMLTextAreaElement,
      ...args: Parameters<HTMLElement['focus']>
    ) {
      if (this === sink) calls.push(`focus:${this.readOnly}`);
      HTMLElement.prototype.focus.apply(this, args);
    });
    const blurSpy = vi.spyOn(HTMLTextAreaElement.prototype, 'blur').mockImplementation(function (
      this: HTMLTextAreaElement,
    ) {
      if (this === sink) calls.push('blur');
      HTMLElement.prototype.blur.call(this);
    });
    const cell = cellEl(grid, 1, 1);
    touchDown(cell);
    touchUp(cell);
    cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
    expect(document.activeElement).toBe(sink);
    vi.advanceTimersByTime(DOUBLE_TAP_MS - 50);
    touchDown(cell);
    touchUp(cell);
    expect(grid.element.querySelector('.cell-editor')).not.toBeNull();
    expect(document.activeElement).toBe(sink);
    // Read-only focus (tap one, suppressed) -> blur -> normal focus (tap two,
    // opens the editor): the blur forces a real focus transition, which is
    // what actually re-shows the on-screen keyboard on a real device.
    expect(calls).toEqual(['focus:true', 'blur', 'focus:false']);
    focusSpy.mockRestore();
    blurSpy.mockRestore();
  });
});
