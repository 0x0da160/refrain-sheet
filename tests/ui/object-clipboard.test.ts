// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * Copying, cutting and pasting sheet objects: onto the same sheet (moved a
 * little), another sheet (a chart keeps its range) and another file (a chart
 * keeps the copied data, a picture comes along); Ctrl+C / Ctrl+V through the
 * clipboard events; and the data a chart keeps, edited as text or put into a
 * new sheet in one undoable step.
 */
import { describe, expect, it, vi } from 'vitest';
import { AppState } from '../../src/app/state';
import { Commands, type UiPort } from '../../src/app/commands';
import { ClipboardController } from '../../src/app/clipboard-controller';
import { RsfDocument } from '../../src/core/workbook/rsf-document';
import { chartDataFromRows, chartDataToRows, type ChartData } from '../../src/core/workbook/sheet-charts';
import type { SheetObject } from '../../src/core/workbook/sheet-objects';
import { Grid } from '../../src/ui/grid';
import { ObjectsPanel } from '../../src/ui/objects-panel';
import { doc as csvDoc } from '../helpers';

/** A 1 × 1 PNG. */
const PNG = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0, 144,
  119, 83, 222, 0, 0, 0, 12, 73, 68, 65, 84, 120, 156, 99, 248, 207, 192, 0, 0, 3, 1, 1, 0, 201, 254, 146,
  239, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
]);

function setup() {
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
  const clipboard = new ClipboardController(state, commands, notify, document);
  const doc = RsfDocument.empty('a.rsf', 8, 5);
  doc.markSaved();
  const tab = state.addTab('a.rsf', doc, null);
  [
    ['', 'East'],
    ['Jan', '10'],
    ['Feb', '20'],
  ].forEach((row, r) => row.forEach((v, c) => doc.setCell(r, c, v)));
  const picture = doc.images.add({ type: 'image/png', bytes: PNG });
  const source = { sheetId: doc.activeSheetId, top: 0, left: 0, bottom: 2, right: 1 };
  const objects: SheetObject[] = [
    { id: 'o1', name: 'Box', kind: 'rect', row: 1, col: 3, dx: 4, dy: 2, width: 100, height: 50 },
    {
      id: 'o2',
      name: 'Logo',
      kind: 'image',
      row: 0,
      col: 0,
      dx: 0,
      dy: 0,
      width: 20,
      height: 20,
      image: picture,
    },
    {
      id: 'o3',
      name: 'Chart',
      kind: 'chart',
      row: 4,
      col: 0,
      dx: 0,
      dy: 0,
      width: 300,
      height: 200,
      chart: { type: 'bar', source, seriesInRows: true },
    },
  ];
  doc.setObjectsOn(undefined, objects);
  return { state, commands, clipboard, doc, tab, notify, source, picture };
}

