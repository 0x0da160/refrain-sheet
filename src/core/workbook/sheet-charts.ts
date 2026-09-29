// SPDX-License-Identifier: MIT
/**
 * Charts over a spreadsheet worksheet: a bar, line or pie chart object
 * (`SheetObject.chart`, see `sheet-objects.ts`) that shows one rectangular
 * range of a spreadsheet worksheet, recalculated whenever the cells change.
 *
 * A chart names its range by worksheet id, so renaming the worksheet keeps
 * it. Inserting or deleting rows or columns in that worksheet moves and
 * grows or shrinks the range with the cells ({@link shiftChartSources}).
 * When the worksheet is deleted, the chart keeps the data it showed then
 * (`data` in place of `source`, see {@link embedChartData}); undoing the
 * deletion brings the range back.
 *
 * Which cells are names and which are values is read from the range
 * itself (see {@link chartData}): the first row holds the series names when
 * any of its cells is text, and the first column the category names when
 * any of its cells is text.
 */
import { cellLabel, formatValue, parseRef, type FormulaValue } from '../formula';
import { normalizeHexColor } from './cell-style';

export const CHART_TYPES = ['bar', 'line', 'pie'] as const;
type ChartType = (typeof CHART_TYPES)[number];
export const CHART_LEGENDS = ['right', 'bottom', 'none'] as const;

