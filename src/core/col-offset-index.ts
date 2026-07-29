// SPDX-License-Identifier: MIT
/**
 * Cached prefix sum of column pixel widths for a virtualized grid.
 *
 * Building the index costs O(columns), so callers should build it only when
 * widths or zoom actually change (a resize, autofit, or zoom change) and
 * reuse it across every render and scroll event in between — otherwise
 * horizontal scrolling and offset lookups cost O(total columns) instead of
 * O(the visible window). Offsets (col -> x) are O(1); hit-testing (x -> col)
 * is O(log n) via binary search over the prefix sum.
 */
export class ColOffsetIndex {
  /** prefix[i] = summed pixel width of columns [0, i). Length is columnCount + 1. */
  private readonly prefix: number[];

  constructor(columnCount: number, widthOf: (col: number) => number) {
    const cols = Math.max(1, columnCount);
    const prefix = new Array<number>(cols + 1);
    prefix[0] = 0;
    for (let c = 0; c < cols; c++) {
      prefix[c + 1] = prefix[c] + widthOf(c);
    }
    this.prefix = prefix;
  }

  get columnCount(): number {
    return this.prefix.length - 1;
  }

  /** Total pixel width of every column in the index. */
  get totalWidth(): number {
    return this.prefix[this.prefix.length - 1];
  }

  /**
   * X offset of the left edge of `col`, measured from column 0. Out-of-range
   * columns clamp to the nearest end (0, or the total width past the last
   * column) rather than throwing.
   */
  offsetOf(col: number): number {
    const i = Math.max(0, Math.min(col, this.prefix.length - 1));
    return this.prefix[i];
  }

  /**
   * The largest column whose left edge is at or before `x` — the column
   * whose band contains `x`, or `columnCount` when `x` is past the last
   * column's right edge (matching a linear scan that walks off the end).
   */
  colAtOrBefore(x: number): number {
    // upper_bound(x) - 1: smallest index with prefix > x, minus one.
    let lo = 0;
    let hi = this.prefix.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.prefix[mid] > x) {
        hi = mid;
      } else {
        lo = mid + 1;
      }
    }
    return lo - 1;
  }

  /**
   * The smallest column whose left edge is at or after `x`, clamped to
   * `columnCount` (one past the last column) when every column's left edge
   * is before `x`.
   */
  colAtOrAfter(x: number): number {
    // lower_bound(x): smallest index with prefix >= x.
    let lo = 0;
    let hi = this.prefix.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.prefix[mid] < x) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return Math.min(lo, this.columnCount);
  }
}
