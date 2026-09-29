// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * Grid-paper sheets: adding one, the file key, empty squares, the square
 * grid, objects placed and dragged on squares, and printing.
 */
import { describe, expect, it, vi } from 'vitest';
import { AppState } from '../../src/app/state';
import { Commands, type UiPort } from '../../src/app/commands';
import { DEFAULT_PRINT_SETTINGS } from '../../src/core/print-layout';
import { RsfDocument } from '../../src/core/workbook/rsf-document';
import type { SheetObject } from '../../src/core/workbook/sheet-objects';
import { Grid } from '../../src/ui/grid';
import { printTab } from '../../src/ui/print-view';
import { rsfFromTree, rsfTree } from '../rsf-single-sheet';

function setup() {
  const state = new AppState();
  const announced: string[] = [];
  state.announce = (message) => announced.push(message);
  const ui = new Proxy({} as UiPort, {
    get: (_target, key) =>
      key === 'promptSheetName'
        ? vi.fn(async () => ({ name: 'Paper1', kind: 'paper' }))
        : vi.fn(async () => null),
  });
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
  return { state, grid, commands, tab, doc, announced };
}

async function withPaper() {
  const env = setup();
  await env.commands.run('worksheet.add');
  env.grid.refresh();
  return env;
}

describe('grid paper', () => {
  it('adds a grid-paper sheet from the Add Sheet dialog, as one undoable step', async () => {
    const { doc, tab, state } = await withPaper();
    expect(doc.sheets).toHaveLength(2);
    const paper = doc.activeSheet;
    expect([paper.name, paper.paper, paper.rowCount, paper.columnCount]).toEqual(['Paper1', 20, 200, 80]);
    state.undo(tab);
    expect(doc.sheets).toHaveLength(1);
  });

  it('keeps the square size in the file, and refuses a bad one', async () => {
    const { doc } = await withPaper();
    const tree = rsfTree(doc.toBytes());
    expect(tree.sheets[1].paper).toBe(20);
    const reread = RsfDocument.fromBytes(doc.toBytes(), 't.rsf');
    expect(reread.ok && reread.doc.sheets[1].paper).toBe(20);
    const bad = (paper: unknown, kind?: string) =>
      RsfDocument.fromBytes(
        rsfFromTree({
          format: 'refrain-sheet',
          version: 1,
          sheets: [{ id: 's1', name: 'S', rows: 2, cols: 2, cells: [], paper, ...(kind ? { kind } : {}) }],
        }),
        't.rsf',
      );
    for (const read of [bad(4), bad('20'), bad(20.5)]) {
      expect(read.ok ? 'ok' : read.error).toBe('bad-shape');
    }
  });

  it('keeps its squares empty and says where text goes', async () => {
    const { state, tab, doc, announced } = await withPaper();
    expect(state.editCell(tab, 0, 0, 'x')).toBe(false);
    expect(doc.activeSheet.getValue(0, 0)).toBe('');
    expect(announced[announced.length - 1]).toContain('Text Box');
  });

  it('draws every row and column one square wide, and ordinary sheets as before', async () => {
    const { grid, tab, doc, state } = await withPaper();
    expect(grid.objectPosition(tab, box('a', 3, 2))).toEqual({ x: 60, y: 40 });
    state.setActiveSheet(tab, doc.sheets[0].id);
    grid.refresh();
    expect(grid.objectPosition(tab, box('a', 3, 2))).toEqual({ x: 3 * 104, y: 2 * 24 });
  });

  it('puts a new text box over the selected squares, and other shapes on whole squares', async () => {
    const { commands, doc, tab, state } = await withPaper();
    state.setSelection(tab, { row: 1, col: 2 }, { row: 2, col: 6 });
    await commands.run('insert.textBox');
    expect(pick(doc.objects[0])).toEqual({ row: 1, col: 2, dx: 0, dy: 0, width: 100, height: 40 });
    state.setSelection(tab, { row: 5, col: 0 }, { row: 5, col: 0 });
    await commands.run('insert.ellipse');
    expect(pick(doc.objects[1])).toEqual({ row: 5, col: 0, dx: 0, dy: 0, width: 100, height: 80 });
  });

  it('moves a dragged object from square to square', async () => {
    const { grid, doc } = await withPaper();
    doc.setObjectsOn(undefined, [box('a', 0, 0)]);
    grid.refresh();
    const node = grid.element.querySelector<HTMLElement>('[data-object-id="a"]')!;
    node.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 0, clientY: 0 }));
    document.dispatchEvent(new MouseEvent('pointermove', { clientX: 27, clientY: 52 }));
    document.dispatchEvent(new MouseEvent('pointerup', { clientX: 27, clientY: 52 }));
    expect(pick(doc.objects[0])).toMatchObject({ row: 3, col: 1, dx: 0, dy: 0 });
  });

  it('prints squares of the same size', async () => {
    const { state, tab, doc } = await withPaper();
    doc.setObjectsOn(undefined, [box('a', 1, 1)]);
    let widths: string[] = [];
    let height = '';
    const win = {
      document,
      onafterprint: null,
      addEventListener: (type: string, fn: () => void) => window.addEventListener(type, fn),
      removeEventListener: (type: string, fn: () => void) => window.removeEventListener(type, fn),
      print: () => {
        const table = document.querySelector('.print-table.print-paper')!;
        widths = Array.from(table.querySelectorAll('col')).map((c) => (c as HTMLElement).style.width);
        height = table.querySelector<HTMLElement>('tbody tr')!.style.height;
        window.dispatchEvent(new Event('afterprint'));
      },
    } as unknown as Window;
    printTab(state, tab, DEFAULT_PRINT_SETTINGS, win);
    expect(widths).toEqual(['20px', '20px']);
    expect(height).toBe('20px');
  });
});

function box(id: string, col: number, row: number): SheetObject {
  return { id, name: id, kind: 'rect', row, col, dx: 0, dy: 0, width: 40, height: 20 };
}

function pick(o: SheetObject) {
  return { row: o.row, col: o.col, dx: o.dx, dy: o.dy, width: o.width, height: o.height };
}
