// SPDX-License-Identifier: MIT
/**
 * Renders a cell range to a PNG blob for the "Copy as image" command
 * (`ClipboardController.copyImageAsPng`). Deliberately a plain table image —
 * white background, thin gridlines, one line of text per cell — rather than a
 * pixel-exact copy of the live grid's current theme/zoom/wrap, so the result
 * stays legible when pasted into another application regardless of which
 * theme is active. `doc` is injected (never the global `document`) so this
 * stays testable the same way `file-access.ts` injects it.
 */
import type { CellRange } from '../core/clipboard';
import { layoutRangeForImage, type DisplayValueSource } from '../core/image-layout';

const FONT = '13px system-ui, -apple-system, "Segoe UI", sans-serif';
const CELL_PADDING_X = 8;
const ROW_HEIGHT = 24;
const MIN_COL_WIDTH = 48;
const MAX_COL_WIDTH = 320;
const TEXT_COLOR = '#1a1a1a';
const GRID_LINE_COLOR = '#c9c9c9';
const BACKGROUND_COLOR = '#ffffff';

/**
 * Returns null when the Canvas 2D context is unavailable, or the range has no
 * visible rows (every row hidden by an active filter).
 */
export async function renderRangeToPng(
  doc: Document,
  source: DisplayValueSource,
  range: CellRange,
  hidden: ReadonlySet<number> | null,
): Promise<Blob | null> {
  const measureCanvas = doc.createElement('canvas');
  const measureCtx = measureCanvas.getContext('2d');
  if (!measureCtx) {
    return null;
  }
  measureCtx.font = FONT;
  const layout = layoutRangeForImage(source, range, hidden, (text) => measureCtx.measureText(text).width, {
    cellPaddingX: CELL_PADDING_X,
    rowHeight: ROW_HEIGHT,
    minColWidth: MIN_COL_WIDTH,
    maxColWidth: MAX_COL_WIDTH,
  });
  if (layout.matrix.length === 0) {
    return null;
  }

  const width = layout.colWidths.reduce((sum, w) => sum + w, 0) + 1;
  const height = layout.matrix.length * layout.rowHeight + 1;
  const scale = doc.defaultView?.devicePixelRatio ?? 1;

  const canvas = doc.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return null;
  }
  ctx.scale(scale, scale);
  ctx.fillStyle = BACKGROUND_COLOR;
  ctx.fillRect(0, 0, width, height);
  ctx.font = FONT;
  ctx.textBaseline = 'middle';
  ctx.strokeStyle = GRID_LINE_COLOR;
  ctx.lineWidth = 1;

  let y = 0.5;
  for (const row of layout.matrix) {
    let x = 0.5;
    for (let c = 0; c < row.length; c++) {
      const w = layout.colWidths[c];
      ctx.strokeRect(x, y, w, layout.rowHeight);
      const text = row[c];
      if (text !== '') {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, w, layout.rowHeight);
        ctx.clip();
        ctx.fillStyle = TEXT_COLOR;
        ctx.fillText(text, x + CELL_PADDING_X, y + layout.rowHeight / 2 + 1);
        ctx.restore();
      }
      x += w;
    }
    y += layout.rowHeight;
  }

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png');
  });
}
