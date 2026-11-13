// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * Anchored popovers (`openAnchoredPopover`): the native popover and CSS anchor
 * positioning where the browser has them, and the JavaScript placement when it
 * does not or when the invoker has left the page.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openAnchoredPopover } from '../../src/ui/anchored-popover';

const RECT = { left: 100, top: 40, right: 140, bottom: 64 };

/** jsdom has neither the popover API nor CSS anchor positioning; a test adds whichever it needs. */
function givePopoverApi(): { show: ReturnType<typeof vi.fn>; hide: ReturnType<typeof vi.fn> } {
  const show = vi.fn();
  const hide = vi.fn();
  Object.assign(HTMLElement.prototype, { showPopover: show, hidePopover: hide });
  return { show, hide };
}

function giveAnchorPositioning(supported: boolean): void {
  vi.stubGlobal('CSS', { supports: vi.fn(() => supported) });
}

function invoker(connected = true): HTMLButtonElement {
  const button = document.createElement('button');
  if (connected) {
    document.body.append(button);
  }
  return button;
}

function openFrom(anchor: HTMLElement): Promise<void> {
  return openAnchoredPopover({
    placement: { kind: 'below', rect: RECT, anchor },
    label: 'Test popover',
    build: (root) => root.append(document.createElement('button')),
  });
}

function popover(): HTMLElement {
  return document.querySelector<HTMLElement>('.anchored-popover')!;
}

function escape(): void {
  popover().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  const proto = HTMLElement.prototype as Partial<Record<'showPopover' | 'hidePopover', unknown>>;
  delete proto.showPopover;
  delete proto.hidePopover;
  document.body.replaceChildren();
});

describe('openAnchoredPopover', () => {
  it('shows a native popover and places it with CSS anchor positioning from its connected invoker', async () => {
    giveAnchorPositioning(true);
    const { show, hide } = givePopoverApi();
    const button = invoker();
    const pending = openFrom(button);

    expect(popover().getAttribute('popover')).toBe('manual');
    expect(show).toHaveBeenCalledTimes(1);
    expect(popover().classList.contains('anchored-popover-anchored')).toBe(true);
    const name = button.style.getPropertyValue('anchor-name');
    expect(name).toMatch(/^--anchored-popover-\d+$/);
    expect(popover().style.getPropertyValue('position-anchor')).toBe(name);

    escape();
    await pending;
    expect(hide).toHaveBeenCalledTimes(1);
    expect(button.style.getPropertyValue('anchor-name')).toBe('');
    expect(document.querySelector('.anchored-popover')).toBeNull();
  });

  it('gives each popover its own anchor name', async () => {
    giveAnchorPositioning(true);
    givePopoverApi();
    const button = invoker();
    const first = openFrom(button);
    const firstName = button.style.getPropertyValue('anchor-name');
    escape();
    await first;
    const second = openFrom(button);
    expect(button.style.getPropertyValue('anchor-name')).not.toBe(firstName);
    escape();
    await second;
  });

  it('places it with JavaScript when the browser has no CSS anchor positioning', async () => {
    giveAnchorPositioning(false);
    givePopoverApi();
    const button = invoker();
    const pending = openFrom(button);

    expect(popover().classList.contains('anchored-popover-anchored')).toBe(false);
    expect(button.style.getPropertyValue('anchor-name')).toBe('');
    expect(popover().style.left).toMatch(/px$/);
    escape();
    await pending;
  });

  it('places it with JavaScript when the invoker has left the page', async () => {
    giveAnchorPositioning(true);
    givePopoverApi();
    const button = invoker(false);
    const pending = openFrom(button);

    expect(popover().classList.contains('anchored-popover-anchored')).toBe(false);
    expect(button.style.getPropertyValue('anchor-name')).toBe('');
    escape();
    await pending;
  });

  it('still anchors with CSS when there is no popover API, without the top layer', async () => {
    giveAnchorPositioning(true);
    const button = invoker();
    const pending = openFrom(button);

    expect(popover().hasAttribute('popover')).toBe(false);
    expect(popover().classList.contains('anchored-popover-anchored')).toBe(true);
    escape();
    await pending;
  });
});
