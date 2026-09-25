// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { AppState } from '../src/app/app-state';
import { Commands, type UiPort } from '../src/app/commands';
import { Grid } from '../src/ui/grid';
import { findDataEdge } from '../src/ui/grid/data-edge';
import { doc } from './helpers';

/** Walk a string like "xx..x" (x = filled) from `start` in direction `dir`. */
function edge(line: string, start: number, dir: 1 | -1): number {
  return findDataEdge(
    start,
    (i) => (i + dir >= 0 && i + dir < line.length ? i + dir : null),
    (i) => line[i] === 'x',
  );
}

describe('findDataEdge', () => {
  it('runs to the last filled cell of a block', () => {
    expect(edge('xxxx..x', 0, 1)).toBe(3);
    expect(edge('x..xxxx', 6, -1)).toBe(3);
  });

  it('jumps across empty cells to the next filled one', () => {
    expect(edge('x...x.', 0, 1)).toBe(4);
    expect(edge('..x...', 0, 1)).toBe(2);
    expect(edge('xx..x', 1, 1)).toBe(4);
  });

  it('goes to the end of the line when nothing further is filled', () => {
    expect(edge('x.....', 0, 1)).toBe(5);
    expect(edge('......', 2, -1)).toBe(0);
  });

  it('stays put at the end of the line', () => {
    expect(edge('xxx', 2, 1)).toBe(2);
    expect(edge('xxx', 0, -1)).toBe(0);
  });
});

describe('Ctrl+Arrow in the grid', () => {
  function setup(csv: string) {
    const state = new AppState();
    const commands = new Commands(state, {} as UiPort, document);
    const grid = new Grid(state, commands);
    Object.defineProperty(grid.element, 'clientHeight', { value: 400, configurable: true });
    Object.defineProperty(grid.element, 'clientWidth', { value: 800, configurable: true });
    document.body.append(grid.element);
    state.subscribe((e) => (e === 'selection' ? grid.refreshSelection() : grid.refresh()));
    const tab = state.addTab('t.csv', doc(csv), null);
    grid.refresh();
    return { grid, tab };
  }

  function press(grid: Grid, key: string, shiftKey = false): KeyboardEvent {
    const event = new KeyboardEvent('keydown', {
      key,
      ctrlKey: true,
      shiftKey,
      bubbles: true,
      cancelable: true,
    });
    grid.element.dispatchEvent(event);
    return event;
  }

  it('moves to the data edge in each direction', () => {
    const { grid, tab } = setup('a,b,,d\ne,,,\ni,,,\n,,,\nm,,,\n');
    grid.select(tab, 0, 0);
    expect(press(grid, 'ArrowRight').defaultPrevented).toBe(true);
    expect(tab.selection).toEqual({ row: 0, col: 1 });
    press(grid, 'ArrowRight');
    expect(tab.selection).toEqual({ row: 0, col: 3 });
    press(grid, 'ArrowLeft');
    expect(tab.selection).toEqual({ row: 0, col: 1 });

    grid.select(tab, 0, 0);
    press(grid, 'ArrowDown');
    expect(tab.selection).toEqual({ row: 2, col: 0 });
    press(grid, 'ArrowDown');
    expect(tab.selection).toEqual({ row: 4, col: 0 });
    press(grid, 'ArrowUp');
    expect(tab.selection).toEqual({ row: 2, col: 0 });
  });

  it('extends the selection with Ctrl+Shift+Arrow', () => {
    const { grid, tab } = setup('a,b,c\nd,e,f\n');
    grid.select(tab, 0, 0);
    press(grid, 'ArrowRight', true);
    expect(tab.selection).toEqual({ row: 0, col: 2 });
    expect(tab.anchor).toEqual({ row: 0, col: 0 });
  });
});
