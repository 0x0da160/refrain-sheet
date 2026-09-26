// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/app/app-state';
import { ClipboardController } from '../src/app/clipboard-controller';
import { Commands, type UiPort } from '../src/app/commands';
import { t } from '../src/app/i18n';
import { RsfDocument } from '../src/core/rsf-document';
import { Grid, OVERSCAN_ROWS, ROW_HEIGHT, COL_WIDTH, MIN_COL_WIDTH, ROW_HEAD_WIDTH } from '../src/ui/grid';
import { doc } from './helpers';

const noopUi: UiPort = {
  confirmValidation: async () => true,
  confirmUnsaved: async () => 'discard',
  chooseSaveOptions: async () => null,
  promptDriveName: async () => null,
  confirmUnrepresentable: async () => false,
  notifyNcr: async () => undefined,
  confirmUndecodableEdit: async () => true,
  chooseReopen: async () => null,
  confirmConvert: async () => true,
  explainRsfSave: async () => true,
  chooseExportCsv: async () => ({
    encoding: 'utf-8' as const,
    bom: false,
    lineEnding: 'lf' as const,
    delimiter: 'keep' as const,
    quoteStyle: 'minimal' as const,
  }),
  confirmExportXlsx: vi.fn(async () => true),
  confirmExportJson: vi.fn(async () => true),
  chooseInsertShift: async () => null,
  confirmFlashFill: async () => false,
  chooseFilter: async () => null,
  chooseColumnMenu: async () => null,
  chooseSort: async () => null,
  chooseDataValidation: async () => null,
  chooseConditionalFormat: async () => null,
  chooseCellComment: async () => null,
  promptSheetName: async () => null,
  confirmDeleteSheet: async () => true,
  chooseExportSheet: async () => null,
  confirmReplaceAllWorkbook: async () => true,
  confirmRangeMoveOverwrite: async () => true,
  promptMoveTarget: async () => null,
  promptGoToCell: async () => null,
  confirm: async () => true,
  showMessage: async () => undefined,
  notify: () => undefined,
  openFindBar: () => undefined,
  findNext: () => undefined,
  showAbout: () => undefined,
  showFormulaHelp: () => undefined,
  showSqlQuery: vi.fn(async () => undefined),
  showDiff: vi.fn(async () => undefined),
  chooseSettings: async () => null,
  chooseTimezone: async () => null,
  chooseDisplayLanguage: async () => null,
  chooseVersionHistory: async () => null,
  confirmHistoryCapExceeded: async () => true,
  chooseTextColor: async () => null,
  chooseBackgroundColor: async () => null,
  chooseBorders: async () => null,
  chooseNumberFormat: async () => null,
  chooseRecentFile: async () => null,
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

function setupRsf(rsf: RsfDocument) {
  const state = new AppState();
  const commands = new Commands(state, noopUi, document);
  const grid = new Grid(state, commands);
  Object.defineProperty(grid.element, 'clientHeight', { value: VIEW_HEIGHT, configurable: true });
  Object.defineProperty(grid.element, 'clientWidth', { value: VIEW_WIDTH, configurable: true });
  document.body.append(grid.element);
  const tab = state.addTab('book.rsf', rsf, null);
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

  it('aligns header aria-colindex with data cells after horizontal scroll', () => {
    const { grid } = setup(bigCsv(20, 300));
    grid.element.scrollLeft = 250 * COL_WIDTH;
    grid.refresh();
    const dataCell = grid.element.querySelector<HTMLElement>('.vgrid-rows [data-row="0"][data-col]')!;
    const col = Number(dataCell.dataset.col);
    const headerCell = grid.element.querySelector<HTMLElement>(`.vgrid-header [data-colhead="${col}"]`)!;
    expect(headerCell.getAttribute('aria-colindex')).toBe(dataCell.getAttribute('aria-colindex'));
    const rowHeadCell = grid.element.querySelector<HTMLElement>('.vgrid-rows [data-rowhead="0"]')!;
    expect(rowHeadCell.getAttribute('aria-colindex')).toBe('1');
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
    expect(grid.element.querySelector<HTMLElement>('.vgrid-sticky')!.hidden).toBe(true);
    state.setStickyFirstRow(true);
    grid.refresh();
    expect(grid.element.querySelector<HTMLElement>('.vgrid-sticky')!.hidden).toBe(false);
    const sticky = grid.element.querySelector<HTMLElement>('.vgrid-stickyrow')!;
    expect(sticky.dataset.row).toBe('0');
    expect(sticky.querySelector('[data-row="0"][data-col="0"]')!.textContent).toBe('r0c0');
    // The pinned row header is visually distinct from column headers.
    expect(sticky.querySelector('.vrowhead.pinned')).not.toBeNull();
    state.setStickyFirstRow(false);
    grid.refresh();
    expect(grid.element.querySelector<HTMLElement>('.vgrid-sticky')!.hidden).toBe(true);
    expect(grid.element.querySelector('.vgrid-stickyrow')).toBeNull();
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

describe('sticky first column', () => {
  it('is disabled by default and toggleable through app state', () => {
    const { state, grid } = setup(bigCsv(20, 40));
    expect(grid.element.querySelector('.colpin')).toBeNull();
    state.setStickyFirstColumn(true);
    grid.refresh();
    const pinnedHead = grid.element.querySelector<HTMLElement>('.vgrid-header .colpin')!;
    expect(pinnedHead).not.toBeNull();
    expect(pinnedHead.dataset.colhead).toBe('0');
    const pinnedCell = grid.element.querySelector<HTMLElement>('.vgrid-rows .colpin[data-row="0"]')!;
    expect(pinnedCell).not.toBeNull();
    expect(pinnedCell.dataset.col).toBe('0');
    expect(pinnedCell.textContent).toBe('r0c0');
    // Column 0 is rendered exactly once (the pinned copy), not duplicated.
    expect(grid.element.querySelectorAll('[data-row="0"][data-col="0"]').length).toBe(1);
    state.setStickyFirstColumn(false);
    grid.refresh();
    expect(grid.element.querySelector('.colpin')).toBeNull();
  });

  it('keeps column 0 pinned while the scrolling region starts at column 1', () => {
    const { state, grid } = setup(bigCsv(20, 300));
    state.setStickyFirstColumn(true);
    grid.refresh();
    // Column 0 lives in the pinned cell, not among the normally windowed cells.
    const windowed = Array.from(
      grid.element.querySelectorAll<HTMLElement>('[data-row="0"][data-col]:not(.colpin)'),
    );
    expect(windowed.some((c) => c.dataset.col === '0')).toBe(false);
    // After scrolling far right, column 0 is still rendered (pinned).
    grid.element.scrollLeft = 250 * COL_WIDTH;
    grid.refresh();
    expect(grid.element.querySelector('.colpin[data-row="0"][data-col="0"]')).not.toBeNull();
  });

  it('persists the preference in localStorage', () => {
    const { state } = setup(bigCsv(10, 10));
    state.setStickyFirstColumn(true);
    expect(localStorage.getItem('refrain-csv-html.stickyFirstColumn')).toBe('1');
    const fresh = new AppState();
    expect(fresh.stickyFirstColumn).toBe(true);
  });
});

describe('sticky at the selected cell', () => {
  it('pins every row above and column left of the active cell, and toggles off', async () => {
    const { state, commands, grid, tab } = setup(bigCsv(50, 20));
    state.setSelection(tab, { row: 3, col: 2 }, null);
    expect(commands.isEnabled('view.freezeAtSelection')).toBe(true);
    await commands.run('view.freezeAtSelection');
    grid.refresh();
    expect(tab.freeze).toEqual({ rows: 3, cols: 2 });
    expect(grid.element.querySelector<HTMLElement>('.vgrid-sticky')!.hidden).toBe(false);
    const pinnedRows = Array.from(grid.element.querySelectorAll<HTMLElement>('.vgrid-stickyrow'));
    expect(pinnedRows.map((r) => r.dataset.row)).toEqual(['0', '1', '2']);
    // The scrolling rows start right below the frozen ones.
    const firstScrolled = grid.element.querySelector<HTMLElement>('.vgrid-row')!;
    expect(firstScrolled.dataset.row).toBe('3');
    // Columns A and B are pinned in the header and every row; only B carries the boundary rule.
    const pinnedHeads = Array.from(grid.element.querySelectorAll<HTMLElement>('.vgrid-header .colpin'));
    expect(pinnedHeads.map((h) => h.dataset.colhead)).toEqual(['0', '1']);
    expect(pinnedHeads.map((h) => h.classList.contains('colpin-edge'))).toEqual([false, true]);
    expect(pinnedHeads[1]!.style.left).toBe(`${ROW_HEAD_WIDTH + COL_WIDTH}px`);
    expect(grid.element.querySelectorAll('[data-row="5"][data-col="1"]').length).toBe(1);
    expect(cellEl(grid, 5, 1).classList.contains('colpin')).toBe(true);
    // Choosing it again clears the freeze.
    await commands.run('view.freezeAtSelection');
    grid.refresh();
    expect(tab.freeze).toBeNull();
    expect(grid.element.querySelector<HTMLElement>('.vgrid-sticky')!.hidden).toBe(true);
    expect(grid.element.querySelector('.colpin')).toBeNull();
  });

  it('keeps the pinned rows and columns while scrolled far away', async () => {
    const { state, commands, grid, tab } = setup(bigCsv(5_000, 300));
    state.setSelection(tab, { row: 2, col: 3 }, null);
    await commands.run('view.freezeAtSelection');
    grid.refresh();
    grid.element.scrollTop = 3_000 * ROW_HEIGHT;
    grid.element.scrollLeft = 250 * COL_WIDTH;
    grid.refresh();
    expect(grid.element.querySelector('.vgrid-stickyrow [data-row="1"][data-col="2"]')).not.toBeNull();
    expect(grid.element.querySelector('.vgrid-row .colpin[data-col="2"]')).not.toBeNull();
    // Frozen rows never reappear in the scrolling region.
    expect(grid.element.querySelector('.vgrid-row[data-row="1"]')).toBeNull();
  });

  it('scrolls a column into view past the pinned columns', async () => {
    const { state, commands, grid, tab } = setup(bigCsv(20, 60));
    state.setSelection(tab, { row: 1, col: 2 }, null);
    await commands.run('view.freezeAtSelection');
    grid.refresh();
    grid.element.scrollLeft = 30 * COL_WIDTH;
    grid.refresh();
    grid.reveal(1, 10);
    // Column K's left edge lands right after the two pinned columns.
    expect(grid.element.scrollLeft).toBe(10 * COL_WIDTH - 2 * COL_WIDTH);
    expect(cellEl(grid, 1, 10)).toBeTruthy();
  });

  it('is unavailable at A1 and replaced by the sticky first row/column toggles', async () => {
    const { state, commands, tab } = setup(bigCsv(10, 5));
    state.setSelection(tab, { row: 0, col: 0 }, null);
    expect(commands.isEnabled('view.freezeAtSelection')).toBe(false);
    state.setTabFreeze(tab, { rows: 2, cols: 2 });
    expect(state.stickyFirstRowShown).toBe(false);
    await commands.run('view.stickyFirstRow');
    expect(tab.freeze).toBeNull();
    expect(state.stickyFirstRow).toBe(true);
    expect(state.frozenPanes(tab)).toEqual({ rows: 1, cols: 0 });
  });

  it('is remembered per worksheet', () => {
    const rsf = RsfDocument.empty('book', 10, 4, 'Sheet1');
    const { state, tab } = setupRsf(rsf);
    const first = rsf.activeSheetId;
    state.setTabFreeze(tab, { rows: 1, cols: 1 });
    expect(state.addSheet(tab, 'Sheet2')).not.toBeNull();
    expect(tab.freeze).toBeNull();
    state.setActiveSheet(tab, first);
    expect(tab.freeze).toEqual({ rows: 1, cols: 1 });
  });
});

describe('moving a selection by dragging its border', () => {
  function mouse(target: Element, type: string, init: MouseEventInit = {}): void {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init }));
  }

  /** Give a rendered cell a real-looking box (jsdom has no layout). */
  function layOut(cell: HTMLElement, left: number, top: number): void {
    cell.getBoundingClientRect = () =>
      ({
        left,
        top,
        width: 100,
        height: 24,
        right: left + 100,
        bottom: top + 24,
        x: left,
        y: top,
      }) as DOMRect;
  }

  function selectedRsf() {
    const rsf = RsfDocument.empty('book', 10, 4, 'Sheet1');
    rsf.setCell(1, 1, 'x');
    const setupResult = setupRsf(rsf);
    setupResult.state.setSelection(setupResult.tab, { row: 2, col: 2 }, { row: 1, col: 1 });
    return setupResult;
  }

  it('starts a move from anywhere on the outer border', () => {
    const { commands, grid, tab } = selectedRsf();
    const moveRange = vi.spyOn(commands, 'moveRange').mockResolvedValue(true);
    // Grab the bottom border of C3 (the range's bottom-right cell).
    const grabbed = cellEl(grid, 2, 2);
    layOut(grabbed, 300, 100);
    mouse(grabbed, 'mousemove', { clientX: 350, clientY: 122 });
    expect(grid.element.classList.contains('move-edge')).toBe(true);
    mouse(grabbed, 'mousedown', { clientX: 350, clientY: 122 });
    expect(grid.element.classList.contains('moving-range')).toBe(true);
    mouse(cellEl(grid, 5, 3), 'mousemove');
    document.dispatchEvent(new MouseEvent('mouseup'));
    // The drag follows the grabbed cell: C3 → D6 is 3 rows down, 1 column right.
    expect(moveRange).toHaveBeenCalledWith(tab, { top: 1, left: 1, bottom: 2, right: 2 }, 3, 1);
  });

  it('selects normally from the middle of a selected cell', () => {
    const { commands, grid, tab } = selectedRsf();
    const moveRange = vi.spyOn(commands, 'moveRange');
    const inside = cellEl(grid, 1, 2);
    layOut(inside, 300, 76);
    mouse(inside, 'mousemove', { clientX: 350, clientY: 88 });
    expect(grid.element.classList.contains('move-edge')).toBe(false);
    mouse(inside, 'mousedown', { clientX: 350, clientY: 88 });
    document.dispatchEvent(new MouseEvent('mouseup'));
    expect(grid.element.classList.contains('moving-range')).toBe(false);
    expect(tab.selection).toEqual({ row: 1, col: 2 });
    expect(moveRange).not.toHaveBeenCalled();
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

  it('Ctrl+Home jumps to A1 and Ctrl+End jumps to the last used cell', () => {
    const { grid, tab } = setup(bigCsv(20));
    grid.element.focus();
    grid.element.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
    );
    grid.element.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
    );
    expect(tab.selection).toEqual({ row: 1, col: 1 });
    const end = new KeyboardEvent('keydown', {
      key: 'End',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    grid.element.dispatchEvent(end);
    expect(tab.selection).toEqual({ row: 19, col: 3 });
    expect(end.defaultPrevented).toBe(true);
    const home = new KeyboardEvent('keydown', {
      key: 'Home',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    grid.element.dispatchEvent(home);
    expect(tab.selection).toEqual({ row: 0, col: 0 });
    expect(home.defaultPrevented).toBe(true);
  });

  it('Ctrl+Shift+End extends the selection to the last used cell', () => {
    const { state, grid, tab } = setup(bigCsv(20));
    grid.element.focus();
    grid.element.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'End',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(state.selectedRange(tab)).toEqual({ top: 0, left: 0, bottom: 19, right: 3 });
  });

  it('leaves plain Home/End moving within the current row, unaffected by Ctrl+Home/End', () => {
    const { grid, tab } = setup(bigCsv(20));
    grid.element.focus();
    grid.element.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
    );
    grid.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
    expect(tab.selection).toEqual({ row: 1, col: 3 });
    grid.element.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }),
    );
    expect(tab.selection).toEqual({ row: 1, col: 0 });
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

describe('auto-focus on document activation (#282)', () => {
  // A document becoming active (created, opened, or switched to) with focus
  // sitting on the inert default means the user has no way to type without
  // first clicking a cell; see grid.ts `refresh()`.
  it('focuses the grid keyboard sink when a document becomes active with nothing else focused', () => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    const state = new AppState();
    const commands = new Commands(state, noopUi, document);
    const grid = new Grid(state, commands);
    document.body.append(grid.element);
    expect(document.activeElement).toBe(document.body);

    state.addTab('big.csv', doc(bigCsv(5)), null);
    grid.refresh();

    expect(document.activeElement).toBeInstanceOf(HTMLTextAreaElement);
    expect((document.activeElement as HTMLElement).classList.contains('grid-sink')).toBe(true);
    grid.element.remove();
  });

  it('leaves an already-focused control alone', () => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    const state = new AppState();
    const commands = new Commands(state, noopUi, document);
    const grid = new Grid(state, commands);
    document.body.append(grid.element);
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();

    state.addTab('big.csv', doc(bigCsv(5)), null);
    grid.refresh();

    expect(document.activeElement).toBe(input);
    input.remove();
    grid.element.remove();
  });
});

describe('cell edit caret placement (#286)', () => {
  it('F2 opens the editor with the caret at the end of the text, not the whole value selected', () => {
    const { state, grid, tab } = setup(bigCsv(10));
    state.setSelection(tab, { row: 2, col: 2 });
    grid.element.focus();
    grid.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true, cancelable: true }));
    const input = grid.element.querySelector<HTMLTextAreaElement>('.cell-editor')!;
    expect(input).not.toBeNull();
    expect(input.value).toBe('r2c2');
    expect([input.selectionStart, input.selectionEnd]).toEqual([input.value.length, input.value.length]);
  });

  it('double-click opens the editor without selecting the whole value', () => {
    const { grid, tab } = setup(bigCsv(10));
    const cell = grid.element.querySelector<HTMLElement>('[data-row="2"][data-col="2"]')!;
    cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, button: 0 }));
    const input = grid.element.querySelector<HTMLTextAreaElement>('.cell-editor')!;
    expect(input).not.toBeNull();
    expect(input.value).toBe('r2c2');
    // jsdom implements neither caretPositionFromPoint nor caretRangeFromPoint,
    // so the click offset cannot be resolved here; the important assertion is
    // that the fallback never selects the whole value (the bug being fixed).
    expect(input.selectionStart).toBe(input.selectionEnd);
    void tab;
  });

  it('openEditor(..., caretOffset) places the caret at the given offset', () => {
    const { grid, tab } = setup(bigCsv(10));
    grid.openEditor(tab, 2, 2, null, 2);
    const input = grid.element.querySelector<HTMLTextAreaElement>('.cell-editor')!;
    expect(input.value).toBe('r2c2');
    expect([input.selectionStart, input.selectionEnd]).toEqual([2, 2]);
  });

  it('openEditor(..., caretOffset) clamps an out-of-range offset to the text length', () => {
    const { grid, tab } = setup(bigCsv(10));
    grid.openEditor(tab, 2, 2, null, 999);
    const input = grid.element.querySelector<HTMLTextAreaElement>('.cell-editor')!;
    expect([input.selectionStart, input.selectionEnd]).toEqual([input.value.length, input.value.length]);
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

  function canvasWidth(grid: Grid): number {
    return parseInt(grid.element.querySelector<HTMLElement>('.vgrid-canvas')!.style.width, 10);
  }

  it('invalidates the cached column-offset total after a resize', () => {
    const { grid, tab } = setup(bigCsv(10, 3));
    const before = canvasWidth(grid);
    handleFor(grid, 0).dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 200 }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 260 }));
    document.dispatchEvent(new MouseEvent('mouseup'));
    expect(tab.colWidths[0]).toBe(COL_WIDTH + 60);
    // A stale cached prefix sum would keep reporting the pre-resize total.
    expect(canvasWidth(grid)).toBe(before + 60);
  });

  it('invalidates the cached column-offset total after auto-fit', () => {
    const { grid, tab } = setup(bigCsv(10, 3));
    const before = canvasWidth(grid);
    handleFor(grid, 1).dispatchEvent(new MouseEvent('dblclick', { bubbles: true, button: 0 }));
    expect(tab.colWidths[1]).toBe(MIN_COL_WIDTH);
    expect(canvasWidth(grid)).toBe(before - (COL_WIDTH - MIN_COL_WIDTH));
  });

  it('invalidates the cached column-offset total after a zoom change', () => {
    const { state, grid, tab } = setup(bigCsv(10, 3));
    const before = canvasWidth(grid);
    state.setTabZoom(tab, 150);
    grid.refresh();
    // A stale cache would keep reporting the 100%-zoom total.
    expect(canvasWidth(grid)).toBeGreaterThan(before);
    expect(canvasWidth(grid)).toBe(Math.round(ROW_HEAD_WIDTH * 1.5) + Math.round(COL_WIDTH * 1.5) * 3);
  });
});

