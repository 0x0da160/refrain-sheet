// SPDX-License-Identifier: MIT
/**
 * Toasts previously only disappeared after a 7-second auto-dismiss timeout,
 * with no way to close one early. `Toasts.notify()` now appends a close
 * button that removes the toast immediately and cancels its pending
 * auto-dismiss timer, and shows toasts near the top of the viewport instead
 * of the bottom on narrow (mobile) screens (#534).
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLocale, setLocale, t } from '../src/app/i18n';
import { Toasts } from '../src/ui/dialogs';

describe('Toasts', () => {
  const locale = getLocale();

  beforeEach(() => {
    setLocale('en');
    vi.useFakeTimers();
  });

  afterEach(() => {
    setLocale(locale);
    vi.useRealTimers();
  });

  it('renders a close button labeled for accessibility', () => {
    const toasts = new Toasts();
    toasts.notify('Saved.', 'info');

    const closeBtn = toasts.element.querySelector<HTMLButtonElement>('.toast-close');
    expect(closeBtn).not.toBeNull();
    expect(closeBtn?.getAttribute('aria-label')).toBe(t('toast.close'));
  });

  it('removes the toast immediately when the close button is clicked', () => {
    const toasts = new Toasts();
    toasts.notify('Saved.', 'info');

    expect(toasts.element.querySelectorAll('.toast')).toHaveLength(1);
    toasts.element.querySelector<HTMLButtonElement>('.toast-close')?.click();
    expect(toasts.element.querySelectorAll('.toast')).toHaveLength(0);
  });

  it('cancels the pending auto-dismiss timer once closed manually', () => {
    const toasts = new Toasts();
    toasts.notify('Saved.', 'info');
    toasts.element.querySelector<HTMLButtonElement>('.toast-close')?.click();

    // If the auto-dismiss timer were still pending, advancing past its
    // 7-second delay would throw calling .remove() on an already-detached
    // node's parent — this just confirms it's a no-op, not a crash.
    expect(() => vi.advanceTimersByTime(7000)).not.toThrow();
    expect(toasts.element.querySelectorAll('.toast')).toHaveLength(0);
  });

  it('still auto-dismisses after 7 seconds when left unclosed', () => {
    const toasts = new Toasts();
    toasts.notify('Saved.', 'info');

    expect(toasts.element.querySelectorAll('.toast')).toHaveLength(1);
    vi.advanceTimersByTime(7000);
    expect(toasts.element.querySelectorAll('.toast')).toHaveLength(0);
  });
});
