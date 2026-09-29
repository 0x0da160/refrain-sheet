// SPDX-License-Identifier: MIT
/**
 * How a chart object (`src/core/workbook/sheet-charts.ts`) is drawn: one
 * SVG on a white card, like a shape's own fill, so it reads the same in
 * either theme and when printed. Bars and columns are thin with a rounded
 * data end, lines 2px with ringed markers, pie slices parted by a thin gap
 * of the card color; gridlines are hairlines. A legend is shown for two or
 * more series (pie: slices), and every mark carries its value in a
 * tooltip. Text is set with `textContent` only.
 */
import { chartColor, type ChartData, type ChartSpec } from '../core/workbook/sheet-charts';

const SVG_NS = 'http://www.w3.org/2000/svg';
const SURFACE = '#ffffff';
const INK = '#1f1f1f';
const INK_SOFT = '#595959';
const GRID = '#e6e6e6';
const BASELINE = '#a6a6a6';

/** The words the chart shows that come from the application, not the file. */
export interface ChartWords {
  series: (n: number) => string;
  noData: string;
}

type Attrs = Record<string, string | number>;

function node(tag: string, attrs: Attrs = {}, text?: string): SVGElement {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) {
    element.setAttribute(name, String(value));
  }
  if (text !== undefined) {
    element.textContent = text;
  }
  return element;
}

function titled(element: SVGElement, tip: string): SVGElement {
  element.append(node('title', {}, tip));
  return element;
}

const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const formatNumber = (n: number): string => numberFormat.format(n);

