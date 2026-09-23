// SPDX-License-Identifier: MIT
// Fixed metrics of the virtualized grid, shared by the grid and its pure
// layout helpers (src/ui/grid/*).

/** Fixed row/column metrics for virtualization (px), the logical values at
 * 100% zoom. A cell's outer box is exactly COL_WIDTH x ROW_HEIGHT including
 * its single shared 1px grid line (right and bottom border inside the
 * border-box), so the column/row pitch never grows past these values.
 * ROW_HEIGHT must stay in sync with the `--grid-row-height` CSS variable (see
 * styles.css), which the cell typography uses to vertically center
 * single-line text via line-height. */
export const ROW_HEIGHT = 24;
/** Line box of a wrapped cell (px). Kept in sync with `--grid-wrap-line`. */
export const WRAP_LINE_HEIGHT = 18;
/** Vertical chrome (top+bottom padding) added around a wrapped cell's lines. */
export const WRAP_VERTICAL_PAD = 8;
/** Hard cap on the visual lines a single row may grow to when wrapping. */
export const MAX_WRAP_LINES = 12;
/** Row count above which the off-screen wrap-measure pass shows a busy label. */
export const WRAP_PASS_BUSY_ROWS = 4000;
/** Default column width. Cell padding (6px left/right, 3px top/bottom at 100%
 * zoom, scaled with it) lives in `.vcell` in virtualized-grid.css and sits
 * inside the grid line, so a default cell's content box is 91 x 17 px. */
export const COL_WIDTH = 104;
export const MIN_COL_WIDTH = 40;
export const MAX_COL_WIDTH = 1200;
export const ROW_HEAD_WIDTH = 64;
export const OVERSCAN_ROWS = 8;
export const OVERSCAN_COLS = 3;
