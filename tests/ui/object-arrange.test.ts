// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * Groups of sheet objects, lining objects up and spacing them out, and the
 * guides objects snap to while dragged: the pure pieces, the commands, the
 * file key, and picking and dragging on the grid.
 */
import { describe, expect, it, vi } from 'vitest';
import { AppState } from '../../src/app/state';
import { Commands, type UiPort } from '../../src/app/commands';
import { RsfDocument } from '../../src/core/workbook/rsf-document';
import { arrangeBoxes, nextGroupId, withGroups } from '../../src/core/workbook/object-arrange';
import { validateObject, type SheetObject } from '../../src/core/workbook/sheet-objects';
import { Grid } from '../../src/ui/grid';
import { snapMove } from '../../src/ui/grid/object-guides';
import { rsfFromTree, rsfTree } from '../rsf-single-sheet';

function setup() {
  const state = new AppState();
  const ui = new Proxy({} as UiPort, { get: () => vi.fn(async () => null) });
  const commands = new Commands(state, ui, document);
  const grid = new Grid(state, commands);
  Object.defineProperty(grid.element, 'clientHeight', { value: 400, configurable: true });
  Object.defineProperty(grid.element, 'clientWidth', { value: 800, configurable: true });
  document.body.append(grid.element);
  state.subscribe((e) => (e === 'selection' ? grid.refreshSelection() : grid.refresh()));
  commands.objectGeometry = {
    objectPosition: (tab, o) => grid.objectPosition(tab, o),
    objectMovedTo: (tab, o, x, y) => grid.objectMovedTo(tab, o, x, y),
  };
  const doc = RsfDocument.empty('t.rsf', 20, 10);
  doc.markSaved();
  const tab = state.addTab('t.rsf', doc, null);
  grid.refresh();
  return { state, grid, commands, tab, doc };
}

const box = (id: string, dx: number, dy: number, width = 40, height = 20, extra: Partial<SheetObject> = {}) =>
  ({ id, name: id, kind: 'rect', row: 0, col: 0, dx, dy, width, height, ...extra }) as SheetObject;

describe('object arrange: the pure pieces', () => {
  const boxes = [
    { x: 10, y: 0, w: 20, h: 10 },
    { x: 50, y: 30, w: 40, h: 20 },
    { x: 200, y: 5, w: 10, h: 10 },
  ];

  it('lines boxes up on an outer edge or the middle', () => {
    expect(arrangeBoxes(boxes, 'alignLeft').map((p) => p.x)).toEqual([10, 10, 10]);
    expect(arrangeBoxes(boxes, 'alignRight').map((p) => p.x)).toEqual([190, 170, 200]);
    expect(arrangeBoxes(boxes, 'alignCenter').map((p) => p.x)).toEqual([100, 90, 105]);
    expect(arrangeBoxes(boxes, 'alignBottom').map((p) => p.y)).toEqual([40, 30, 40]);
    expect(arrangeBoxes(boxes, 'alignTop').map((p) => p.y)).toEqual([0, 0, 0]);
  });

  it('spaces boxes so the gaps are equal, keeping the first and last', () => {
    // 10–30, 50–90, 200–210: 130 of gap in all, 65 each.
    expect(arrangeBoxes(boxes, 'distributeHorizontally').map((p) => p.x)).toEqual([10, 95, 200]);
  });

  it('finds whole groups and a free group id', () => {
    const objects = [
      box('a', 0, 0, 1, 1, { group: 'g1' }),
      box('b', 0, 0),
      box('c', 0, 0, 1, 1, { group: 'g1' }),
    ];
    expect(withGroups(objects, ['c'])).toEqual(['a', 'c']);
    expect(withGroups(objects, ['b'])).toEqual(['b']);
    expect(nextGroupId(objects)).toBe('g2');
  });

  it('snaps a moved box to another box and says where the guide goes', () => {
    const other = { x: 100, y: 100, w: 50, h: 50 };
    // Left edge 3px from the other's left edge, far on y.
    expect(snapMove({ x: 0, y: 0, w: 20, h: 20 }, [other], 97, 0)).toEqual({
      dx: 100,
      dy: 0,
      guides: [{ axis: 'x', at: 100, from: 0, to: 150 }],
    });
    // Middles line up.
    expect(snapMove({ x: 0, y: 0, w: 20, h: 20 }, [other], 0, 113).dy).toBe(115);
    expect(snapMove({ x: 0, y: 0, w: 20, h: 20 }, [other], 60, 60)).toEqual({ dx: 60, dy: 60, guides: [] });
  });

  it('checks the group id and keeps it through a save', () => {
    expect(validateObject(box('a', 0, 0, 1, 1, { group: 'g 1' }), 5, 5)).toBeNull();
    const { doc } = setup();
    doc.setObjectsOn(undefined, [box('a', 0, 0, 1, 1, { group: 'g1' })]);
    expect(rsfTree(doc.toBytes()).sheets[0].objects[0].group).toBe('g1');
    const bad = rsfFromTree({
      format: 'refrain-sheet',
      version: 1,
      sheets: [
        {
          id: 's1',
          name: 'S',
          rows: 2,
          cols: 2,
          cells: [],
          objects: [
            { id: 'o1', name: 'B', kind: 'rect', at: 'A1', dx: 0, dy: 0, width: 1, height: 1, group: 7 },
          ],
        },
      ],
    });
    const read = RsfDocument.fromBytes(bad, 't.rsf');
    expect(read.ok ? 'ok' : read.error).toBe('bad-shape');
  });
});