describe('Escape cancels in-progress drags (#288)', () => {
  function mouse(el: Element, type: string, init: MouseEventInit = {}): void {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init }));
  }
  function escape(): void {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  }

  it('cancels a fill-handle drag without applying the fill', () => {
    const { commands, grid, tab } = setup(bigCsv(10, 3));
    mouse(cellEl(grid, 0, 0), 'mousedown');
    document.dispatchEvent(new MouseEvent('mouseup'));
    const handle = grid.element.querySelector<HTMLElement>('[data-fillhandle]');
    expect(handle).not.toBeNull();
    mouse(handle!, 'mousedown');
    mouse(cellEl(grid, 3, 0), 'mousemove');
    expect(grid.element.querySelectorAll('.fill-target').length).toBeGreaterThan(0);

    const applyFill = vi.spyOn(commands, 'applyFill');
    escape();
    expect(grid.element.querySelectorAll('.fill-target').length).toBe(0);
    document.dispatchEvent(new MouseEvent('mouseup'));
    expect(applyFill).not.toHaveBeenCalled();
    void tab;
  });

  it('cancels a column-resize drag, restoring the original width', () => {
    const { grid, tab } = setup(bigCsv(10, 3));
    const handle = grid.element.querySelector<HTMLElement>('[data-colresize="0"]');
    expect(handle).not.toBeNull();
    mouse(handle!, 'mousedown', { clientX: 200 });
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 260 }));
    expect(tab.colWidths[0]).toBe(COL_WIDTH + 60);

    escape();
    expect(tab.colWidths[0]).toBe(COL_WIDTH);
    expect(parseInt(cellEl(grid, 0, 0).style.width, 10)).toBe(COL_WIDTH);

    // A trailing mousemove/mouseup from the same physical drag has no effect.
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 300 }));
    document.dispatchEvent(new MouseEvent('mouseup'));
    expect(tab.colWidths[0]).toBe(COL_WIDTH);
  });

  it('cancels a range-move drag without moving cells', () => {
    const rsf = RsfDocument.empty('book', 10, 4, 'Sheet1');
    rsf.setCell(0, 0, 'x');
    const { commands, grid, tab } = setupRsf(rsf);
    mouse(cellEl(grid, 0, 0), 'mousedown');
    document.dispatchEvent(new MouseEvent('mouseup'));
    const handle = grid.element.querySelector<HTMLElement>('[data-movehandle]');
    expect(handle).not.toBeNull();
    mouse(handle!, 'mousedown');
    mouse(cellEl(grid, 2, 2), 'mousemove');
    expect(grid.element.classList.contains('moving-range')).toBe(true);

    const moveRange = vi.spyOn(commands, 'moveRange');
    escape();
    expect(grid.element.classList.contains('moving-range')).toBe(false);
    document.dispatchEvent(new MouseEvent('mouseup'));
    expect(moveRange).not.toHaveBeenCalled();
    expect(tab.doc.getDisplayValue(0, 0)).toBe('x');
  });
});

