// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * Shapes over a worksheet: the object model (validation, following row and
 * column changes), the `.rsf` round trip (and that malformed objects are
 * refused), the commands with their two locks and undo, and the grid's
 * drawing, picking and keyboard handling.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppState } from '../../src/app/state';
import { Commands, type UiPort } from '../../src/app/commands';
import { RsfDocument } from '../../src/core/workbook/rsf-document';
import {
  moveObjects,
  shiftObjectsForDelete,
  shiftObjectsForInsert,
  validateObject,
  type SheetObject,
} from '../../src/core/workbook/sheet-objects';
import { doc as csvDoc } from '../helpers';
import { Grid } from '../../src/ui/grid';
import { ObjectsPanel } from '../../src/ui/objects-panel';
import { rsfFromTree, rsfTree } from '../rsf-single-sheet';

const rect = (overrides: Partial<SheetObject> = {}): SheetObject => ({
  id: 'o1',
  name: 'Box',
  kind: 'rect',
  row: 2,
  col: 1,
  dx: 4,
  dy: 3,
  width: 100,
  height: 50,
  ...overrides,
});

function setup(rows = 6, cols = 4) {
  const state = new AppState();
  const notify = vi.fn();
  const fakes = new Map<string | symbol, unknown>([
    ['notify', notify],
    ['confirmConvert', vi.fn(async () => true)],
  ]);
  const ui = new Proxy({} as UiPort, {
    get: (_target, key) => {
      if (!fakes.has(key)) {
        fakes.set(
          key,
          vi.fn(async () => null),
        );
      }
      return fakes.get(key);
    },
  });
  const commands = new Commands(state, ui, document);
  const grid = new Grid(state, commands);
  Object.defineProperty(grid.element, 'clientHeight', { value: 400, configurable: true });
  Object.defineProperty(grid.element, 'clientWidth', { value: 800, configurable: true });
  document.body.append(grid.element);
  state.subscribe((e) => (e === 'selection' ? grid.refreshSelection() : grid.refresh()));
  const doc = RsfDocument.empty('t.rsf', rows, cols);
  doc.markSaved();
  const tab = state.addTab('t.rsf', doc, null);
  grid.refresh();
  return { state, grid, commands, tab, doc, notify };
}

beforeEach(() => {
  document.body.textContent = '';
  localStorage.clear();
});

describe('sheet objects: the model', () => {
  it('accepts an object that fits the sheet and refuses one that does not', () => {
    expect(validateObject(rect(), 6, 4)).not.toBeNull();
    for (const bad of [
      rect({ row: 6 }),
      rect({ col: -1 }),
      rect({ dx: -1 }),
      rect({ width: Number.NaN }),
      rect({ id: '' }),
      rect({ id: 'a b' }),
      rect({ name: '' }),
      rect({ name: 'a\nb' }),
      rect({ rotation: 0 }),
      rect({ rotation: 360 }),
      rect({ fill: 'red' }),
      rect({ fill: '#FFFFFF' }),
      rect({ strokeWidth: 30 }),
      rect({ fontSize: 11.3 }),
      rect({ align: 'justify' as 'left' }),
      rect({ hidden: false as unknown as true }),
      { ...rect(), kind: 'star' as 'rect' },
    ]) {
      expect(validateObject(bad, 6, 4)).toBeNull();
    }
    expect(validateObject(rect({ fill: 'none', stroke: '#12ab34', rotation: 45.5 }), 6, 4)).not.toBeNull();
  });

  it('moves with inserted and deleted rows and columns, keeping its size', () => {
    const o = rect();
    expect(shiftObjectsForInsert([o], 'row', 2, 3)[0]).toMatchObject({ row: 5, dy: 3 });
    expect(shiftObjectsForInsert([o], 'row', 3, 3)[0]).toBe(o);
    expect(shiftObjectsForInsert([o], 'col', 0, 2)[0]).toMatchObject({ col: 3, dx: 4 });
    expect(shiftObjectsForDelete([o], 'row', 0, 2, 4)[0]).toMatchObject({ row: 0, dy: 3 });
    // Its own row deleted: it stays, at the edge where the rows were.
    expect(shiftObjectsForDelete([o], 'row', 1, 3, 3)[0]).toMatchObject({ row: 1, dy: 0, width: 100 });
    // Deleted at the end: pulled back onto the last row left.
    expect(shiftObjectsForDelete([o], 'row', 2, 4, 2)[0]).toMatchObject({ row: 1 });
    expect(moveObjects([o], 'row', 2, 1, 5)[0]).toMatchObject({ row: 4 });
    expect(moveObjects([o], 'row', 0, 1, 4)[0]).toMatchObject({ row: 1 });
  });
});

