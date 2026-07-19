// SPDX-License-Identifier: MIT
/**
 * Sparse, order-preserving index of per-row pixel heights for a virtualized
 * grid with variable row heights (conditional text wrapping).
 *
 * Rows default to `base`; only rows taller than that store an override, so a
 * document with no wrapped rows costs O(1) extra memory and answers every
 * query exactly like a uniform-height grid. Cumulative offsets — row → y
 * (`offsetOf`) and y → row (`rowAtOffset`) — are answered in O(log n) from a
 * prefix sum of the overrides that is rebuilt lazily only after the set of
 * overrides changes. This keeps scrolling, virtualization windows, keyboard
 * navigation, and sticky-row geometry correct as rows grow and shrink.
 */
export class RowHeightIndex {
  private readonly overrides = new Map<number, number>();
  /** Override rows in ascending order (rebuilt lazily from `overrides`). */
  private sortedRows: number[] = [];
  /** prefix[i] = summed extra height (height − base) of sortedRows[0..i-1]. */
  private prefix: number[] = [0];
  private dirty = false;

  constructor(private readonly base: number) {}

  /** True when no row overrides the base height (the uniform-grid fast path). */
  get isUniform(): boolean {
    return this.overrides.size === 0;
  }

  /** Drop every override so all rows revert to the base height. */
  clear(): void {
    if (this.overrides.size === 0) {
      return;
    }
    this.overrides.clear();
    this.dirty = true;
  }

  /**
   * Set a row's height, returning true when the stored height changed. A
   * height at or below the base removes the override (the row is single-line).
   */
  set(row: number, height: number): boolean {
    const h = Math.round(height);
    if (h <= this.base) {
      return this.overrides.delete(row) ? ((this.dirty = true), true) : false;
    }
    if (this.overrides.get(row) === h) {
      return false;
    }
    this.overrides.set(row, h);
    this.dirty = true;
    return true;
  }

  heightOf(row: number): number {
    return this.overrides.get(row) ?? this.base;
  }

  private ensure(): void {
    if (!this.dirty) {
      return;
    }
    this.sortedRows = [...this.overrides.keys()].sort((a, b) => a - b);
    this.prefix = new Array(this.sortedRows.length + 1);
    this.prefix[0] = 0;
    for (let i = 0; i < this.sortedRows.length; i++) {
      this.prefix[i + 1] = this.prefix[i] + (this.overrides.get(this.sortedRows[i])! - this.base);
    }
    this.dirty = false;
  }

  /** Summed extra height of every override row strictly less than `row`. */
  private extraBefore(row: number): number {
    this.ensure();
    // Lower bound: first index whose override row is >= `row`.
    let lo = 0;
    let hi = this.sortedRows.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.sortedRows[mid] < row) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return this.prefix[lo];
  }

  /** Y offset of the top edge of `row`, measured from the top of row 0. */
  offsetOf(row: number): number {
    return row * this.base + this.extraBefore(row);
  }

  /**
   * Total pixel height of rows [0, rowCount). Computed via `offsetOf` so any
   * stale override left at an index >= rowCount (e.g. after rows were deleted)
   * is ignored rather than double-counted.
   */
  totalHeight(rowCount: number): number {
    return this.offsetOf(rowCount);
  }

  /** Pixel height of rows [from, to). */
  rangeHeight(from: number, to: number): number {
    return this.offsetOf(to) - this.offsetOf(from);
  }

  /**
   * The row whose band contains the offset `y`: the largest row with
   * `offsetOf(row) <= y`, clamped to [0, rowCount − 1]. Used to turn a scroll
   * position back into a first-visible row.
   */
  rowAtOffset(y: number, rowCount: number): number {
    if (rowCount <= 0) {
      return 0;
    }
    if (y <= 0) {
      return 0;
    }
    let lo = 0;
    let hi = rowCount - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.offsetOf(mid) <= y) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    return lo;
  }
}
