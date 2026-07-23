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
