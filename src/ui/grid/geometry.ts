// SPDX-License-Identifier: MIT
// Fixed metrics of the virtualized grid, shared by the grid and its pure
// layout helpers (src/ui/grid/*).

/** Fixed row/column metrics for virtualization (px). ROW_HEIGHT must stay in
 * sync with the `--grid-row-height` CSS variable (see styles.css), which the
 * cell typography uses to vertically center single-line text via line-height. */
export const ROW_HEIGHT = 26;
/** Line box of a wrapped cell (px). Kept in sync with `--grid-wrap-line`. */
export const WRAP_LINE_HEIGHT = 18;
/** Vertical chrome (top+bottom padding) added around a wrapped cell's lines. */
export const WRAP_VERTICAL_PAD = 8;
/** Hard cap on the visual lines a single row may grow to when wrapping. */
export const MAX_WRAP_LINES = 12;
/** Row count above which the off-screen wrap-measure pass shows a busy label. */
export const WRAP_PASS_BUSY_ROWS = 4000;
export const COL_WIDTH = 132;
export const MIN_COL_WIDTH = 40;
export const MAX_COL_WIDTH = 1200;
export const ROW_HEAD_WIDTH = 64;
export const OVERSCAN_ROWS = 8;
export const OVERSCAN_COLS = 3;
