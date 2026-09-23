// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * `installKeyboardViewportFix` (#402): resyncs the page's scroll position on
 * `visualViewport` resize/scroll so iOS Safari cannot leave the page shifted
 * upward after the on-screen keyboard closes (see `src/ui/popup.ts`). The
 * resync is guarded to only act when the page is actually away from (0, 0),
 * so frequent, unrelated `visualViewport` events (e.g. a mobile keyboard's
 * predictive-text bar changing height per keystroke, #519) don't force a
 * scroll when there is nothing to correct.
 *
 * Also covers `onViewportResize` (#557), the shared coalescing helper the
 * fix above is itself now built on: several unrelated modules each need to
 * react to a `visualViewport` resize, and on iOS Safari that event fires on
 * every keystroke (the predictive-text bar's width changing as candidates
 * change) — coalescing every subscriber's reaction onto one shared
 * `requestAnimationFrame` tick per event burst, instead of each one
 * measuring/writing independently on every event, cuts that fan-out down to
 * one pass per keystroke.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installKeyboardViewportFix, isKeyboardLikelyOpen, onViewportResize } from '../src/ui/popup';

/** A minimal stand-in for `window.visualViewport` in jsdom, which has none. */
function fakeVisualViewport(): EventTarget {
  return new EventTarget();
}

/**
 * A fresh copy of `popup.ts`, so resync listeners installed by earlier tests
 * (kept in the module's shared subscriber set) cannot react to this test's
 * events with their own, measurement-free fake viewports.
 */
async function freshPopupModule(): Promise<typeof import('../src/ui/popup')> {
  vi.resetModules();
  return import('../src/ui/popup');
}

/** Waits past one coalesced `onViewportResize` tick (debounce + rAF/setTimeout fallback). */
function nextViewportResizeTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

describe('installKeyboardViewportFix', () => {
  const scrollTo = vi.fn();

  beforeEach(() => {
    scrollTo.mockClear();
    vi.stubGlobal('scrollTo', scrollTo);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('resyncs the scroll position when the visual viewport resizes while the page is shifted (keyboard close, #402)', async () => {
    const vv = fakeVisualViewport();
    vi.stubGlobal('visualViewport', vv);
    vi.stubGlobal('scrollY', 120);
    installKeyboardViewportFix();

    vv.dispatchEvent(new Event('resize'));
    // The resize reaction is now coalesced onto a shared rAF tick (see
    // `onViewportResize`) rather than running synchronously off the event.
    await nextViewportResizeTick();

    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it('resyncs the scroll position when the visual viewport scrolls while the page is shifted', () => {
    const vv = fakeVisualViewport();
    vi.stubGlobal('visualViewport', vv);
    vi.stubGlobal('scrollX', 40);
    installKeyboardViewportFix();

    // 'scroll' is a different event from the coalesced 'resize' above and
    // still runs its listener synchronously.
    vv.dispatchEvent(new Event('scroll'));

    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it('does not scroll when the page is already at (0, 0) (e.g. per-keystroke visualViewport churn, #519)', async () => {
    const vv = fakeVisualViewport();
    vi.stubGlobal('visualViewport', vv);
    installKeyboardViewportFix();

    vv.dispatchEvent(new Event('resize'));
    vv.dispatchEvent(new Event('scroll'));
    await nextViewportResizeTick();

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('does not scroll while the on-screen keyboard is open, even with the page shifted (per-keystroke jump)', async () => {
    // WebKit scrolls the page itself to keep the focused cell editor in view
    // on each keystroke while the keyboard is up; snapping that back made the
    // whole page jump up and down as the user typed.
    const vv = Object.assign(fakeVisualViewport(), { height: 400, scale: 1 });
    vi.stubGlobal('visualViewport', vv);
    vi.stubGlobal('scrollY', 120);
    vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(800);
    (await freshPopupModule()).installKeyboardViewportFix();

    vv.dispatchEvent(new Event('resize'));
    vv.dispatchEvent(new Event('scroll'));
    await nextViewportResizeTick();

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('resyncs once the keyboard has closed and the visual viewport is full height again (#402)', async () => {
    const vv = Object.assign(fakeVisualViewport(), { height: 400, scale: 1 });
    vi.stubGlobal('visualViewport', vv);
    vi.stubGlobal('scrollY', 120);
    vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(800);
    (await freshPopupModule()).installKeyboardViewportFix();

    vv.height = 800;
    vv.dispatchEvent(new Event('resize'));
    await nextViewportResizeTick();

    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it('is a no-op without a visualViewport (e.g. a unit test, or a non-WebKit browser)', () => {
    vi.stubGlobal('visualViewport', undefined);
    expect(() => installKeyboardViewportFix()).not.toThrow();
    expect(scrollTo).not.toHaveBeenCalled();
  });
});

describe('onViewportResize', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is a no-op — never subscribes, and returns a no-op unsubscribe — without a visualViewport', () => {
    vi.stubGlobal('visualViewport', undefined);
    const fn = vi.fn();
    const off = onViewportResize(fn);
    expect(() => off()).not.toThrow();
    expect(fn).not.toHaveBeenCalled();
  });

  it('coalesces a burst of resize events into a single notification per tick', async () => {
    const vv = fakeVisualViewport();
    vi.stubGlobal('visualViewport', vv);
    const fn = vi.fn();
    onViewportResize(fn);

    vv.dispatchEvent(new Event('resize'));
    vv.dispatchEvent(new Event('resize'));
    vv.dispatchEvent(new Event('resize'));
    await nextViewportResizeTick();

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('notifies every current subscriber from the same shared tick', async () => {
    const vv = fakeVisualViewport();
    vi.stubGlobal('visualViewport', vv);
    const a = vi.fn();
    const b = vi.fn();
    onViewportResize(a);
    onViewportResize(b);

    vv.dispatchEvent(new Event('resize'));
    await nextViewportResizeTick();

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('stops notifying once unsubscribed', async () => {
    const vv = fakeVisualViewport();
    vi.stubGlobal('visualViewport', vv);
    const fn = vi.fn();
    const off = onViewportResize(fn);
    off();

    vv.dispatchEvent(new Event('resize'));
    await nextViewportResizeTick();

    expect(fn).not.toHaveBeenCalled();
  });

  it('re-attaches when a different visualViewport object is subscribed against later', async () => {
    // Regression test for the identity-tracking design itself: a naive
    // "attach once" flag would silently stop working the moment
    // `globalThis.visualViewport` becomes a different object, which is
    // exactly what happens across tests in this file (a fresh fake per
    // test) and is also possible in principle in a real page.
    const first = fakeVisualViewport();
    vi.stubGlobal('visualViewport', first);
    const fnFirst = vi.fn();
    const offFirst = onViewportResize(fnFirst);
    first.dispatchEvent(new Event('resize'));
    await nextViewportResizeTick();
    expect(fnFirst).toHaveBeenCalledTimes(1);
    // Unsubscribe before switching viewports so the second dispatch below
    // only exercises whether the *new* subscriber actually receives it —
    // an accumulated but still-subscribed `fnFirst` would also be notified
    // by the second dispatch (every subscriber shares one listener set),
    // which is correct production behavior but would muddy this assertion.
    offFirst();

    const second = fakeVisualViewport();
    vi.stubGlobal('visualViewport', second);
    const fnSecond = vi.fn();
    onViewportResize(fnSecond);
    second.dispatchEvent(new Event('resize'));
    await nextViewportResizeTick();
    expect(fnSecond).toHaveBeenCalledTimes(1);
  });
});

describe('isKeyboardLikelyOpen', () => {
  it('is true when the visible area is a keyboard-height shorter than the layout viewport', () => {
    expect(isKeyboardLikelyOpen({ height: 400, scale: 1 }, 800)).toBe(true);
  });

  it('is false for the few tens of px a browser toolbar moves', () => {
    expect(isKeyboardLikelyOpen({ height: 740, scale: 1 }, 800)).toBe(false);
  });

  it('is false when pinch-zoom alone shrinks the visual viewport', () => {
    expect(isKeyboardLikelyOpen({ height: 400, scale: 2 }, 800)).toBe(false);
  });

  it('is false without usable measurements (no layout, e.g. jsdom)', () => {
    expect(isKeyboardLikelyOpen({}, 800)).toBe(false);
    expect(isKeyboardLikelyOpen({ height: 400, scale: 1 }, 0)).toBe(false);
  });
});