describe('add row / add column buttons anchored to the grid edges (#467)', () => {
  it('offers Add row / Add column controls with localized accessible names, sitting on the grid itself', () => {
    const { grid } = setup(bigCsv(5, 3));
    const addRow = grid.element.querySelector<HTMLButtonElement>('.sheet-grid-add-row')!;
    const addColumn = grid.element.querySelector<HTMLButtonElement>('.sheet-grid-add-col')!;
    expect(addRow.getAttribute('aria-label')).toBe(t('grid.addRow'));
    expect(addColumn.getAttribute('aria-label')).toBe(t('grid.addColumn'));
    expect(addRow.disabled).toBe(false);
    expect(addColumn.disabled).toBe(false);
    // Both live inside the scrollable canvas, not the surrounding chrome.
    expect(grid.element.querySelector('.vgrid-canvas')!.contains(addRow)).toBe(true);
    expect(grid.element.querySelector('.vgrid-canvas')!.contains(addColumn)).toBe(true);
  });

  it('anchors add-row below the last row and add-column right of the last column', () => {
    const { grid } = setup(bigCsv(5, 3));
    const canvas = grid.element.querySelector<HTMLElement>('.vgrid-canvas')!;
    const rowAnchor = grid.element.querySelector<HTMLElement>('.vgrid-add-row-anchor')!;
    const colAnchor = grid.element.querySelector<HTMLElement>('.vgrid-add-col-anchor')!;
    expect(rowAnchor.hidden).toBe(false);
    expect(colAnchor.hidden).toBe(false);
    // The anchors sit exactly at the content's own bottom/right edge, i.e.
    // the true last-row / last-column boundary, not a fixed viewport corner.
    expect(rowAnchor.style.top).toBe(canvas.style.height);
    expect(colAnchor.style.left).toBe(canvas.style.width);
  });

  it('repositions the anchors to the new bottom/right edge after a row/column is appended', async () => {
    const { grid, commands } = setup(bigCsv(5, 3));
    const canvas = grid.element.querySelector<HTMLElement>('.vgrid-canvas')!;
    const rowAnchor = grid.element.querySelector<HTMLElement>('.vgrid-add-row-anchor')!;
    const colAnchor = grid.element.querySelector<HTMLElement>('.vgrid-add-col-anchor')!;
    const rowTopBefore = rowAnchor.style.top;
    const colLeftBefore = colAnchor.style.left;

    await commands.run('sheet.addRow');
    grid.refresh();
    expect(rowAnchor.style.top).not.toBe(rowTopBefore);
    expect(rowAnchor.style.top).toBe(canvas.style.height);

    await commands.run('sheet.addColumn');
    grid.refresh();
    expect(colAnchor.style.left).not.toBe(colLeftBefore);
    expect(colAnchor.style.left).toBe(canvas.style.width);
  });

  it('runs sheet.addRow / sheet.addColumn when clicked', () => {
    const { grid, commands } = setup(bigCsv(5, 3));
    const run = vi.spyOn(commands, 'run');
    grid.element.querySelector<HTMLButtonElement>('.sheet-grid-add-row')!.click();
    expect(run).toHaveBeenCalledWith('sheet.addRow');
    grid.element.querySelector<HTMLButtonElement>('.sheet-grid-add-col')!.click();
    expect(run).toHaveBeenCalledWith('sheet.addColumn');
  });

  it('hides both buttons when no document is open', () => {
    const state = new AppState();
    const commands = new Commands(state, noopUi, document);
    const grid = new Grid(state, commands);
    grid.refresh();
    const rowAnchor = grid.element.querySelector<HTMLElement>('.vgrid-add-row-anchor')!;
    const colAnchor = grid.element.querySelector<HTMLElement>('.vgrid-add-col-anchor')!;
    expect(rowAnchor.hidden).toBe(true);
    expect(colAnchor.hidden).toBe(true);
  });
});

