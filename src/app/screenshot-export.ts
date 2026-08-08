// SPDX-License-Identifier: MIT
/**
 * Renders a cell range to a PNG blob for the "Copy Screenshot" command
 * (`ClipboardController.copyScreenshotAsPng`), reproducing each cell's
 * actual on-screen appearance: the active color theme's default cell
 * background/text color, the current sheet font and zoom level, and any
 * per-cell bold/italic/underline, text/background color, and border a user
 * has applied (including conditional formatting) — unlike `image-export.ts`,
 * whose "Copy as Image" is deliberately a plain, theme-independent table
 * (see that file's comment). Column widths and row height mirror the grid's
 * own on-screen sizing (`onScreenGeometry`) rather than auto-fitting to
 * content, so the captured image matches what was visible; overflowing text
 * is ellipsis-truncated the same way the live grid clips it.
 *
 * Border line style (solid/dashed/dotted/double) is not reproduced — every
 * border is painted solid at its configured color and width — since canvas
 * has no native equivalent and pixel-exact dash patterns are not the point
 * of this feature. `doc` is injected (never the global `document`), matching
 * `image-export.ts` and `file-access.ts`.
 */
import type { CellRange } from '../core/clipboard';
import { BORDER_WIDTH_PX, type BorderSideValue } from '../core/cell-style';
import {
  layoutStyledRangeForImage,
  type CellVisualStyle,
  type VisualDisplaySource,
} from '../core/screenshot-layout';
import type { EditorDocument, Tab } from './app-state';

/** Kept in sync with `COL_WIDTH`/`ROW_HEIGHT` in `ui/grid.ts` (the default, unzoomed metrics). */
const DEFAULT_COL_WIDTH = 132;
const DEFAULT_ROW_HEIGHT = 26;
const CELL_PADDING_X = 8;
const FALLBACK_FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const FALLBACK_FONT_SIZE = '13px';
const FALLBACK_TEXT_COLOR = '#1a1a1a';
const FALLBACK_CELL_BG = '#ffffff';
const FALLBACK_GRID_LINE = '#c9c9c9';

/** The on-screen column widths and row height for `range`, at the tab's current zoom. */
export function onScreenGeometry(
  tab: Pick<Tab, 'colWidths' | 'zoom'>,
  range: CellRange,
): { colWidths: number[]; rowHeight: number } {
  const zoom = (tab.zoom || 100) / 100;
  const colWidths: number[] = [];
  for (let c = range.left; c <= range.right; c++) {
    const w = tab.colWidths[c];
    colWidths.push(Math.round((w && w > 0 ? w : DEFAULT_COL_WIDTH) * zoom));
  }
  return { colWidths, rowHeight: Math.round(DEFAULT_ROW_HEIGHT * zoom) };
}

/** Adapts a plain CSV document (which carries no per-cell styling) to `VisualDisplaySource`. */
export function asVisualDisplaySource(doc: EditorDocument): VisualDisplaySource {
  if (doc.kind === 'rsf') {
    return doc;
  }
  return {
    getDisplayValue: (row, col) => doc.getDisplayValue(row, col),
    getStyle: () => null,
    getConditionalFormatStyle: () => null,
    rowCount: doc.rowCount,
    columnCount: doc.columnCount,
  };
}

interface GridAppearance {
  fontFamily: string;
  fontSize: string;
  textColor: string;
  cellBg: string;
  gridLine: string;
}

/**
 * Samples the live grid's resolved theme/font colors via a hidden probe cell
 * appended to the real `.vgrid-canvas`, so this file never duplicates the
 * theme color tokens or sheet-font stacks declared in `styles.css` — it
 * reads whatever the browser actually resolved for the current theme and
 * font choice. Falls back to fixed defaults when no grid is rendered (e.g. a
 * non-DOM test).
 */
function sampleGridAppearance(doc: Document): GridAppearance {
  const fallback: GridAppearance = {
    fontFamily: FALLBACK_FONT_FAMILY,
    fontSize: FALLBACK_FONT_SIZE,
    textColor: FALLBACK_TEXT_COLOR,
    cellBg: FALLBACK_CELL_BG,
    gridLine: FALLBACK_GRID_LINE,
  };
  const canvasEl = doc.querySelector<HTMLElement>('.vgrid-canvas');
  const view = doc.defaultView;
  if (!canvasEl || !view) {
    return fallback;
  }
  const probe = doc.createElement('div');
  probe.className = 'vcell';
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  probe.style.left = '-9999px';
  probe.style.top = '0';
  canvasEl.append(probe);
  const computed = view.getComputedStyle(probe);
  const appearance: GridAppearance = {
    fontFamily: computed.fontFamily || fallback.fontFamily,
    fontSize: computed.fontSize || fallback.fontSize,
    textColor: computed.color || fallback.textColor,
    cellBg: computed.backgroundColor || fallback.cellBg,
    gridLine: computed.borderRightColor || fallback.gridLine,
  };
  probe.remove();
  return appearance;
}

function cellFont(appearance: GridAppearance, style: CellVisualStyle): string {
  return `${style.italic ? 'italic ' : ''}${style.bold ? 'bold ' : ''}${appearance.fontSize} ${appearance.fontFamily}`;
}

