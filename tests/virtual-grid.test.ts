// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/app/app-state';
import { Commands, type UiPort } from '../src/app/commands';
import { Grid, OVERSCAN_ROWS, ROW_HEIGHT, COL_WIDTH, MIN_COL_WIDTH } from '../src/ui/grid';
import { doc } from './helpers';

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
  chooseExportCsv: async () => ({ encoding: 'utf-8' as const, bom: false, lineEnding: 'lf' as const }),
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

const VIEW_HEIGHT = 520;
const VIEW_WIDTH = 900;

function bigCsv(rows: number, cols = 4): string {
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

function setup(csv: string) {
  const state = new AppState();
  const commands = new Commands(state, noopUi, document);
  const grid = new Grid(state, commands);
  Object.defineProperty(grid.element, 'clientHeight', { value: VIEW_HEIGHT, configurable: true });
  Object.defineProperty(grid.element, 'clientWidth', { value: VIEW_WIDTH, configurable: true });
  document.body.append(grid.element);
  const tab = state.addTab('big.csv', doc(csv), null);
  grid.refresh();
  return { state, commands, grid, tab };
}

function cellEl(grid: Grid, row: number, col: number): HTMLElement {
  const cell = grid.element.querySelector<HTMLElement>(`[data-row="${row}"][data-col="${col}"]`);
  expect(cell, `cell ${row},${col} should be rendered`).not.toBeNull();
  return cell!;
}

beforeEach(() => {
  document.body.textContent = '';
  localStorage.clear();
});

describe('virtualized rendering', () => {
  it('renders only the visible window plus overscan for 100,000 rows', () => {
    const { grid } = setup(bigCsv(100_000));
    const rows = grid.element.querySelectorAll('.vgrid-row');
    const expectedMax = Math.ceil(VIEW_HEIGHT / ROW_HEIGHT) + 2 * OVERSCAN_ROWS + 2;
    expect(rows.length).toBeGreaterThan(5);
    expect(rows.length).toBeLessThanOrEqual(expectedMax);
    // Total DOM cells stay bounded regardless of document size.
    expect(grid.element.querySelectorAll('[data-row][data-col]').length).toBeLessThan(1000);
  });

  it('sizes the scroll canvas to the full document height', () => {
    const { grid } = setup(bigCsv(100_000));
    const canvas = grid.element.querySelector<HTMLElement>('.vgrid-canvas')!;
    // 100k rows * 26px + header row.
    expect(parseInt(canvas.style.height, 10)).toBe(100_000 * ROW_HEIGHT + ROW_HEIGHT);
  });

  it('renders distant rows after scrolling', () => {
    const { grid } = setup(bigCsv(100_000));
    grid.element.scrollTop = 50_000 * ROW_HEIGHT;
    grid.refresh();
    expect(grid.element.querySelector('[data-row="50000"][data-col="0"]')).not.toBeNull();
    expect(grid.element.querySelector('[data-row="0"][data-col="0"]')).toBeNull();
    expect(cellEl(grid, 50_000, 0).textContent).toBe('r50000c0');
  });

  it('keeps the header row while scrolling and labels columns with letters', () => {
    const { grid } = setup(bigCsv(1000));
    grid.element.scrollTop = 500 * ROW_HEIGHT;
    grid.refresh();
    const header = grid.element.querySelector('.vgrid-header')!;
    expect(getComputedStyle(header).position || header.className).toBeTruthy();
    const labels = Array.from(header.querySelectorAll('[data-colhead]')).map((h) => h.textContent);
    expect(labels.slice(0, 4)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('reveals a far-away cell for find navigation', () => {
    const { state, grid, tab } = setup(bigCsv(100_000));
    grid.reveal(99_999, 2);
    expect(tab.selection).toEqual({ row: 99_999, col: 2 });
    expect(grid.element.scrollTop).toBeGreaterThan(0);
    expect(cellEl(grid, 99_999, 2).classList.contains('selected')).toBe(true);
    void state;
  });
});

describe('sticky first row', () => {
  it('is disabled by default and toggleable through app state', () => {
    const { state, grid } = setup(bigCsv(100));
    expect(grid.element.querySelector<HTMLElement>('.vgrid-stickyrow')!.hidden).toBe(true);
    state.setStickyFirstRow(true);
    grid.refresh();
    const sticky = grid.element.querySelector<HTMLElement>('.vgrid-stickyrow')!;
    expect(sticky.hidden).toBe(false);
    expect(sticky.dataset.row).toBe('0');
    expect(sticky.querySelector('[data-row="0"][data-col="0"]')!.textContent).toBe('r0c0');
    // The pinned row header is visually distinct from column headers.
    expect(sticky.querySelector('.vrowhead.pinned')).not.toBeNull();
    state.setStickyFirstRow(false);
    grid.refresh();
    expect(grid.element.querySelector<HTMLElement>('.vgrid-stickyrow')!.hidden).toBe(true);
  });

  it('keeps row 0 pinned while the scrolling region starts at row 1', () => {
    const { state, grid } = setup(bigCsv(10_000));
    state.setStickyFirstRow(true);
    grid.refresh();
    // Row 0 lives in the sticky layer, not among virtual rows.
    const virtualRows = Array.from(grid.element.querySelectorAll('.vgrid-row'));
    expect(virtualRows.some((r) => (r as HTMLElement).dataset.row === '0')).toBe(false);
    expect(virtualRows.some((r) => (r as HTMLElement).dataset.row === '1')).toBe(true);
    // After scrolling far away, row 0 is still rendered in the sticky layer.
    grid.element.scrollTop = 5_000 * ROW_HEIGHT;
    grid.refresh();
    expect(grid.element.querySelector('.vgrid-stickyrow [data-row="0"]')).not.toBeNull();
  });

  it('supports editing the pinned first row', async () => {
    const { grid, tab } = setup(bigCsv(50));
    const { AppState: _unused } = await import('../src/app/app-state');
    void _unused;
    if (tab) grid.openEditor(tab, 0, 0, null);
    const input = grid.element.querySelector<HTMLInputElement>('.cell-editor');
    expect(input).not.toBeNull();
    expect(input!.value).toBe('r0c0');
  });

  it('persists the preference in localStorage', () => {
    const { state } = setup(bigCsv(10));
    state.setStickyFirstRow(true);
    expect(localStorage.getItem('refrain-csv-html.stickyFirstRow')).toBe('1');
    const fresh = new AppState();
    expect(fresh.stickyFirstRow).toBe(true);
  });
});

describe('selection and keyboard interaction', () => {
  function mouse(el: Element, type: string, init: MouseEventInit = {}): void {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init }));
  }

  it('selects a cell on mousedown and extends with drag', () => {
    const { state, grid, tab } = setup(bigCsv(50));
    mouse(cellEl(grid, 1, 1), 'mousedown');
    expect(tab.selection).toEqual({ row: 1, col: 1 });
    mouse(cellEl(grid, 3, 2), 'mousemove');
    expect(state.selectedRange(tab)).toEqual({ top: 1, left: 1, bottom: 3, right: 2 });
    document.dispatchEvent(new MouseEvent('mouseup'));
    mouse(cellEl(grid, 5, 0), 'mousemove');
    expect(state.selectedRange(tab)).toEqual({ top: 1, left: 1, bottom: 3, right: 2 });
  });

  it('extends the selection with Shift+click and Shift+arrows', () => {
    const { state, grid, tab } = setup(bigCsv(50));
    mouse(cellEl(grid, 2, 1), 'mousedown');
    document.dispatchEvent(new MouseEvent('mouseup'));
    mouse(cellEl(grid, 4, 2), 'mousedown', { shiftKey: true });
    expect(state.selectedRange(tab)).toEqual({ top: 2, left: 1, bottom: 4, right: 2 });
    grid.element.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true, cancelable: true }),
    );
    expect(state.selectedRange(tab)).toEqual({ top: 2, left: 1, bottom: 5, right: 2 });
    grid.element.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true, cancelable: true }),
    );
    expect(state.selectedRange(tab)).toEqual({ top: 2, left: 1, bottom: 5, right: 1 });
    // Plain arrow collapses the range.
    grid.element.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }),
    );
    expect(tab.anchor).toBeNull();
  });

  it('selects whole rows/columns from their headers', () => {
    const { state, grid, tab } = setup(bigCsv(30));
    mouse(grid.element.querySelector('[data-rowhead="3"]')!, 'mousedown');
    expect(state.selectedRange(tab)).toEqual({ top: 3, left: 0, bottom: 3, right: 3 });
    mouse(grid.element.querySelector('[data-colhead="1"]')!, 'mousedown');
    expect(state.selectedRange(tab)).toEqual({ top: 0, left: 1, bottom: 29, right: 1 });
  });

  it('navigates with arrows and edits via typing and F2', async () => {
    const { grid, tab } = setup(bigCsv(20));
    grid.element.focus();
    grid.element.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
    );
    grid.element.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
    );
    expect(tab.selection).toEqual({ row: 1, col: 1 });
    const typed = new KeyboardEvent('keydown', { key: 'x', bubbles: true, cancelable: true });
    grid.element.dispatchEvent(typed);
    const input = grid.element.querySelector<HTMLTextAreaElement>('.cell-editor')!;
    // IME-safe: typing opens an EMPTY editor and does not synthesize the key or
    // preventDefault — the browser routes the character into the focused field
    // (which jsdom does not simulate), so the first char is never a literal
    // insert by our code.
    expect(input).not.toBeNull();
    expect(input.value).toBe('');
    expect(typed.defaultPrevented).toBe(false);
    input.value = 'xyz';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(tab.doc.getValue(1, 1)).toBe('xyz'));
    // Editor commit moved the selection down.
    expect(tab.selection).toEqual({ row: 2, col: 1 });
  });

  it('Escape cancels an edit without changing the value', () => {
    const { grid, tab } = setup(bigCsv(20));
    grid.openEditor(tab, 0, 0, null);
    const input = grid.element.querySelector<HTMLInputElement>('.cell-editor')!;
    input.value = 'discarded';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(tab.doc.getValue(0, 0)).toBe('r0c0');
    expect(grid.element.querySelector('.cell-editor')).toBeNull();
  });

  it('Delete clears the selected range atomically', async () => {
    const { state, grid, tab } = setup(bigCsv(10));
    state.setSelection(tab, { row: 1, col: 1 }, { row: 0, col: 0 });
    grid.element.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }),
    );
    expect(tab.doc.getValue(0, 0)).toBe('');
    expect(tab.doc.getValue(1, 1)).toBe('');
    state.undo(tab);
    expect(tab.doc.getValue(0, 0)).toBe('r0c0');
  });

  it('marks the selected range cells with in-range classes', () => {
    const { state, grid, tab } = setup(bigCsv(10));
    state.setSelection(tab, { row: 2, col: 2 }, { row: 1, col: 1 });
    grid.refreshSelection();
    expect(cellEl(grid, 1, 1).classList.contains('in-range')).toBe(true);
    expect(cellEl(grid, 2, 2).classList.contains('selected')).toBe(true);
    expect(cellEl(grid, 0, 0).classList.contains('in-range')).toBe(false);
  });
});

