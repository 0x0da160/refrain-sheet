// SPDX-License-Identifier: MIT
/**
 * The chart settings in the objects panel (`objects-panel.ts`): the chart's
 * type, the worksheet and range it shows, whether series run down the
 * columns or across the rows, its titles, legend, data labels and series
 * colors. Each change hands the whole new chart to `apply`, one undoable
 * step through the panel.
 */
import { colorField } from './color-picker';
import { t } from '../app/i18n';
import {
  CHART_LEGENDS,
  CHART_TYPES,
  chartColor,
  chartDataToRows,
  chartRangeLabel,
  chartSourceFits,
  MAX_CHART_SERIES,
  MAX_CHART_TEXT,
  parseChartRange,
  type ChartData,
  type ChartSpec,
} from '../core/workbook/sheet-charts';
import { panelCheck, panelField, panelSection } from './dialogs/side-panel';
import { el } from './dom';

interface ChartSheet {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly rowCount: number;
  readonly columnCount: number;
}

export interface ChartPanelContext {
  spec: ChartSpec;
  /** What the chart shows now (null: nothing). */
  data: ChartData | null;
  /** The file's worksheets, in tab order. */
  sheets: readonly ChartSheet[];
  disabled: boolean;
  apply: (spec: ChartSpec) => void;
  /** Replace the data the chart keeps (rows as `chartDataToRows` writes them). */
  editData: (rows: string[][]) => void;
  /** Put the data the chart keeps into a new sheet and show those cells. */
  dataToSheet: () => void;
}

/** `spec` with `key` set to `value`, or left out when `value` is undefined. */
function withSetting<K extends keyof ChartSpec>(
  spec: ChartSpec,
  key: K,
  value: ChartSpec[K] | undefined,
): ChartSpec {
  const next = { ...spec };
  if (value === undefined) {
    delete next[key];
  } else {
    next[key] = value;
  }
  return next;
}

function select(
  key: string,
  options: ReadonlyArray<[value: string, label: string]>,
  current: string,
  disabled: boolean,
  onChange: (value: string) => void,
): HTMLSelectElement {
  const box = el('select', { attrs: { 'data-focus-key': key } }) as HTMLSelectElement;
  for (const [value, label] of options) {
    box.append(el('option', { text: label, attrs: { value } }));
  }
  box.value = current;
  box.disabled = disabled;
  box.addEventListener('change', () => onChange(box.value));
  return box;
}

function input(
  type: string,
  key: string,
  value: string,
  disabled: boolean,
  onChange: (value: string) => void,
): HTMLInputElement {
  const box = el('input', { attrs: { type, 'data-focus-key': key } }) as HTMLInputElement;
  box.value = value;
  box.disabled = disabled;
  box.addEventListener('change', () => onChange(box.value));
  return box;
}

/** The worksheet and range: picking both points the chart at those cells (again). */
function dataFields(ctx: ChartPanelContext): HTMLElement[] {
  const { spec, disabled } = ctx;
  const grids = ctx.sheets.filter((sheet) => sheet.kind === 'grid');
  const source = spec.source;
  const sheet = select(
    'chart:sheet',
    [
      ...(source ? [] : [['', t('panel.objects.chart.kept')] as [string, string]]),
      ...grids.map((s): [string, string] => [s.id, s.name]),
    ],
    source?.sheetId ?? '',
    disabled,
    () => pointAt(),
  );
  const range = input('text', 'chart:range', source ? chartRangeLabel(source) : '', disabled, () =>
    pointAt(),
  );
  range.spellcheck = false;
  function pointAt(): void {
    const target = grids.find((s) => s.id === sheet.value);
    const at = parseChartRange(range.value);
    if (!target || !at) {
      return;
    }
    const next = { sheetId: target.id, ...at };
    if (!chartSourceFits(next, target.rowCount, target.columnCount)) {
      return;
    }
    const linked = withSetting(spec, 'data', undefined);
    ctx.apply({ ...linked, source: next });
  }
  const series = select(
    'chart:seriesInRows',
    [
      ['columns', t('panel.objects.chart.seriesInColumns')],
      ['rows', t('panel.objects.chart.seriesInRows')],
    ],
    spec.seriesInRows ? 'rows' : 'columns',
    disabled || !source,
    (value) => ctx.apply(withSetting(spec, 'seriesInRows', value === 'rows' ? true : undefined)),
  );
  const fields = [
    panelField(t('panel.objects.chart.sheet'), sheet),
    panelField(t('panel.objects.chart.range'), range),
    panelField(t('panel.objects.chart.series'), series),
  ];
  if (!source) {
    fields.push(...keptDataFields(ctx));
  }
  return fields;
}

/**
 * The data a chart keeps (its worksheet was deleted, or it was pasted from
 * another file), editable as tab-separated text, and the way back to cells.
 */
