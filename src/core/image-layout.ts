// SPDX-License-Identifier: MIT
/**
 * DOM-independent layout for rendering a cell range as a table image
 * ("Copy as image"). Extracts the visible display values of a range — rows
 * hidden by an active filter are excluded, matching {@link copyRows} — and
 * sizes each column to fit its widest cell. Pixel measurement is injected via
 * `measure` (mirroring the {@link TextMeasure} convention in `text-wrap.ts`)
 * so this stays testable without a canvas.
 */
import { copyRows, type CellRange } from './clipboard';

/** The minimal read-only surface `layoutRangeForImage` needs from a document. */
export interface DisplayValueSource {
  getDisplayValue(row: number, col: number): string;
}

/** Returns the rendered pixel width of a string under the active font. */
export type TextMeasure = (text: string) => number;

export interface ImageLayoutOptions {
  /** Horizontal padding added on each side of a cell's text, in px. */
  cellPaddingX: number;
  /** Fixed row height, in px. */
  rowHeight: number;
  /** Narrowest a column may be, even for empty or short content. */
  minColWidth: number;
  /** Widest a column may grow to before its content is clipped. */
  maxColWidth: number;
}

export interface ImageLayout {
  /** Display values of the visible rows in the range, row-major. */
  matrix: string[][];
  /** Per-column pixel width, indexed from 0 (== `range.left`). */
  colWidths: number[];
  rowHeight: number;
}

export function layoutRangeForImage(
  source: DisplayValueSource,
  range: CellRange,
  hidden: ReadonlySet<number> | null,
  measure: TextMeasure,
  options: ImageLayoutOptions,
): ImageLayout {
  const { cellPaddingX, rowHeight, minColWidth, maxColWidth } = options;
  const colCount = range.right - range.left + 1;
  const colWidths = new Array<number>(colCount).fill(minColWidth);
  const matrix: string[][] = [];
  for (const r of copyRows(range, hidden)) {
    const row: string[] = [];
    for (let c = range.left; c <= range.right; c++) {
      const text = source.getDisplayValue(r, c);
      row.push(text);
      const idx = c - range.left;
      const width = Math.min(
        maxColWidth,
        Math.max(colWidths[idx], Math.ceil(measure(text)) + cellPaddingX * 2),
      );
      colWidths[idx] = width;
    }
    matrix.push(row);
  }
  return { matrix, colWidths, rowHeight };
}
