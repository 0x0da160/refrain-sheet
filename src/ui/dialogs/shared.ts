// SPDX-License-Identifier: MIT
import { el, focusWithoutKeyboard } from '../dom';
import { makeDraggable, makeResizable } from '../drag-resize';
import { t } from '../../app/i18n';

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

/**
 * Background a user does not need in order to decide or act — how a setting
 * is stored, what an export leaves out, how keys are routed — folded behind
 * a closed native `<details>` disclosure so the dialog shows only what the
 * decision needs. Impact a user must see before a save, convert, discard, or
 * encoding change never goes here (`knowledge/ui/ui-writing-and-wording.md`
 * §2-3). `<details>`/`<summary>` are keyboard- and screen-reader-accessible
 * natively.
 */
export function helpDetails(...paragraphs: string[]): HTMLDetailsElement {
  return el('details', { className: 'dialog-help' }, [
    el('summary', { text: t('dialog.help.summary') }),
    ...paragraphs.map((text) => el('p', { className: 'dialog-note', text })),
  ]);
}

function cellName(row: number, col: number): string {
  return `R${row + 1}C${col + 1}`;
}

export function cellList(cells: Array<{ row: number; col: number }>, extra?: (i: number) => string): string {
  const shown = cells.slice(0, 10).map((c, i) => cellName(c.row, c.col) + (extra ? extra(i) : ''));
  return shown.join(', ') + (cells.length > 10 ? ` … (+${cells.length - 10})` : '');
}

export type DialogBuilder<T> = (body: HTMLElement, buttons: HTMLElement, close: (value: T) => void) => void;

/**
 * A corner grip appended to a dialog/popover so it can be resized (see
 * `makeResizable`, `src/ui/drag-resize.ts`). `aria-hidden` plus a `title`
 * tooltip mirrors the grid's pointer-only resize/fill/move handles
 * (`.col-resize-handle` etc. in `src/ui/grid/index.ts`): a mouse/touch affordance
 * with no keyboard equivalent, so it is not exposed to assistive tech.
 */
function resizeGrip(): HTMLDivElement {
  return el('div', {
    className: 'dialog-resize-handle',
    attrs: { 'aria-hidden': 'true', title: t('dialog.resizeHandle') },
  });
}

/**
 * Modal dialogs built on the native <dialog> element, which provides the
 * focus trap and Escape handling. All content is added via textContent.
 * The heading doubles as a drag handle and a corner grip makes it resizable
 * (`makeDraggable`/`makeResizable`); both are pointer-only and leave the
 * dialog centered until the user first grabs one of them.
 */
export function openDialog<T>(title: string, fallback: T, build: DialogBuilder<T>): Promise<T> {
  return new Promise((resolve) => {
    const dialog = el('dialog', { attrs: { 'aria-labelledby': 'dialog-title' } });
    const heading = el('h2', {
      className: 'dialog-title',
      text: title,
      attrs: { id: 'dialog-title', title: t('dialog.dragHandle') },
    });
    const body = el('div', { className: 'dialog-body' });
    const buttons = el('div', { className: 'dialog-buttons' });
    const grip = resizeGrip();
    dialog.append(heading, body, buttons, grip);
    makeDraggable(dialog, heading);
    makeResizable(dialog, grip);

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
    const autofocusTarget = dialog.querySelector<HTMLElement>('[data-autofocus]');
    if (autofocusTarget) {
      focusWithoutKeyboard(autofocusTarget);
    }
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