describe('object arrange: commands', () => {
  it('groups and ungroups the selection, each one undoable step', () => {
    const { commands, doc, tab, state } = setup();
    doc.setObjectsOn(undefined, [box('a', 0, 0), box('b', 50, 0), box('c', 100, 0)]);
    state.objectSelection.select(tab, ['a', 'c']);
    expect(commands.isEnabled('object.ungroup')).toBe(false);
    commands.run('object.group');
    expect(doc.objects.map((o) => o.group)).toEqual(['g1', undefined, 'g1']);
    expect(commands.isEnabled('object.group')).toBe(false);
    state.objectSelection.select(tab, ['a']);
    commands.run('object.ungroup');
    expect(doc.objects.every((o) => o.group === undefined)).toBe(true);
    state.undo(tab);
    expect(doc.objects.map((o) => o.group)).toEqual(['g1', undefined, 'g1']);
  });

  it('gives a pasted copy of a group its own group', async () => {
    const { commands, doc, tab, state } = setup();
    doc.setObjectsOn(undefined, [
      box('a', 0, 0, 40, 20, { group: 'g1' }),
      box('b', 50, 0, 40, 20, { group: 'g1' }),
    ]);
    state.objectSelection.select(tab, ['a', 'b']);
    await commands.objectActions.paste(tab, commands.objectActions.copySelected(tab)!);
    expect(doc.objects.map((o) => o.group)).toEqual(['g1', 'g1', 'g2', 'g2']);
  });

  it('lines objects up, a whole selected group moving as one', () => {
    const { commands, doc, tab, state, grid } = setup();
    doc.setObjectsOn(undefined, [
      box('a', 10, 5, 40, 20, { group: 'g1' }),
      box('b', 30, 40, 40, 20, { group: 'g1' }),
      box('c', 200, 80, 40, 20),
    ]);
    state.objectSelection.select(tab, ['a', 'b', 'c']);
    commands.run('object.alignTop');
    const at = (id: string) => doc.objects.find((o) => o.id === id)!;
    const y = (id: string) => grid.objectPosition(tab, at(id)).y;
    // The group keeps its layout: b stays 35px below a.
    expect([y('a'), y('b'), y('c')]).toEqual([5, 40, 5]);
    expect(commands.isEnabled('object.distributeHorizontally')).toBe(false);
    state.undo(tab);
    expect(y('c')).toBe(80);
  });
});

describe('object arrange: the grid', () => {
  const press = (grid: Grid, id: string, init: MouseEventInit = {}) => {
    const node = grid.element.querySelector<HTMLElement>(`[data-object-id="${id}"]`)!;
    node.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 0, clientY: 0, ...init }),
    );
    return node;
  };
  const release = (x = 0, y = 0, init: MouseEventInit = {}) => {
    document.dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: y, ...init }));
    document.dispatchEvent(new MouseEvent('pointerup', { clientX: x, clientY: y, ...init }));
  };

  it('picks a whole group, then one member on a second click', () => {
    const { grid, doc, tab, state } = setup();
    doc.setObjectsOn(undefined, [
      box('a', 0, 0, 40, 20, { group: 'g1' }),
      box('b', 100, 0, 40, 20, { group: 'g1' }),
    ]);
    grid.refresh();
    press(grid, 'b');
    release();
    expect(state.objectSelection.selected(tab)).toEqual(['a', 'b']);
    press(grid, 'b');
    release();
    expect(state.objectSelection.selected(tab)).toEqual(['b']);
  });

  it('snaps a dragged object to another one and shows a guide while dragging', () => {
    const { grid, doc, tab } = setup();
    doc.setObjectsOn(undefined, [box('a', 0, 0), box('b', 200, 100)]);
    grid.refresh();
    press(grid, 'a');
    document.dispatchEvent(new MouseEvent('pointermove', { clientX: 197, clientY: 30 }));
    expect(grid.element.querySelectorAll('.sheet-object-guide')).toHaveLength(1);
    release(197, 30);
    expect(grid.element.querySelectorAll('.sheet-object-guide')).toHaveLength(0);
    expect(grid.objectPosition(tab, doc.objects[0])).toEqual({ x: 200, y: 30 });
  });
});
