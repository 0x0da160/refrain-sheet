// SPDX-License-Identifier: MIT
import { Maximize2, Minimize2, PanelBottom, PanelLeft, PanelRight, PanelTop, X, type IconNode } from 'lucide';
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
 * Every side panel currently shown, in the order it was opened (#598). They
 * share one dock — the same side and size — and, when more than one is open,
 * stack there as an accordion: only `expandedSidePanel` shows its body, the
 * others collapse to their title bar, and clicking (or pressing Enter/Space
 * on) a collapsed title bar expands that panel instead. A panel joins by
 * being docked (`applySidePanelPosition`) and leaves through
 * `releaseSidePanel`; the app-edge space stays reserved until the last one
 * leaves.
 */
const openSidePanels: HTMLElement[] = [];
let expandedSidePanel: HTMLElement | null = null;
/** The dock's current side and size (the size along its docked axis). */
let dockedPosition: SidePanelPosition = 'right';
let dockedSize = DEFAULT_SIDE_PANEL_SIZE;
/** Re-syncs a panel's header controls (position/maximize buttons) with the shared dock state. */
const headerRefreshers = new WeakMap<HTMLElement, () => void>();
let relayoutOnResize = false;

/** Drops panels removed from the page without being released (never `keep`, the one being docked or released). */
function pruneDetachedSidePanels(keep: HTMLElement): void {
  for (let i = openSidePanels.length - 1; i >= 0; i--) {
    const panel = openSidePanels[i];
    if (panel !== keep && !panel.isConnected) {
      openSidePanels.splice(i, 1);
      if (expandedSidePanel === panel) {
        expandedSidePanel = null;
      }
    }
  }
}

/** The height a collapsed panel keeps: its title bar. */
function collapsedHeight(panel: HTMLElement): number {
  const title = panel.querySelector<HTMLElement>(':scope > .side-panel-title');
  const height = title?.getBoundingClientRect().height ?? 0;
  // jsdom (and a panel not yet laid out) measures 0; fall back to the shared bar height.
  return height > 0 ? height + 2 : 34; // + the panel's 1px top and bottom border
}

/** Places one panel at the dock's edge exactly as a lone panel sits (#399/#541). */
function placeDocked(panel: HTMLElement, position: SidePanelPosition, size: number): void {
  panel.dataset.sidePanelPosition = position;
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
 * Stacks two or more open panels inside the dock: collapsed title bars plus
 * the one expanded panel filling the rest, each given an explicit `top` and
 * `height`. For a top dock the expanded panel comes last and for a bottom
 * dock first, so its resize handle sits on the dock's free edge; left/right
 * docks keep the order the panels were opened in.
 */
function stackSidePanels(position: SidePanelPosition, size: number): void {
  const expanded = expandedSidePanel ?? openSidePanels[openSidePanels.length - 1];
  const collapsed = openSidePanels.filter((p) => p !== expanded);
  const order =
    position === 'top'
      ? [...collapsed, expanded]
      : position === 'bottom'
        ? [expanded, ...collapsed]
        : openSidePanels;
  const vp = visualViewportRect();
  const bottomInset = statusBarHeight() + sheetBarHeight();
  const start =
    position === 'top' ? topChromeInset() : position === 'bottom' ? vp.height - bottomInset - size : 0;
  const total = position === 'top' || position === 'bottom' ? size : vp.height;
  const collapsedTotal = collapsed.reduce((sum, p) => sum + collapsedHeight(p), 0);
  let y = start;
  for (const panel of order) {
    const height = panel === expanded ? Math.max(0, total - collapsedTotal) : collapsedHeight(panel);
    panel.style.top = `${y}px`;
    panel.style.bottom = '';
    panel.style.height = `${height}px`;
    y += height;
  }
}

/** Marks which panels are collapsed and wires their title bars to expand them. */
function syncAccordionState(): void {
  const stacked = openSidePanels.length > 1;
  for (const panel of openSidePanels) {
    const collapsed = stacked && panel !== expandedSidePanel;
    panel.classList.toggle('collapsed', collapsed);
    const title = panel.querySelector<HTMLElement>(':scope > .side-panel-title');
    if (!title) {
      continue;
    }
    if (stacked) {
      title.setAttribute('aria-expanded', String(!collapsed));
      title.tabIndex = collapsed ? 0 : -1;
    } else {
      title.removeAttribute('aria-expanded');
      title.removeAttribute('tabindex');
    }
    if (title.dataset.accordion !== 'true') {
      title.dataset.accordion = 'true';
      const expand = (): void => {
        if (panel.classList.contains('collapsed')) {
          expandSidePanel(panel);
        }
      };
      title.addEventListener('click', (event) => {
        // The title's own buttons (dock side, maximize, close) keep their jobs.
        if (!(event.target as Element).closest('.side-panel-title-actions')) {
          expand();
        }
      });
      title.addEventListener('keydown', (event) => {
        if (event.target === title && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          expand();
        }
      });
    }
  }
}

/** Lays out every open panel in the dock and reserves its space. */
function layoutSidePanels(position: SidePanelPosition, size: number): void {
  dockedPosition = position;
  dockedSize = size;
  // Reserve (and release the previous dock's) space first: a left/right
  // reservation narrows the app, which can move the document tabs out of the
  // menu bar's row or back (#596), so the top inset below must be measured
  // with the new reservation and the resulting layout.
  reserveAppEdge(position, size);
  updateShellLayout();
  for (const panel of openSidePanels) {
    placeDocked(panel, position, size);
  }
  syncAccordionState();
  if (openSidePanels.length > 1) {
    stackSidePanels(position, size);
  }
  for (const panel of openSidePanels) {
    headerRefreshers.get(panel)?.();
  }
  if (!relayoutOnResize && typeof window !== 'undefined') {
    relayoutOnResize = true;
    // A stack is placed in pixels, so it follows the window's height.
    window.addEventListener('resize', () => {
      if (openSidePanels.length > 1) {
        stackSidePanels(dockedPosition, dockedSize);
      }
    });
  }
}

/** Expands `panel` within the stack, collapsing the others to their title bars. */
function expandSidePanel(panel: HTMLElement): void {
  expandedSidePanel = panel;
  layoutSidePanels(dockedPosition, dockedSize);
  panel.querySelector<HTMLElement>('[data-autofocus]')?.focus();
}

/**
 * Docks `panel` to `position` at `size` pixels (width for left/right, height
 * for top/bottom), together with every other open side panel, and expands
 * it. A top-docked panel is inset below the menu bar *and* the book tab strip
 * (wherever they sit — see `topChromeInset`), and a bottom-docked one above
 * the status bar *and* the worksheet tab strip — chrome the panel must never
 * cover — measured live so it tracks their actual height (e.g. the menu bar
 * collapsing to a toggle button on a narrow viewport, or either tab strip
 * being hidden) rather than a guessed constant (#399/#541). Left/right-docked
 * panels still span the full viewport height. With several panels open they
 * share the dock as an accordion (see `openSidePanels`, #598).
 */
export function applySidePanelPosition(panel: HTMLElement, position: SidePanelPosition, size: number): void {
  pruneDetachedSidePanels(panel);
  if (!openSidePanels.includes(panel)) {
    openSidePanels.push(panel);
  }
  expandedSidePanel = panel;
  layoutSidePanels(position, size);
}

/**
 * Takes a closed or hidden panel out of the dock. The last one to leave
 * releases the app-edge space; otherwise the remaining panels re-stack, the
 * most recently opened one expanding if `panel` was the expanded one.
 */
export function releaseSidePanel(panel: HTMLElement): void {
  pruneDetachedSidePanels(panel);
  const index = openSidePanels.indexOf(panel);
  if (index >= 0) {
    openSidePanels.splice(index, 1);
  }
  panel.classList.remove('collapsed');
  if (openSidePanels.length === 0) {
    expandedSidePanel = null;
    clearAppEdgeReservation();
    return;
  }
  if (expandedSidePanel === panel || expandedSidePanel === null) {
    expandedSidePanel = openSidePanels[openSidePanels.length - 1];
  }
  layoutSidePanels(dockedPosition, dockedSize);
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
 * the last side panel closes. A no-op outside a full app shell (e.g. a unit test that
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

/** Releases the space `reserveAppEdge` reserved, once the last panel closes. */
function clearAppEdgeReservation(): void {
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
 * Builds the header position switcher, maximize toggle, and inner-edge resize
 * handle shared by every dockable side panel, so they all dock and resize
 * identically and remember the same position/size across one another (#399).
 * Internal to {@link buildSidePanelChrome}, which is what panels use.
 */
function buildSidePanelDock(panel: HTMLElement): {
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
      className: 'side-panel-header-btn side-panel-position-btn',
      attrs: {
        type: 'button',
        'aria-pressed': String(position === effectiveSidePanelPosition()),
        title: label,
      },
    });
    button.append(createIcon(SIDE_PANEL_POSITION_ICON[position], 'side-panel-header-icon', 14));
    button.addEventListener('click', () => {
      sidePanelPosition = position;
      sidePanelPositionExplicit = true;
      // Moves the whole dock, every open panel with it; the header refresher
      // below updates each panel's pressed button.
      applySidePanelPosition(panel, sidePanelPosition, currentSize(sidePanelPosition));
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
    className: 'side-panel-header-btn side-panel-maximize-btn',
    attrs: { type: 'button' },
  });
  const refreshMaximizeToggle = (): void => {
    clearChildren(maximizeToggle);
    maximizeToggle.append(
      createIcon(sidePanelMaximized ? Minimize2 : Maximize2, 'side-panel-header-icon', 14),
    );
    maximizeToggle.setAttribute('aria-pressed', String(sidePanelMaximized));
    maximizeToggle.setAttribute(
      'title',
      t(sidePanelMaximized ? 'dialog.sidePanel.restore' : 'dialog.sidePanel.maximize'),
    );
  };
  refreshMaximizeToggle();
  // Every open panel shows the shared dock side and maximize state, so a
  // change made from one panel's header is reflected in the others'.
  headerRefreshers.set(panel, () => {
    const current = effectiveSidePanelPosition();
    for (const other of positionButtons) {
      other.button.setAttribute('aria-pressed', String(other.position === current));
    }
    refreshMaximizeToggle();
  });
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
      // A stacked panel is only part of the dock; resizing sizes the whole dock.
      if (openSidePanels.length > 1) {
        return dockedSize;
      }
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

export interface SidePanelChromeOptions {
  /** The title-bar icon, shown before the title like every other panel's. */
  icon: IconNode;
  title: string;
  /** Accessible name of the header's close (×) button. */
  closeLabel: string;
  onClose: () => void;
}

export interface SidePanelChrome {
  /** The `.side-panel-title` bar: icon + title, dock/maximize/close buttons. */
  heading: HTMLElement;
  /** The inner-edge resize handle; append it last. */
  resizeHandle: HTMLElement;
  /** The title text's element id, for `aria-labelledby`. */
  titleId: string;
  /** Re-translate the title and close label (locale change). */
  relabel: (title: string, closeLabel: string) => void;
}

let sidePanelTitleSeq = 0;

/**
 * The one title bar every dockable side panel shares — the transient
 * Filter/Sort/Format/SQL panels ({@link openSidePanel}) and the persistent
 * comments and worksheet-preview panels alike — so each has the same icon +
 * title on the left and the same dock side / maximize / close (×) buttons on
 * the right, in the same order and size. `panel` must already be a
 * `.side-panel` element; a caller that starts out hidden must call
 * {@link applySidePanelPosition} itself once it becomes visible, so a closed
 * panel never reserves app-edge space it isn't showing.
 */
export function buildSidePanelChrome(panel: HTMLElement, options: SidePanelChromeOptions): SidePanelChrome {
  const { positionSwitcher, resizeHandle, maximizeToggle } = buildSidePanelDock(panel);
  const titleId = `side-panel-title-${++sidePanelTitleSeq}`;
  const label = el('span', { className: 'side-panel-title-label', text: options.title });
  const title = el('span', { className: 'side-panel-title-text', attrs: { id: titleId } }, [
    createIcon(options.icon, 'side-panel-title-icon', 16),
    label,
  ]);
  const closeButton = el('button', {
    className: 'side-panel-header-btn side-panel-close-btn',
    attrs: { type: 'button', 'aria-label': options.closeLabel, title: options.closeLabel },
  });
  closeButton.append(createIcon(X, 'side-panel-header-icon', 14));
  closeButton.addEventListener('click', options.onClose);
  const heading = el('div', { className: 'dialog-title side-panel-title' }, [
    title,
    el('div', { className: 'side-panel-title-actions' }, [
      positionSwitcher,
      maximizeToggle,
      el('span', { className: 'side-panel-title-divider', attrs: { 'aria-hidden': 'true' } }),
      closeButton,
    ]),
  ]);
  return {
    heading,
    resizeHandle,
    titleId,
    relabel: (nextTitle, nextCloseLabel) => {
      label.textContent = nextTitle;
      closeButton.setAttribute('aria-label', nextCloseLabel);
      closeButton.setAttribute('title', nextCloseLabel);
    },
  };
}

/**
 * Builds a side panel's body and footer. `apply` hands a result to the
 * caller: with an `onApply` handler the panel stays open (so the user can
 * adjust and apply again), otherwise it closes and resolves with the value.
 * Closing is the shared chrome's job (the footer Close button, the header ×,
 * or Escape), so builders add only their own action buttons.
 */
export type SidePanelBuilder<T> = (
  body: HTMLElement,
  buttons: HTMLElement,
  apply: (value: NonNullable<T>) => void,
) => void;

export interface SidePanelOptions<T> {
  title: string;
  icon: IconNode;
  /** What the promise resolves with when the panel is closed. */
  fallback: T;
  /** Applies a result while the panel stays open. */
  onApply?: (value: NonNullable<T>) => unknown;
}

/**
 * A dockable, resizable panel with the same `.dialog-title`/`.dialog-body`/
 * `.dialog-buttons` structure/CSS as `openDialog`, but anchored to an edge of
 * the viewport (top/right/bottom/left, switchable from the header) instead
 * of floating, and made resizable by dragging its inner edge. It reserves its
 * own space along the docked edge (`reserveAppEdge`) so the sheet is never
 * covered — a genuine split view, not an overlay (#396).
 *
 * The panel stays open until the user closes it: applying never closes it
 * when the caller passes `onApply`, and neither an outside click nor the
 * window losing focus (e.g. a native color picker opening) dismisses it —
 * a stray click on the sheet while adjusting filter/sort/format/validation
 * settings must not silently discard them (#396). Only the footer's Close
 * button (always the bottom-right one), the header's ×, or Escape close it,
 * resolving `fallback`, and focus returns to whatever triggered it.
 */
export function openSidePanel<T>(options: SidePanelOptions<T>, build: SidePanelBuilder<T>): Promise<T> {
  return new Promise((resolve) => {
    const panel = el('div', {
      className: 'side-panel',
      attrs: { role: 'dialog', 'aria-modal': 'false' },
    });
    const chrome = buildSidePanelChrome(panel, {
      icon: options.icon,
      title: options.title,
      closeLabel: t('dialog.sidePanel.close'),
      onClose: () => finish(options.fallback),
    });
    panel.setAttribute('aria-labelledby', chrome.titleId);
    const body = el('div', { className: 'dialog-body side-panel-form' });
    const buttons = el('div', { className: 'dialog-buttons' });
    const actions = el('div', { className: 'dialog-buttons-actions' });
    const closeButton = dialogButton(t('dialog.sidePanel.closeButton'), false, false, () =>
      finish(options.fallback),
    );
    closeButton.classList.add('side-panel-footer-close');
    buttons.append(actions, closeButton);
    panel.append(chrome.heading, body, buttons, chrome.resizeHandle);

    const restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    let removeKeyListener = (): void => {};

    let settled = false;
    function finish(value: T): void {
      if (settled) {
        return;
      }
      settled = true;
      removeKeyListener();
      panel.remove();
      releaseSidePanel(panel);
      if (restoreFocus && restoreFocus.isConnected) {
        restoreFocus.focus();
      }
      resolve(value);
    }

    const apply = (value: NonNullable<T>): void => {
      if (settled) {
        return;
      }
      if (options.onApply) {
        void options.onApply(value);
      } else {
        finish(value);
      }
    };

    const focusableItems = (): HTMLElement[] =>
      Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((item) => !item.closest('[hidden]'));

    build(body, actions, apply);
    // Nothing of the panel's own is focused first: the Close button is.
    if (!panel.querySelector('[data-autofocus]')) {
      closeButton.dataset.autofocus = 'true';
    }
    document.body.append(panel);
    // Docked once built, so a stack of open panels can measure its title bar.
    const initialPlacement = currentSidePanelPlacement();
    applySidePanelPosition(panel, initialPlacement.position, initialPlacement.size);
    const autofocusTarget = panel.querySelector<HTMLElement>('[data-autofocus]');
    if (autofocusTarget) {
      focusWithoutKeyboard(autofocusTarget);
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(options.fallback);
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
    panel.addEventListener('keydown', onKeyDown);
    removeKeyListener = () => panel.removeEventListener('keydown', onKeyDown);
  });
}

/**
 * Lays out one labelled control in a side panel: the label on its own line
 * above a full-width control, so every field in every panel lines up on the
 * same left edge and grid instead of flowing inline at whatever width its
 * text happens to be.
 */
export function panelField(label: string, control: HTMLElement, hint?: string): HTMLElement {
  if (!control.id) {
    control.id = `panel-field-${++sidePanelTitleSeq}`;
  }
  const children: Node[] = [
    el('label', { className: 'panel-field-label', text: label, attrs: { for: control.id } }),
    control,
  ];
  if (hint) {
    children.push(el('p', { className: 'dialog-note panel-field-hint', text: hint }));
  }
  return el('div', { className: 'panel-field' }, children);
}

/** A checkbox or radio button with its label beside it, aligned on one row. */
export function panelCheck(input: HTMLInputElement, label: string): HTMLLabelElement {
  return el('label', { className: 'panel-check' }, [input, el('span', { text: label })]);
}

/**
 * A titled group of fields; consecutive sections are separated by the same
 * rule and spacing in every panel.
 */
export function panelSection(title: string | null, children: Node[]): HTMLElement {
  const section = el('section', { className: 'panel-section' });
  if (title) {
    section.append(el('h3', { className: 'panel-section-title', text: title }));
  }
  section.append(...children);
  return section;
}
