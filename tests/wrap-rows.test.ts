// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * Conditional row-height wrapping in the virtualized grid. jsdom performs no
 * layout and has no 2D canvas, so a deterministic text measurer (10px/char) is
 * injected via `grid.setTextMeasurer`; wrapping is then driven by column
 * widths exactly as it would be by real font metrics in the browser. The
 * visible window's heights are measured synchronously during `refresh`, so the
 * assertions below read them straight back from the DOM.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/app/app-state';
import { Commands, type UiPort } from '../src/app/commands';
import { rangeToTsv } from '../src/core/clipboard';
import { RcsvDocument } from '../src/core/rcsv-document';
import { countVisualLines, rowHeightForLines } from '../src/core/text-wrap';
import { Grid, MAX_WRAP_LINES, ROW_HEIGHT, WRAP_LINE_HEIGHT, WRAP_VERTICAL_PAD } from '../src/ui/grid';
import { doc } from './helpers';

/** Every character is 10px wide, so wrapping is fully deterministic. */
const CHAR = 10;
const measure = (text: string): number => text.length * CHAR;

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
    explainRcsvSave: vi.fn(async () => true),
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

beforeEach(() => {
  document.body.textContent = '';
  // Sticky-first-row persists to localStorage; clear it so one test's sticky
  // setting never leaks into the next (which would move row 0 into the overlay).
  localStorage.clear();
});

interface SetupOptions {
  wrap?: boolean;
  colWidths?: number[];
  sticky?: boolean;
  height?: number;
}

function setup(document_: RcsvDocument | string, opts: SetupOptions = {}) {
  const state = new AppState();
  const commands = new Commands(state, stubUi(), document);
  const grid = new Grid(state, commands);
  Object.defineProperty(grid.element, 'clientHeight', { value: opts.height ?? 520, configurable: true });
  Object.defineProperty(grid.element, 'clientWidth', { value: 900, configurable: true });
  document.body.append(grid.element);
  if (opts.sticky) {
    state.setStickyFirstRow(true);
  }
  if (opts.wrap ?? true) {
    state.setWrapCells(true);
  }
  grid.setTextMeasurer(measure);
  const source = typeof document_ === 'string' ? doc(document_) : document_;
  const name = typeof document_ === 'string' ? 't.csv' : document_.name;
  const tab = state.addTab(name, source, null);
  if (opts.colWidths) {
    tab.colWidths = opts.colWidths.slice();
  }
  grid.refresh();
  return { state, grid, commands, tab };
}

function rowEl(grid: Grid, row: number): HTMLElement {
  return grid.element.querySelector<HTMLElement>(`.vgrid-row[data-row="${row}"]`)!;
}

