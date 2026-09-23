// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * `installViewportDebug` (#582): the opt-in on-device viewport diagnostics.
 * Nothing is installed without the `#debug-viewport` hash; with it, events
 * are logged and the Copy button hands the whole log to the clipboard.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installViewportDebug } from '../src/ui/viewport-debug';

afterEach(() => {
  document.querySelector('.viewport-debug')?.remove();
  history.replaceState(null, '', '#');
  vi.restoreAllMocks();
});

describe('installViewportDebug', () => {
  it('adds nothing without the #debug-viewport hash', () => {
    const add = vi.spyOn(document, 'addEventListener');
    installViewportDebug();
    expect(document.querySelector('.viewport-debug')).toBeNull();
    expect(add.mock.calls.map((call) => call[0])).not.toContain('focusin');
  });

  it('logs focus and scroll events and copies the log', async () => {
    history.replaceState(null, '', '#debug-viewport');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    installViewportDebug();
    const panel = document.querySelector('.viewport-debug');
    expect(panel).not.toBeNull();
    expect(panel?.textContent).toContain(' start vv=');

    const input = document.createElement('textarea');
    input.className = 'grid-sink';
    document.body.append(input);
    input.focus();
    expect(panel?.querySelector('.viewport-debug-current')?.textContent).toContain(
      'focusin:textarea.grid-sink',
    );

    const copy = panel?.querySelector<HTMLButtonElement>('.viewport-debug-button');
    copy?.click();
    await Promise.resolve();
    const text = writeText.mock.calls[0]?.[0] as string;
    expect(text.split('\n')[0]).toMatch(/^Refrain Sheet /);
    expect(text).toContain(' start ');
    expect(text).toContain('focusin:textarea.grid-sink');
    expect(text).toContain('ae=textarea.grid-sink');
    input.remove();
  });
});
