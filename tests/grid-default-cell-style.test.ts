// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * Default cell style: a logical 104 x 24 px cell at 100% zoom, grid line
 * included, with 6px left/right and 3px top/bottom padding. jsdom performs no
 * layout, so this asserts the geometry the grid writes (inline sizes, content
 * size, row positions) at every zoom level; the laid-out boxes, text
 * placement, editing/IME and hit testing are measured in real Chromium by
 * `npm run ui:check` (scripts/ui-check-grid.mjs).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { AppState } from '../src/app/app-state';
import { Commands, type UiPort } from '../src/app/commands';
import { onScreenGeometry } from '../src/app/screenshot-export';
import { SHEET_ZOOM_LEVELS } from '../src/app/settings';
import { ColOffsetIndex } from '../src/core/col-offset-index';
import { RowHeightIndex } from '../src/core/row-height-index';
import { serializeDocument } from '../src/core/serializer';
import { COL_WIDTH, Grid, ROW_HEAD_WIDTH, ROW_HEIGHT } from '../src/ui/grid';
import { concat, doc, enc, readBundledCss, utf8 } from './helpers';

const noopUi = new Proxy({} as UiPort, {
  get: (_target, prop) => (prop === 'setBusy' || prop === 'notify' ? () => undefined : async () => null),
});

beforeEach(() => {
  document.body.textContent = '';
});

function setup(csv: string) {
  const state = new AppState();
  const commands = new Commands(state, noopUi, document);
  const grid = new Grid(state, commands);
  Object.defineProperty(grid.element, 'clientHeight', { value: 520, configurable: true });
  Object.defineProperty(grid.element, 'clientWidth', { value: 900, configurable: true });
  document.body.append(grid.element);
  const tab = state.addTab('t.csv', doc(csv), null);
  grid.refresh();
  return { state, grid, tab };
}