describe('conditional row-height wrapping', () => {
  it('keeps short rows at the single-line height while wrapping is enabled', () => {
    const { grid } = setup('ab,cd\nef,gh\n');
    for (const el of grid.element.querySelectorAll<HTMLElement>('.vgrid-row')) {
      expect(el.style.height).toBe(`${ROW_HEIGHT}px`);
      expect(el.classList.contains('wrapped')).toBe(false);
    }
  });

  it('grows only the row whose value needs more than one visual line', () => {
    // Column A is 50px (fits 5 chars); "hello world" needs two lines there.
    const { grid } = setup('hello world,x\nshort,y\n', { colWidths: [50, 132] });
    const long = rowEl(grid, 0);
    const short = rowEl(grid, 1);
    const lines = countVisualLines('hello world', measure, 50, MAX_WRAP_LINES);
    expect(lines).toBeGreaterThan(1);
    expect(long.style.height).toBe(
      `${rowHeightForLines(lines, ROW_HEIGHT, WRAP_LINE_HEIGHT, WRAP_VERTICAL_PAD)}px`,
    );
    expect(long.classList.contains('wrapped')).toBe(true);
    // The neighbouring short row is untouched.
    expect(short.style.height).toBe(`${ROW_HEIGHT}px`);
    expect(short.classList.contains('wrapped')).toBe(false);
  });

  it('grows a row with explicit newline characters', () => {
    // A quoted CSV field carrying two explicit line breaks → three lines.
    const { grid } = setup('"a\nb\nc",x\n');
    const el = rowEl(grid, 0);
    expect(el.style.height).toBe(
      `${rowHeightForLines(3, ROW_HEIGHT, WRAP_LINE_HEIGHT, WRAP_VERTICAL_PAD)}px`,
    );
    expect(el.classList.contains('wrapped')).toBe(true);
  });

  it('measures a formula row from its displayed result, not the formula source', () => {
    const d = RcsvDocument.empty('f.rcsv', 1, 2);
    d.setCell(0, 0, 'hello world here now more text');
    d.setCell(0, 1, '=A1');
    d.markSaved();
    // Column A is wide (single line); column B is 50px so the *result* wraps.
    const { grid, tab } = setup(d, { colWidths: [400, 50] });
    const result = tab.doc.getDisplayValue(0, 1);
    const lines = countVisualLines(result, measure, 50, MAX_WRAP_LINES);
    // The formula source "=A1" is only 3 chars and would never wrap; the row is
    // tall solely because the calculated result does.
    expect(lines).toBeGreaterThan(1);
    expect(rowEl(grid, 0).style.height).toBe(
      `${rowHeightForLines(lines, ROW_HEIGHT, WRAP_LINE_HEIGHT, WRAP_VERTICAL_PAD)}px`,
    );
  });

  it('returns a wrapped row to the single-line height when its column is widened', () => {
    const { grid, tab } = setup('hello world,x\n', { colWidths: [50, 132] });
    expect(rowEl(grid, 0).classList.contains('wrapped')).toBe(true);
    // Widen column A so the value fits on one line, then re-render.
    tab.colWidths[0] = 200;
    grid.refresh();
    const el = rowEl(grid, 0);
    expect(el.style.height).toBe(`${ROW_HEIGHT}px`);
    expect(el.classList.contains('wrapped')).toBe(false);
  });

  it('re-measures heights when the sheet font (measurer) changes', () => {
    const { grid } = setup('abcdef,x\n', { colWidths: [80, 132] });
    // At 10px/char "abcdef" is 60px and fits an 80px column → single line.
    expect(rowEl(grid, 0).style.height).toBe(`${ROW_HEIGHT}px`);
    // Switching to a wider font (20px/char) makes it overflow → the row grows.
    grid.setTextMeasurer((text: string) => text.length * 20);
    grid.refresh();
    expect(rowEl(grid, 0).classList.contains('wrapped')).toBe(true);
    expect(Number.parseInt(rowEl(grid, 0).style.height, 10)).toBeGreaterThan(ROW_HEIGHT);
  });

  it('restores uniform single-line heights when wrapping is turned off', () => {
    const { grid, state } = setup('hello world,x\n', { colWidths: [50, 132] });
    expect(rowEl(grid, 0).classList.contains('wrapped')).toBe(true);
    state.setWrapCells(false);
    grid.refresh();
    const el = rowEl(grid, 0);
    expect(el.style.height).toBe(`${ROW_HEIGHT}px`);
    expect(el.classList.contains('wrapped')).toBe(false);
  });

  it('virtualizes a large document with mixed single-line and wrapped rows', async () => {
    const rows = 5000;
    // Every row is short except row 1, which wraps in a narrow column A.
    const lines = Array.from({ length: rows }, (_, r) => (r === 1 ? 'hello world,y' : 'a,b'));
    const { grid, tab } = setup(lines.join('\n') + '\n', { colWidths: [50, 132] });
    // Only the virtualized window is materialized.
    const rendered = grid.element.querySelectorAll('.vgrid-row');
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered.length).toBeLessThan(500);
    // Mixed heights within the window: row 0 single-line, row 1 wrapped.
    expect(rowEl(grid, 0).style.height).toBe(`${ROW_HEIGHT}px`);
    expect(rowEl(grid, 1).classList.contains('wrapped')).toBe(true);
    // Let the off-screen measure pass run; the document stays a valid grid.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(tab.doc.rowCount).toBe(rows);
  });

  it('keeps the pinned sticky first row single-line even with a long value', () => {
    const { grid } = setup('hello world,x\nsecond,y\nthird,z\n', { colWidths: [50, 132], sticky: true });
    // The pinned overlay row stays a stable single-line height…
    const sticky = grid.element.querySelector<HTMLElement>('.vgrid-stickyrow')!;
    expect(sticky.style.height).toBe(`${ROW_HEIGHT}px`);
    expect(sticky.classList.contains('wrapped')).toBe(false);
  });

  it('supports selection, keyboard navigation, and copy across variable-height rows', () => {
    const { grid, state, tab } = setup('hello world,x\nshort,y\nmore text here,z\n', {
      colWidths: [50, 132],
    });
    // Row 0 and row 2 wrap; row 1 does not — a genuinely mixed layout.
    expect(rowEl(grid, 0).classList.contains('wrapped')).toBe(true);
    expect(rowEl(grid, 2).classList.contains('wrapped')).toBe(true);
    // Select a cell in a wrapped row: the outline lands on the right box.
    state.setSelection(tab, { row: 2, col: 0 }, null);
    grid.refreshSelection();
    expect(grid.element.querySelector('[data-row="2"][data-col="0"]')!.classList.contains('selected')).toBe(
      true,
    );
    // Keyboard navigation moves the active cell down through variable heights.
    grid.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    // (Selection started at row 2; ArrowDown clamps at the last row.)
    expect(tab.selection).toEqual({ row: 2, col: 0 });
    grid.select(tab, 0, 0);
    grid.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(tab.selection).toEqual({ row: 1, col: 0 });
    // Copy is unaffected by row heights.
    state.setSelection(tab, { row: 0, col: 0 }, { row: 2, col: 1 });
    expect(rangeToTsv(tab.doc, state.selectedRange(tab)!)).toBe(
      'hello world\tx\nshort\ty\nmore text here\tz',
    );
  });
});
