// SPDX-License-Identifier: MIT
/**
 * DOM-independent layout for rendering a cell range as a "screenshot" image
 * (`ClipboardController.copyScreenshotAsPng`) that reflects each cell's
 * actual resolved appearance on screen — bold/italic/underline, text and
 * background color (conditional formatting overriding a cell's own style,
 * matching `Grid.paintCell`'s precedence), and borders (matching
 * `resolveSharedBorder`'s shared-edge resolution) — unlike
 * `layoutRangeForImage`, which deliberately renders a plain, style-free
 * table (see `image-layout.ts`). Column widths and row height are supplied
 * by the caller (the on-screen, zoom-scaled values) rather than computed
 * here.
 */
import { copyRows, type CellRange } from './clipboard';
import { borderSideValue, resolveSharedBorder, type BorderSideValue, type CellStyle } from './cell-style';
import type { ConditionalFormatStyle } from './conditional-format';

/** A cell's fully resolved visual appearance, ready to paint. */
export interface CellVisualStyle {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  /** `null` means "use the sheet's default text color". */
  textColor: string | null;
  /** `null` means "use the sheet's default cell background". */
  backgroundColor: string | null;
  borderTop: BorderSideValue | null;
  borderRight: BorderSideValue | null;
  borderBottom: BorderSideValue | null;
  borderLeft: BorderSideValue | null;
}

/** The minimal read-only surface `layoutStyledRangeForImage` needs from a document. */
export interface VisualDisplaySource {
  getDisplayValue(row: number, col: number): string;
  getStyle(row: number, col: number): CellStyle | null;
  getConditionalFormatStyle(row: number, col: number): ConditionalFormatStyle | null;
  readonly rowCount: number;
  readonly columnCount: number;
}

export interface StyledImageLayout {
  /** Display values of the visible rows in the range, row-major. */
  matrix: string[][];
  /** Resolved per-cell appearance, same shape as `matrix`. */
  styles: CellVisualStyle[][];
  /** Per-column pixel width, indexed from 0 (== `range.left`). */
  colWidths: number[];
  rowHeight: number;
}

/**
 * Resolve one cell's appearance exactly as `Grid.paintCell` does: a border
 * side is only painted directly on the sheet's first row/column, since every
 * other shared edge is already resolved (and painted once) from the
 * neighboring cell's opposite side.
 */
function resolveCellVisualStyle(source: VisualDisplaySource, row: number, col: number): CellVisualStyle {
  const style = source.getStyle(row, col);
  const conditional = source.getConditionalFormatStyle(row, col);
  const below = row + 1 < source.rowCount ? source.getStyle(row + 1, col) : null;
  const right = col + 1 < source.columnCount ? source.getStyle(row, col + 1) : null;
  return {
    bold: !!style?.bold,
    italic: !!style?.italic,
    underline: !!style?.underline,
    textColor: conditional?.textColor ?? style?.textColor ?? null,
    backgroundColor: conditional?.backgroundColor ?? style?.backgroundColor ?? null,
    borderTop: row === 0 ? borderSideValue(style, 'borderTop') : null,
    borderLeft: col === 0 ? borderSideValue(style, 'borderLeft') : null,
    borderBottom: resolveSharedBorder(
      borderSideValue(style, 'borderBottom'),
      borderSideValue(below, 'borderTop'),
    ),
    borderRight: resolveSharedBorder(
      borderSideValue(style, 'borderRight'),
      borderSideValue(right, 'borderLeft'),
    ),
  };
}

export function layoutStyledRangeForImage(
  source: VisualDisplaySource,
  range: CellRange,
  hidden: ReadonlySet<number> | null,
  colWidths: number[],
  rowHeight: number,
): StyledImageLayout {
  const matrix: string[][] = [];
  const styles: CellVisualStyle[][] = [];
  for (const r of copyRows(range, hidden)) {
    const row: string[] = [];
    const styleRow: CellVisualStyle[] = [];
    for (let c = range.left; c <= range.right; c++) {
      row.push(source.getDisplayValue(r, c));
      styleRow.push(resolveCellVisualStyle(source, r, c));
    }
    matrix.push(row);
    styles.push(styleRow);
  }
  return { matrix, styles, colWidths, rowHeight };
}
