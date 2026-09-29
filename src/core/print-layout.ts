// SPDX-License-Identifier: MIT
/**
 * File > Print…: the page settings and the arithmetic behind them. The page
 * itself is laid out by the browser's own print (and "Save as PDF"); this
 * module only decides what is printed (which cells, split into which pages)
 * and how much it is scaled, so it runs unchanged in tests.
 *
 * Work is bounded: a print never holds more than {@link MAX_PRINT_CELLS}
 * cells, and a grid prints only down to its last row and across to its last
 * column that hold anything.
 */

/** What to print: the active sheet, the selected cells, or every sheet of the file. */
export type PrintScope = 'sheet' | 'selection' | 'file';
const PRINT_SCOPES: readonly PrintScope[] = ['sheet', 'selection', 'file'];

export type PaperSize = 'A4' | 'A3' | 'B5' | 'Letter' | 'Legal';
export const PAPER_SIZES: readonly PaperSize[] = ['A4', 'A3', 'B5', 'Letter', 'Legal'];

type PageOrientation = 'portrait' | 'landscape';

/** Paper in millimetres, portrait (B5 is JIS B5, the size Japanese printers call B5). */
const PAPER_MM: Record<PaperSize, { width: number; height: number }> = {
  A4: { width: 210, height: 297 },
  A3: { width: 297, height: 420 },
  B5: { width: 182, height: 257 },
  Letter: { width: 215.9, height: 279.4 },
  Legal: { width: 215.9, height: 355.6 },
};

/** The page margin on every side, in millimetres. */
export const PRINT_MARGIN_MM = 12;

export const MIN_PRINT_SCALE = 10;
export const MAX_PRINT_SCALE = 400;
export const MAX_ROWS_PER_PAGE = 10_000;
/** The most cells one print lays out; a larger print is refused (print a selection instead). */
export const MAX_PRINT_CELLS = 200_000;

export interface PrintSettings {
  scope: PrintScope;
  paper: PaperSize;
  orientation: PageOrientation;
  /** `'fit'` shrinks a sheet wider than the page to its width; a number is a percentage. */
  scale: 'fit' | number;
  gridlines: boolean;
  /** Row numbers and column letters. */
  headings: boolean;
  /** Repeat the first printed row at the top of every page. */
  repeatFirstRow: boolean;
  /** Start a new page after this many rows; 0 leaves page breaks to the browser. */
  rowsPerPage: number;
}

export const DEFAULT_PRINT_SETTINGS: PrintSettings = {
  scope: 'sheet',
  paper: 'A4',
  orientation: 'portrait',
  scale: 'fit',
  gridlines: true,
  headings: false,
  repeatFirstRow: false,
  rowsPerPage: 0,
};

/**
 * Settings from untrusted input (browser storage): every field that is
 * missing or out of range takes its default.
 */
export function normalizePrintSettings(value: unknown): PrintSettings {
  const raw = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const pick = <T>(allowed: readonly T[], v: unknown, fallback: T): T =>
    allowed.includes(v as T) ? (v as T) : fallback;
  const flag = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
  const d = DEFAULT_PRINT_SETTINGS;
  const scale =
    raw.scale === 'fit'
      ? 'fit'
      : typeof raw.scale === 'number' && Number.isInteger(raw.scale)
        ? Math.min(MAX_PRINT_SCALE, Math.max(MIN_PRINT_SCALE, raw.scale))
        : d.scale;
  const rows =
    typeof raw.rowsPerPage === 'number' && Number.isInteger(raw.rowsPerPage)
      ? Math.min(MAX_ROWS_PER_PAGE, Math.max(0, raw.rowsPerPage))
      : d.rowsPerPage;
  return {
    scope: pick(PRINT_SCOPES, raw.scope, d.scope),
    paper: pick(PAPER_SIZES, raw.paper, d.paper),
    orientation: pick<PageOrientation>(['portrait', 'landscape'], raw.orientation, d.orientation),
    scale,
    gridlines: flag(raw.gridlines, d.gridlines),
    headings: flag(raw.headings, d.headings),
    repeatFirstRow: flag(raw.repeatFirstRow, d.repeatFirstRow),
    rowsPerPage: rows,
  };
}

/** The page size for CSS `@page { size }`, in millimetres, e.g. `"297mm 210mm"` for A4 landscape. */
export function pageSizeCss(settings: Pick<PrintSettings, 'paper' | 'orientation'>): string {
  const { width, height } = PAPER_MM[settings.paper];
  return settings.orientation === 'portrait' ? `${width}mm ${height}mm` : `${height}mm ${width}mm`;
}

/** The width inside the margins, in CSS pixels (96 per inch). */
export function printableWidthPx(settings: Pick<PrintSettings, 'paper' | 'orientation'>): number {
  const mm = PAPER_MM[settings.paper];
  const width = settings.orientation === 'portrait' ? mm.width : mm.height;
  return Math.floor(((width - 2 * PRINT_MARGIN_MM) / 25.4) * 96);
}

/**
 * The zoom factor for content `contentWidthPx` wide: a fixed percentage, or
 * for `'fit'` whatever makes it fit the page width (never enlarged, never
 * below {@link MIN_PRINT_SCALE}%).
 */
export function printScale(settings: PrintSettings, contentWidthPx: number): number {
  if (settings.scale !== 'fit') {
    return settings.scale / 100;
  }
  if (contentWidthPx <= 0) {
    return 1;
  }
  const fit = printableWidthPx(settings) / contentWidthPx;
  return Math.max(MIN_PRINT_SCALE / 100, Math.min(1, fit));
}

/** An inclusive block of cells. */
export interface PrintArea {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/**
 * What of a grid to print: the selection when given (clipped to the grid),
 * otherwise everything down to the last row and column holding anything.
 * Null when there is nothing to print.
 */
export function printArea(
  used: { rows: number; cols: number },
  selection: PrintArea | null,
): PrintArea | null {
  if (selection) {
    return selection.top <= selection.bottom && selection.left <= selection.right ? selection : null;
  }
  return used.rows > 0 && used.cols > 0
    ? { top: 0, left: 0, bottom: used.rows - 1, right: used.cols - 1 }
    : null;
}

/**
 * The positions (0-based, within the printed rows) that start a new page
 * when a page holds `rowsPerPage` rows; a repeated first row does not count
 * towards any page but the first. Empty when `rowsPerPage` is 0.
 */
export function pageBreakRows(rowCount: number, rowsPerPage: number, repeatFirstRow: boolean): number[] {
  if (rowsPerPage <= 0) {
    return [];
  }
  const breaks: number[] = [];
  // With a repeated first row, the first page holds it plus rowsPerPage - 1
  // body rows, and every later page repeats it above rowsPerPage - 1 more.
  const perPage = repeatFirstRow ? Math.max(1, rowsPerPage - 1) : rowsPerPage;
  const start = repeatFirstRow ? 1 : 0;
  for (let at = start + perPage; at < rowCount; at += perPage) {
    breaks.push(at);
  }
  return breaks;
}