/** The cells a chart shows: a range of one worksheet (document rows and columns, inclusive). */
export interface ChartSource {
  sheetId: string;
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/** What a chart shows: category names and, per series, a name and one value per category. */
export interface ChartData {
  categories: string[];
  /** `name` null: the series has no name of its own ("Series 1"…). A value null: no number there. */
  series: Array<{ name: string | null; values: Array<number | null> }>;
}

export interface ChartSpec {
  type: ChartType;
  /** The cells shown. Exactly one of `source` and `data` is set. */
  source?: ChartSource;
  /** The data kept by the chart itself (its worksheet was deleted). */
  data?: ChartData;
  /** Each row of the range is a series (by default each column is). */
  seriesInRows?: true;
  title?: string;
  /** Where the legend goes; left out: at the right. Shown only for two or more series (pie: slices). */
  legend?: 'bottom' | 'none';
  /** The category axis and value axis titles (bar and line). */
  xTitle?: string;
  yTitle?: string;
  /** `#rrggbb` per series (pie: per slice), in order; left out or short: the default colors. */
  colors?: string[];
  /** Show each value next to its bar, point or slice. */
  dataLabels?: true;
}

/** Most series and categories a chart shows (the rest of a larger range is left out). */
export const MAX_CHART_SERIES = 50;
const MAX_CHART_CATEGORIES = 1000;
/** Longest title, axis title, series or category name. */
export const MAX_CHART_TEXT = 255;

/**
 * The default series colors, in order: a fixed categorical order, never
 * cycled into new hues (a ninth series repeats from the first). Chosen for
 * the white chart surface: every adjacent pair stays apart for readers
 * with a color vision deficiency.
 */
const DEFAULT_CHART_COLORS = [
  '#2a78d6',
  '#eb6834',
  '#1baf7a',
  '#eda100',
  '#e87ba4',
  '#008300',
  '#4a3aa7',
  '#e34948',
] as const;

/** The color of series (pie: slice) `index`. */
export function chartColor(spec: ChartSpec, index: number): string {
  return spec.colors?.[index] ?? DEFAULT_CHART_COLORS[index % DEFAULT_CHART_COLORS.length];
}

// ----- Validation -----

const SHEET_ID = /^.{1,255}$/s;

function text(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_CHART_TEXT;
}

function sourceValid(s: ChartSource): boolean {
  const index = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
  return (
    typeof s === 'object' &&
    s !== null &&
    typeof s.sheetId === 'string' &&
    SHEET_ID.test(s.sheetId) &&
    index(s.top) &&
    index(s.left) &&
    index(s.bottom) &&
    index(s.right) &&
    s.top <= s.bottom &&
    s.left <= s.right
  );
}

function dataValid(d: ChartData): boolean {
  if (typeof d !== 'object' || d === null || !Array.isArray(d.categories) || !Array.isArray(d.series)) {
    return false;
  }
  const n = d.categories.length;
  return (
    n <= MAX_CHART_CATEGORIES &&
    d.series.length <= MAX_CHART_SERIES &&
    d.categories.every(text) &&
    d.series.every(
      (s) =>
        typeof s === 'object' &&
        s !== null &&
        (s.name === null || text(s.name)) &&
        Array.isArray(s.values) &&
        s.values.length === n &&
        s.values.every((v) => v === null || (typeof v === 'number' && Number.isFinite(v))),
    )
  );
}

/**
 * Whether a chart's settings are all in range (whether its worksheet and
 * range exist is checked against the workbook, {@link chartSourceFits}).
 */
export function chartSpecValid(spec: ChartSpec): boolean {
  const optional = <T>(value: T | undefined, test: (value: T) => boolean): boolean =>
    value === undefined || test(value);
  return (
    typeof spec === 'object' &&
    spec !== null &&
    (CHART_TYPES as readonly string[]).includes(spec.type) &&
    (spec.source === undefined) !== (spec.data === undefined) &&
    optional(spec.source, sourceValid) &&
    optional(spec.data, dataValid) &&
    optional(spec.title, text) &&
    optional(spec.xTitle, text) &&
    optional(spec.yTitle, text) &&
    optional(spec.legend, (l) => l === 'bottom' || l === 'none') &&
    optional(
      spec.colors,
      (colors) =>
        Array.isArray(colors) &&
        colors.length <= MAX_CHART_SERIES &&
        colors.every((c) => typeof c === 'string' && normalizeHexColor(c) === c),
    ) &&
    [spec.seriesInRows, spec.dataLabels].every((flag) => flag === undefined || flag === true)
  );
}

/** Whether a chart's range lies inside a worksheet of `rows` × `cols`. */
export function chartSourceFits(source: ChartSource, rows: number, cols: number): boolean {
  return source.bottom < rows && source.right < cols;
}

/** A chart's range as `A1:C5` (top-left first, as the file writes it). */
export function chartRangeLabel(s: Omit<ChartSource, 'sheetId'>): string {
  return `${cellLabel(s.top, s.left)}:${cellLabel(s.bottom, s.right)}`;
}

/** The range typed as `A1:C5` (any corners, any case, `$` allowed), or null. */
export function parseChartRange(text: string): Omit<ChartSource, 'sheetId'> | null {
  const ends = text.replace(/\$/g, '').trim().toUpperCase().split(':');
  const a = ends.length === 2 ? parseRef(ends[0].trim()) : null;
  const b = ends.length === 2 ? parseRef(ends[1].trim()) : null;
  if (!a || !b) {
    return null;
  }
  return {
    top: Math.min(a.row, b.row),
    left: Math.min(a.col, b.col),
    bottom: Math.max(a.row, b.row),
    right: Math.max(a.col, b.col),
  };
}

// ----- The data a chart shows -----

/** What a chart reads its cells through (a `Workbook`). */
export interface ChartCells<S> {
  sheetById(id: string): S | null;
  evaluateInSheet(sheet: S, row: number, col: number): FormulaValue;
}

function isText(value: FormulaValue): boolean {
  return value.type === 'string' && value.value.trim() !== '';
}

/**
 * The categories and series a chart shows now: its kept `data`, or its
 * range's values read as this module's header explains. Null when its worksheet
 * is gone.
 */
export function chartData<S>(book: ChartCells<S>, spec: ChartSpec): ChartData | null {
  if (spec.data) {
    return spec.data;
  }
  const source = spec.source;
  const sheet = source ? book.sheetById(source.sheetId) : null;
  if (!source || !sheet) {
    return null;
  }
  // Series run down the columns: read [series][point] either way.
  const rows = spec.seriesInRows ? source.right - source.left + 1 : source.bottom - source.top + 1;
  const cols = spec.seriesInRows ? source.bottom - source.top + 1 : source.right - source.left + 1;
  const at = (r: number, c: number): FormulaValue =>
    spec.seriesInRows
      ? book.evaluateInSheet(sheet, source.top + c, source.left + r)
      : book.evaluateInSheet(sheet, source.top + r, source.left + c);
  const rowCount = Math.min(rows, MAX_CHART_CATEGORIES + 1);
  const colCount = Math.min(cols, MAX_CHART_SERIES + 1);
  let headerRow = false;
  for (let c = 0; c < colCount && rows > 1 && !headerRow; c++) {
    headerRow = (c > 0 || cols === 1) && isText(at(0, c));
  }
  const first = headerRow ? 1 : 0;
  let categoryCol = false;
  for (let r = first; r < rowCount && cols > 1 && !categoryCol; r++) {
    categoryCol = isText(at(r, 0));
  }
  // An empty corner above text names is a label too.
  if (headerRow && cols > 1 && at(0, 0).type === 'empty') {
    categoryCol = true;
  }
  const categories: string[] = [];
  for (let r = first; r < rowCount && categories.length < MAX_CHART_CATEGORIES; r++) {
    categories.push(categoryCol ? formatValue(at(r, 0)).slice(0, MAX_CHART_TEXT) : String(r - first + 1));
  }
  const series: ChartData['series'] = [];
  for (let c = categoryCol ? 1 : 0; c < colCount && series.length < MAX_CHART_SERIES; c++) {
    const name = headerRow ? formatValue(at(0, c)).slice(0, MAX_CHART_TEXT) : null;
    const values = categories.map((_, i) => {
      const value = at(first + i, c);
      return value.type === 'number' && Number.isFinite(value.value) ? value.value : null;
    });
    series.push({ name, values });
  }
  return { categories, series };
}

/**
 * The block of filled cells around (`row`, `col`), for a chart inserted
 * from a single selected cell: grown one row or column at a time while
 * the next one holds anything, up to the chart limits.
 */
export function dataRegionAround(
  filled: (row: number, col: number) => boolean,
  row: number,
  col: number,
  rows: number,
  cols: number,
): { top: number; left: number; bottom: number; right: number } {
  let top = row;
  let left = col;
  let bottom = row;
  let right = col;
  const rowHas = (r: number): boolean => {
    for (let c = left; c <= right; c++) if (filled(r, c)) return true;
    return false;
  };
  const colHas = (c: number): boolean => {
    for (let r = top; r <= bottom; r++) if (filled(r, c)) return true;
    return false;
  };
  for (let grew = true; grew;) {
    const tall = bottom - top < MAX_CHART_CATEGORIES;
    const wide = right - left < MAX_CHART_SERIES;
    const up = top > 0 && tall && rowHas(top - 1);
    const down = bottom < rows - 1 && tall && rowHas(bottom + 1);
    const back = left > 0 && wide && colHas(left - 1);
    const on = right < cols - 1 && wide && colHas(right + 1);
    top -= up ? 1 : 0;
    bottom += down ? 1 : 0;
    left -= back ? 1 : 0;
    right += on ? 1 : 0;
    grew = up || down || back || on;
  }
  return { top, left, bottom, right };
}

// ----- Following the worksheet -----

type Spanned = { chart?: ChartSpec };

/** A range after `count` rows (or columns) were inserted at `index`, or deleted from it, in its worksheet. */
function shiftSpan(
  from: number,
  to: number,
  action: 'insert' | 'delete',
  index: number,
  count: number,
  limit: number,
): [number, number] {
  if (action === 'insert') {
    return [from >= index ? from + count : from, to >= index ? to + count : to];
  }
  const end = index + count;
  let a = from < index ? from : from >= end ? from - count : index;
  let b = to < index ? to : to >= end ? to - count : index - 1;
  if (b < a) {
    // Every cell was deleted: it keeps one row (column) where they were.
    b = a;
  }
  a = Math.max(0, Math.min(a, limit - 1));
  b = Math.max(a, Math.min(b, limit - 1));
  return [a, b];
}

/**
 * The objects with every chart that shows worksheet `sheetId` following
 * a row or column insert or delete there (`limit`: that axis's length after
 * it). Objects that do not change are kept as they are.
 */
function shiftChartSources<T extends Spanned>(
  objects: readonly T[],
  sheetId: string,
  axis: 'row' | 'col',
  action: 'insert' | 'delete',
  index: number,
  count: number,
  limit: number,
): T[] {
  return objects.map((o) => {
    const source = o.chart?.source;
    if (!source || source.sheetId !== sheetId) {
      return o;
    }
    const next = { ...source };
    if (axis === 'row') {
      [next.top, next.bottom] = shiftSpan(source.top, source.bottom, action, index, count, limit);
    } else {
      [next.left, next.right] = shiftSpan(source.left, source.right, action, index, count, limit);
    }
    return next.top === source.top &&
      next.bottom === source.bottom &&
      next.left === source.left &&
      next.right === source.right
      ? o
      : { ...o, chart: { ...o.chart!, source: next } };
  });
}

/**
 * After rows or columns of worksheet `changed` were inserted or deleted,
 * move the range of every chart (on any of `sheets`) that shows it along
 * with its cells.
 */
export function followCharts(
  sheets: ReadonlyArray<{ objects: readonly Spanned[] }>,
  changed: { id: string; rowCount: number; columnCount: number },
  axis: 'row' | 'col',
  action: 'insert' | 'delete',
  index: number,
  count: number,
): void {
  const limit = axis === 'row' ? changed.rowCount : changed.columnCount;
  for (const sheet of sheets) {
    const next = shiftChartSources(sheet.objects, changed.id, axis, action, index, count, limit);
    if (next.some((o, i) => o !== sheet.objects[i])) {
      sheet.objects = next;
    }
  }
}

/** Whether any of `objects` is a chart showing one of the worksheets `sheetIds`. */
export function showsSheet(objects: readonly Spanned[], sheetIds: readonly string[]): boolean {
  return objects.some((o) => o.chart?.source !== undefined && sheetIds.includes(o.chart.source.sheetId));
}

/**
 * For each other worksheet with a chart that shows one of `sheetIds` (those
 * worksheets are about to be deleted), its objects before and after every
 * such chart keeps the data it shows now instead.
 */
export function embedChartData<T extends Spanned, S>(
  sheets: ReadonlyArray<{ id: string; objects: readonly T[] }>,
  sheetIds: readonly string[],
  book: ChartCells<S>,
): Array<{ sheetId: string; before: readonly T[]; after: T[] }> {
  return sheets
    .filter((sheet) => !sheetIds.includes(sheet.id) && showsSheet(sheet.objects, sheetIds))
    .map((sheet) => ({
      sheetId: sheet.id,
      before: sheet.objects,
      after: keepChartData(sheet.objects, sheetIds, book),
    }));
}

function keepChartData<T extends Spanned, S>(
  objects: readonly T[],
  sheetIds: readonly string[],
  book: ChartCells<S>,
): T[] {
  return objects.map((o) => {
    const chart = o.chart;
    if (!chart?.source || !sheetIds.includes(chart.source.sheetId)) {
      return o;
    }
    const data = chartData(book, chart) ?? { categories: [], series: [] };
    const next: ChartSpec = { ...chart, data };
    delete next.source;
    delete next.seriesInRows;
    return { ...o, chart: next };
  });
}

/**
 * Worksheet records about to be saved, with every chart whose range is not
 * in one of them (never expected: deleting a worksheet keeps its charts'
 * data) keeping no data instead, so the file never names a range the
 * reader would reject.
 */
export function detachLostCharts(
  sheets: ReadonlyArray<{
    id: string;
    kind?: string;
    rowCount: number;
    columnCount: number;
    objects?: Spanned[];
  }>,
): void {
  const byId = new Map(sheets.map((sheet) => [sheet.id, sheet]));
  for (const sheet of sheets) {
    sheet.objects = sheet.objects?.map((o) => {
      const source = o.chart?.source;
      const target = source ? byId.get(source.sheetId) : undefined;
      if (
        !source ||
        (target &&
          (target.kind ?? 'grid') === 'grid' &&
          chartSourceFits(source, target.rowCount, target.columnCount))
      ) {
        return o;
      }
      const chart: ChartSpec = { ...o.chart!, data: { categories: [], series: [] } };
      delete chart.source;
      delete chart.seriesInRows;
      return { ...o, chart };
    });
    if (sheet.objects === undefined) delete sheet.objects;
  }
}