/** Truncates `text` with an ellipsis so it fits `maxWidth` under the context's current font. */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (maxWidth <= 0 || ctx.measureText(text).width <= maxWidth) {
    return text;
  }
  const ellipsis = '…';
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(text.slice(0, mid) + ellipsis).width <= maxWidth) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo === 0 ? '' : text.slice(0, lo) + ellipsis;
}

function paintCellText(
  ctx: CanvasRenderingContext2D,
  text: string,
  style: CellVisualStyle,
  appearance: GridAppearance,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  if (text === '') {
    return;
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.font = cellFont(appearance, style);
  const color = style.textColor ?? appearance.textColor;
  ctx.fillStyle = color;
  const textX = x + CELL_PADDING_X;
  const textY = y + h / 2 + 1;
  const fitted = fitText(ctx, text, w - CELL_PADDING_X * 2);
  ctx.fillText(fitted, textX, textY);
  if (style.underline) {
    const textWidth = Math.min(ctx.measureText(fitted).width, w - CELL_PADDING_X * 2);
    const underlineY = Math.round(textY + h * 0.22);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(textX, underlineY);
    ctx.lineTo(textX + textWidth, underlineY);
    ctx.stroke();
  }
  ctx.restore();
}

function drawBorderSide(
  ctx: CanvasRenderingContext2D,
  side: BorderSideValue | null,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): void {
  if (!side) {
    return;
  }
  ctx.strokeStyle = side.color;
  ctx.lineWidth = BORDER_WIDTH_PX[side.width];
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

/**
 * Top/left borders only ever come from an explicit cell style (mirroring the
 * live grid, where every other top/left edge is really the neighboring
 * cell's already-painted bottom/right edge). Right/bottom fall back to the
 * theme's thin default gridline, exactly like the live grid's base `.vcell`
 * CSS rule, which a custom border replaces rather than layers on top of.
 */
function paintCellBorders(
  ctx: CanvasRenderingContext2D,
  style: CellVisualStyle,
  gridLineColor: string,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const defaultSide: BorderSideValue = { color: gridLineColor, lineStyle: 'solid', width: 'thin' };
  drawBorderSide(ctx, style.borderTop, x, y, x + w, y);
  drawBorderSide(ctx, style.borderLeft, x, y, x, y + h);
  drawBorderSide(ctx, style.borderRight ?? defaultSide, x + w, y, x + w, y + h);
  drawBorderSide(ctx, style.borderBottom ?? defaultSide, x, y + h, x + w, y + h);
}

/**
 * Returns null when the Canvas 2D context is unavailable, or the range has no
 * visible rows (every row hidden by an active filter).
 */
export async function renderStyledRangeToPng(
  doc: Document,
  source: VisualDisplaySource,
  range: CellRange,
  hidden: ReadonlySet<number> | null,
  colWidths: number[],
  rowHeight: number,
): Promise<Blob | null> {
  const layout = layoutStyledRangeForImage(source, range, hidden, colWidths, rowHeight);
  if (layout.matrix.length === 0) {
    return null;
  }
  const appearance = sampleGridAppearance(doc);

  const width = layout.colWidths.reduce((sum, w) => sum + w, 0);
  const height = layout.matrix.length * layout.rowHeight;
  const scale = doc.defaultView?.devicePixelRatio ?? 1;

  const canvas = doc.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return null;
  }
  ctx.scale(scale, scale);
  ctx.fillStyle = appearance.cellBg;
  ctx.fillRect(0, 0, width, height);
  ctx.textBaseline = 'middle';

  const xOffsets: number[] = [];
  let acc = 0;
  for (const w of layout.colWidths) {
    xOffsets.push(acc);
    acc += w;
  }

  // Three passes (background, text, borders) so a later cell's background
  // fill never overwrites an earlier cell's shared-edge border stroke.
  for (let r = 0; r < layout.matrix.length; r++) {
    const y = r * layout.rowHeight;
    for (let c = 0; c < layout.colWidths.length; c++) {
      const bg = layout.styles[r][c].backgroundColor;
      if (bg) {
        ctx.fillStyle = bg;
        ctx.fillRect(xOffsets[c], y, layout.colWidths[c], layout.rowHeight);
      }
    }
  }
  for (let r = 0; r < layout.matrix.length; r++) {
    const y = r * layout.rowHeight;
    for (let c = 0; c < layout.colWidths.length; c++) {
      paintCellText(
        ctx,
        layout.matrix[r][c],
        layout.styles[r][c],
        appearance,
        xOffsets[c],
        y,
        layout.colWidths[c],
        layout.rowHeight,
      );
    }
  }
  for (let r = 0; r < layout.matrix.length; r++) {
    const y = r * layout.rowHeight;
    for (let c = 0; c < layout.colWidths.length; c++) {
      paintCellBorders(
        ctx,
        layout.styles[r][c],
        appearance.gridLine,
        xOffsets[c],
        y,
        layout.colWidths[c],
        layout.rowHeight,
      );
    }
  }

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png');
  });
}