/** Text cut to about `px` pixels at `size` (an estimate: no layout pass). */
function fit(text: string, px: number, size: number): string {
  const max = Math.max(1, Math.floor(px / (size * 0.6)));
  return text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`;
}

/** Round tick values covering `min`…`max` (about five steps). */
function ticks(min: number, max: number): number[] {
  if (min === max) {
    max = min + 1;
  }
  const raw = (max - min) / 5;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.floor(min / step) * step; v <= max + step * 1e-9; v += step) {
    out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  }
  if (out[out.length - 1] < max) out.push(out[out.length - 1] + step);
  return out;
}

/** A bar from `base` to `end` (y), `x`…`x + w`, with a 4px rounded data end and a square base. */
function barPath(x: number, w: number, base: number, end: number, r: number): string {
  const up = end < base;
  const radius = Math.min(r, w / 2, Math.abs(base - end));
  const tip = up ? end + radius : end - radius;
  const turn = up ? 0 : 1;
  return (
    `M${x},${base} L${x},${tip} ` +
    `A${radius},${radius} 0 0 ${turn === 0 ? 1 : 0} ${x + radius},${end} ` +
    `L${x + w - radius},${end} ` +
    `A${radius},${radius} 0 0 ${turn === 0 ? 1 : 0} ${x + w},${tip} L${x + w},${base} Z`
  );
}

interface Frame {
  svg: SVGElement;
  z: number;
  /** The area left for the plot after the title and legend. */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The card, title and legend; returns what is left for the plot. */
function frame(
  spec: ChartSpec,
  w: number,
  h: number,
  z: number,
  entries: Array<{ label: string; color: string }>,
): Frame {
  const svg = node('svg', { class: 'sheet-chart', width: Math.max(w, 1), height: Math.max(h, 1) });
  svg.append(
    node('rect', {
      x: 0.5,
      y: 0.5,
      width: Math.max(0, w - 1),
      height: Math.max(0, h - 1),
      rx: 4 * z,
      fill: SURFACE,
      stroke: '#d0d0d0',
    }),
  );
  const pad = 10 * z;
  let top = pad;
  let right = w - pad;
  let bottom = h - pad;
  if (spec.title) {
    const size = 14 * z;
    svg.append(
      node(
        'text',
        {
          x: w / 2,
          y: top + size,
          'text-anchor': 'middle',
          'font-size': size,
          'font-weight': 600,
          fill: INK,
        },
        fit(spec.title, w - 2 * pad, size),
      ),
    );
    top += size + 8 * z;
  }
  if (entries.length >= 2 && spec.legend !== 'none') {
    const size = 11 * z;
    const swatch = 10 * z;
    if (spec.legend === 'bottom') {
      const rowH = size + 6 * z;
      let x = pad;
      let rows = 1;
      const items: Array<[number, number, (typeof entries)[number], string]> = [];
      for (const entry of entries) {
        const label = fit(entry.label, 120 * z, size);
        const itemW = swatch + 4 * z + label.length * size * 0.6 + 12 * z;
        if (x + itemW > w - pad && x > pad) {
          x = pad;
          rows += 1;
        }
        items.push([x, rows, entry, label]);
        x += itemW;
      }
      bottom -= rows * rowH;
      for (const [ix, row, entry, label] of items) {
        const iy = bottom + (row - 1) * rowH + 4 * z;
        svg.append(
          node('rect', { x: ix, y: iy, width: swatch, height: swatch, rx: 2 * z, fill: entry.color }),
        );
        svg.append(
          node(
            'text',
            { x: ix + swatch + 4 * z, y: iy + swatch - 1 * z, 'font-size': size, fill: INK_SOFT },
            label,
          ),
        );
      }
    } else {
      const legendW = Math.min(w * 0.3, 140 * z);
      right -= legendW;
      entries.forEach((entry, i) => {
        const iy = top + i * (size + 6 * z);
        if (iy + size > h - pad) return;
        svg.append(
          node('rect', {
            x: right + 8 * z,
            y: iy,
            width: swatch,
            height: swatch,
            rx: 2 * z,
            fill: entry.color,
          }),
        );
        svg.append(
          node(
            'text',
            { x: right + 8 * z + swatch + 4 * z, y: iy + swatch - 1 * z, 'font-size': size, fill: INK_SOFT },
            fit(entry.label, legendW - swatch - 16 * z, size),
          ),
        );
      });
    }
  }
  return { svg, z, x: pad, y: top, w: Math.max(0, right - pad), h: Math.max(0, bottom - top) };
}

function seriesName(data: ChartData, i: number, words: ChartWords): string {
  return data.series[i].name || words.series(i + 1);
}

/** Where bars and lines go once the axes are drawn. */
interface Plot {
  left: number;
  bottom: number;
  /** Width of one category's band. */
  band: number;
  size: number;
  yOf: (v: number) => number;
  /** The y of the value axis's zero (or its nearest end). */
  zero: number;
}

/** The axis titles; returns the plot's left and bottom edges. */
function axisTitles(
  spec: ChartSpec,
  f: Frame,
  labelW: number,
  size: number,
): { left: number; bottom: number } {
  const { svg, z } = f;
  let left = f.x + labelW;
  let bottom = f.y + f.h - size - 6 * z;
  if (spec.yTitle) {
    left += size + 6 * z;
    const cy = f.y + (bottom - f.y) / 2;
    const attrs = { x: f.x + size, y: cy, transform: `rotate(-90 ${f.x + size} ${cy})` };
    svg.append(
      node(
        'text',
        { ...attrs, 'text-anchor': 'middle', 'font-size': size, fill: INK_SOFT },
        fit(spec.yTitle, bottom - f.y, size),
      ),
    );
  }
  if (spec.xTitle) {
    bottom -= size + 6 * z;
    svg.append(
      node(
        'text',
        {
          x: left + (f.x + f.w - left) / 2,
          y: f.y + f.h,
          'text-anchor': 'middle',
          'font-size': size,
          fill: INK_SOFT,
        },
        fit(spec.xTitle, f.w, size),
      ),
    );
  }
  return { left, bottom };
}

/** The value axis (gridlines and labels) and the category names; returns the plot. */
function axes(spec: ChartSpec, data: ChartData, f: Frame): Plot {
  const { svg, z } = f;
  const size = 10 * z;
  const values = data.series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const scale = ticks(Math.min(0, ...values), Math.max(0, ...values));
  const lo = scale[0];
  const hi = scale[scale.length - 1];
  const labelW = Math.max(...scale.map((v) => formatNumber(v).length)) * size * 0.6 + 6 * z;
  const { left, bottom } = axisTitles(spec, f, labelW, size);
  const top = f.y + size / 2;
  const width = Math.max(1, f.x + f.w - left);
  const height = Math.max(1, bottom - top);
  const yOf = (v: number): number => bottom - ((v - lo) / (hi - lo)) * height;
  for (const v of scale) {
    const y = yOf(v);
    const stroke = v === 0 ? BASELINE : GRID;
    svg.append(node('line', { x1: left, x2: left + width, y1: y, y2: y, stroke, 'stroke-width': 1 }));
    svg.append(
      node(
        'text',
        { x: left - 6 * z, y: y + size * 0.35, 'text-anchor': 'end', 'font-size': size, fill: INK_SOFT },
        formatNumber(v),
      ),
    );
  }
  const band = width / Math.max(1, data.categories.length);
  // Every k-th category name, so neighbours never collide.
  const every = Math.max(1, Math.ceil((size * 4) / band));
  data.categories.forEach((name, i) => {
    if (i % every === 0) {
      const at = { x: left + band * (i + 0.5), y: bottom + size + 4 * z };
      svg.append(
        node(
          'text',
          { ...at, 'text-anchor': 'middle', 'font-size': size, fill: INK_SOFT },
          fit(name, band * every - 4 * z, size),
        ),
      );
    }
  });
  return { left, bottom, band, size, yOf, zero: yOf(Math.max(lo, Math.min(0, hi))) };
}

function valueLabel(spec: ChartSpec, f: Frame, p: Plot, x: number, y: number, v: number): void {
  if (spec.dataLabels) {
    f.svg.append(
      node('text', { x, y, 'text-anchor': 'middle', 'font-size': p.size, fill: INK }, formatNumber(v)),
    );
  }
}

function tip(data: ChartData, si: number, i: number, v: number, words: ChartWords): string {
  return `${seriesName(data, si, words)}: ${data.categories[i]} = ${formatNumber(v)}`;
}

/** Bars side by side in each category's band, thin, with a rounded data end. */
function bars(spec: ChartSpec, data: ChartData, f: Frame, p: Plot, words: ChartWords): void {
  const { z } = f;
  const k = data.series.length;
  const gap = 2 * z;
  const barW = Math.max(1, Math.min(24 * z, (p.band * 0.8 - gap * (k - 1)) / Math.max(1, k)));
  const groupW = barW * k + gap * (k - 1);
  data.series.forEach((s, si) => {
    s.values.forEach((v, i) => {
      if (v === null) return;
      const x = p.left + p.band * i + (p.band - groupW) / 2 + si * (barW + gap);
      const end = p.yOf(v);
      const bar = node('path', { d: barPath(x, barW, p.zero, end, 4 * z), fill: chartColor(spec, si) });
      f.svg.append(titled(bar, tip(data, si, i, v, words)));
      valueLabel(spec, f, p, x + barW / 2, v >= 0 ? end - 4 * z : end + p.size + 2 * z, v);
    });
  });
}

/** A 2px line per series with a ringed marker at each value; a gap where a value is missing. */
function lines(spec: ChartSpec, data: ChartData, f: Frame, p: Plot, words: ChartWords): void {
  const { svg, z } = f;
  const xOf = (i: number): number => p.left + p.band * (i + 0.5);
  data.series.forEach((s, si) => {
    const color = chartColor(spec, si);
    let d = '';
    s.values.forEach((v, i) => {
      if (v === null) return;
      d += `${d === '' || s.values[i - 1] === null ? 'M' : 'L'}${xOf(i)},${p.yOf(v)} `;
    });
    svg.append(
      node('path', {
        d: d.trim(),
        fill: 'none',
        stroke: color,
        'stroke-width': 2 * z,
        'stroke-linejoin': 'round',
        'stroke-linecap': 'round',
      }),
    );
    s.values.forEach((v, i) => {
      if (v === null) return;
      const [cx, cy] = [xOf(i), p.yOf(v)];
      const marker = node('circle', {
        cx,
        cy,
        r: 4 * z,
        fill: color,
        stroke: SURFACE,
        'stroke-width': 2 * z,
      });
      svg.append(titled(marker, tip(data, si, i, v, words)));
      valueLabel(spec, f, p, cx, cy - 8 * z, v);
    });
  });
}

/** Bars and lines: a value axis at the left, categories along the bottom. */
function cartesian(spec: ChartSpec, data: ChartData, f: Frame, words: ChartWords): void {
  const plot = axes(spec, data, f);
  if (spec.type === 'bar') {
    bars(spec, data, f, plot, words);
  } else {
    lines(spec, data, f, plot, words);
  }
}

/** A pie of the first series; slices below zero or empty are left out. */
function pie(spec: ChartSpec, data: ChartData, f: Frame): void {
  const { svg, z } = f;
  const values = data.series[0]?.values ?? [];
  const total = values.reduce<number>((sum, v) => sum + (v !== null && v > 0 ? v : 0), 0);
  const r = Math.max(0, Math.min(f.w, f.h) / 2 - 2 * z);
  const cx = f.x + f.w / 2;
  const cy = f.y + f.h / 2;
  if (total <= 0 || r <= 0) {
    return;
  }
  let angle = -Math.PI / 2;
  values.forEach((v, i) => {
    if (v === null || v <= 0) return;
    const sweep = (v / total) * Math.PI * 2;
    const a2 = angle + sweep;
    const point = (a: number, radius = r): string =>
      `${cx + radius * Math.cos(a)},${cy + radius * Math.sin(a)}`;
    const d =
      sweep >= Math.PI * 2 - 1e-9
        ? `M${cx - r},${cy} A${r},${r} 0 1 1 ${cx + r},${cy} A${r},${r} 0 1 1 ${cx - r},${cy} Z`
        : `M${cx},${cy} L${point(angle)} A${r},${r} 0 ${sweep > Math.PI ? 1 : 0} 1 ${point(a2)} Z`;
    const share = Math.round((v / total) * 1000) / 10;
    svg.append(
      titled(
        node('path', {
          d,
          fill: chartColor(spec, i),
          stroke: SURFACE,
          'stroke-width': 2 * z,
          'stroke-linejoin': 'round',
        }),
        `${data.categories[i]} = ${formatNumber(v)} (${share}%)`,
      ),
    );
    if (spec.dataLabels && sweep > 0.25) {
      const mid = angle + sweep / 2;
      const [lx, ly] = point(mid, r * 0.62)
        .split(',')
        .map(Number);
      svg.append(
        node(
          'text',
          {
            x: lx,
            y: ly + 4 * z,
            'text-anchor': 'middle',
            'font-size': 11 * z,
            'font-weight': 600,
            fill: INK,
            stroke: SURFACE,
            'stroke-width': 3 * z,
            'paint-order': 'stroke',
          },
          `${share}%`,
        ),
      );
    }
    angle = a2;
  });
}

/** The chart, `w` × `h` pixels at `zoom`, showing `data` (null: its cells are gone). */
export function buildChartSvg(
  spec: ChartSpec,
  data: ChartData | null,
  w: number,
  h: number,
  zoom: number,
  words: ChartWords,
): SVGElement {
  const hasData = data !== null && data.series.some((s) => s.values.some((v) => v !== null));
  const entries =
    !hasData || data === null
      ? []
      : spec.type === 'pie'
        ? data.categories.map((label, i) => ({ label, color: chartColor(spec, i) }))
        : data.series.map((_, i) => ({ label: seriesName(data, i, words), color: chartColor(spec, i) }));
  const f = frame(spec, w, h, zoom, entries);
  if (!hasData || data === null) {
    f.svg.append(
      node(
        'text',
        {
          x: f.x + f.w / 2,
          y: f.y + f.h / 2,
          'text-anchor': 'middle',
          'font-size': 12 * zoom,
          fill: INK_SOFT,
        },
        words.noData,
      ),
    );
  } else if (spec.type === 'pie') {
    pie(spec, data, f);
  } else {
    cartesian(spec, data, f, words);
  }
  return f.svg;
}
