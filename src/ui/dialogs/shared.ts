// SPDX-License-Identifier: MIT
import { PanelBottom, PanelLeft, PanelRight, PanelTop } from 'lucide';
import { el } from '../dom';
import { makeDraggable, makeEdgeResizable, makeResizable, type EdgeResizeAxis } from '../drag-resize';
import { createIcon } from '../icon';
import { positionPopup, visualViewportRect, type AnchorRect } from '../popup';
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

export function cellName(row: number, col: number): string {
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
 * (`.col-resize-handle` etc. in `src/ui/grid.ts`): a mouse/touch affordance
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
 * element has no native focus trap. The heading doubles as a drag handle
 * and a corner grip makes it resizable (`makeDraggable`/`makeResizable`);
 * once the user has grabbed either, `reposition` stops re-anchoring it to
 * `getAnchor()` so a scroll or window resize does not snap it back.
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
      attrs: { id: 'filter-popover-title', title: t('dialog.dragHandle') },
    });
    const body = el('div', { className: 'dialog-body' });
    const buttons = el('div', { className: 'dialog-buttons' });
    const grip = resizeGrip();
    popover.append(heading, body, buttons, grip);
    makeDraggable(popover, heading);
    makeResizable(popover, grip);

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
      if (popover.dataset.dragResized === 'true') {
        return; // the user has manually moved/resized it; don't snap it back.
      }
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

export type SidePanelPosition = 'top' | 'right' | 'bottom' | 'left';

const SIDE_PANEL_POSITIONS: readonly SidePanelPosition[] = ['top', 'right', 'bottom', 'left'];
const SIDE_PANEL_POSITION_ICON: Record<SidePanelPosition, typeof PanelTop> = {
  top: PanelTop,
  right: PanelRight,
  bottom: PanelBottom,
  left: PanelLeft,
};
const DEFAULT_SIDE_PANEL_SIZE = 380;
const MIN_SIDE_PANEL_SIZE = 240;
const SIDE_PANEL_VIEWPORT_MARGIN = 160;

/**
 * Remembered across calls (but not across page loads) so opening the Filter
 * dialog, then Sort, then Borders all reuse whichever dock side/size the user
 * last chose, instead of resetting every time (#393).
 */
let sidePanelPosition: SidePanelPosition = 'right';
let sidePanelSize = DEFAULT_SIDE_PANEL_SIZE;

function sidePanelAxis(position: SidePanelPosition): EdgeResizeAxis {
  return position === 'left' || position === 'right' ? 'horizontal' : 'vertical';
}

/** Docks `panel` to `position` at `size` pixels (width for left/right, height for top/bottom). */
function applySidePanelPosition(panel: HTMLElement, position: SidePanelPosition, size: number): void {
  panel.dataset.sidePanelPosition = position;
  // The two edges perpendicular to the dock side always span the full
  // viewport (e.g. left/right docked panels are always full height); the
  // edge opposite the dock side is left unset so the panel's size comes from
  // its explicit width/height below, not from being pinned on both sides.
  panel.style.top = position === 'left' || position === 'right' || position === 'top' ? '0px' : '';
  panel.style.bottom = position === 'left' || position === 'right' || position === 'bottom' ? '0px' : '';
  panel.style.left = position === 'top' || position === 'bottom' || position === 'left' ? '0px' : '';
  panel.style.right = position === 'top' || position === 'bottom' || position === 'right' ? '0px' : '';
  if (sidePanelAxis(position) === 'horizontal') {
    panel.style.width = `${size}px`;
    panel.style.height = '';
  } else {
    panel.style.width = '';
    panel.style.height = `${size}px`;
  }
}

