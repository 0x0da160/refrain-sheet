// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * Live auto-height while typing (see `EditSession.updateEditGrowth`). A line
 * break, or a pasted multi-line value, in the inline cell editor grows the
 * row to the lines its text takes, up to the shared `MAX_WRAP_LINES` cap, and
 * shrinks back as lines go. Only the row's height moves while the cell is
 * being edited; the document is written on commit, as before.
 *
 * jsdom performs no layout and has no 2D canvas, so the same deterministic
 * 10px-per-character measurer as `wrap-rows.test.ts` is injected.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { AppState } from '../../src/app/state';
import { Commands, type UiPort } from '../../src/app/commands';
import { setAutoGrowCells } from '../../src/app/settings';
import { RsfDocument } from '../../src/core/workbook/rsf-document';
import { rowHeightForLines } from '../../src/core/text-wrap';
import { Grid, MAX_WRAP_LINES, ROW_HEIGHT, WRAP_LINE_HEIGHT, WRAP_VERTICAL_PAD } from '../../src/ui/grid';
import { doc } from '../helpers';

/** Every character is 10px wide, so wrapping is fully deterministic. */
const CHAR = 10;
const measure = (text: string): number => text.length * CHAR;

/** The row height, as the grid writes it, for a row whose text takes `lines` lines. */
function heightOf(lines: number): string {
  return `${rowHeightForLines(lines, ROW_HEIGHT, WRAP_LINE_HEIGHT, WRAP_VERTICAL_PAD)}px`;
}

function setup(csv = 'ab,cd\nef,gh\n', wrap = false) {
  const state = new AppState();
  // No test here opens a dialog, so the UI port is never called.
  const commands = new Commands(state, {} as UiPort, document);
  const grid = new Grid(state, commands);
  Object.defineProperty(grid.element, 'clientHeight', { value: 520, configurable: true });
  Object.defineProperty(grid.element, 'clientWidth', { value: 900, configurable: true });
  document.body.append(grid.element);
  state.subscribe((event) => (event === 'selection' ? grid.refreshSelection() : grid.refresh()));
  state.setWrapCells(wrap);
  grid.setTextMeasurer(measure);
  const tab = state.addTab('t.csv', doc(csv), null);
  grid.refresh();
  return { state, grid, commands, tab };
}

/** Put `text` into the open inline editor the way the browser does: new value, then an input event. */
function typeInEditor(grid: Grid, text: string): HTMLTextAreaElement {
  const input = grid.element.querySelector<HTMLTextAreaElement>('.cell-editor')!;
  input.value = text;
  input.dispatchEvent(new Event('input'));
  return input;
}

function keyInEditor(grid: Grid, init: KeyboardEventInit & { key: string }): void {
  grid.element
    .querySelector<HTMLTextAreaElement>('.cell-editor')!
    .dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
}

function rowEl(grid: Grid, row: number): HTMLElement {
  // Row 1 follows the scroll in the pinned layer; the rest are virtualized rows.
  return grid.element.querySelector<HTMLElement>(`[role="row"][data-row="${row}"]`)!;
}

beforeEach(() => {
  document.body.textContent = '';
  localStorage.clear();
});

