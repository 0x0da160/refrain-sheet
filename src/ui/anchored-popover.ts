// SPDX-License-Identifier: MIT
/**
 * A small floating panel next to the control that opened it: the color and
 * border pickers open here when chosen from the toolbar or the right-click
 * menu, so the choice is made where the pointer already is instead of in the
 * side panel. One is open at a time.
 *
 * The toolbar and the right-click menu record where they were used with
 * {@link noteInvoker} just before they run a command; a dialog that can open
 * as a popover takes that place with {@link takeInvokerPlacement}. A command
 * run from the menu bar or a shortcut finds none and uses its side panel.
 *
 * Closes on Escape, a pointer press outside it, a scroll outside it, or a
 * window resize. Window blur does not close it, so the browser's own color
 * chooser can be used from inside it.
 */
import { el, focusWithoutKeyboard } from './dom';
import { positionPopup, type PopupPlacement } from './popup';

/** How long a recorded invoker stays valid for the command it started. */
const INVOKER_TTL_MS = 1000;

let invoker: { placement: PopupPlacement; at: number } | null = null;
let openClose: (() => void) | null = null;

/** Record where a toolbar button or right-click menu was used, for the popover its command may open. */
export function noteInvoker(placement: PopupPlacement): void {
  invoker = { placement, at: Date.now() };
}

/** Where to open a popover for the command being run now, or null to use the side panel. */
export function takeInvokerPlacement(): PopupPlacement | null {
  const found = invoker && Date.now() - invoker.at <= INVOKER_TTL_MS ? invoker.placement : null;
  invoker = null;
  return found;
}

/** Close the open popover, if any. */
function closeAnchoredPopover(): void {
  openClose?.();
}

/**
 * Open a popover at `placement`, filled by `build` (which gets a `close`
 * function). Resolves when it closes, however that happens.
 */
export function openAnchoredPopover(options: {
  placement: PopupPlacement;
  label: string;
  className?: string;
  /** Where to put it: inside a modal dialog it must join the dialog's layer. Default: the page body. */
  container?: HTMLElement;
  build: (root: HTMLElement, close: () => void) => void;
}): Promise<void> {
  closeAnchoredPopover();
  return new Promise((resolve) => {
    const root = el('div', {
      className: `anchored-popover${options.className ? ` ${options.className}` : ''}`,
      attrs: { role: 'dialog', 'aria-modal': 'false', 'aria-label': options.label },
    });
    const listeners: Array<() => void> = [];
    const on = (target: EventTarget, type: string, handler: (event: Event) => void): void => {
      target.addEventListener(type, handler, true);
      listeners.push(() => target.removeEventListener(type, handler, true));
    };
    let done = false;
    const close = (): void => {
      if (done) {
        return;
      }
      done = true;
      openClose = null;
      for (const off of listeners) {
        off();
      }
      root.remove();
      resolve();
    };
    openClose = close;
    root.addEventListener('keydown', (event) => {
      event.stopPropagation(); // keys typed here never reach the grid or app shortcuts
      if (event.key === 'Escape' && !event.isComposing) {
        event.preventDefault();
        close();
      }
    });
    const outside = (event: Event): void => {
      const target = event.target as Node | null;
      if (!target || !root.contains(target)) {
        close();
      }
    };
    on(document, 'pointerdown', outside);
    on(document, 'scroll', outside);
    on(window, 'resize', close);
    options.build(root, close);
    (options.container ?? document.body).append(root);
    positionPopup(root, options.placement);
    const first = root.querySelector<HTMLElement>('[data-autofocus], button, input, select');
    if (first) {
      focusWithoutKeyboard(first);
    }
  });
}
