// SPDX-License-Identifier: MIT
/**
 * Viewport-aware placement for floating surfaces: context menus, menu-bar
 * drop-downs, and nested submenus.
 *
 * The rules are the same everywhere and contain **no hard-coded offsets**.
 * A surface is measured after it is in the DOM, then placed against the
 * *visual* viewport (so browser zoom, pinch-zoom, and mobile keyboards are
 * accounted for — `visualViewport` reports the actually visible rectangle,
 * unlike `innerWidth`/`innerHeight`):
 *
 * 1. Try the preferred position (at the pointer, below a button, or to the
 *    right of a parent menu item).
 * 2. If it would overflow, try the mirrored position (above / to the left).
 * 3. If neither fits, clamp into the viewport.
 * 4. If the surface is taller than the viewport, cap its height and make it
 *    scrollable, so every item — including the focused one — stays reachable.
 *
 * Callers position on open and again whenever the content, localized text,
 * zoom, or submenu visibility changes; positioning is idempotent because the
 * inline styles it writes are always reset before measuring.
 */

/** The smallest rectangle description this module needs from an anchor. */
export interface AnchorRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type PopupPlacement =
  /** At a pointer position (viewport coordinates), e.g. a context menu. */
  | { kind: 'point'; x: number; y: number }
  /** Below an anchor (a menu-bar button), mirrored above when it does not fit. */
  | { kind: 'below'; rect: AnchorRect }
  /** Beside an anchor (a submenu's parent item), mirrored to the other side. */
  | { kind: 'beside'; rect: AnchorRect };

export interface PlacementResult {
  left: number;
  top: number;
  /** True when the surface was mirrored to the other side of the anchor. */
  flippedX: boolean;
  flippedY: boolean;
  /** True when the height was capped and the surface made scrollable. */
  scrollable: boolean;
}

/** Gap kept between a surface and the viewport edges (CSS px). */
const VIEWPORT_MARGIN = 4;

export interface ViewportRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The currently visible rectangle in client coordinates. `visualViewport` is
 * preferred because it is the only source that reflects pinch-zoom and
 * on-screen keyboards; `innerWidth`/`innerHeight` (and finally the document
 * element) are fallbacks for environments without it.
 */
export function visualViewportRect(): ViewportRect {
  const vv = globalThis.visualViewport;
  if (vv && Number.isFinite(vv.width) && vv.width > 0 && Number.isFinite(vv.height) && vv.height > 0) {
    return { left: vv.offsetLeft, top: vv.offsetTop, width: vv.width, height: vv.height };
  }
  const root = globalThis.document?.documentElement;
  const width = globalThis.innerWidth || root?.clientWidth || 0;
  const height = globalThis.innerHeight || root?.clientHeight || 0;
  return { left: 0, top: 0, width, height };
}

/**
 * Works around a WebKit bug where the page can stay scrolled after the iOS
 * on-screen keyboard closes, most visible with a bottom-docked side panel
 * (`position: fixed`, anchored via `bottom` — see `applySidePanelPosition`,
 * `src/ui/dialogs/shared.ts`): WebKit pins fixed elements to the *visual*
 * viewport while the keyboard is open, and does not always restore that
 * viewport's offset back to zero once it closes, leaving the whole page
 * looking shifted upward even though `body { overflow: hidden }` (see
 * `styles.css`) means the document itself was never meant to scroll (#402).
 * Resyncing the scroll position on `visualViewport` resize/scroll (fired when
 * the keyboard opens *and* when it closes) nudges WebKit to recompute it.
 *
 * The resync only runs `scrollTo` when the page is actually away from (0, 0):
 * `visualViewport` also fires `resize` for reasons unrelated to the #402 bug
 * — e.g. a mobile keyboard's predictive-text suggestion bar changing height
 * on every keystroke as the candidate words change — and calling `scrollTo`
 * unconditionally on each of those was itself causing a brief layout jitter
 * while typing (#519). Skipping the call when there is nothing to correct
 * keeps it a true no-op there, while still firing for the real post-keyboard
 * shift this exists to fix. It is also a no-op entirely in environments
 * without `visualViewport` (e.g. a unit test).
 */
export function installKeyboardViewportFix(): void {
  const vv = globalThis.visualViewport;
  if (!vv) return;
  const resync = () => {
    if (globalThis.scrollX !== 0 || globalThis.scrollY !== 0) {
      globalThis.scrollTo(0, 0);
    }
  };
  onViewportResize(resync);
  vv.addEventListener('scroll', resync);
}

/** Subscribers waiting for the next coalesced `visualViewport` resize tick (see `onViewportResize`). */
const viewportResizeListeners = new Set<() => void>();
let viewportResizeFrame: ReturnType<typeof requestAnimationFrame> | ReturnType<typeof setTimeout> | null =
  null;
/** The `VisualViewport` the shared listener is currently attached to, so a different object (a real
 * viewport replaced by another, or a fresh one stubbed in a test) gets re-attached rather than ignored. */
let attachedViewport: VisualViewport | null = null;

function flushViewportResize(): void {
  viewportResizeFrame = null;
  for (const fn of viewportResizeListeners) {
    fn();
  }
}

