// SPDX-License-Identifier: MIT
/**
 * Auto-scroll for drags that should nudge the viewport when the pointer nears
 * the grid's edge (range selection, fill handle, column resize, range move).
 */

/** How close to the edge (px) triggers a nudge. */
export const AUTO_SCROLL_EDGE_PX = 24;
/** The largest single nudge (px). */
export const AUTO_SCROLL_MAX_STEP_PX = 28;
/** How often nudges repeat (ms) while the pointer holds at the edge. */
export const AUTO_SCROLL_INTERVAL_MS = 50;

/** The part of a `DOMRect` the edge test reads. */
interface EdgeRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

/**
 * Scroll direction/speed implied by a pointer position relative to the
 * grid's edges, or null when the pointer isn't close enough to nudge the
 * viewport. A zero-size rect means the grid isn't laid out (hidden, or an
 * environment without real geometry, e.g. an unmocked jsdom test) and
 * never nudges.
 */
export function edgeScrollDirection(
  rect: EdgeRect,
  clientX: number,
  clientY: number,
): { dx: number; dy: number } | null {
  if (rect.width === 0 || rect.height === 0) {
    return null;
  }
  const step = (depth: number): number => Math.min(AUTO_SCROLL_MAX_STEP_PX, Math.max(4, Math.round(depth)));
  let dx = 0;
  if (clientX < rect.left + AUTO_SCROLL_EDGE_PX) {
    dx = -step(rect.left + AUTO_SCROLL_EDGE_PX - clientX);
  } else if (clientX > rect.right - AUTO_SCROLL_EDGE_PX) {
    dx = step(clientX - (rect.right - AUTO_SCROLL_EDGE_PX));
  }
  let dy = 0;
  if (clientY < rect.top + AUTO_SCROLL_EDGE_PX) {
    dy = -step(rect.top + AUTO_SCROLL_EDGE_PX - clientY);
  } else if (clientY > rect.bottom - AUTO_SCROLL_EDGE_PX) {
    dy = step(clientY - (rect.bottom - AUTO_SCROLL_EDGE_PX));
  }
  return dx === 0 && dy === 0 ? null : { dx, dy };
}

/** What the auto-scroller needs from the grid that owns it. */
export interface AutoScrollHost {
  /** Whether a drag that should auto-scroll the viewport is active. */
  dragActive(): boolean;
  /** Whether a document is showing (a nudge needs something to scroll). */
  hasTab(): boolean;
  /**
   * The viewport just moved under a pointer that has not: re-render and feed
   * the pointer's now-different cell back into the active drag.
   */
  scrolled(clientX: number, clientY: number): void;
}

/**
 * Drives the repeating edge nudge: `track` runs on every document-level
 * mousemove (and every confirmed touch-drag move) and starts, updates, or
 * stops the timer depending on whether an edge-scrollable drag is active and
 * how close its pointer is to the edge.
 */
export class EdgeAutoScroller {
  /** Timer driving auto-scroll while an active drag's pointer sits at/beyond the grid edge. */
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Scroll direction/speed and the pointer position it was computed from. */
  private state: { dx: number; dy: number; clientX: number; clientY: number } | null = null;

  constructor(
    private readonly element: HTMLElement,
    private readonly host: AutoScrollHost,
  ) {}

  track(event: MouseEvent): void {
    if (!this.host.dragActive()) {
      this.stop();
      return;
    }
    const dir = edgeScrollDirection(this.element.getBoundingClientRect(), event.clientX, event.clientY);
    if (!dir) {
      this.stop();
      return;
    }
    this.state = { ...dir, clientX: event.clientX, clientY: event.clientY };
    if (this.timer === null) {
      this.timer = setInterval(() => this.tick(), AUTO_SCROLL_INTERVAL_MS);
    }
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.state = null;
  }

  /**
   * One auto-scroll nudge: move the viewport, then let the host re-render and
   * update the drag for the cell now under the unmoved pointer — the same
   * update a real pointer move onto that cell would have made.
   */
  private tick(): void {
    const state = this.state;
    if (!this.host.hasTab() || !state || !this.host.dragActive()) {
      this.stop();
      return;
    }
    const before = { top: this.element.scrollTop, left: this.element.scrollLeft };
    this.element.scrollTop = Math.max(0, this.element.scrollTop + state.dy);
    this.element.scrollLeft = Math.max(0, this.element.scrollLeft + state.dx);
    if (this.element.scrollTop === before.top && this.element.scrollLeft === before.left) {
      return; // already at the scroll limit in every direction being nudged
    }
    this.host.scrolled(state.clientX, state.clientY);
  }
}
