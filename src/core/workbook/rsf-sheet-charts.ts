// SPDX-License-Identifier: MIT
/**
 * A chart object's `chart` key in `.rsf` (knowledge/formats/rsf/json-document.md):
 * its type, the range it shows (`{ "sheet": "<worksheet id>", "range": "A1:C5" }`)
 * or the data it keeps, and its titles, legend, colors and labels. Like
 * every key in the codec, a known key with the wrong shape fails the whole
 * file; whether the worksheet and range exist is checked with the file's
 * worksheets ({@link checkChartSources}).
 */
import { cellLabel, parseRef } from '../formula';
import {
  chartRangeLabel,
  chartSourceFits,
  type ChartData,
  type ChartSource,
  type ChartSpec,
} from './sheet-charts';
import type { SheetObject } from './sheet-objects';

type Fail = (reason?: 'too-large') => never;
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** The settings written only when set, in this order. */
const PLAIN_KEYS = ['seriesInRows', 'title', 'legend', 'xTitle', 'yTitle', 'colors', 'dataLabels'] as const;

export function chartToJson(spec: ChartSpec): { [key: string]: Json } {
  const out: { [key: string]: Json } = { type: spec.type };
  if (spec.source) {
    const s = spec.source;
    out.source = { sheet: s.sheetId, range: chartRangeLabel(s) };
  }
  if (spec.data) {
    out.data = {
      categories: spec.data.categories.slice(),
      series: spec.data.series.map((s) => ({
        ...(s.name !== null ? { name: s.name } : {}),
        values: s.values.slice(),
      })),
    };
  }
  for (const key of PLAIN_KEYS) {
    const value = spec[key];
    if (value !== undefined) {
      out[key] = Array.isArray(value) ? value.slice() : value;
    }
  }
  return out;
}

function object(value: unknown, fail: Fail): { [key: string]: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as { [key: string]: unknown })
    : fail();
}

function sourceFromJson(value: unknown, fail: Fail): ChartSource {
  const { sheet, range } = object(value, fail);
  const ends = typeof range === 'string' ? range.split(':') : [];
  const a = ends.length === 2 ? parseRef(ends[0]) : null;
  const b = ends.length === 2 ? parseRef(ends[1]) : null;
  // The range exactly as the writer spells it (upper case, no `$`, top-left first).
  if (!a || !b || `${cellLabel(a.row, a.col)}:${cellLabel(b.row, b.col)}` !== range) {
    return fail();
  }
  return { sheetId: sheet as string, top: a.row, left: a.col, bottom: b.row, right: b.col };
}

function dataFromJson(value: unknown, fail: Fail): ChartData {
  const { categories, series } = object(value, fail);
  if (!Array.isArray(series)) {
    return fail();
  }
  return {
    categories: categories as string[],
    series: series.map((raw: unknown) => {
      const { name, values } = object(raw, fail);
      return { name: name === undefined ? null : (name as string), values: values as Array<number | null> };
    }),
  };
}

/** A chart's settings as read (ranges and types are checked with the object: `chartSpecValid`). */
export function chartFromJson(value: unknown, fail: Fail): ChartSpec {
  const entry = object(value, fail);
  const spec = { type: entry.type } as ChartSpec;
  if (entry.source !== undefined) spec.source = sourceFromJson(entry.source, fail);
  if (entry.data !== undefined) spec.data = dataFromJson(entry.data, fail);
  for (const key of PLAIN_KEYS) {
    if (entry[key] !== undefined) {
      (spec as unknown as Record<string, unknown>)[key] = entry[key];
    }
  }
  return spec;
}

/** Fails the file when a chart shows a worksheet it does not hold, or cells outside it. */
export function checkChartSources(
  sheets: ReadonlyArray<{
    id: string;
    kind?: string;
    rowCount: number;
    columnCount: number;
    objects?: readonly SheetObject[];
  }>,
  fail: Fail,
): void {
  const byId = new Map(sheets.map((sheet) => [sheet.id, sheet]));
  for (const sheet of sheets) {
    for (const o of sheet.objects ?? []) {
      const source = o.chart?.source;
      const target = source ? byId.get(source.sheetId) : undefined;
      if (
        source &&
        (!target ||
          (target.kind ?? 'grid') !== 'grid' ||
          !chartSourceFits(source, target.rowCount, target.columnCount))
      ) {
        fail();
      }
    }
  }
}
