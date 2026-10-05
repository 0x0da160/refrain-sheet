// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * Row heights in the grid: a row the person sized is drawn at that height
 * (scaled by the zoom, winning over a wrapped height), its cells place the
 * text up and down by their vertical alignment, and the row header's bottom
 * edge drags the height and double-clicks back to automatic.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppState } from '../../src/app/state';
import { Commands, type UiPort } from '../../src/app/commands';
import { RsfDocument } from '../../src/core/workbook/rsf-document';
import { Grid, ROW_HEIGHT } from '../../src/ui/grid';

function stubUi(): UiPort {
  return new Proxy(
    { notify: vi.fn(), setBusy: vi.fn() },
    {
      get: (target, key) => (key in target ? target[key as keyof typeof target] : vi.fn(async () => null)),
    },
  ) as unknown as UiPort;
}

beforeEach(() => {
  document.body.textContent = '';
  localStorage.clear();
});

function setup() {
  const state = new AppState();
  const commands = new Commands(state, stubUi(), document);
  const grid = new Grid(state, commands);
  Object.defineProperty(grid.element, 'clientHeight', { value: 520, configurable: true });
  Object.defineProperty(grid.element, 'clientWidth', { value: 900, configurable: true });
  document.body.append(grid.element);
  const doc = RsfDocument.empty('t.rsf', 6, 3);
  doc.setCell(2, 0, 'tall');
  const tab = state.addTab('t.rsf', doc, null);
  state.subscribe((event) => event === 'view' && grid.refresh());
  grid.refresh();
  return { state, grid, commands, tab, doc };
}

function rowEl(grid: Grid, row: number): HTMLElement {
  return grid.element.querySelector<HTMLElement>(`[role="row"][data-row="${row}"]`)!;
}

describe('row heights in the grid', () => {
  it('draws a sized row at its height, scaled by the zoom', () => {
    const { grid, commands, tab, state } = setup();
    commands.setRowHeight(tab, [2], 60);
    expect(rowEl(grid, 2).style.height).toBe('60px');
    expect(rowEl(grid, 2).classList.contains('sized')).toBe(true);
    expect(rowEl(grid, 3).style.height).toBe(`${ROW_HEIGHT}px`);
    state.setTabZoom(tab, 150);
    grid.refresh();
    expect(rowEl(grid, 2).style.height).toBe('90px');
  });

  it('places a cell at the top or bottom of a sized row', () => {
    const { grid, commands, tab, doc } = setup();
    commands.setRowHeight(tab, [2], 60);
    doc.setCellStyleOn(undefined, 2, 0, { verticalAlign: 'bottom' });
    grid.refresh();
    const cell = grid.element.querySelector<HTMLElement>('[data-row="2"][data-col="0"]')!;
    expect(cell.style.alignItems).toBe('flex-end');
  });

  it('drags the row header edge to a new height, and double-clicks it back to automatic', () => {
    const { grid, doc } = setup();
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 0;
    });
    const handle = () => grid.element.querySelector<HTMLElement>('[data-rowresize="2"]')!;
    expect(handle()).not.toBeNull();
    handle().dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientY: 100 }));
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientY: 130 }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientY: 130 }));
    expect(doc.activeSheet.rowHeights.get(2)).toBe(ROW_HEIGHT + 30);
    handle().dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(doc.activeSheet.rowHeights.size).toBe(0);
  });
});
