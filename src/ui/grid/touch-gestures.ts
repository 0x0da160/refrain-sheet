// SPDX-License-Identifier: MIT
/**
 * Touch/pen gesture state for the grid (#290): press-and-hold to arm a drag
 * or open the context menu, and double-tap to edit. The grid decides what
 * each gesture does; these classes only own the timers and the positions the
 * gestures are recognized from.
 */

/**
 * Touch/pen press-and-hold duration that arms a drag (cell-range selection or
 * a row/column header drag) — a quick tap stays a tap, handled by the
 * browser's own synthetic click, same as before touch support existed.
 */
export const LONG_PRESS_MS = 400;
/** Movement past this distance during the long-press window reads as the
 * start of a scroll, not a drag, and cancels the pending long-press. */
export const LONG_PRESS_MOVE_TOLERANCE_PX = 10;
/**
 * Touch/pen double-tap detection window: a second quick tap landing on the
 * same cell within this many ms of the first opens the inline editor, the
 * touch equivalent of a desktop double-click. Mobile browsers do not
 * reliably synthesize a `dblclick` DOM event from two taps on a plain
 * (non-form, non-anchor) element, so this is detected explicitly rather than
 * relying on `dblclick` for touch input.
 */
export const DOUBLE_TAP_MS = 300;
/**
 * How far apart (px) the two taps of a double-tap may land, on top of both
 * hitting the same cell. A finger's second tap routinely lands 10–15px from
 * the first; the on-device log for #590 shows a 12px pair that the
 * long-press tolerance (10px) wrongly rejected.
 */
export const DOUBLE_TAP_SLOP_PX = 30;

interface PressPoint {
  event: PointerEvent;
  x: number;
  y: number;
}

function within(point: { x: number; y: number }, event: PointerEvent, tolerance: number): boolean {
  return Math.hypot(event.clientX - point.x, event.clientY - point.y) <= tolerance;
}

/** Press-and-hold recognition (cell/header drags and the touch context menu). */
export class LongPress {
  /** Pending long-press timer (cell/header drags only — the fill/move/resize
   * handles start dragging immediately on touch, same as a mouse press, since
   * they already opt out of native panning in CSS). */
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Origin of a pending long-press: used to detect cancel-by-movement and to
   * replay the original press once the hold is confirmed. */
  private origin: PressPoint | null = null;
  /** A completed long-press that has not yet turned into a drag — a mouse has
   * a right-click for the context menu, but touch has no equivalent input, so
   * a stationary press-and-hold (#406) opens it instead once the finger
   * lifts. `x`/`y` are the press origin, used to tell a held finger's own
   * sensor jitter apart from real movement (#475) — only movement past the
   * tolerance cancels this back to `null`. */
  menuTarget: PressPoint | null = null;

  /** Arms a hold; `onHold` replays the original press once it completes with no real movement. */
  arm(event: PointerEvent, onHold: (press: PointerEvent) => void): void {
    this.clear();
    this.menuTarget = null;
    this.origin = { event, x: event.clientX, y: event.clientY };
    this.timer = setTimeout(() => {
      this.timer = null;
      const origin = this.origin;
      this.origin = null;
      if (!origin) {
        return;
      }
      onHold(origin.event);
      // The hold just fired and nothing has moved yet: this is a candidate
      // for the context menu once the finger lifts (the grid clears it again
      // the moment real movement turns this into an actual drag).
      this.menuTarget = origin;
    }, LONG_PRESS_MS);
  }

  /** Whether a hold is still pending (armed, not yet fired or cancelled). */
  get pending(): boolean {
    return this.origin !== null;
  }

  /** A pending hold that lifts now is a quick tap: it lifted before the timer fired. */
  get quickTap(): boolean {
    return this.origin !== null && this.timer !== null;
  }

  /** Whether `event` moved past the tolerance from the pending hold's origin. */
  movedFromOrigin(event: PointerEvent): boolean {
    return this.origin !== null && !within(this.origin, event, LONG_PRESS_MOVE_TOLERANCE_PX);
  }

  /** Whether `event` is still within the tolerance of the completed hold (sensor jitter). */
  menuTargetHeld(event: PointerEvent): boolean {
    return this.menuTarget !== null && within(this.menuTarget, event, LONG_PRESS_MOVE_TOLERANCE_PX);
  }

  /** Cancels a pending hold (a completed hold's `menuTarget` is left alone). */
  clear(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.origin = null;
  }
}

/**
 * Pairs successive quick taps into a double-tap — see `DOUBLE_TAP_MS`. The
 * first tap of a pair only arms a pending-tap window; the second, landing on
 * the same cell within that window and `DOUBLE_TAP_SLOP_PX`, completes the
 * pair and clears the pending state so a third tap doesn't retrigger it.
 */
export class DoubleTap {
  /** A completed quick tap awaiting a possible second tap; cleared once the
   * window elapses with no matching second tap. */
  private pending: {
    row: number;
    col: number;
    x: number;
    y: number;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;

  /** Records a quick tap on a cell; true when it completes a double-tap. */
  tap(cell: { row: number; col: number }, event: PointerEvent): boolean {
    const pending = this.pending;
    if (
      pending &&
      pending.row === cell.row &&
      pending.col === cell.col &&
      within(pending, event, DOUBLE_TAP_SLOP_PX)
    ) {
      clearTimeout(pending.timer);
      this.pending = null;
      return true;
    }
    if (pending) {
      clearTimeout(pending.timer);
    }
    this.pending = {
      row: cell.row,
      col: cell.col,
      x: event.clientX,
      y: event.clientY,
      timer: setTimeout(() => {
        this.pending = null;
      }, DOUBLE_TAP_MS),
    };
    return false;
  }
}
