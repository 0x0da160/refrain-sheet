// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { layoutStyledRangeForImage, type VisualDisplaySource } from '../src/core/screenshot-layout';
import type { CellStyle } from '../src/core/cell-style';
import type { ConditionalFormatStyle } from '../src/core/conditional-format';

/** A minimal fake `VisualDisplaySource` for pure, DOM-free unit tests. */
function fakeSource(opts: {
  rows: string[][];
  styles?: Record<string, CellStyle>;
  conditional?: Record<string, ConditionalFormatStyle>;
}): VisualDisplaySource {
  const key = (row: number, col: number): string => `${row},${col}`;
  return {
    getDisplayValue: (row, col) => opts.rows[row]?.[col] ?? '',
    getStyle: (row, col) => opts.styles?.[key(row, col)] ?? null,
    getConditionalFormatStyle: (row, col) => opts.conditional?.[key(row, col)] ?? null,
    rowCount: opts.rows.length,
    columnCount: opts.rows[0]?.length ?? 0,
  };
}

describe('layoutStyledRangeForImage', () => {
  it('extracts the display-value matrix, passing through the given col widths and row height', () => {
    const source = fakeSource({
      rows: [
        ['a', 'b'],
        ['1', '2'],
      ],
    });
    const layout = layoutStyledRangeForImage(
      source,
      { top: 0, left: 0, bottom: 1, right: 1 },
      null,
      [50, 60],
      30,
    );
    expect(layout.matrix).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(layout.colWidths).toEqual([50, 60]);
    expect(layout.rowHeight).toBe(30);
  });

  it('excludes rows hidden by an active filter, matching copyRows', () => {
    const source = fakeSource({ rows: [['a'], ['b'], ['c']] });
    const layout = layoutStyledRangeForImage(
      source,
      { top: 0, left: 0, bottom: 2, right: 0 },
      new Set([1]),
      [50],
      20,
    );
    expect(layout.matrix).toEqual([['a'], ['c']]);
    expect(layout.styles.length).toBe(2);
  });

  it('resolves bold/italic/underline and colors from a cell style', () => {
    const source = fakeSource({
      rows: [['a']],
      styles: {
        '0,0': {
          bold: true,
          italic: true,
          underline: true,
          textColor: '#ff0000',
          backgroundColor: '#00ff00',
        },
      },
    });
    const layout = layoutStyledRangeForImage(
      source,
      { top: 0, left: 0, bottom: 0, right: 0 },
      null,
      [50],
      20,
    );
    expect(layout.styles[0][0]).toMatchObject({
      bold: true,
      italic: true,
      underline: true,
      textColor: '#ff0000',
      backgroundColor: '#00ff00',
    });
  });

  it('defaults to unstyled (false/null) when a cell carries no style', () => {
    const source = fakeSource({ rows: [['a']] });
    const layout = layoutStyledRangeForImage(
      source,
      { top: 0, left: 0, bottom: 0, right: 0 },
      null,
      [50],
      20,
    );
    expect(layout.styles[0][0]).toMatchObject({
      bold: false,
      italic: false,
      underline: false,
      textColor: null,
      backgroundColor: null,
    });
  });

  it('lets conditional formatting override the cell style colors', () => {
    const source = fakeSource({
      rows: [['a']],
      styles: { '0,0': { textColor: '#111111', backgroundColor: '#222222' } },
      conditional: { '0,0': { textColor: '#ff0000', backgroundColor: '#00ff00' } },
    });
    const layout = layoutStyledRangeForImage(
      source,
      { top: 0, left: 0, bottom: 0, right: 0 },
      null,
      [50],
      20,
    );
    expect(layout.styles[0][0].textColor).toBe('#ff0000');
    expect(layout.styles[0][0].backgroundColor).toBe('#00ff00');
  });

  it('only paints a top/left border directly on the sheet-edge row/column', () => {
    const source = fakeSource({
      rows: [
        ['a', 'b'],
        ['c', 'd'],
      ],
      styles: {
        '0,0': { borderTop: '#111111', borderLeft: '#111111' },
        '1,1': { borderTop: '#222222', borderLeft: '#222222' },
      },
    });
    const layout = layoutStyledRangeForImage(
      source,
      { top: 0, left: 0, bottom: 1, right: 1 },
      null,
      [50, 50],
      20,
    );
    expect(layout.styles[0][0].borderTop).toEqual({ color: '#111111', lineStyle: 'solid', width: 'thin' });
    expect(layout.styles[0][0].borderLeft).toEqual({ color: '#111111', lineStyle: 'solid', width: 'thin' });
    // Row 1 / col 1 is not the sheet's first row/column, so its own borderTop/
    // borderLeft never paints directly — that edge belongs to the neighboring
    // cell's bottom/right (mirroring `Grid.paintCell`).
    expect(layout.styles[1][1].borderTop).toBeNull();
    expect(layout.styles[1][1].borderLeft).toBeNull();
  });

  it('resolves a shared bottom/right border from either neighbor, matching resolveSharedBorder', () => {
    const source = fakeSource({
      rows: [['a'], ['b']],
      styles: {
        '0,0': { borderBottom: '#111111', borderBottomWidth: 'thick' },
      },
    });
    const layout = layoutStyledRangeForImage(
      source,
      { top: 0, left: 0, bottom: 1, right: 0 },
      null,
      [50],
      20,
    );
    expect(layout.styles[0][0].borderBottom).toEqual({
      color: '#111111',
      lineStyle: 'solid',
      width: 'thick',
    });
  });

  it('returns an empty matrix and styles when every row in the range is hidden', () => {
    const source = fakeSource({ rows: [['a'], ['b']] });
    const layout = layoutStyledRangeForImage(
      source,
      { top: 0, left: 0, bottom: 1, right: 0 },
      new Set([0, 1]),
      [50],
      20,
    );
    expect(layout.matrix).toEqual([]);
    expect(layout.styles).toEqual([]);
  });
});
