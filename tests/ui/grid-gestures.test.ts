// SPDX-License-Identifier: MIT
/**
 * The grid's gesture building blocks, tested without a DOM grid: the edge
 * auto-scroll direction (src/ui/grid/auto-scroll.ts) and touch press-and-hold
 * / double-tap recognition (src/ui/grid/touch-gestures.ts). The full
 * behavior through a real Grid is covered by grid-autoscroll.test.ts and
 * grid-touch.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTO_SCROLL_EDGE_PX,
  AUTO_SCROLL_INTERVAL_MS,
  AUTO_SCROLL_MAX_STEP_PX,
  EdgeAutoScroller,
  edgeScrollDirection,
} from '../../src/ui/grid/auto-scroll';
import {
  DOUBLE_TAP_MS,
  DOUBLE_TAP_SLOP_PX,
  DoubleTap,
  LONG_PRESS_MOVE_TOLERANCE_PX,
  LONG_PRESS_MS,
  LongPress,
} from '../../src/ui/grid/touch-gestures';

const rect = { left: 100, right: 500, top: 50, bottom: 450, width: 400, height: 400 };

function pointer(clientX: number, clientY: number): PointerEvent {
  return { clientX, clientY, pointerId: 1 } as PointerEvent;
}

describe('edgeScrollDirection', () => {
  it('does not nudge away from the edges', () => {
    expect(edgeScrollDirection(rect, 300, 250)).toBeNull();
  });

  it('nudges toward each edge the pointer is near, faster the deeper it is', () => {
    expect(edgeScrollDirection(rect, rect.left + 1, 250)).toEqual({ dx: -(AUTO_SCROLL_EDGE_PX - 1), dy: 0 });
    expect(edgeScrollDirection(rect, 300, rect.bottom - 1)).toEqual({ dx: 0, dy: AUTO_SCROLL_EDGE_PX - 1 });
    expect(edgeScrollDirection(rect, rect.right + 500, rect.top - 500)).toEqual({
      dx: AUTO_SCROLL_MAX_STEP_PX,
      dy: -AUTO_SCROLL_MAX_STEP_PX,
    });
  });

  it('never nudges by less than 4px, and never for a grid that is not laid out', () => {
    expect(edgeScrollDirection(rect, rect.right - AUTO_SCROLL_EDGE_PX + 1, 250)).toEqual({ dx: 4, dy: 0 });
    expect(edgeScrollDirection({ ...rect, width: 0 }, rect.left, rect.top)).toBeNull();
  });
});

describe('EdgeAutoScroller', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(active = true) {
    const element = {
      scrollTop: 100,
      scrollLeft: 0,
      getBoundingClientRect: () => rect,
    } as unknown as HTMLElement;
    const scrolled = vi.fn();
    const scroller = new EdgeAutoScroller(element, {
      dragActive: () => active,
      hasTab: () => true,
      scrolled,
    });
    return { element, scrolled, scroller };
  }

  it('repeats the nudge while the pointer holds at the edge, until stopped', () => {
    const { element, scrolled, scroller } = setup();
    scroller.track(pointer(300, rect.top) as unknown as MouseEvent);
    vi.advanceTimersByTime(AUTO_SCROLL_INTERVAL_MS * 2);
    expect(element.scrollTop).toBe(100 - 2 * AUTO_SCROLL_EDGE_PX);
    expect(scrolled).toHaveBeenCalledTimes(2);
    expect(scrolled).toHaveBeenLastCalledWith(300, rect.top);
    scroller.stop();
    vi.advanceTimersByTime(AUTO_SCROLL_INTERVAL_MS * 2);
    expect(scrolled).toHaveBeenCalledTimes(2);
  });

  it('does nothing without an active drag, and skips the host at the scroll limit', () => {
    const idle = setup(false);
    idle.scroller.track(pointer(300, rect.top) as unknown as MouseEvent);
    vi.advanceTimersByTime(AUTO_SCROLL_INTERVAL_MS * 2);
    expect(idle.scrolled).not.toHaveBeenCalled();

    const atTop = setup();
    atTop.element.scrollTop = 0;
    atTop.scroller.track(pointer(300, rect.top) as unknown as MouseEvent);
    vi.advanceTimersByTime(AUTO_SCROLL_INTERVAL_MS);
    expect(atTop.scrolled).not.toHaveBeenCalled();
    atTop.scroller.stop();
  });
});

describe('LongPress', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('replays the press after the hold and then offers the context menu', () => {
    const press = new LongPress();
    const onHold = vi.fn();
    const down = pointer(10, 10);
    press.arm(down, onHold);
    expect(press.pending).toBe(true);
    expect(press.quickTap).toBe(true);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(onHold).toHaveBeenCalledWith(down);
    expect(press.pending).toBe(false);
    expect(press.menuTarget?.event).toBe(down);
    expect(press.menuTargetHeld(pointer(10 + LONG_PRESS_MOVE_TOLERANCE_PX, 10))).toBe(true);
    expect(press.menuTargetHeld(pointer(11 + LONG_PRESS_MOVE_TOLERANCE_PX, 10))).toBe(false);
  });

  it('tells real movement from jitter, and a cleared hold never fires', () => {
    const press = new LongPress();
    const onHold = vi.fn();
    press.arm(pointer(10, 10), onHold);
    expect(press.movedFromOrigin(pointer(10, 10 + LONG_PRESS_MOVE_TOLERANCE_PX))).toBe(false);
    expect(press.movedFromOrigin(pointer(10, 11 + LONG_PRESS_MOVE_TOLERANCE_PX))).toBe(true);
    press.clear();
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(onHold).not.toHaveBeenCalled();
    expect(press.menuTarget).toBeNull();
  });
});

describe('DoubleTap', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('pairs two taps on the same cell within the window and slop', () => {
    const taps = new DoubleTap();
    expect(taps.tap({ row: 1, col: 2 }, pointer(0, 0))).toBe(false);
    expect(taps.tap({ row: 1, col: 2 }, pointer(DOUBLE_TAP_SLOP_PX, 0))).toBe(true);
    // A third tap starts a new pair rather than retriggering.
    expect(taps.tap({ row: 1, col: 2 }, pointer(0, 0))).toBe(false);
  });

  it('does not pair taps on different cells, too far apart, or too slow', () => {
    const taps = new DoubleTap();
    taps.tap({ row: 1, col: 2 }, pointer(0, 0));
    expect(taps.tap({ row: 1, col: 3 }, pointer(0, 0))).toBe(false);
    expect(taps.tap({ row: 1, col: 3 }, pointer(DOUBLE_TAP_SLOP_PX + 1, 0))).toBe(false);
    taps.tap({ row: 4, col: 4 }, pointer(0, 0));
    vi.advanceTimersByTime(DOUBLE_TAP_MS);
    expect(taps.tap({ row: 4, col: 4 }, pointer(0, 0))).toBe(false);
  });
});
