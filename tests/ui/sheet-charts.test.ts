// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * Charts over a worksheet: which cells are names and which are values, the
 * `.rsf` round trip and what the reader refuses, Insert > Chart, ranges that
 * follow inserted, deleted and moved rows, a deleted source worksheet (the
 * chart keeps its data, undo brings the range back), and the drawing and
 * settings in the grid and the object list.
 */
import { describe, expect, it, vi } from 'vitest';
import { AppState } from '../../src/app/state';
import { Commands, type UiPort } from '../../src/app/commands';
import { RsfDocument } from '../../src/core/workbook/rsf-document';
import {
  chartData,
  chartRangeLabel,
  dataRegionAround,
  parseChartRange,
  type ChartSpec,
} from '../../src/core/workbook/sheet-charts';
import { validateObject, type SheetObject } from '../../src/core/workbook/sheet-objects';
import { Grid } from '../../src/ui/grid';
import { ObjectsPanel } from '../../src/ui/objects-panel';
import { rsfFromTree, rsfTree } from '../rsf-single-sheet';

function setup() {
  const state = new AppState();
  const notify = vi.fn();
  const confirmDeleteSheet = vi.fn(async () => true);
  const fakes = new Map<string | symbol, unknown>([
    ['notify', notify],
    ['confirmConvert', vi.fn(async () => true)],
    ['confirmDeleteSheet', confirmDeleteSheet],
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
  const doc = RsfDocument.empty('t.rsf', 8, 5);
  doc.markSaved();
  const tab = state.addTab('t.rsf', doc, null);
  // Sheet1: a header row, month names down column A, two series.
  const rows = [
    ['', 'East', 'West'],
    ['Jan', '10', '4'],
    ['Feb', '=B2*2', ''],
    ['Mar', '5', '-2'],
  ];
  rows.forEach((row, r) => row.forEach((v, c) => doc.setCell(r, c, v)));
  grid.refresh();
  return { state, grid, commands, tab, doc, notify, confirmDeleteSheet };
}

const chartObject = (chart: ChartSpec, overrides: Partial<SheetObject> = {}): SheetObject => ({
  id: 'c1',
  name: 'Chart 1',
  kind: 'chart',
  row: 0,
  col: 4,
  dx: 0,
  dy: 0,
  width: 480,
  height: 300,
  chart,
  ...overrides,
});

describe('sheet charts: the data', () => {
  it('reads series names from the first row and categories from the first column', () => {
    const { doc } = setup();
    const source = { sheetId: doc.activeSheetId, top: 0, left: 0, bottom: 3, right: 2 };
    expect(chartData(doc, { type: 'bar', source })).toEqual({
      categories: ['Jan', 'Feb', 'Mar'],
      series: [
        { name: 'East', values: [10, 20, 5] },
        { name: 'West', values: [4, null, -2] },
      ],
    });
    expect(chartData(doc, { type: 'bar', source, seriesInRows: true })).toEqual({
      categories: ['East', 'West'],
      series: [
        { name: 'Jan', values: [10, 4] },
        { name: 'Feb', values: [20, null] },
        { name: 'Mar', values: [5, -2] },
      ],
    });
    // Numbers only: no names, categories counted.
    expect(chartData(doc, { type: 'line', source: { ...source, top: 1, left: 1 } })).toEqual({
      categories: ['1', '2', '3'],
      series: [
        { name: null, values: [10, 20, 5] },
        { name: null, values: [4, null, -2] },
      ],
    });
    expect(chartData(doc, { type: 'bar', source: { ...source, sheetId: 'gone' } })).toBeNull();
  });

  it('finds the filled block around a cell and reads typed ranges', () => {
    const filled = (r: number, c: number) => r >= 1 && r <= 3 && c >= 2 && c <= 4;
    expect(dataRegionAround(filled, 2, 3, 10, 10)).toEqual({ top: 1, left: 2, bottom: 3, right: 4 });
    expect(parseChartRange(' c5:$a$1 ')).toEqual({ top: 0, left: 0, bottom: 4, right: 2 });
    expect(parseChartRange('A1')).toBeNull();
    expect(parseChartRange('A1:B')).toBeNull();
    expect(chartRangeLabel({ top: 0, left: 0, bottom: 4, right: 2 })).toBe('A1:C5');
  });

  it('validates the chart fields of an object', () => {
    const source = { sheetId: 's1', top: 0, left: 0, bottom: 1, right: 1 };
    expect(validateObject(chartObject({ type: 'pie', source }), 10, 10)).not.toBeNull();
    for (const bad of [
      chartObject({ type: 'area' as 'bar', source }),
      chartObject({ type: 'bar' }),
      chartObject({ type: 'bar', source, data: { categories: [], series: [] } }),
      chartObject({ type: 'bar', source: { ...source, top: 2 } }),
      chartObject({ type: 'bar', source, colors: ['red'] }),
      chartObject({ type: 'bar', source }, { text: 'hi' }),
      chartObject({ type: 'bar', source }, { kind: 'rect' }),
      { ...chartObject({ type: 'bar', source }), chart: undefined },
    ]) {
      expect(validateObject(bad, 10, 10)).toBeNull();
    }
  });
});

describe('sheet charts: the file', () => {
  it('writes the range as A1 text and reads it back', () => {
    const { doc } = setup();
    const source = { sheetId: doc.activeSheetId, top: 0, left: 0, bottom: 3, right: 2 };
    const o = chartObject({ type: 'pie', source, title: 'Sales', legend: 'none', dataLabels: true });
    doc.setObjectsOn(undefined, [o]);
    const tree = rsfTree(doc.toBytes());
    expect(tree.sheets[0].objects[0].chart).toEqual({
      type: 'pie',
      source: { sheet: doc.activeSheetId, range: 'A1:C4' },
      title: 'Sales',
      legend: 'none',
      dataLabels: true,
    });
    const reopened = RsfDocument.fromBytes(doc.toBytes(), 't.rsf');
    expect(reopened.ok && reopened.doc.objects).toEqual([o]);
  });

  it('refuses a chart whose worksheet or range the file does not hold', () => {
    const file = (chart: unknown) =>
      rsfFromTree({
        format: 'refrain-sheet',
        version: 1,
        sheets: [
          {
            id: 's1',
            name: 'Sheet1',
            rows: 3,
            cols: 3,
            cells: [['a']],
            objects: [
              { id: 'o1', name: 'C', kind: 'chart', at: 'A1', dx: 0, dy: 0, width: 10, height: 10, chart },
            ],
          },
        ],
      });
    const good = { type: 'bar', source: { sheet: 's1', range: 'A1:C3' } };
    expect(RsfDocument.fromBytes(file(good), 't.rsf').ok).toBe(true);
    expect(
      RsfDocument.fromBytes(
        file({ type: 'bar', data: { categories: ['a'], series: [{ values: [1] }] } }),
        't.rsf',
      ).ok,
    ).toBe(true);
    for (const chart of [
      { ...good, source: { sheet: 's2', range: 'A1:C3' } },
      { ...good, source: { sheet: 's1', range: 'A1:D3' } },
      { ...good, source: { sheet: 's1', range: 'a1:c3' } },
      { ...good, source: { sheet: 's1', range: 'C3:A1' } },
      { ...good, source: 'A1:C3' },
      { type: 'bar' },
      { ...good, data: { categories: [], series: [] } },
      { type: 'bar', data: { categories: ['a'], series: [{ values: [1, 2] }] } },
      { ...good, legend: 'left' },
      'bar',
    ]) {
      const result = RsfDocument.fromBytes(file(chart), 't.rsf');
      expect(result.ok ? 'ok' : result.error).toBe('bad-shape');
    }
  });
});

describe('sheet charts: commands', () => {
  it('charts the filled block around the selected cell, beside it, and undoes it', async () => {
    const { doc, tab, commands, state } = setup();
    state.setSelection(tab, { row: 2, col: 1 });
    await commands.run('insert.chart');
    expect(doc.objects).toHaveLength(1);
    expect(doc.objects[0]).toMatchObject({
      kind: 'chart',
      row: 0,
      col: 3,
      chart: { type: 'bar', source: { sheetId: doc.activeSheetId, top: 0, left: 0, bottom: 3, right: 2 } },
    });
    expect(state.objectSelection.selected(tab)).toEqual([doc.objects[0].id]);
    state.undo(tab);
    expect(doc.objects).toHaveLength(0);
  });

  it('says so when there is nothing to chart', async () => {
    const { doc, tab, commands, state, notify } = setup();
    state.setSelection(tab, { row: 7, col: 4 });
    await commands.run('insert.chart');
    expect(doc.objects).toHaveLength(0);
    expect(notify).toHaveBeenCalledWith(expect.any(String), 'warn');
  });

  it('follows rows and columns inserted, deleted and moved in its worksheet, from another worksheet', () => {
    const { doc, tab, state } = setup();
    const data = doc.activeSheetId;
    const other = state.addSheet(tab, 'Charts')!;
    const source = { sheetId: data, top: 0, left: 0, bottom: 3, right: 2 };
    doc.setObjectsOn(other.id, [chartObject({ type: 'bar', source })]);
    const on = () => doc.sheetById(other.id)!.objects[0].chart!.source;
    state.setActiveSheet(tab, data);
    expect(state.insertRows(tab, 2, 2)).toBe(true);
    expect(on()).toEqual({ ...source, bottom: 5 });
    expect(state.insertCols(tab, 0, 1)).toBe(true);
    expect(on()).toEqual({ ...source, bottom: 5, left: 1, right: 3 });
    expect(state.deleteRows(tab, 0, 1)).toBe(true);
    expect(on()).toEqual({ ...source, bottom: 4, left: 1, right: 3 });
    state.undo(tab);
    state.undo(tab);
    state.undo(tab);
    expect(on()).toEqual(source);
    // A move keeps the range; undoing it too.
    expect(state.moveAxis(tab, 'row', 0, 1, 3)).toBe(true);
    expect(on()).toEqual(source);
    state.undo(tab);
    expect(on()).toEqual(source);
  });

  it('keeps the data when its worksheet is deleted, and brings the range back on undo', async () => {
    const { doc, tab, state, commands, confirmDeleteSheet } = setup();
    const data = doc.activeSheetId;
    const other = state.addSheet(tab, 'Charts')!;
    const source = { sheetId: data, top: 0, left: 0, bottom: 3, right: 2 };
    doc.setObjectsOn(other.id, [chartObject({ type: 'bar', source, seriesInRows: true })]);
    const shown = chartData(doc, { type: 'bar', source, seriesInRows: true });
    state.setActiveSheet(tab, data);
    await commands.run('worksheet.delete');
    expect(confirmDeleteSheet).toHaveBeenCalledWith('Sheet1', 0, 1);
    const kept = doc.sheetById(other.id)!.objects[0].chart!;
    expect(kept).toEqual({ type: 'bar', data: shown });
    expect(RsfDocument.fromBytes(doc.toBytes(), 't.rsf').ok).toBe(true);
    state.undo(tab);
    expect(doc.sheetById(other.id)!.objects[0].chart).toEqual({ type: 'bar', source, seriesInRows: true });
  });
});

describe('sheet charts: the grid and the object list', () => {
  it('draws the bars and redraws when a cell changes', () => {
    const { grid, doc } = setup();
    const source = { sheetId: doc.activeSheetId, top: 0, left: 0, bottom: 3, right: 2 };
    doc.setObjectsOn(undefined, [chartObject({ type: 'bar', source, title: 'Sales' })]);
    grid.refresh();
    const svg = () => grid.element.querySelector('.sheet-object-chart svg.sheet-chart')!;
    expect(svg()).not.toBeNull();
    // Five values (one is empty), a legend for the two series, and the title as text.
    expect(svg().querySelectorAll('path[fill="#2a78d6"]')).toHaveLength(3);
    expect(svg().querySelectorAll('path[fill="#eb6834"]')).toHaveLength(2);
    expect([...svg().querySelectorAll('text')].map((t) => t.textContent)).toContain('Sales');
    expect(svg().querySelector('path title')?.textContent).toBe('East: Jan = 10');
    doc.setCell(2, 2, '7');
    grid.refresh();
    expect(svg().querySelectorAll('path[fill="#eb6834"]')).toHaveLength(3);
  });

  it('shows the no-data text when the chart has no numbers', () => {
    const { grid, doc } = setup();
    const source = { sheetId: doc.activeSheetId, top: 5, left: 0, bottom: 6, right: 1 };
    doc.setObjectsOn(undefined, [chartObject({ type: 'line', source })]);
    grid.refresh();
    const texts = [...grid.element.querySelectorAll('.sheet-chart text')].map((t) => t.textContent);
    expect(texts).toEqual(['No numbers to show']);
  });

  it('changes the type, range, series direction and titles from the object list', async () => {
    const { state, commands, grid, tab, doc } = setup();
    const source = { sheetId: doc.activeSheetId, top: 0, left: 0, bottom: 3, right: 2 };
    doc.setObjectsOn(undefined, [chartObject({ type: 'bar', source })]);
    const panel = new ObjectsPanel(state, commands, grid);
    document.body.append(panel.element);
    state.subscribe(() => panel.render());
    panel.open();
    state.objectSelection.select(tab, ['c1']);
    const field = (key: string) =>
      panel.element.querySelector<HTMLInputElement>(`[data-focus-key="${key}"]`)!;
    const set = async (key: string, value: string) => {
      field(key).value = value;
      field(key).dispatchEvent(new Event('change'));
      await new Promise((resolve) => setTimeout(resolve, 0));
    };
    // No fill, line or text for a chart.
    expect(panel.element.querySelector('[data-focus-key="fill"]')).toBeNull();
    expect(panel.element.querySelector('[data-focus-key="text"]')).toBeNull();
    expect(field('chart:range').value).toBe('A1:C4');
    await set('chart:type', 'line');
    await set('chart:range', 'a1:b3');
    await set('chart:seriesInRows', 'rows');
    await set('chart:title', 'Sales');
    await set('chart:legend', 'bottom');
    await set('chart:color:1', '#123456');
    expect(doc.objects[0].chart).toEqual({
      type: 'line',
      source: { ...source, bottom: 2, right: 1 },
      seriesInRows: true,
      title: 'Sales',
      legend: 'bottom',
      colors: ['#2a78d6', '#123456'],
    });
    // A range outside the worksheet is not taken.
    await set('chart:range', 'A1:Z99');
    expect(doc.objects[0].chart!.source).toEqual({ ...source, bottom: 2, right: 1 });
    state.undo(tab);
    expect(doc.objects[0].chart!.colors).toBeUndefined();
  });
});