describe('cell height while typing', () => {
  it('a typed line break grows the row to its lines, and the edit is not yet committed', () => {
    const { grid, tab } = setup();
    grid.openEditor(tab, 0, 0, null);
    expect(rowEl(grid, 0).style.height).toBe(`${ROW_HEIGHT}px`);
    const input = typeInEditor(grid, 'ab\ncd');
    expect(rowEl(grid, 0).style.height).toBe(heightOf(2));
    expect(rowEl(grid, 0).classList.contains('wrapped')).toBe(true);
    expect(input.classList.contains('grown')).toBe(true);
    expect(tab.doc.getValue(0, 0)).toBe('ab');
  });

  it('a pasted multi-line value grows the row like typed lines do', () => {
    const { grid, tab } = setup();
    grid.openEditor(tab, 0, 0, '');
    typeInEditor(grid, 'one\ntwo\nthree');
    expect(rowEl(grid, 0).style.height).toBe(heightOf(3));
  });

  it('stops at the same line cap a wrapped row has', () => {
    const { grid, tab } = setup();
    grid.openEditor(tab, 0, 0, null);
    typeInEditor(grid, `a${'\nb'.repeat(MAX_WRAP_LINES + 5)}`);
    expect(rowEl(grid, 0).style.height).toBe(heightOf(MAX_WRAP_LINES));
  });

  it('shrinks back as lines are removed', () => {
    const { grid, tab } = setup();
    grid.openEditor(tab, 0, 0, null);
    typeInEditor(grid, 'a\nb\nc');
    expect(rowEl(grid, 0).style.height).toBe(heightOf(3));
    typeInEditor(grid, 'a');
    expect(rowEl(grid, 0).style.height).toBe(`${ROW_HEIGHT}px`);
    expect(rowEl(grid, 0).classList.contains('wrapped')).toBe(false);
  });

  it('Escape cancels the edit and restores the single-line row', () => {
    const { grid, tab } = setup();
    grid.openEditor(tab, 0, 0, null);
    typeInEditor(grid, 'a\nb');
    expect(rowEl(grid, 0).style.height).toBe(heightOf(2));
    keyInEditor(grid, { key: 'Escape' });
    expect(grid.element.querySelector('.cell-editor')).toBeNull();
    expect(rowEl(grid, 0).style.height).toBe(`${ROW_HEIGHT}px`);
    expect(tab.doc.getValue(0, 0)).toBe('ab');
  });

  it('committing keeps the lines, and the row stays as tall as its text', () => {
    const { grid, tab } = setup();
    grid.openEditor(tab, 0, 0, null);
    typeInEditor(grid, 'a\nb');
    keyInEditor(grid, { key: 'Enter', ctrlKey: true });
    expect(tab.doc.getValue(0, 0)).toBe('a\nb');
    expect(rowEl(grid, 0).style.height).toBe(heightOf(2));
  });

  it('with wrapping off, a long line is shown clipped and the row keeps its height', () => {
    const { grid, tab } = setup();
    grid.openEditor(tab, 0, 0, null);
    typeInEditor(grid, 'x'.repeat(20)); // 200px, wider than the 104px column
    expect(rowEl(grid, 0).style.height).toBe(`${ROW_HEIGHT}px`);
  });

  it('with wrapping on, text that wraps at the column width grows the row', () => {
    const { grid, tab } = setup('ab,cd\nef,gh\n', true);
    grid.openEditor(tab, 0, 0, null);
    typeInEditor(grid, 'x'.repeat(20));
    expect(rowEl(grid, 0).style.height).toBe(heightOf(2));
  });

  it('defers the growth until an IME composition ends', () => {
    const { grid, tab } = setup();
    grid.openEditor(tab, 0, 0, null);
    const input = grid.element.querySelector<HTMLTextAreaElement>('.cell-editor')!;
    input.dispatchEvent(new Event('compositionstart'));
    typeInEditor(grid, 'a\nb');
    expect(rowEl(grid, 0).style.height).toBe(`${ROW_HEIGHT}px`);
    input.dispatchEvent(new Event('compositionend'));
    expect(rowEl(grid, 0).style.height).toBe(heightOf(2));
  });

  it('does nothing when the Settings preference turns it off', () => {
    setAutoGrowCells(false);
    const { grid, tab } = setup();
    grid.openEditor(tab, 0, 0, null);
    const input = typeInEditor(grid, 'a\nb\nc');
    expect(rowEl(grid, 0).style.height).toBe(`${ROW_HEIGHT}px`);
    expect(input.classList.contains('grown')).toBe(false);
  });

  it('never overrides a row height the person set', () => {
    const state = new AppState();
    const commands = new Commands(state, {} as UiPort, document);
    const grid = new Grid(state, commands);
    Object.defineProperty(grid.element, 'clientHeight', { value: 520, configurable: true });
    Object.defineProperty(grid.element, 'clientWidth', { value: 900, configurable: true });
    document.body.append(grid.element);
    state.subscribe((event) => (event === 'selection' ? grid.refreshSelection() : grid.refresh()));
    grid.setTextMeasurer(measure);
    const rsf = RsfDocument.empty('t.rsf', 6, 3);
    const tab = state.addTab('t.rsf', rsf, null);
    grid.refresh();
    commands.setRowHeight(tab, [2], 60);
    grid.openEditor(tab, 2, 0, null);
    typeInEditor(grid, 'a\nb\nc');
    expect(rowEl(grid, 2).style.height).toBe('60px');
    expect(rowEl(grid, 2).classList.contains('wrapped')).toBe(false);
  });
});
