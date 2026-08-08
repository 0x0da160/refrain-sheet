// SPDX-License-Identifier: MIT
import { el } from '../dom';
import { positionPopup, visualViewportRect, type AnchorRect } from '../popup';

/**
 * A safe external hyperlink. The href/text are fixed constants (never CSV or
 * user content), text goes through textContent, and the link opens in a new
 * tab with `rel="noopener noreferrer"` so the opened page cannot reach back
 * through `window.opener`. Keyboard/focus/screen-reader support is native to
 * the anchor; visual styling (incl. light/dark themes and focus ring) is in
 * `.dialog-link`.
 */
export function externalLink(text: string, href: string): HTMLAnchorElement {
  return el('a', {
    className: 'dialog-link',
    text,
    attrs: { href, target: '_blank', rel: 'noopener noreferrer' },
  });
}

export function cellName(row: number, col: number): string {
  return `R${row + 1}C${col + 1}`;
}

export function cellList(cells: Array<{ row: number; col: number }>, extra?: (i: number) => string): string {
  const shown = cells.slice(0, 10).map((c, i) => cellName(c.row, c.col) + (extra ? extra(i) : ''));
  return shown.join(', ') + (cells.length > 10 ? ` … (+${cells.length - 10})` : '');
}

export type DialogBuilder<T> = (body: HTMLElement, buttons: HTMLElement, close: (value: T) => void) => void;

/**
 * Modal dialogs built on the native <dialog> element, which provides the
 * focus trap and Escape handling. All content is added via textContent.
 */
export function openDialog<T>(title: string, fallback: T, build: DialogBuilder<T>): Promise<T> {
  return new Promise((resolve) => {
    const dialog = el('dialog', { attrs: { 'aria-labelledby': 'dialog-title' } });
    const heading = el('h2', { className: 'dialog-title', text: title, attrs: { id: 'dialog-title' } });
    const body = el('div', { className: 'dialog-body' });
    const buttons = el('div', { className: 'dialog-buttons' });
    dialog.append(heading, body, buttons);

    const restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    let settled = false;
    const finish = (value: T) => {
      if (settled) {
        return;
      }
      settled = true;
      if (dialog.open) {
        dialog.close();
      }
      dialog.remove();
      if (restoreFocus && restoreFocus.isConnected) {
        restoreFocus.focus();
      }
      resolve(value);
    };
    // Escape triggers 'cancel'; some environments never fire 'close', so the
    // promise is settled directly rather than from the 'close' event.
    dialog.addEventListener('cancel', () => finish(fallback));
    dialog.addEventListener('close', () => finish(fallback));
    build(body, buttons, finish);
    document.body.append(dialog);
    dialog.showModal();
    dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus();
  });
}

/**
 * Makes Enter submit a single-line dialog input, mirroring how a native
 * `<form>` treats Enter in a text/number field. Ignored while an IME
 * composition is in progress — `compositionstart`/`compositionend` are
 * tracked explicitly because `isComposing` is not set on the keydown that
 * commits a candidate in every browser — so committing a Japanese candidate
 * with Enter never submits the dialog by accident.
 */
export function submitOnEnter(input: HTMLElement, submit: () => void): void {
  let composing = false;
  input.addEventListener('compositionstart', () => {
    composing = true;
  });
  input.addEventListener('compositionend', () => {
    composing = false;
  });
  input.addEventListener('keydown', (event) => {
    const keyboardEvent = event as KeyboardEvent;
    if (keyboardEvent.key === 'Enter' && !composing && !keyboardEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  });
}

export function dialogButton(
  label: string,
  primary: boolean,
  autofocus: boolean,
  onClick: () => void,
): HTMLButtonElement {
  const button = el('button', {
    className: primary ? 'primary' : '',
    text: label,
    attrs: { type: 'button', ...(autofocus ? { 'data-autofocus': 'true' } : {}) },
  });
  button.addEventListener('click', onClick);
  return button;
}

/**
 * A non-modal, anchored popover built the same way as `openDialog` (same
 * `.dialog-title`/`.dialog-body`/`.dialog-buttons` structure and CSS) but
 * positioned with {@link positionPopup} next to `getAnchor()` instead of
 * centered behind a modal backdrop, so the sheet stays visible and usable
 * behind it. `getAnchor` is re-invoked on every reposition (not cached)
 * because the grid re-renders its (virtualized) header on scroll, which can
 * replace the anchor element entirely; when it returns null (the anchor has
 * scrolled out of the rendered window) the popover falls back to a
 * viewport-centered position rather than closing, since the underlying
 * command already captured everything it needs from the triggering column.
 * Dismissal mirrors `ContextMenu`: Escape, an outside pointer interaction,
 * and window blur all close it, and focus returns to whatever triggered it.
 * A manual Tab/Shift+Tab handler keeps focus cycling within the popover
 * since, unlike `<dialog>` opened with `showModal()`, a plain positioned
 * element has no native focus trap.
 */
export function openPopover<T>(
  getAnchor: () => AnchorRect | null,
  title: string,
  fallback: T,
  build: DialogBuilder<T>,
): Promise<T> {
  return new Promise((resolve) => {
    const popover = el('div', {
      className: 'filter-popover',
      attrs: { role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'filter-popover-title' },
    });
    const heading = el('h2', {
      className: 'dialog-title',
      text: title,
      attrs: { id: 'filter-popover-title' },
    });
    const body = el('div', { className: 'dialog-body' });
    const buttons = el('div', { className: 'dialog-buttons' });
    popover.append(heading, body, buttons);

    const restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const listeners: Array<() => void> = [];
    const on = (
      target: EventTarget,
      type: string,
      handler: EventListenerOrEventListenerObject,
      capture = false,
    ) => {
      target.addEventListener(type, handler, capture);
      listeners.push(() => target.removeEventListener(type, handler, capture));
    };

    let settled = false;
    const finish = (value: T): void => {
      if (settled) {
        return;
      }
      settled = true;
      for (const off of listeners) {
        off();
      }
      popover.remove();
      if (restoreFocus && restoreFocus.isConnected) {
        restoreFocus.focus();
      }
      resolve(value);
    };

    const reposition = (): void => {
      const anchor = getAnchor();
      if (anchor) {
        positionPopup(popover, { kind: 'below', rect: anchor });
      } else {
        const vp = visualViewportRect();
        positionPopup(popover, { kind: 'point', x: vp.left + vp.width / 2, y: vp.top + vp.height / 3 });
      }
    };

    const focusableItems = (): HTMLElement[] =>
      Array.from(
        popover.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      );

    build(body, buttons, finish);
    document.body.append(popover);
    reposition();
    popover.querySelector<HTMLElement>('[data-autofocus]')?.focus();

    const onPointerDown = (event: Event): void => {
      const target = event.target as Node | null;
      if (target && popover.contains(target)) {
        return;
      }
      finish(fallback);
    };
    const onKeyDown = (evt: Event): void => {
      const event = evt as KeyboardEvent;
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(fallback);
        return;
      }
      if (event.key !== 'Tab') {
        return;
      }
      const items = focusableItems();
      if (items.length === 0) {
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    on(document, 'mousedown', onPointerDown, true);
    on(document, 'touchstart', onPointerDown, true);
    on(popover, 'keydown', onKeyDown);
    on(window, 'resize', reposition);
    on(window, 'blur', () => finish(fallback));
    on(document, 'scroll', reposition, true);
    if (globalThis.visualViewport) {
      on(globalThis.visualViewport, 'resize', reposition);
    }
  });
}
