// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * `installKeyboardViewportFix` (#402): resyncs the page's scroll position on
 * `visualViewport` resize/scroll so iOS Safari cannot leave the page shifted
 * upward after the on-screen keyboard closes (see `src/ui/popup.ts`).
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

  it('resyncs the scroll position when the visual viewport resizes (keyboard open or close)', () => {
    const vv = fakeVisualViewport();
    vi.stubGlobal('visualViewport', vv);
    installKeyboardViewportFix();

    vv.dispatchEvent(new Event('resize'));

    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it('resyncs the scroll position when the visual viewport scrolls', () => {
    const vv = fakeVisualViewport();
    vi.stubGlobal('visualViewport', vv);
    installKeyboardViewportFix();

    vv.dispatchEvent(new Event('scroll'));

    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it('is a no-op without a visualViewport (e.g. a unit test, or a non-WebKit browser)', () => {
    vi.stubGlobal('visualViewport', undefined);
    expect(() => installKeyboardViewportFix()).not.toThrow();
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