/** A clipboard event carrying `text`, recording what the handler writes. */
function clipboardEvent(text = ''): ClipboardEvent & { written: Map<string, string> } {
  const written = new Map<string, string>();
  return {
    written,
    clipboardData: {
      getData: (type: string) => (type === 'text/plain' ? text : ''),
      setData: (type: string, value: string) => written.set(type, value),
      files: [],
    },
    preventDefault: vi.fn(),
  } as unknown as ClipboardEvent & { written: Map<string, string> };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('object clipboard: commands', () => {
  it('pastes a copy onto the same sheet a little down and right, with new ids, selected', async () => {
    const { commands, doc, tab, state } = setup();
    state.objectSelection.select(tab, ['o1', 'o3']);
    const clip = commands.objectActions.copySelected(tab)!;
    expect(await commands.objectActions.paste(tab, clip)).toBe(true);
    expect(doc.objects).toHaveLength(5);
    const [box, chart] = doc.objects.slice(3);
    expect(box).toMatchObject({ id: 'o4', name: 'Box', row: 1, col: 3, dx: 14, dy: 12 });
    expect(chart).toMatchObject({ id: 'o5', chart: doc.objects[2].chart });
    expect(state.objectSelection.selected(tab)).toEqual(['o4', 'o5']);
    state.undo(tab);
    expect(doc.objects).toHaveLength(3);
  });

  it('keeps a chart on its range when pasted onto another sheet of the same file', async () => {
    const { commands, doc, tab, state, source } = setup();
    state.objectSelection.select(tab, ['o3']);
    const clip = commands.objectActions.copySelected(tab)!;
    const other = state.addSheet(tab, 'Other')!;
    expect(doc.activeSheetId).toBe(other.id);
    await commands.objectActions.paste(tab, clip);
    expect(doc.objects[0]).toMatchObject({ row: 4, col: 0, dx: 0, dy: 0, chart: { source } });
  });

  it('keeps the copied data and brings the picture along when pasted into another file', async () => {
    const { commands, tab, state, picture } = setup();
    state.objectSelection.select(tab, ['o2', 'o3']);
    const clip = commands.objectActions.copySelected(tab)!;
    const target = RsfDocument.empty('b.rsf', 3, 3);
    const other = state.addTab('b.rsf', target, null);
    await commands.objectActions.paste(other, clip);
    const [logo, chart] = target.objects;
    expect(target.images.get(logo.image!)?.bytes).toEqual(PNG);
    expect(logo.image).toBe(picture);
    // The chart showed each row as a series; its data keeps that shape without the range.
    expect(chart.row).toBe(2);
    expect(chart.chart).toEqual({
      type: 'bar',
      data: {
        categories: ['East'],
        series: [
          { name: 'Jan', values: [10] },
          { name: 'Feb', values: [20] },
        ],
      },
    });
    expect(RsfDocument.fromBytes(target.toBytes(), 'b.rsf').ok).toBe(true);
  });

  it('converts a CSV file before pasting onto it', async () => {
    const { commands, tab, state } = setup();
    state.objectSelection.select(tab, ['o1']);
    const clip = commands.objectActions.copySelected(tab)!;
    const csv = state.addTab('c.csv', csvDoc('a,b\n'), null);
    await commands.objectActions.paste(csv, clip);
    expect(csv.doc).toBeInstanceOf(RsfDocument);
    expect((csv.doc as RsfDocument).objects).toHaveLength(1);
  });
});

describe('object clipboard: Ctrl+C, Ctrl+X, Ctrl+V', () => {
  it('copies the selected objects as their names and pastes them while the clipboard holds those', async () => {
    const { clipboard, doc, tab, state } = setup();
    state.objectSelection.select(tab, ['o1', 'o2']);
    const copy = clipboardEvent();
    expect(clipboard.handleCopyEvent(copy)).toBe(true);
    expect(copy.written.get('text/plain')).toBe('Box\nLogo');
    expect(clipboard.handlePasteEvent(clipboardEvent('Box\nLogo'))).toBe(true);
    await settle();
    expect(doc.objects).toHaveLength(5);
    // Text copied elsewhere since goes into the cells instead.
    state.setSelection(tab, { row: 7, col: 0 });
    expect(clipboard.handlePasteEvent(clipboardEvent('hello'))).toBe(true);
    await settle();
    expect(doc.objects).toHaveLength(5);
    expect(doc.getValue(7, 0)).toBe('hello');
  });

  it('cuts objects (not the cells under them)', () => {
    const { clipboard, doc, tab, state } = setup();
    state.objectSelection.select(tab, ['o1']);
    state.setSelection(tab, { row: 1, col: 1 });
    state.objectSelection.select(tab, ['o1']);
    expect(clipboard.handleCutEvent(clipboardEvent())).toBe(true);
    expect(doc.objects.map((o) => o.id)).toEqual(['o2', 'o3']);
    expect(doc.getValue(1, 1)).toBe('10');
  });

  it('copies cells again once no object is selected', () => {
    const { clipboard, tab, state } = setup();
    state.objectSelection.select(tab, ['o1']);
    clipboard.handleCopyEvent(clipboardEvent());
    state.objectSelection.select(tab, []);
    state.setSelection(tab, { row: 1, col: 0 });
    const copy = clipboardEvent();
    clipboard.handleCopyEvent(copy);
    expect(copy.written.get('text/plain')).toBe('Jan');
  });
});

describe('object clipboard: the data a chart keeps', () => {
  const kept: ChartData = {
    categories: ['Q1', 'Q2'],
    series: [
      { name: 'East', values: [1, null] },
      { name: null, values: [2.5, -3] },
    ],
  };

  it('writes the data as rows and reads rows back', () => {
    const rows = chartDataToRows(kept, (n) => `Series ${n}`);
    expect(rows).toEqual([
      ['', 'East', 'Series 2'],
      ['Q1', '1', '2.5'],
      ['Q2', '', '-3'],
    ]);
    expect(chartDataFromRows(rows)).toEqual({
      categories: ['Q1', 'Q2'],
      series: [
        { name: 'East', values: [1, null] },
        { name: 'Series 2', values: [2.5, -3] },
      ],
    });
    expect(chartDataFromRows([['', 'A'], ['x', 'no'], ['y']])).toEqual({
      categories: ['x', 'y'],
      series: [{ name: 'A', values: [null, null] }],
    });
  });

  it('puts the data into a new sheet and shows those cells, undone in one step', () => {
    const { commands, doc, tab, state } = setup();
    const chartSheet = doc.activeSheetId;
    doc.setObjectsOn(undefined, [
      {
        id: 'c1',
        name: 'C',
        kind: 'chart',
        row: 0,
        col: 0,
        dx: 0,
        dy: 0,
        width: 9,
        height: 9,
        chart: { type: 'line', data: kept },
      },
    ]);
    const name = commands.objectActions.chartDataToSheet(tab, 'c1');
    expect(name).toBe('Chart Data');
    const added = doc.sheets.find((s) => s.name === name)!;
    const chart = doc.sheetById(chartSheet)!.objects[0].chart!;
    expect(chart).toEqual({
      type: 'line',
      source: { sheetId: added.id, top: 0, left: 0, bottom: 2, right: 2 },
    });
    // The cells read back as the same data (the unnamed series is now named).
    expect(doc.evaluateInSheet(added, 1, 2)).toEqual({ type: 'number', value: 2.5 });
    state.undo(tab);
    expect(doc.sheets.some((s) => s.name === name)).toBe(false);
    expect(doc.sheetById(chartSheet)!.objects[0].chart).toEqual({ type: 'line', data: kept });
  });

  it('edits the kept data and puts it in a new sheet from the object list', async () => {
    const { commands, doc, tab, state } = setup();
    doc.setObjectsOn(undefined, [
      {
        id: 'c1',
        name: 'C',
        kind: 'chart',
        row: 0,
        col: 0,
        dx: 0,
        dy: 0,
        width: 9,
        height: 9,
        chart: { type: 'line', data: kept },
      },
    ]);
    const grid = new Grid(state, commands);
    const panel = new ObjectsPanel(state, commands, grid);
    document.body.append(panel.element);
    state.subscribe(() => panel.render());
    panel.open();
    state.objectSelection.select(tab, ['c1']);
    const data = panel.element.querySelector<HTMLTextAreaElement>('[data-focus-key="chart:data"]')!;
    expect(data.value).toBe('\tEast\tSeries 2\nQ1\t1\t2.5\nQ2\t\t-3');
    data.value = '\tWest\nA\t5\nB\t6\nC\t7';
    data.dispatchEvent(new Event('change'));
    await settle();
    expect(doc.objects[0].chart!.data).toEqual({
      categories: ['A', 'B', 'C'],
      series: [{ name: 'West', values: [5, 6, 7] }],
    });
    panel.element.querySelector<HTMLButtonElement>('[data-focus-key="chart:dataToSheet"]')!.click();
    expect(doc.activeSheet.name).toBe('Chart Data');
  });
});