/**
 * A dockable, resizable panel built the same way as `openDialog` (same
 * `DialogBuilder<T>` callback and `.dialog-title`/`.dialog-body`/
 * `.dialog-buttons` structure/CSS), but anchored to an edge of the viewport
 * (top/right/bottom/left, switchable from the header) instead of floating —
 * the same idea as the comments panel (`ui/comments-panel.ts`), generalized
 * to every filter/sort/format/data dialog and made resizable by dragging its
 * inner edge (see `makeEdgeResizable`, `src/ui/drag-resize.ts`). The sheet
 * stays visible and usable beside/below it, like `openPopover`. Dismissal
 * mirrors `openPopover`: Escape, an outside pointer interaction, and window
 * blur all close it (resolving `fallback`), and focus returns to whatever
 * triggered it.
 */
export function openSidePanel<T>(title: string, fallback: T, build: DialogBuilder<T>): Promise<T> {
  return new Promise((resolve) => {
    const panel = el('div', {
      className: 'side-panel',
      attrs: { role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'side-panel-title' },
    });
    applySidePanelPosition(panel, sidePanelPosition, sidePanelSize);

    // Position/cursor for the resize handle come purely from the `.side-panel`
    // element's `data-side-panel-position` attribute (see the CSS), so no
    // per-position class juggling is needed here beyond re-applying it.
    const grip = el('div', {
      className: 'side-panel-resize-handle',
      attrs: { 'aria-hidden': 'true', title: t('dialog.resizeHandle') },
    });

    const positionButtons = SIDE_PANEL_POSITIONS.map((position) => {
      const label = t(`dialog.sidePanel.position.${position}`);
      const button = el('button', {
        className: 'side-panel-position-btn',
        attrs: { type: 'button', 'aria-pressed': String(position === sidePanelPosition), title: label },
      });
      button.append(createIcon(SIDE_PANEL_POSITION_ICON[position], 'side-panel-position-icon', 14));
      button.addEventListener('click', () => {
        sidePanelPosition = position;
        applySidePanelPosition(panel, sidePanelPosition, sidePanelSize);
        for (const other of positionButtons) {
          other.button.setAttribute('aria-pressed', String(other.position === position));
        }
      });
      return { position, button };
    });
    const positionSwitcher = el(
      'div',
      {
        className: 'side-panel-positions',
        attrs: { role: 'group', 'aria-label': t('dialog.sidePanel.position') },
      },
      positionButtons.map((p) => p.button),
    );

    const heading = el('div', { className: 'dialog-title side-panel-title' }, [
      el('span', { text: title, attrs: { id: 'side-panel-title' } }),
      positionSwitcher,
    ]);
    const body = el('div', { className: 'dialog-body' });
    const buttons = el('div', { className: 'dialog-buttons' });
    panel.append(heading, body, buttons, grip);

    makeEdgeResizable(
      grip,
      () => sidePanelAxis(sidePanelPosition),
      () => (sidePanelPosition === 'left' || sidePanelPosition === 'top' ? 1 : -1),
      () => {
        const rect = panel.getBoundingClientRect();
        return sidePanelAxis(sidePanelPosition) === 'horizontal' ? rect.width : rect.height;
      },
      MIN_SIDE_PANEL_SIZE,
      () => {
        const vp = visualViewportRect();
        return (
          (sidePanelAxis(sidePanelPosition) === 'horizontal' ? vp.width : vp.height) -
          SIDE_PANEL_VIEWPORT_MARGIN
        );
      },
      (size) => {
        sidePanelSize = size;
        applySidePanelPosition(panel, sidePanelPosition, size);
      },
    );

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
      panel.remove();
      if (restoreFocus && restoreFocus.isConnected) {
        restoreFocus.focus();
      }
      resolve(value);
    };

    const focusableItems = (): HTMLElement[] =>
      Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      );

    build(body, buttons, finish);
    document.body.append(panel);
    panel.querySelector<HTMLElement>('[data-autofocus]')?.focus();

    const onPointerDown = (event: Event): void => {
      const target = event.target as Node | null;
      if (target && panel.contains(target)) {
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
    on(panel, 'keydown', onKeyDown);
    on(window, 'blur', () => finish(fallback));
  });
}
