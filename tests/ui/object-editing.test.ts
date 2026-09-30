// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * Editing shapes on the sheet: typing a shape's text on the shape, keeping
 * objects on whole pixels, and Alt-resizing onto cell edges.
 */
import { describe, expect, it, vi } from 'vitest';
import { AppState } from '../../src/app/state';
import { Commands, type UiPort } from '../../src/app/commands';
import { RsfDocument } from '../../src/core/workbook/rsf-document';
import { wholePixels, type SheetObject } from '../../src/core/workbook/sheet-objects';
import { Grid } from '../../src/ui/grid';
import { COL_WIDTH, ROW_HEIGHT } from '../../src/ui/grid/geometry';

function setup() {
  const state = new AppState();
  const ui = new Proxy({} as UiPort, { get: () => vi.fn(async () => null) });
  const commands = new Commands(state, ui, document);
  const grid = new Grid(state, commands);
  Object.defineProperty(grid.element, 'clientHeight', { value: 400, configurable: true });
  Object.defineProperty(grid.element, 'clientWidth', { value: 800, configurable: true });
  document.body.append(grid.element);
  state.subscribe((e) => (e === 'selection' ? grid.refreshSelection() : grid.refresh()));
  const doc = RsfDocument.empty('t.rsf', 20, 10);
  doc.markSaved();
  const tab = state.addTab('t.rsf', doc, null);
  grid.refresh();
  const run = vi.spyOn(commands, 'run');
  return { state, grid, commands, tab, doc, run };
}

const shape = (id: string, kind: SheetObject['kind'], extra: Partial<SheetObject> = {}) =>
  ({ id, name: id, kind, row: 0, col: 0, dx: 5, dy: 5, width: 60, height: 30, ...extra }) as SheetObject;

function nodeOf(grid: Grid, id: string): HTMLElement {
  return grid.element.querySelector<HTMLElement>(`[data-object-id="${id}"]`)!;
}

/** Two quick presses on object `id`, as a double-click reaches the grid. */
function doublePress(grid: Grid, id: string): void {
  for (let i = 0; i < 2; i++) {
    nodeOf(grid, id).dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 10, clientY: 10 }),
    );
    document.dispatchEvent(new MouseEvent('pointerup', { clientX: 10, clientY: 10 }));
  }
}

function field(grid: Grid): HTMLElement | null {
  return grid.element.querySelector<HTMLElement>('.sheet-object-text-field');
}

function key(target: HTMLElement, init: KeyboardEventInit): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
}

describe('typing a shape’s text on the shape', () => {
  it('opens an editor and the object settings on double-click, and keeps the text on Ctrl+Enter as one undo step', () => {
    const { grid, doc, state, tab, run } = setup();
    doc.setObjectsOn(undefined, [shape('a', 'rect', { text: 'old' })]);
    grid.refresh();
    doublePress(grid, 'a');
    const editor = field(grid)!;
    expect(editor.textContent).toBe('old');
    expect(run).toHaveBeenCalledWith('insert.objectList');
    editor.textContent = 'line 1\nline 2';
    key(editor, { key: 'Enter', ctrlKey: true });
    expect(doc.objects[0].text).toBe('line 1\nline 2');
    expect(field(grid)).toBeNull();
    expect(nodeOf(grid, 'a').textContent).toContain('line 1');
    state.undo(tab);
    expect(doc.objects[0].text).toBe('old');
  });

  it('keeps the text when the editor loses focus, and Escape puts it back', () => {
    const { grid, doc } = setup();
    doc.setObjectsOn(undefined, [shape('a', 'ellipse', { text: 'x' }), shape('b', 'text')]);
    grid.refresh();
    doublePress(grid, 'a');
    let editor = field(grid)!;
    editor.textContent = 'changed';
    key(editor, { key: 'Escape' });
    expect(doc.objects[0].text).toBe('x');
    key(nodeOf(grid, 'b'), { key: 'F2' });
    editor = field(grid)!;
    editor.textContent = 'typed';
    editor.dispatchEvent(new FocusEvent('blur'));
    expect(doc.objects[1].text).toBe('typed');
  });

  it('opens the object list for a line, a chart or a shape whose editing is locked', () => {
    const { grid, doc, run } = setup();
    doc.setObjectsOn(undefined, [shape('l', 'line'), shape('r', 'rect', { lockEdit: true })]);
    grid.refresh();
    doublePress(grid, 'l');
    doublePress(grid, 'r');
    expect(field(grid)).toBeNull();
    expect(run.mock.calls.filter(([id]) => id === 'insert.objectList')).toHaveLength(2);
  });

  it('does not open an editor on a read-only tab', () => {
    const { grid, doc, state, tab } = setup();
    doc.setObjectsOn(undefined, [shape('a', 'rect')]);
    state.setReadOnly(tab, true);
    grid.refresh();
    doublePress(grid, 'a');
    expect(field(grid)).toBeNull();
  });
});

describe('whole pixels', () => {
  it('rounds offsets, sizes, line widths and font sizes, and keeps a whole object as it is', () => {
    const o = shape('a', 'rect', {
      dx: 1.4,
      dy: 2.6,
      width: 10.5,
      height: 3.2,
      strokeWidth: 0.25,
      fontSize: 10.5,
    });
    expect(wholePixels(o)).toMatchObject({
      dx: 1,
      dy: 3,
      width: 11,
      height: 3,
      strokeWidth: 1,
      fontSize: 11,
    });
    const whole = shape('b', 'rect', { strokeWidth: 2 });
    expect(wholePixels(whole)).toBe(whole);
  });

  it('rounds an edited object', () => {
    const { commands, tab, doc } = setup();
    doc.setObjectsOn(undefined, [shape('a', 'rect')]);
    commands.updateObjects(
      tab,
      [shape('a', 'rect', { width: 33.7, strokeWidth: 2.4 })],
      'history.editObject',
    );
    expect(doc.objects[0]).toMatchObject({ width: 34, strokeWidth: 2 });
  });
});

describe('Alt-resizing onto cell edges', () => {
  function resize(alt: boolean) {
    const { grid, doc, state, tab } = setup();
    doc.setObjectsOn(undefined, [shape('a', 'rect')]);
    grid.refresh();
    state.objectSelection.select(tab, ['a']);
    const handle = grid.element.querySelector<HTMLElement>('[data-handle="se"]')!;
    handle.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 0, clientY: 0 }));
    document.dispatchEvent(new MouseEvent('pointermove', { clientX: 7, clientY: 3, altKey: alt }));
    document.dispatchEvent(new MouseEvent('pointerup', { clientX: 7, clientY: 3, altKey: alt }));
    return doc.objects[0];
  }

  it('puts the dragged corner on the nearest cell edge, and leaves the others', () => {
    // Right edge 5 + 60 + 7 = 72 is nearer the first column's end; bottom 38 nearer the second row's.
    expect(resize(true)).toMatchObject({ dx: 5, dy: 5, width: COL_WIDTH - 5, height: 2 * ROW_HEIGHT - 5 });
  });

  it('moves freely without Alt', () => {
    expect(resize(false)).toMatchObject({ width: 67, height: 33 });
  });
});