function bigCsv(rows: number, cols: number): string {
  const lines: string[] = [];
  for (let r = 0; r < rows; r++) {
    lines.push(Array.from({ length: cols }, (_, c) => `R${r}C${c}`).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

describe('default cell metrics', () => {
  it('are 104 x 24 px at 100% zoom, matching the stylesheet', () => {
    expect(COL_WIDTH).toBe(104);
    expect(ROW_HEIGHT).toBe(24);
    const css = readBundledCss();
    expect(css).toContain('--grid-row-height: 24px');
    const vcell = /\n\.vcell\s*\{([^}]*)\}/.exec(css)![1];
    expect(vcell).toMatch(
      /padding:\s*calc\(3px \* var\(--sheet-zoom, 1\)\) calc\(6px \* var\(--sheet-zoom, 1\)\)/,
    );
  });

  it('screenshot export uses the same defaults', () => {
    const geometry = onScreenGeometry({ colWidths: [], zoom: 100 }, { top: 0, left: 0, bottom: 0, right: 0 });
    expect(geometry).toEqual({ colWidths: [COL_WIDTH], rowHeight: ROW_HEIGHT });
  });
});

describe.each(SHEET_ZOOM_LEVELS)('grid geometry at %i%% zoom', (level) => {
  const z = level / 100;
  const colW = Math.round(COL_WIDTH * z);
  const rowH = Math.round(ROW_HEIGHT * z);

  it('renders every cell, header and row at the zoom-scaled default size', () => {
    const { state, grid, tab } = setup('商品名,担当者,数量\n抹茶ラテ,田中,12\n深煎り珈琲,佐藤,120\n');
    state.setTabZoom(tab, level);
    grid.refresh();
    expect(grid.element.style.getPropertyValue('--grid-row-height')).toBe(`${rowH}px`);
    expect(grid.element.querySelector<HTMLElement>('.vgrid-header')!.style.height).toBe(`${rowH}px`);
    for (const head of grid.element.querySelectorAll<HTMLElement>('.vcell.vhead[data-col]')) {
      expect(head.style.width).toBe(`${colW}px`);
    }
    const cells = grid.element.querySelectorAll<HTMLElement>('.vgrid-rows .vcell[data-row][data-col]');
    expect(cells.length).toBe(9);
    for (const cell of cells) {
      // The grid line lives inside this width (border-box), never added to it.
      expect(cell.style.width).toBe(`${colW}px`);
    }
    for (const row of grid.element.querySelectorAll<HTMLElement>('.vgrid-rows .vgrid-row')) {
      expect(row.style.height).toBe(`${rowH}px`);
    }
  });

  it('keeps the content size an exact multiple of the pitch (no accumulated error)', () => {
    const rows = 3000;
    const cols = 60;
    const { state, grid, tab } = setup(bigCsv(rows, cols));
    state.setTabZoom(tab, level);
    grid.element.scrollTop = 2400 * rowH;
    grid.element.scrollLeft = 50 * colW;
    grid.refresh();
    const canvas = grid.element.querySelector<HTMLElement>('.vgrid-canvas')!;
    expect(canvas.style.width).toBe(`${Math.round(ROW_HEAD_WIDTH * z) + cols * colW}px`);
    expect(canvas.style.height).toBe(`${rowH + rows * rowH}px`);
    // Rendered rows, far down the sheet, sit exactly one pitch apart.
    const tops = [...grid.element.querySelectorAll<HTMLElement>('.vgrid-rows .vgrid-row')].map((r) =>
      Number.parseFloat(r.style.top),
    );
    expect(tops.length).toBeGreaterThan(1);
    for (let i = 1; i < tops.length; i++) {
      expect(tops[i] - tops[i - 1]).toBe(rowH);
    }
    const rendered = grid.element.querySelector<HTMLElement>(
      '.vgrid-rows .vcell[data-row="2400"][data-col="50"]',
    );
    expect(rendered?.style.width).toBe(`${colW}px`);
  });

  it('maps logical offsets to cells and back exactly, far from the origin', () => {
    const cols = new ColOffsetIndex(100_000, () => colW);
    expect(cols.offsetOf(99_999)).toBe(99_999 * colW);
    expect(cols.colAtOrBefore(99_999 * colW + colW - 1)).toBe(99_999);
    expect(cols.colAtOrBefore(99_999 * colW)).toBe(99_999);
    const rowIndex = new RowHeightIndex(rowH);
    expect(rowIndex.offsetOf(1_000_000)).toBe(1_000_000 * rowH);
    expect(rowIndex.rowAtOffset(1_000_000 * rowH + rowH - 1, 2_000_000)).toBe(1_000_000);
    expect(rowIndex.rowAtOffset(1_000_000 * rowH, 2_000_000)).toBe(1_000_000);
  });
});

describe('display settings never touch the CSV bytes', () => {
  const cases: Array<[string, Uint8Array, Parameters<typeof doc>[1]?]> = [
    [
      'UTF-8 with BOM, CRLF, quotes, spaces',
      concat(
        new Uint8Array([0xef, 0xbb, 0xbf]),
        utf8('商品名, 単価 \r\n"抹茶ラテ","4,800"\r\n  , "a""b"\r\n'),
      ),
    ],
    [
      'UTF-8 without BOM, LF, no trailing newline',
      utf8('code,date\nSKU-00012,2026-09-23\nJP-1000-0001,2026-09-23'),
    ],
    ['Shift_JIS, CRLF', enc('商品名,担当者\r\n深煎り珈琲,佐藤\r\n', 'shift_jis'), { encoding: 'shift_jis' }],
  ];

  it.each(cases)(
    '%s: zoom, resize and rendering leave the saved bytes identical',
    (_name, bytes, interpretation) => {
      const state = new AppState();
      const commands = new Commands(state, noopUi, document);
      const grid = new Grid(state, commands);
      document.body.append(grid.element);
      const csv = doc(bytes, interpretation);
      const tab = state.addTab('t.csv', csv, null);
      for (const level of SHEET_ZOOM_LEVELS) {
        state.setTabZoom(tab, level);
        grid.refresh();
      }
      tab.colWidths[0] = 200;
      grid.refresh();
      expect(csv.isDirty).toBe(false);
      const result = serializeDocument(csv);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.mode).toBe('identity');
      expect(Array.from(result.bytes)).toEqual(Array.from(bytes));
    },
  );
});
