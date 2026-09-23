// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * `focusOnTapWithoutRevealScroll` (#592): a quick tap on an unfocused text
 * field is focused from script with `preventScroll` (no iOS Safari reveal
 * scroll of the whole page); caret moves, scrolls, and long-presses stay
 * native.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { focusOnTapWithoutRevealScroll } from '../src/ui/dom';

function touchEvent(type: 'touchstart' | 'touchend', x: number, y: number): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const touch = { clientX: x, clientY: y };
  Object.defineProperty(event, 'touches', { value: type === 'touchstart' ? [touch] : [] });
  Object.defineProperty(event, 'changedTouches', { value: [touch] });
  return event;
}

function tap(field: HTMLElement, from: [number, number], to: [number, number], holdMs = 80): Event {
  field.dispatchEvent(touchEvent('touchstart', ...from));
  vi.advanceTimersByTime(holdMs);
  const end = touchEvent('touchend', ...to);
  field.dispatchEvent(end);
  return end;
}

describe('focusOnTapWithoutRevealScroll', () => {
  let field: HTMLTextAreaElement;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.textContent = '';
    field = document.createElement('textarea');
    field.value = '=SUM(A1:A3)';
    document.body.append(field);
    focusOnTapWithoutRevealScroll(field);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('focuses a tapped, unfocused field with preventScroll and cancels the native focus', () => {
    const focus = vi.spyOn(field, 'focus');
    const end = tap(field, [20, 600], [22, 603]);
    expect(end.defaultPrevented).toBe(true);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(document.activeElement).toBe(field);
    expect(field.selectionStart).toBe(field.value.length);
  });

  it('leaves taps on an already focused field native (caret placement)', () => {
    field.focus();
    const focus = vi.spyOn(field, 'focus');
    const end = tap(field, [20, 600], [20, 600]);
    expect(end.defaultPrevented).toBe(false);
    expect(focus).not.toHaveBeenCalled();
  });

  it('leaves scrolls and long-presses native', () => {
    expect(tap(field, [20, 600], [20, 640]).defaultPrevented).toBe(false);
    expect(tap(field, [20, 600], [20, 600], 800).defaultPrevented).toBe(false);
    expect(document.activeElement).not.toBe(field);
  });
});
