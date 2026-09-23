// SPDX-License-Identifier: MIT
import { Maximize2, Minimize2, PanelBottom, PanelLeft, PanelRight, PanelTop } from 'lucide';
import { clearChildren, el, focusWithoutKeyboard } from '../dom';
import { makeDraggable, makeEdgeResizable, makeResizable, type EdgeResizeAxis } from '../drag-resize';
import { createIcon } from '../icon';
import { visualViewportRect } from '../popup';
import { updateShellLayout } from '../shell-layout';
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

export type SidePanelPosition = 'top' | 'right' | 'bottom' | 'left';

const SIDE_PANEL_POSITIONS: readonly SidePanelPosition[] = ['left', 'top', 'bottom', 'right'];
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
 * last chose, instead of resetting every time (#393). `sidePanelPosition`
 * only takes effect once the user has explicitly picked a side via the
 * header switcher (`sidePanelPositionExplicit`); until then, the effective
 * position is computed live from the viewport by
 * {@link effectiveSidePanelPosition} so a smartphone held in portrait
 * defaults to a bottom dock instead of the desktop-oriented right dock
 * (#459).
 */
let sidePanelPosition: SidePanelPosition = 'right';
let sidePanelPositionExplicit = false;
let sidePanelSize = DEFAULT_SIDE_PANEL_SIZE;
/** Whether the last-opened side panel was left maximized; shared the same
 * way `sidePanelPosition`/`sidePanelSize` are, so opening the next panel
 * (Filter, then Sort, …) keeps whichever the user last chose. */
let sidePanelMaximized = false;

/**
 * Smartphone-in-portrait viewports default to a bottom dock — there's little
 * usable width for a left/right split — while every other viewport keeps the
 * pre-existing right-docked default (#459).
 */
function effectiveSidePanelPosition(): SidePanelPosition {
  if (sidePanelPositionExplicit) {
    return sidePanelPosition;
  }
  const isMobilePortrait =
    typeof globalThis.matchMedia === 'function' &&
    globalThis.matchMedia('(max-width: 700px) and (orientation: portrait)').matches;
  return isMobilePortrait ? 'bottom' : 'right';
}

/** The dock side/size any *new* dockable side panel should open at. */
export function currentSidePanelPlacement(): { position: SidePanelPosition; size: number } {
  const position = effectiveSidePanelPosition();
  return { position, size: sidePanelMaximized ? sidePanelMaximizedExtent(position) : sidePanelSize };
}

function sidePanelAxis(position: SidePanelPosition): EdgeResizeAxis {
  return position === 'left' || position === 'right' ? 'horizontal' : 'vertical';
}

/** The largest a side panel is ever allowed to grow to along its docked
 * axis — the same cap the edge-resize handle enforces (`SIDE_PANEL_VIEWPORT_MARGIN`
 * left over so the sheet behind it is never fully hidden) — used by the edge
 * resize handle. */
function sidePanelMaxExtent(position: SidePanelPosition): number {
  const vp = visualViewportRect();
  return (sidePanelAxis(position) === 'horizontal' ? vp.width : vp.height) - SIDE_PANEL_VIEWPORT_MARGIN;
}

/**
 * The size a maximized side panel takes along its docked axis: all of it.
 * A left/right-docked panel spans the whole viewport width; a top/bottom
 * one fills everything between the top chrome (menu bar and book tabs) and
 * the bottom chrome (worksheet strip and status bar), which it never covers.
 * Unlike {@link sidePanelMaxExtent}, no margin of sheet is left showing —
 * the restore button brings the sheet back.
 */
function sidePanelMaximizedExtent(position: SidePanelPosition): number {
  const vp = visualViewportRect();
  if (sidePanelAxis(position) === 'horizontal') {
    return vp.width;
  }
  return Math.max(MIN_SIDE_PANEL_SIZE, vp.height - topChromeInset() - statusBarHeight() - sheetBarHeight());
}

/** The live height of the status bar (always visible, even in welcome mode). */
function statusBarHeight(): number {
  return document.querySelector('.status-bar')?.getBoundingClientRect().height ?? 0;
}

/**
 * Where a top-docked panel starts: just below the top chrome — the menu bar
 * and the book tab strip, whether stacked or sharing one row on a wide
 * window (#596) — which is exactly where `#app-content` begins. On a phone,
 * where the menu bar sits at the bottom, that is just below the tab strip.
 * 0 when no app shell is mounted (e.g. a unit test).
 */
function topChromeInset(): number {
  const content = document.getElementById('app-content');
  return content ? Math.max(0, content.getBoundingClientRect().top) : 0;
}

/** The live height of the worksheet tab strip (0 when hidden, e.g. a plain
 * CSV document, which has no worksheet strip, or the welcome screen). */
function sheetBarHeight(): number {
  const bar = document.querySelector<HTMLElement>('.sheet-bar');
  return bar && !bar.hidden ? bar.getBoundingClientRect().height : 0;
}

/**
 * Docks `panel` to `position` at `size` pixels (width for left/right, height
 * for top/bottom). A top-docked panel is inset below the menu bar *and* the
 * book tab strip (wherever they sit — see `topChromeInset`), and a
 * bottom-docked one above the status bar *and* the worksheet tab strip — chrome the panel must never cover — measured live so
 * it tracks their actual height (e.g. the menu bar collapsing to a toggle
 * button on a narrow viewport, or either tab strip being hidden) rather than
 * a guessed constant (#399/#541). Left/right-docked panels still span the
 * full viewport height, unchanged.
 */
export function applySidePanelPosition(panel: HTMLElement, position: SidePanelPosition, size: number): void {
  panel.dataset.sidePanelPosition = position;
  // Reserve (and release the previous dock's) space first: a left/right
  // reservation narrows the app, which can move the document tabs out of the
  // menu bar's row or back (#596), so the top inset below must be measured
  // with the new reservation and the resulting layout.
  reserveAppEdge(position, size);
  updateShellLayout();
  // The two edges perpendicular to the dock side always span the full
  // viewport (e.g. left/right docked panels are always full height); the
  // edge opposite the dock side is left unset so the panel's size comes from
  // its explicit width/height below, not from being pinned on both sides.
  panel.style.top =
    position === 'left' || position === 'right' ? '0px' : position === 'top' ? `${topChromeInset()}px` : '';
  panel.style.bottom =
    position === 'left' || position === 'right'
      ? '0px'
      : position === 'bottom'
        ? `${statusBarHeight() + sheetBarHeight()}px`
        : '';
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
 * Reserves `size` pixels along `position`'s edge so the docked side panel
 * shares the screen with the sheet as a genuine split view instead of
 * floating over it and hiding whatever is underneath (#396). A left/right
 * reservation pads `#app` itself (`box-sizing: border-box`, filling the
 * viewport — see `styles.css`), narrowing the menu bar and status bar along
 * with everything else, exactly as before. A top/bottom reservation instead
 * pads `#app-content` — the flex column between the two tab strips (book
 * tabs above, worksheet tabs below) — so a top dock lands below the book tab
 * strip and a bottom dock lands above the worksheet tab strip, rather than
 * covering either one (#399/#541). Cleared by `clearAppEdgeReservation` when
 * the panel closes. A no-op outside a full app shell (e.g. a unit test that
 * never mounts it).
 */
function reserveAppEdge(position: SidePanelPosition, size: number): void {
  const app = document.getElementById('app');
  if (app) {
    app.style.paddingLeft = position === 'left' ? `${size}px` : '';
    app.style.paddingRight = position === 'right' ? `${size}px` : '';
  }
  const appContent = document.getElementById('app-content');
  if (appContent) {
    appContent.style.paddingTop = position === 'top' ? `${size}px` : '';
    appContent.style.paddingBottom = position === 'bottom' ? `${size}px` : '';
  }
}

/** Releases the space `reserveAppEdge` reserved, once the panel closes. */
export function clearAppEdgeReservation(): void {
  const app = document.getElementById('app');
  if (app) {
    app.style.paddingLeft = '';
    app.style.paddingRight = '';
  }
  const appContent = document.getElementById('app-content');
  if (appContent) {
    appContent.style.paddingTop = '';
    appContent.style.paddingBottom = '';
  }
  updateShellLayout();
}

/**
 * Builds the header position switcher and the inner-edge resize handle
 * shared by every dockable side panel — the transient filter/sort/format/SQL
 * panels below (`openSidePanel`) and the persistent comments panel
 * (`ui/comments-panel.ts`) alike — so they all dock and resize identically
 * and remember the same position/size across one another (#399). `panel`
 * must already be a `.side-panel` element; its position is (re)applied here
 * on every switch and resize, but not at build time — a caller that starts
 * out hidden (the comments panel) must call {@link applySidePanelPosition}
 * itself once it actually becomes visible, so a closed panel never reserves
 * app-edge space it isn't showing.
 */
export function buildSidePanelDock(panel: HTMLElement): {
  positionSwitcher: HTMLElement;
  resizeHandle: HTMLElement;
  maximizeToggle: HTMLElement;
} {
  // Position/cursor for the resize handle come purely from the `.side-panel`
  // element's `data-side-panel-position` attribute (see the CSS), so no
  // per-position class juggling is needed here beyond re-applying it.
  const grip = el('div', {
    className: 'side-panel-resize-handle',
    attrs: { 'aria-hidden': 'true', title: t('dialog.resizeHandle') },
  });

  /** The size to apply for the current dock side, honoring maximize. */
  const currentSize = (position: SidePanelPosition): number =>
    sidePanelMaximized ? sidePanelMaximizedExtent(position) : sidePanelSize;

  const positionButtons = SIDE_PANEL_POSITIONS.map((position) => {
    const label = t(`dialog.sidePanel.position.${position}`);
    const button = el('button', {
      className: 'side-panel-position-btn',
      attrs: {
        type: 'button',
        'aria-pressed': String(position === effectiveSidePanelPosition()),
        title: label,
      },
    });
    button.append(createIcon(SIDE_PANEL_POSITION_ICON[position], 'side-panel-position-icon', 14));
    button.addEventListener('click', () => {
      sidePanelPosition = position;
      sidePanelPositionExplicit = true;
      applySidePanelPosition(panel, sidePanelPosition, currentSize(sidePanelPosition));
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

  const maximizeToggle = el('button', {
    className: 'side-panel-maximize-btn',
    attrs: { type: 'button' },
  });
  const refreshMaximizeToggle = (): void => {
    clearChildren(maximizeToggle);
    maximizeToggle.append(
      createIcon(sidePanelMaximized ? Minimize2 : Maximize2, 'side-panel-maximize-icon', 14),
    );
    maximizeToggle.setAttribute('aria-pressed', String(sidePanelMaximized));
    maximizeToggle.setAttribute(
      'title',
      t(sidePanelMaximized ? 'dialog.sidePanel.restore' : 'dialog.sidePanel.maximize'),
    );
  };
  refreshMaximizeToggle();
  maximizeToggle.addEventListener('click', () => {
    sidePanelMaximized = !sidePanelMaximized;
    const position = effectiveSidePanelPosition();
    applySidePanelPosition(panel, position, currentSize(position));
    refreshMaximizeToggle();
  });

  makeEdgeResizable(
    grip,
    () => sidePanelAxis(effectiveSidePanelPosition()),
    () => (effectiveSidePanelPosition() === 'left' || effectiveSidePanelPosition() === 'top' ? 1 : -1),
    () => {
      const rect = panel.getBoundingClientRect();
      return sidePanelAxis(effectiveSidePanelPosition()) === 'horizontal' ? rect.width : rect.height;
    },
    MIN_SIDE_PANEL_SIZE,
    () => sidePanelMaxExtent(effectiveSidePanelPosition()),
    (size) => {
      // A manual resize abandons maximize — the panel is now whatever size
      // the user just dragged it to, not necessarily the maximum.
      sidePanelMaximized = false;
      sidePanelSize = size;
      applySidePanelPosition(panel, effectiveSidePanelPosition(), size);
      refreshMaximizeToggle();
    },
  );

  return { positionSwitcher, resizeHandle: grip, maximizeToggle };
}

/**
 * A dockable, resizable panel built the same way as `openDialog` (same
 * `DialogBuilder<T>` callback and `.dialog-title`/`.dialog-body`/
 * `.dialog-buttons` structure/CSS), but anchored to an edge of the viewport
 * (top/right/bottom/left, switchable from the header) instead of floating —
 * the same idea as the comments panel (`ui/comments-panel.ts`), generalized
 * to every filter/sort/format/SQL/data dialog and made resizable by dragging
 * its inner edge (see `buildSidePanelDock` above). It reserves its own space
 * along the docked edge (`reserveAppEdge`) so the sheet is never covered — a
 * genuine split view, not an overlay (#396). Unlike `openPopover`, an
 * outside pointer interaction never dismisses it — a stray click on the
 * sheet while adjusting filter/sort/format/validation settings must not
 * silently discard them (#396); only Escape, its own Cancel button, or
 * window blur close it (resolving `fallback`), and focus returns to
 * whatever triggered it.
 */
export function openSidePanel<T>(title: string, fallback: T, build: DialogBuilder<T>): Promise<T> {
  return new Promise((resolve) => {
    const panel = el('div', {
      className: 'side-panel',
      attrs: { role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'side-panel-title' },
    });
    const initialPlacement = currentSidePanelPlacement();
    applySidePanelPosition(panel, initialPlacement.position, initialPlacement.size);
    const { positionSwitcher, resizeHandle: grip, maximizeToggle } = buildSidePanelDock(panel);

    const heading = el('div', { className: 'dialog-title side-panel-title' }, [
      el('span', { text: title, attrs: { id: 'side-panel-title' } }),
      el('div', { className: 'side-panel-title-actions' }, [positionSwitcher, maximizeToggle]),
    ]);
    const body = el('div', { className: 'dialog-body' });
    const buttons = el('div', { className: 'dialog-buttons' });
    panel.append(heading, body, buttons, grip);

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
      clearAppEdgeReservation();
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
    const autofocusTarget = panel.querySelector<HTMLElement>('[data-autofocus]');
    if (autofocusTarget) {
      focusWithoutKeyboard(autofocusTarget);
    }

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
    on(panel, 'keydown', onKeyDown);
    on(window, 'blur', () => finish(fallback));
  });
}
