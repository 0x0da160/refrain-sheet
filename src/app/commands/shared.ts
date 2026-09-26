// SPDX-License-Identifier: MIT
import type { AppState, Tab } from '../app-state';
import type { UiPort } from '../commands';
import { t } from '../i18n';

/**
 * Whether `tab`'s active sheet is a grid — the only kind column widths mean
 * anything for. True for every plain CSV document (which has no other
 * kind), and for an RSF worksheet whose own `kind` is `'grid'`; false for a
 * Markdown/JSON (and future YAML/plain-text) worksheet, which is a single
 * whole-document cell with no columns to fit. Used to gate column auto-fit
 * (`Commands.isEnabled('sheet.autoFitCols')`, `autoFitOnOpen`, the grid's
 * own context menu and double-click-to-fit).
 */
export function isGridSurface(tab: Tab): boolean {
  return tab.doc.kind === 'csv' || tab.doc.activeSheet.kind === 'grid';
}

/**
 * A blocked mutation's scope: `'book'` for `Tab.readOnly` (the whole
 * document is protected), `'sheet'` for one RSF worksheet's `locked` flag.
 */
export type ProtectedScope = 'book' | 'sheet';

/**
 * Shows a blocking warning dialog explaining that `tab` (or its active
 * worksheet, for `scope: 'sheet'`) is protected/locked, and offers to
 * unlock it. Resolves true when the user unlocked it, so the caller can go
 * on with the edit that was blocked instead of making the user repeat it
 * (`AppState.warnBlocked` passes a retry for that; `ensureRsf` continues).
 * `sheetId` names the locked worksheet for `scope: 'sheet'` (default: the
 * active one), so the sheet that refused the edit is the one unlocked.
 *
 * Two callers: `AppState`'s own `refuseReadOnlyWrite`/`refuseLockedSheetWrite`
 * guards (wired through `AppState.warnBlocked`, since `AppState` holds no
 * `UiPort` of its own — this is what turns *every* blocked entry point,
 * including the Markdown/JSON worksheet textareas, into a warning dialog
 * instead of a passive toast) and `FileIoCommands.ensureRsf`'s own
 * protected-document guard, which already has direct `UiPort`/`AppState`
 * access and calls this the same way.
 */
export async function warnProtectedAndOfferUnlock(
  ui: UiPort,
  state: AppState,
  tab: Tab,
  scope: ProtectedScope,
  sheetId?: string,
): Promise<boolean> {
  const doc = tab.doc;
  const lockedId = doc.kind === 'rsf' ? (sheetId ?? doc.activeSheetId) : '';
  const sheetName = doc.kind === 'rsf' ? (doc.sheetById(lockedId)?.name ?? doc.activeSheet.name) : '';
  const title = scope === 'book' ? t('dialog.warnProtected.bookTitle') : t('dialog.warnProtected.sheetTitle');
  const message =
    scope === 'book'
      ? t('dialog.warnProtected.bookMessage', { name: tab.name })
      : t('dialog.warnProtected.sheetMessage', { name: sheetName });
  const unlock = await ui.confirm(
    title,
    message,
    t('dialog.warnProtected.unlock'),
    t('dialog.warnProtected.cancel'),
  );
  if (!unlock) {
    return false;
  }
  if (scope === 'book') {
    state.setReadOnly(tab, false);
  } else if (doc.kind === 'rsf') {
    state.setSheetLocked(tab, lockedId, false);
  }
  return true;
}

/**
 * Cell-count threshold above which an operation counts as "large": its
 * read/prepare phase runs in cooperative time slices behind the progress
 * indicator (with a percentage), and the atomic apply is wrapped in the busy
 * state. Below the threshold operations complete imperceptibly fast and run
 * synchronously.
 */
export const LARGE_OP_CELLS = 20_000;

/**
 * Byte threshold above which opening a file counts as "large" for busy-overlay
 * purposes. Unlike other gated operations, a file's cell count is unknown
 * until it has been parsed, so its byte size stands in as the upfront signal.
 * Sized from `knowledge/operations/performance-measurements.md`'s own CSV benchmark (~200,000 cells /
 * ~11 MB, roughly 9 bytes/cell) to track {@link LARGE_OP_CELLS} at a
 * comparable scale.
 */
export const LARGE_OPEN_BYTES = 200_000;

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

/**
 * Run `work` behind the busy indicator only when `large` is true; otherwise
 * run it directly with no overlay. Small operations (below whichever
 * size threshold the caller already checked — {@link LARGE_OP_CELLS} or
 * {@link LARGE_OPEN_BYTES}) complete imperceptibly fast, so paying the
 * indicator's guaranteed show/paint/hide cost would only produce a flicker.
 */
export async function withBusyIfLarge<T>(
  large: boolean,
  ui: UiPort,
  label: string,
  work: () => T | Promise<T>,
): Promise<T> {
  return large ? withBusy(ui, label, work) : work();
}

/**
 * Runs a side panel whose Apply keeps it open: `open` receives the handler
 * the panel calls for every Apply/Clear the user presses, and each result is
 * applied immediately, one history entry per press. A result the promise
 * itself resolves with (a UI that closes on Apply) is applied the same way.
 * Resolves true when anything was applied before the panel closed.
 */
export async function applyWhileOpen<R>(
  open: (onApply: (result: R) => Promise<boolean>) => Promise<R | null>,
  apply: (result: R) => boolean | Promise<boolean>,
): Promise<boolean> {
  let applied = false;
  const run = async (result: R): Promise<boolean> => {
    const ok = await apply(result);
    applied ||= ok;
    return ok;
  };
  const result = await open(run);
  if (result) {
    await run(result);
  }
  return applied;
}
