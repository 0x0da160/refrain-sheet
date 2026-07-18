// SPDX-License-Identifier: MIT
/**
 * Cooperative time-slicing for data-volume-dependent work on the main thread.
 *
 * Long scans (Replace All, large selection statistics) are split into slices
 * bounded by a wall-clock budget and a maximum index count, yielding a
 * macrotask between slices so input handling, rendering, and the busy
 * indicator stay live. Slicing only ever wraps *read-only* scan phases;
 * mutations are applied synchronously and atomically after a scan completes,
 * so an abandoned scan can never leave a partially-mutated document.
 */

/** Wall-clock budget per slice (ms) before yielding to the browser. */
export const SLICE_BUDGET_MS = 12;

/** Hard cap of indices per slice, so tests and fast machines still yield deterministically. */
export const SLICE_MAX_INDICES = 4096;

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** Yield the main thread for one macrotask so pending input and paints run. */
export function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export interface SliceOptions {
  /** Per-slice wall-clock budget in ms (default {@link SLICE_BUDGET_MS}). */
  budgetMs?: number;
  /** Per-slice index cap (default {@link SLICE_MAX_INDICES}). */
  maxSlice?: number;
  /** Called after each yielded slice with the number of processed indices. */
  onProgress?: (done: number, total: number) => void;
  /** Checked after each yield; return true to abandon the remaining work. */
  shouldStop?: () => boolean;
}

/**
 * Run `work(index)` for every index in `[0, total)`, yielding between slices.
 * Returns true when all indices were processed, false when `shouldStop`
 * cancelled the run. Work processed before a cancellation is not rolled back —
 * callers must treat the scan output as unusable when this returns false.
 */
export async function forEachIndexSliced(
  total: number,
  work: (index: number) => void,
  opts: SliceOptions = {},
): Promise<boolean> {
  const budget = opts.budgetMs ?? SLICE_BUDGET_MS;
  const maxSlice = opts.maxSlice ?? SLICE_MAX_INDICES;
  let i = 0;
  while (i < total) {
    const sliceStart = now();
    const sliceLimit = Math.min(total, i + maxSlice);
    while (i < sliceLimit && now() - sliceStart < budget) {
      work(i);
      i += 1;
    }
    if (i >= total) {
      break;
    }
    opts.onProgress?.(i, total);
    await yieldToBrowser();
    if (opts.shouldStop?.()) {
      return false;
    }
  }
  return true;
}
