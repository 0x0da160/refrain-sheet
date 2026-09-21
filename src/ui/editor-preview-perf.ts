// SPDX-License-Identifier: MIT
/**
 * Shared performance/UX helpers for the docked Markdown/JSON/YAML worksheet
 * editors' source-textarea + preview-pane pairs (#557):
 *
 * - `CoalescedRenderer` batches a burst of `input` events (typing, or a
 *   held key's repeat) into at most one render per short idle window,
 *   painted on the next animation frame, instead of re-tokenizing and
 *   replacing the whole preview on every single keystroke.
 * - `isLargePreviewSource` flags a document too large for syntax
 *   highlighting to be worth the main-thread stall.
 * - `syncScroll` wires proportional two-way scroll sync between a source
 *   textarea and its preview pane.
 *
 * None of this reaches for `src/core/scheduler.ts`'s cooperative slicer:
 * that contract is for read-only scan phases of document operations (see
 * `docs/architecture.md` § Long-running operations), not for repaint
 * coalescing — a different problem with a different fix (debounce + rAF,
 * not time-sliced iteration).
 */

/** Idle time after the last `schedule()` call before a coalesced render is queued (on the next animation frame). */
const RENDER_DEBOUNCE_MS = 120;

/**
 * Coalesces repeated `schedule()` calls (typically one per `input` event)
 * into at most one `render()` call per short idle window, itself painted on
 * the next animation frame rather than synchronously — so a burst of
 * keystrokes, or a held key's OS-level repeat, costs one render instead of
 * one per event. `flush()` renders immediately (for a leading edit — e.g.
 * loading new content — or a case that must not wait out the debounce).
 * `cancel()` drops any pending render without running it, for when the view
 * is about to rebind to different content and a stale in-flight render must
 * never overwrite it.
 */
export class CoalescedRenderer {
  private rafHandle: number | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly render: () => void) {}

  /** Queue a coalesced render; repeated calls within the debounce window collapse into one. */
  schedule(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      if (this.rafHandle !== null) {
        return;
      }
      this.rafHandle = requestAnimationFrame(() => {
        this.rafHandle = null;
        this.render();
      });
    }, RENDER_DEBOUNCE_MS);
  }

  /** Render immediately, cancelling any pending coalesced render first. */
  flush(): void {
    this.cancel();
    this.render();
  }

  /** Drop any pending coalesced render without running it. */
  cancel(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
  }
}

/**
 * Size threshold (UTF-16 code units, a cheap proxy for byte size — good
 * enough for a soft threshold, not an exact accounting) above which a
 * source document is too large for syntax highlighting to be worth the
 * main-thread stall. Starting point: ~256 KB.
 */
export const LARGE_PREVIEW_SOURCE_LENGTH = 256 * 1024;

/** Whether `text` is large enough that its preview should skip tokenization (see `LARGE_PREVIEW_SOURCE_LENGTH`). */
export function isLargePreviewSource(text: string): boolean {
  return text.length > LARGE_PREVIEW_SOURCE_LENGTH;
}

/**
 * Wire proportional two-way scroll sync between `source` (a source
 * textarea) and `preview` (its rendered/highlighted preview pane):
 * scrolling either one moves the other to the same *relative* scroll
 * position. Guarded by a re-entrancy flag so the scroll event each sync
 * step triggers on the other element never bounces back and fights the one
 * that started it. Returns an unbind function (the docked editor views are
 * long-lived singletons that are never torn down, so none of them currently
 * call it, but it keeps this helper self-contained and testable).
 */
export function syncScroll(source: HTMLElement, preview: HTMLElement): () => void {
  let syncing = false;
  const sync = (from: HTMLElement, to: HTMLElement): void => {
    if (syncing) {
      return;
    }
    syncing = true;
    const denom = from.scrollHeight - from.clientHeight;
    to.scrollTop = denom > 0 ? (from.scrollTop / denom) * (to.scrollHeight - to.clientHeight) : 0;
    requestAnimationFrame(() => {
      syncing = false;
    });
  };
  const onSourceScroll = (): void => sync(source, preview);
  const onPreviewScroll = (): void => sync(preview, source);
  source.addEventListener('scroll', onSourceScroll);
  preview.addEventListener('scroll', onPreviewScroll);
  return () => {
    source.removeEventListener('scroll', onSourceScroll);
    preview.removeEventListener('scroll', onPreviewScroll);
  };
}