function keptDataFields(ctx: ChartPanelContext): HTMLElement[] {
  const rows = ctx.spec.data ? chartDataToRows(ctx.spec.data, (n) => t('chart.series', { n })) : [];
  const text = el('textarea', {
    className: 'objects-text objects-chart-data',
    attrs: { rows: '5', spellcheck: 'false', wrap: 'off', 'data-focus-key': 'chart:data' },
  }) as HTMLTextAreaElement;
  text.value = rows.map((row) => row.join('\t')).join('\n');
  text.disabled = ctx.disabled;
  text.addEventListener('change', () =>
    ctx.editData(text.value.split(/\r?\n/).map((line) => line.split('\t'))),
  );
  const toSheet = el('button', {
    className: 'panel-button',
    text: t('panel.objects.chart.dataToSheet'),
    attrs: { type: 'button', 'data-focus-key': 'chart:dataToSheet' },
  }) as HTMLButtonElement;
  toSheet.disabled = ctx.disabled;
  toSheet.addEventListener('click', () => ctx.dataToSheet());
  return [
    el('p', { className: 'dialog-note', text: t('panel.objects.chart.keptNote') }),
    panelField(t('panel.objects.chart.data'), text),
    toSheet,
  ];
}

function textField(
  ctx: ChartPanelContext,
  key: 'title' | 'xTitle' | 'yTitle',
  disabled: boolean,
): HTMLElement {
  const box = input('text', `chart:${key}`, ctx.spec[key] ?? '', disabled, (value) =>
    ctx.apply(withSetting(ctx.spec, key, value.trim() === '' ? undefined : value.slice(0, MAX_CHART_TEXT))),
  );
  box.maxLength = MAX_CHART_TEXT;
  return panelField(t(`panel.objects.chart.${key}`), box);
}

/** One color per series (pie: per slice), named as the chart names it. */
function colorFields(ctx: ChartPanelContext): HTMLElement[] {
  const { spec, data } = ctx;
  if (!data) {
    return [];
  }
  const names =
    spec.type === 'pie'
      ? data.categories
      : data.series.map((s, i) => s.name ?? t('chart.series', { n: i + 1 }));
  return names.slice(0, MAX_CHART_SERIES).map((name, i) => {
    const label = name === '' ? t('chart.series', { n: i + 1 }) : name;
    const box = colorField(null, chartColor(spec, i), label);
    box.dataset.focusKey = `chart:color:${i}`;
    box.disabled = ctx.disabled;
    box.addEventListener('change', () => {
      const colors = Array.from({ length: i + 1 }, (_, n) => chartColor(spec, n));
      colors[i] = box.value.toLowerCase();
      ctx.apply({ ...spec, colors: [...colors, ...(spec.colors?.slice(i + 1) ?? [])] });
    });
    return panelField(label, box);
  });
}

export function chartSection(ctx: ChartPanelContext): HTMLElement {
  const { spec, disabled } = ctx;
  const type = select(
    'chart:type',
    CHART_TYPES.map((value): [string, string] => [value, t(`panel.objects.chart.type.${value}`)]),
    spec.type,
    disabled,
    (value) => ctx.apply({ ...spec, type: value as ChartSpec['type'] }),
  );
  const legend = select(
    'chart:legend',
    CHART_LEGENDS.map((value): [string, string] => [value, t(`panel.objects.chart.legend.${value}`)]),
    spec.legend ?? 'right',
    disabled,
    (value) =>
      ctx.apply(withSetting(spec, 'legend', value === 'right' ? undefined : (value as 'bottom' | 'none'))),
  );
  const labels = el('input', {
    attrs: { type: 'checkbox', 'data-focus-key': 'chart:dataLabels' },
  }) as HTMLInputElement;
  labels.checked = spec.dataLabels === true;
  labels.disabled = disabled;
  labels.addEventListener('change', () =>
    ctx.apply(withSetting(spec, 'dataLabels', labels.checked ? true : undefined)),
  );
  const colors = colorFields(ctx);
  return panelSection(t('panel.objects.chart'), [
    panelField(t('panel.objects.chart.type'), type),
    ...dataFields(ctx),
    textField(ctx, 'title', disabled),
    el('div', { className: 'objects-grid' }, [
      textField(ctx, 'xTitle', disabled || spec.type === 'pie'),
      textField(ctx, 'yTitle', disabled || spec.type === 'pie'),
    ]),
    panelField(t('panel.objects.chart.legend'), legend),
    panelCheck(labels, t('panel.objects.chart.dataLabels')),
    ...(colors.length > 0
      ? [
          el('p', { className: 'dialog-note', text: t('panel.objects.chart.colors') }),
          el('div', { className: 'objects-grid' }, colors),
        ]
      : []),
  ]);
}