describe('sheet objects: the file', () => {
  it('saves and reopens objects with every setting', () => {
    const { doc } = setup();
    const objects: SheetObject[] = [
      rect({
        rotation: 30,
        fill: 'none',
        stroke: '#ff0000',
        strokeWidth: 2.5,
        hidden: true,
        lockPosition: true,
      }),
      {
        id: 'o2',
        name: 'Note',
        kind: 'text',
        row: 0,
        col: 0,
        dx: 0,
        dy: 0,
        width: 160,
        height: 48,
        text: 'Hello\nworld',
        textColor: '#123456',
        fontSize: 14,
        bold: true,
        italic: true,
        align: 'right',
        valign: 'bottom',
        lockEdit: true,
      },
      {
        id: 'o3',
        name: 'Arrow',
        kind: 'arrow',
        row: 5,
        col: 3,
        dx: 1,
        dy: 1,
        width: 80,
        height: 0,
        flipH: true,
      },
    ];
    doc.setObjectsOn(undefined, objects);
    const tree = rsfTree(doc.toBytes()) as { sheets: Array<{ objects: Array<Record<string, unknown>> }> };
    expect(tree.sheets[0].objects[0]).toMatchObject({ at: 'B3', dx: 4, dy: 3, kind: 'rect' });
    const reopened = RsfDocument.fromBytes(doc.toBytes(), 't.rsf');
    expect(reopened.ok && reopened.doc.objects).toEqual(objects);
  });

  it('writes nothing for a sheet without objects', () => {
    const { doc } = setup();
    const tree = rsfTree(doc.toBytes()) as { sheets: Array<Record<string, unknown>> };
    expect('objects' in tree.sheets[0]).toBe(false);
  });

  it('refuses a malformed object', () => {
    const file = (objects: unknown, kind?: string) =>
      rsfFromTree({
        format: 'refrain-sheet',
        version: 1,
        sheets: [
          { id: 's1', name: 'Sheet1', rows: 2, cols: 2, cells: [['a']], objects, ...(kind ? { kind } : {}) },
        ],
      });
    const ok = { id: 'o1', name: 'A', kind: 'rect', at: 'A1', dx: 0, dy: 0, width: 10, height: 10 };
    expect(RsfDocument.fromBytes(file([ok]), 't.rsf').ok).toBe(true);
    for (const objects of [
      {},
      [{ ...ok, at: 'a1' }],
      [{ ...ok, at: '$A$1' }],
      [{ ...ok, at: 'C3' }],
      [{ ...ok, kind: 'star' }],
      [{ ...ok, width: '10' }],
      [{ ...ok, id: 7 }],
      [ok, { ...ok, name: 'B' }],
      [{ ...ok, lockEdit: false }],
    ]) {
      const result = RsfDocument.fromBytes(file(objects), 't.rsf');
      expect(result.ok ? 'ok' : result.error).toBe('bad-shape');
    }
    const onText = RsfDocument.fromBytes(file([ok], 'markdown'), 't.rsf');
    expect(onText.ok ? 'ok' : onText.error).toBe('bad-shape');
  });
});