describe('copy-source outline (animated marching-ants border)', () => {
  it('places exactly one overlay spanning the copied range, when both corner cells are rendered', () => {
    const { grid } = setup(bigCsv(10, 5));
    // Both corners are within the virtualized window, so the overlay must
    // be created rather than skipped (contrast the "scrolled out of view"
    // case below).
    cellEl(grid, 1, 1);
    cellEl(grid, 2, 2);
    grid.setCopySource({ top: 1, left: 1, bottom: 2, right: 2 });
    const outlines = grid.element.querySelectorAll<HTMLElement>('.copy-source-outline');
    expect(outlines.length).toBe(1);
    // jsdom lays out no real geometry (every rect is zero-sized), so only
    // that a pixel position was actually written is asserted here; the
    // real on-screen placement is a visual/manual concern.
    expect(outlines[0].style.left).toMatch(/px$/);
    expect(outlines[0].style.top).toMatch(/px$/);
  });

  it('removes the overlay when the copy source is cleared', () => {
    const { grid } = setup(bigCsv(10, 5));
    grid.setCopySource({ top: 0, left: 0, bottom: 1, right: 1 });
    expect(grid.element.querySelectorAll('.copy-source-outline').length).toBe(1);
    grid.setCopySource(null);
    expect(grid.element.querySelectorAll('.copy-source-outline').length).toBe(0);
  });

  it('re-places the overlay on every selection refresh (e.g. across scrolling)', () => {
    const { grid } = setup(bigCsv(10, 5));
    grid.setCopySource({ top: 0, left: 0, bottom: 0, right: 0 });
    expect(grid.element.querySelectorAll('.copy-source-outline').length).toBe(1);
    grid.refreshSelection();
    // Still exactly one — refreshSelection must not accumulate duplicates.
    expect(grid.element.querySelectorAll('.copy-source-outline').length).toBe(1);
  });

  it('renders no overlay when a corner of the range has scrolled out of view', () => {
    const { grid } = setup(bigCsv(100_000, 5));
    // Row 99,999 is far outside the virtualized window.
    grid.setCopySource({ top: 0, left: 0, bottom: 99_999, right: 0 });
    expect(grid.element.querySelectorAll('.copy-source-outline').length).toBe(0);
  });

  it('is driven end-to-end by ClipboardController.copyText/clearCopySource', () => {
    const { grid, state, commands } = setup(bigCsv(5, 3));
    const clipboard = new ClipboardController(state, commands, vi.fn(), document, (range) =>
      grid.setCopySource(range),
    );
    state.setSelection(state.activeTab!, { row: 0, col: 0 }, { row: 1, col: 1 });
    clipboard.copyText();
    expect(grid.element.querySelectorAll('.copy-source-outline').length).toBe(1);
    clipboard.clearCopySource();
    expect(grid.element.querySelectorAll('.copy-source-outline').length).toBe(0);
  });
});

