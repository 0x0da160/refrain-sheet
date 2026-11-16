// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * Scrolling an object into view on the grid. A phone shows a chart placed
 * under the data this way. The view moves only as far as it must; the
 * selection and the cells stay where they were.
 */
import { describe, expect, it, vi } from 'vitest';
import { AppState } from '../../src/app/state';
import { Commands, type UiPort } from '../../src/app/commands';
import { RsfDocument } from '../../src/core/workbook/rsf-document';
import { COL_WIDTH, Grid, ROW_HEIGHT } from '../../src/ui/grid';

// The grid is 400 px tall and its column header takes one row, so the rows
// scroll through the rest.
const VIEW_HEIGHT = 400;
const ROWS_VIEW = VIEW_HEIGHT - ROW_HEIGHT;

function setup() {
  const state = new AppState();
  const ui = new Proxy({} as UiPort, { get: () => vi.fn(async () => null) });
  const commands = new Commands(state, ui, document);
  const grid = new Grid(state, commands);
  Object.defineProperty(grid.element, 'clientHeight', { value: VIEW_HEIGHT, configurable: true });
  Object.defineProperty(grid.element, 'clientWidth', { value: 360, configurable: true });
  document.body.append(grid.element);
  state.subscribe((e) => (e === 'selection' ? grid.refreshSelection() : grid.refresh()));
  const doc = RsfDocument.empty('t.rsf', 300, 26);
  doc.markSaved();
  const tab = state.addTab('t.rsf', doc, null);
  grid.refresh();
  return { state, grid, tab };
}

describe('scrolling an object into view on the grid', () => {
  it('leaves the view alone when the object is already in view', () => {
    const { grid, tab } = setup();
    grid.scrollObjectIntoView(tab, 10, 0, 100);
    expect(grid.element.scrollTop).toBe(0);
  });

  it('brings the bottom of an object below the view up into view', () => {
    const { grid, tab } = setup();
    grid.scrollObjectIntoView(tab, 30, 0, 100);
    // The object runs from row 30 (720 px) to 820 px, so the view ends at 820 px.
    expect(grid.element.scrollTop).toBe(30 * ROW_HEIGHT + 100 - ROWS_VIEW);
  });

  it('starts an object taller than the view at its top', () => {
    const { grid, tab } = setup();
    grid.scrollObjectIntoView(tab, 30, 0, 500);
    expect(grid.element.scrollTop).toBe(30 * ROW_HEIGHT);
  });

  it('moves the column to the left of the view, so a wide object shows most of its width', () => {
    const { grid, tab } = setup();
    grid.scrollObjectIntoView(tab, 0, 2, 100);
    expect(grid.element.scrollLeft).toBe(2 * COL_WIDTH);
  });

  it('leaves the selection where it was', () => {
    const { grid, tab, state } = setup();
    state.setSelection(tab, { row: 2, col: 1 });
    grid.scrollObjectIntoView(tab, 30, 2, 100);
    expect(tab.selection).toMatchObject({ row: 2, col: 1 });
  });
});