describe('sheet objects: commands', () => {
  it('inserts a shape at the selected cell, selects it, and undoes it', async () => {
    const { state, commands, tab, doc } = setup();
    state.setSelection(tab, { row: 3, col: 2 });
    await commands.run('insert.rectangle');
    expect(doc.objects).toHaveLength(1);
    expect(doc.objects[0]).toMatchObject({ kind: 'rect', row: 3, col: 2, name: 'Rectangle 1' });
    expect(state.objectSelection.selected(tab)).toEqual([doc.objects[0].id]);
    expect(doc.isDirty).toBe(true);
    state.undo(tab);
    expect(doc.objects).toHaveLength(0);
    expect(state.objectSelection.selected(tab)).toEqual([]);
    state.redo(tab);
    expect(doc.objects).toHaveLength(1);
  });

  it('converts a CSV file first', async () => {
    const state = new AppState();
    const ui = new Proxy({} as UiPort, {
      get: (_t, key) => (key === 'confirmConvert' ? async () => true : vi.fn(async () => null)),
    });
    const commands = new Commands(state, ui, document);
    const csv = csvDoc('a,b\n1,2\n');
    const tab = state.addTab('a.csv', csv, null);
    state.setSelection(tab, { row: 0, col: 0 });
    await commands.run('insert.ellipse');
    const doc = state.activeTab?.doc;
    expect(doc instanceof RsfDocument && doc.objects.map((o) => o.kind)).toEqual(['ellipse']);
  });

  it('keeps a position-fixed object in place but lets it be edited', () => {
    const { commands, tab, doc, notify } = setup();
    doc.setObjectsOn(undefined, [rect({ lockPosition: true })]);
    expect(commands.updateObjects(tab, [rect({ lockPosition: true, dx: 20 })], 'history.moveObject')).toBe(
      false,
    );
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('Fix Position'), 'warn');
    expect(
      commands.updateObjects(tab, [rect({ lockPosition: true, text: 'Hi' })], 'history.editObject'),
    ).toBe(true);
    expect(doc.objects[0].text).toBe('Hi');
  });

  it('keeps an edit-locked object as it is, but lets the list unlock, hide and reorder it', async () => {
    const { state, commands, tab, doc } = setup();
    const other = rect({ id: 'o2', name: 'Other' });
    doc.setObjectsOn(undefined, [rect({ lockEdit: true }), other]);
    expect(commands.updateObjects(tab, [rect({ lockEdit: true, dx: 9 })], 'x')).toBe(false);
    expect(commands.updateObjects(tab, [rect({ lockEdit: true, fill: '#000000' })], 'x')).toBe(false);
    expect(commands.updateObjects(tab, [rect({ lockEdit: true, name: 'New' })], 'x')).toBe(false);
    state.objectSelection.select(tab, ['o1']);
    await commands.run('object.delete');
    expect(doc.objects).toHaveLength(2);
    // Showing/hiding and the order are not edits.
    expect(commands.updateObjects(tab, [rect({ lockEdit: true, hidden: true })], 'x')).toBe(true);
    await commands.run('object.bringToFront');
    expect(doc.objects.map((o) => o.id)).toEqual(['o2', 'o1']);
    expect(commands.updateObjects(tab, [rect({ hidden: true })], 'x')).toBe(true);
    await commands.run('object.delete');
    expect(doc.objects.map((o) => o.id)).toEqual(['o2']);
  });

  it('orders the selected objects one step or all the way', async () => {
    const { state, commands, tab, doc } = setup();
    doc.setObjectsOn(
      undefined,
      ['a', 'b', 'c', 'd'].map((id) => rect({ id, name: id })),
    );
    const order = () => doc.objects.map((o) => o.id).join('');
    state.objectSelection.select(tab, ['b']);
    expect(commands.isEnabled('object.sendToBack')).toBe(true);
    await commands.run('object.bringForward');
    expect(order()).toBe('acbd');
    await commands.run('object.bringToFront');
    expect(order()).toBe('acdb');
    expect(commands.isEnabled('object.bringToFront')).toBe(false);
    await commands.run('object.sendBackward');
    expect(order()).toBe('acbd');
    await commands.run('object.sendToBack');
    expect(order()).toBe('bacd');
    state.objectSelection.select(tab, []);
    expect(commands.isEnabled('object.delete')).toBe(false);
  });

  it('follows row deletes and moves, and undo puts it back', () => {
    const { state, tab, doc } = setup();
    doc.setObjectsOn(undefined, [rect()]);
    expect(state.deleteRows(tab, 1, 2)).toBe(true);
    expect(doc.objects[0]).toMatchObject({ row: 1, dy: 0 });
    state.undo(tab);
    expect(doc.objects[0]).toEqual(rect());
    expect(state.insertCols(tab, 0, 1)).toBe(true);
    expect(doc.objects[0]).toMatchObject({ col: 2 });
    state.undo(tab);
    expect(state.moveAxis(tab, 'row', 2, 1, 5)).toBe(true);
    expect(doc.objects[0]).toMatchObject({ row: 4, dy: 3 });
    state.undo(tab);
    expect(doc.objects[0]).toEqual(rect());
  });

  it('copies objects with a duplicated worksheet', () => {
    const { doc } = setup();
    doc.setObjectsOn(undefined, [rect()]);
    expect(doc.activeSheet.clone('s9', 'Copy').objects).toEqual([rect()]);
  });
});