function scheduleViewportResizeFlush(): void {
  if (viewportResizeFrame !== null) {
    return;
  }
  const schedule =
    typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (fn: () => void) => setTimeout(fn, 16);
  viewportResizeFrame = schedule(flushViewportResize);
}

/**
 * Subscribe to `visualViewport`'s `'resize'` event, coalesced onto a single
 * shared `requestAnimationFrame` tick per event burst instead of firing once
 * per subscriber per event. Several unrelated modules (context menus, the
 * formula autocomplete popup, the menu bar, dialog popovers, and this
 * module's own `installKeyboardViewportFix`) each need to reposition or
 * resync on a `visualViewport` resize; on iOS Safari the predictive-text bar
 * above the on-screen keyboard fires this event on **every keystroke** as
 * its candidate words change width (#402/#519), so five independent
 * listeners each doing their own measure/write turned every keystroke into
 * five synchronous layout passes. Coalescing them onto one shared tick cuts
 * that to one pass per keystroke, and gives every subscriber's reaction the
 * same, single measurement instead of five that could each see slightly
 * different intermediate layout state.
 *
 * Returns an unsubscribe function. A no-op subscription (and a no-op
 * unsubscribe) when there is no `visualViewport` at all (e.g. a unit test
 * or a non-WebKit browser). Re-attaches the underlying listener whenever
 * `globalThis.visualViewport` itself is a different object than the one
 * last attached to — in a real browser tab this identity never changes, but
 * a test that stubs a fresh `visualViewport` per test relies on this to get
 * a working listener each time rather than only on the first call.
 */
export function onViewportResize(fn: () => void): () => void {
  const vv = globalThis.visualViewport;
  if (!vv) {
    return () => {};
  }
  if (vv !== attachedViewport) {
    attachedViewport = vv;
    vv.addEventListener('resize', scheduleViewportResizeFlush);
  }
  viewportResizeListeners.add(fn);
  return () => {
    viewportResizeListeners.delete(fn);
  };
}

/** Measured size of a mounted element, tolerating layout-free environments. */
function measure(node: HTMLElement): { width: number; height: number } {
  const rect = node.getBoundingClientRect();
  return {
    width: rect.width || node.offsetWidth || 0,
    height: rect.height || node.offsetHeight || 0,
  };
}

/** Pick a coordinate: preferred, else mirrored if it fits, else clamped. */
function place(
  preferred: number,
  mirrored: number,
  size: number,
  min: number,
  max: number,
): { value: number; flipped: boolean } {
  if (preferred >= min && preferred + size <= max) {
    return { value: preferred, flipped: false };
  }
  if (mirrored >= min && mirrored + size <= max) {
    return { value: mirrored, flipped: true };
  }
  // Neither side fits: keep the preferred side and clamp, so the surface stays
  // fully visible even in a viewport barely larger than itself.
  return { value: Math.max(min, Math.min(preferred, max - size)), flipped: false };
}

/**
 * Position a mounted, fixed-position surface. Writes `left`, `top`, and — only
 * when the surface is taller than the viewport allows — `max-height` plus
 * `overflow-y: auto`. Safe to call repeatedly.
 */
export function positionPopup(node: HTMLElement, placement: PopupPlacement): PlacementResult {
  // Reset first: measuring must never see the previous call's constraints.
  node.style.maxHeight = '';
  node.style.overflowY = '';
  node.style.left = '0px';
  node.style.top = '0px';

  const vp = visualViewportRect();
  const minX = vp.left + VIEWPORT_MARGIN;
  const maxX = vp.left + vp.width - VIEWPORT_MARGIN;
  const minY = vp.top + VIEWPORT_MARGIN;
  const maxY = vp.top + vp.height - VIEWPORT_MARGIN;

  let { width, height } = measure(node);
  const available = Math.max(0, maxY - minY);
  let scrollable = false;
  if (height > available && available > 0) {
    // Taller than the viewport: cap and scroll rather than overflow off-screen.
    node.style.maxHeight = `${available}px`;
    node.style.overflowY = 'auto';
    height = available;
    scrollable = true;
    width = measure(node).width || width;
  }

  let x: { value: number; flipped: boolean };
  let y: { value: number; flipped: boolean };
  switch (placement.kind) {
    case 'point':
      x = place(placement.x, placement.x - width, width, minX, maxX);
      y = place(placement.y, placement.y - height, height, minY, maxY);
      break;
    case 'below':
      x = place(placement.rect.left, placement.rect.right - width, width, minX, maxX);
      y = place(placement.rect.bottom, placement.rect.top - height, height, minY, maxY);
      break;
    case 'beside':
      x = place(placement.rect.right, placement.rect.left - width, width, minX, maxX);
      // A submenu lines up with its parent item and only slides to stay visible.
      y = place(placement.rect.top, placement.rect.bottom - height, height, minY, maxY);
      break;
  }

  node.style.left = `${Math.round(x.value)}px`;
  node.style.top = `${Math.round(y.value)}px`;
  return { left: x.value, top: y.value, flippedX: x.flipped, flippedY: y.flipped, scrollable };
}