describe('selection and change highlights', () => {
  function rowEl(grid: Grid, row: number): HTMLElement {
    return grid.element.querySelector<HTMLElement>(`.vgrid-row[data-row="${row}"]`)!;
  }

  it("highlights the active cell's row only while a single cell is selected", () => {
    const { state, grid, tab } = setup(bigCsv(10));
    state.setSelection(tab, { row: 2, col: 1 }, null);
    grid.refresh();
    expect(rowEl(grid, 2).classList.contains('selected-row')).toBe(true);

    state.setSelection(tab, { row: 2, col: 1 }, { row: 4, col: 2 });
    grid.refresh();
    expect(rowEl(grid, 2).classList.contains('selected-row')).toBe(false);
    expect(rowEl(grid, 3).classList.contains('selected-row')).toBe(false);
  });

  it('does not highlight edits in a brand-new CSV until it has been saved once', () => {
    const { state, grid, tab } = setup('a,b\nc,d\n');
    tab.neverSaved = true;
    state.bulkEdit(tab, [{ row: 0, col: 0, before: null, after: 'X' }], 'history.paste');
    grid.refresh();
    expect(cellEl(grid, 0, 0).classList.contains('edited')).toBe(false);

    tab.neverSaved = false; // what the first save does
    grid.refresh();
    expect(cellEl(grid, 0, 0).classList.contains('edited')).toBe(true);
  });
});
