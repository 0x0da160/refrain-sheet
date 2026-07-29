// SPDX-License-Identifier: MIT
import type { UiPort } from '../commands';

/**
 * Cell-count threshold above which an operation counts as "large": its
 * read/prepare phase runs in cooperative time slices behind the progress
 * indicator (with a percentage), and the atomic apply is wrapped in the busy
 * state. Below the threshold operations complete imperceptibly fast and run
 * synchronously.
 */
export const LARGE_OP_CELLS = 20_000;

/**
 * Whole-number progress percentage for loading labels. Uses floor so 100% is
 * never shown while work remains — a label only reads 100% after the
 * operation has actually completed.
 */
export function pct(done: number, total: number): number {
  return total > 0 ? Math.min(100, Math.floor((done / total) * 100)) : 0;
}

/**
 * Yield to the browser so a just-shown busy indicator actually paints
 * before a synchronous, CPU-heavy step (parsing, serializing) blocks the
 * main thread. Two animation frames guarantee a paint has occurred; falls
 * back to a macrotask where rAF is unavailable (tests, workers).
 */
export function nextPaint(): Promise<void> {
  const raf = (globalThis as { requestAnimationFrame?: (cb: () => void) => void }).requestAnimationFrame;
  if (typeof raf === 'function') {
    return new Promise((resolve) => raf(() => raf(() => resolve())));
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Run a heavy operation behind the busy indicator. The label is shown, the
 * UI is given a chance to paint it, the work runs, and the indicator is
 * always cleared afterwards (even on error).
 */
export async function withBusy<T>(ui: UiPort, label: string, work: () => T | Promise<T>): Promise<T> {
  ui.setBusy(label);
  await nextPaint();
  try {
    return await work();
  } finally {
    ui.setBusy(null);
  }
}