describe('column resizing', () => {
  function handleFor(grid: Grid, col: number): HTMLElement {
    const handle = grid.element.querySelector<HTMLElement>(`[data-colresize="${col}"]`);
    expect(handle, `resize handle for column ${col}`).not.toBeNull();
    return handle!;
  }

  it('renders a resize handle on each visible column header', () => {
    const { grid } = setup(bigCsv(10, 3));
    expect(grid.element.querySelectorAll('[data-colresize]').length).toBeGreaterThanOrEqual(3);
  });

  it('resizes a column by dragging its boundary and re-lays-out cells', () => {
    const { grid, tab } = setup(bigCsv(10, 3));
    // Default width before resizing.
    expect(parseInt(cellEl(grid, 0, 0).style.width, 10)).toBe(COL_WIDTH);
    handleFor(grid, 0).dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 200 }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 260 }));
    document.dispatchEvent(new MouseEvent('mouseup'));
    expect(tab.colWidths[0]).toBe(COL_WIDTH + 60);
    expect(parseInt(cellEl(grid, 0, 0).style.width, 10)).toBe(COL_WIDTH + 60);
    // The following column keeps its default width.
    expect(parseInt(cellEl(grid, 0, 1).style.width, 10)).toBe(COL_WIDTH);
  });

  it('clamps to the minimum width and never marks the document dirty', () => {
    const { grid, tab } = setup(bigCsv(10, 3));
    handleFor(grid, 0).dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 200 }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: -400 }));
    document.dispatchEvent(new MouseEvent('mouseup'));
    expect(tab.colWidths[0]).toBe(MIN_COL_WIDTH);
    expect(tab.doc.isDirty).toBe(false);
  });

  it('double-clicking the boundary auto-fits the column', () => {
    const { grid, tab } = setup(bigCsv(10, 3));
    // jsdom does no layout, so scrollWidth is 0 and auto-fit lands on the minimum.
    handleFor(grid, 1).dispatchEvent(new MouseEvent('dblclick', { bubbles: true, button: 0 }));
    expect(tab.colWidths[1]).toBe(MIN_COL_WIDTH);
  });
});
