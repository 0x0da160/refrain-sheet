// SPDX-License-Identifier: MIT
/** File > Print…: page settings from storage, page size, scale, print area and page breaks. */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRINT_SETTINGS,
  MAX_PRINT_SCALE,
  normalizePrintSettings,
  pageBreakRows,
  pageSizeCss,
  printArea,
  printableWidthPx,
  printScale,
} from '../../src/core/print-layout';

describe('normalizePrintSettings', () => {
  it('keeps valid values and replaces anything else with the default', () => {
    expect(normalizePrintSettings(null)).toEqual(DEFAULT_PRINT_SETTINGS);
    expect(normalizePrintSettings('A4')).toEqual(DEFAULT_PRINT_SETTINGS);
    const valid = {
      scope: 'file',
      paper: 'B5',
      orientation: 'landscape',
      scale: 80,
      gridlines: false,
      headings: true,
      repeatFirstRow: true,
      rowsPerPage: 40,
    };
    expect(normalizePrintSettings(valid)).toEqual(valid);
    expect(
      normalizePrintSettings({
        scope: 'all',
        paper: 'A0',
        orientation: 'up',
        scale: 2.5,
        gridlines: 1,
        rowsPerPage: -3,
      }),
    ).toEqual(DEFAULT_PRINT_SETTINGS);
  });

  it('clamps the scale and rows per page into range', () => {
    expect(normalizePrintSettings({ scale: 9999 }).scale).toBe(MAX_PRINT_SCALE);
    expect(normalizePrintSettings({ scale: 1 }).scale).toBe(10);
    expect(normalizePrintSettings({ rowsPerPage: 1e9 }).rowsPerPage).toBe(10_000);
  });
});

describe('page size and scale', () => {
  it('writes the page size in millimetres, swapped for landscape', () => {
    expect(pageSizeCss({ paper: 'A4', orientation: 'portrait' })).toBe('210mm 297mm');
    expect(pageSizeCss({ paper: 'B5', orientation: 'landscape' })).toBe('257mm 182mm');
  });

  it('fits wide content to the printable width but never enlarges it', () => {
    const settings = { ...DEFAULT_PRINT_SETTINGS, paper: 'A4' as const };
    const width = printableWidthPx(settings);
    expect(width).toBe(702); // (210 - 24) mm at 96 dpi, rounded down
    expect(printScale(settings, width * 2)).toBeCloseTo(0.5);
    expect(printScale(settings, 100)).toBe(1);
    expect(printScale(settings, width * 100)).toBe(0.1);
    expect(printScale({ ...settings, scale: 150 }, 100)).toBe(1.5);
  });
});

describe('printArea', () => {
  it('prints the used cells, or the selection', () => {
    expect(printArea({ rows: 3, cols: 2 }, null)).toEqual({ top: 0, left: 0, bottom: 2, right: 1 });
    expect(printArea({ rows: 0, cols: 0 }, null)).toBeNull();
    const selection = { top: 4, left: 1, bottom: 9, right: 1 };
    expect(printArea({ rows: 0, cols: 0 }, selection)).toBe(selection);
  });
});

describe('pageBreakRows', () => {
  it('breaks every n rows, counting a repeated first row only on the first page', () => {
    expect(pageBreakRows(10, 0, false)).toEqual([]);
    expect(pageBreakRows(10, 4, false)).toEqual([4, 8]);
    expect(pageBreakRows(10, 4, true)).toEqual([4, 7]);
    expect(pageBreakRows(4, 4, false)).toEqual([]);
  });
});