describe('sheet objects: the grid', () => {
  const shape = (grid: Grid) => grid.element.querySelector<HTMLElement>('.sheet-object');

  it('draws each shown object where its cell is, and none that is hidden', () => {
    const { grid, doc, tab, state } = setup();
    doc.setObjectsOn(undefined, [rect(), rect({ id: 'o2', hidden: true })]);
    grid.refresh();
    const node = shape(grid);
    expect(grid.element.querySelectorAll('.sheet-object')).toHaveLength(1);
    expect(node?.style.width).toBe('100px');
    // Column B starts after column A; row 3 after two rows.
    const at = grid.objectPosition(tab, doc.objects[0]);
    const a1 = grid.objectPosition(tab, rect({ row: 0, col: 0, dx: 0, dy: 0 }));
    expect(a1).toEqual({ x: 0, y: 0 });
    expect(at.x).toBeGreaterThan(4);
    expect(at.y).toBeGreaterThan(3);
    expect(node?.getAttribute('aria-label')).toBe('Box');
    // Zoom scales the drawing; the stored size stays.
    state.setTabZoom(tab, 200);
    expect(shape(grid)?.style.width).toBe('200px');
    expect(doc.objects[0].width).toBe(100);
  });

  it('picks an object on a press, moves it with the arrow keys, and deletes it', () => {
    const { grid, doc, tab, state } = setup();
    doc.setObjectsOn(undefined, [rect()]);
    grid.refresh();
    shape(grid)?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    expect(state.objectSelection.selected(tab)).toEqual(['o1']);
    expect(grid.element.querySelectorAll('.sheet-object-handle')).toHaveLength(8);
    shape(grid)?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    const before = grid.objectPosition(tab, rect());
    expect(grid.objectPosition(tab, doc.objects[0])).toEqual({ x: before.x + 1, y: before.y });
    shape(grid)?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true }),
    );
    expect(grid.objectPosition(tab, doc.objects[0]).y).toBe(before.y + 10);
    shape(grid)?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    return Promise.resolve().then(() => {
      expect(doc.objects).toHaveLength(0);
    });
  });

  it('lets go of the objects on a press on a cell', () => {
    const { grid, doc, tab, state } = setup();
    doc.setObjectsOn(undefined, [rect()]);
    state.objectSelection.select(tab, ['o1']);
    grid.element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(state.objectSelection.selected(tab)).toEqual([]);
  });

  it('places an object at a position given in the object list', () => {
    const { grid, doc, tab } = setup();
    doc.setObjectsOn(undefined, [rect()]);
    const moved = grid.objectMovedTo(tab, doc.objects[0], 0, 0);
    expect(moved).toMatchObject({ row: 0, col: 0, dx: 0, dy: 0, width: 100 });
    const back = grid.objectMovedTo(
      tab,
      doc.objects[0],
      ...(Object.values(grid.objectPosition(tab, rect())) as [number, number]),
    );
    expect(back).toMatchObject({ row: 2, col: 1, dx: 4, dy: 3 });
  });
});

describe('sheet objects: the object list', () => {
  it('lists objects front first, selects one, and edits its properties', () => {
    const { state, commands, grid, tab, doc } = setup();
    doc.setObjectsOn(undefined, [rect(), rect({ id: 'o2', name: 'Top' })]);
    const panel = new ObjectsPanel(state, commands, grid);
    document.body.append(panel.element);
    state.subscribe(() => panel.render());
    panel.open();
    const names = () => [...panel.element.querySelectorAll('.objects-name')].map((n) => n.textContent);
    expect(names()).toEqual(['Top', 'Box']);
    panel.element.querySelectorAll<HTMLButtonElement>('.objects-name')[1].click();
    expect(state.objectSelection.selected(tab)).toEqual(['o1']);
    const width = panel.element.querySelector<HTMLInputElement>('[data-focus-key="width"]');
    expect(width?.value).toBe('100');
    // Sizes are whole px only: no unit choice.
    expect(panel.element.querySelector('[data-focus-key="unit"]')).toBeNull();
    width!.value = '140';
    width!.dispatchEvent(new Event('change'));
    expect(doc.objects[0].width).toBe(140);
    const text = panel.element.querySelector<HTMLTextAreaElement>('[data-focus-key="text"]');
    text!.value = 'Label';
    text!.dispatchEvent(new Event('change'));
    expect(doc.objects[0].text).toBe('Label');
    // The lock in the list disables the position fields.
    panel.element.querySelector<HTMLButtonElement>('[data-focus-key="o1:lockPosition"]')!.click();
    expect(doc.objects[0].lockPosition).toBe(true);
    expect(panel.element.querySelector<HTMLInputElement>('[data-focus-key="x"]')?.disabled).toBe(true);
    // Up in the list is forward in the drawing order.
    panel.element.querySelector<HTMLButtonElement>('[data-focus-key="o1:up"]')!.click();
    expect(doc.objects.map((o) => o.id)).toEqual(['o2', 'o1']);
  });
});
