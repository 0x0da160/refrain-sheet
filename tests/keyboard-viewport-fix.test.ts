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
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installKeyboardViewportFix } from '../src/ui/popup';

/** A minimal stand-in for `window.visualViewport` in jsdom, which has none. */
function fakeVisualViewport(): EventTarget {
  return new EventTarget();
}

describe('installKeyboardViewportFix', () => {
  const scrollTo = vi.fn();

  beforeEach(() => {
    scrollTo.mockClear();
    vi.stubGlobal('scrollTo', scrollTo);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resyncs the scroll position when the visual viewport resizes while the page is shifted (keyboard close, #402)', () => {
    const vv = fakeVisualViewport();
    vi.stubGlobal('visualViewport', vv);
    vi.stubGlobal('scrollY', 120);
    installKeyboardViewportFix();

    vv.dispatchEvent(new Event('resize'));

    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it('resyncs the scroll position when the visual viewport scrolls while the page is shifted', () => {
    const vv = fakeVisualViewport();
    vi.stubGlobal('visualViewport', vv);
    vi.stubGlobal('scrollX', 40);
    installKeyboardViewportFix();

    vv.dispatchEvent(new Event('scroll'));

    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it('does not scroll when the page is already at (0, 0) (e.g. per-keystroke visualViewport churn, #519)', () => {
    const vv = fakeVisualViewport();
    vi.stubGlobal('visualViewport', vv);
    installKeyboardViewportFix();

    vv.dispatchEvent(new Event('resize'));
    vv.dispatchEvent(new Event('scroll'));

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('is a no-op without a visualViewport (e.g. a unit test, or a non-WebKit browser)', () => {
    vi.stubGlobal('visualViewport', undefined);
    expect(() => installKeyboardViewportFix()).not.toThrow();
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
