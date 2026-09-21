// SPDX-License-Identifier: MIT
import { visualViewportRect } from './popup';

/**
 * Pointer-based drag-to-move and drag-to-resize for the shared, floating
 * windows in `src/ui/dialogs/shared.ts` (both the modal `<dialog>` from
 * `openDialog` and the anchored, non-modal popover from `openPopover`).
 * Mirrors the pointer-capture pattern used for the grid's column-resize,
 * fill, and move handles (`src/ui/grid.ts`): capture on the handle itself so
 * move/up keep targeting it even if the pointer leaves its small hit area,
 * feature-checked because jsdom (tests) implements neither method.
 *
 * A window starts out positioned by its normal layout (a centered modal, or
 * `positionPopup`'s anchor-relative placement). The first drag or resize
 * gesture "freezes" that position into explicit `left`/`top` pixel styles —
 * and clears the `max-width`/`max-height`/centering styles that would
 * otherwise fight a manual size — after which the window is exactly where
 * the user left it. Marking `dataset.dragResized` lets callers (e.g. the
 * popover's viewport-follow `reposition`) stop overriding a manually placed
 * window instead of snapping it back.
 */

const MARGIN = 4;
const MIN_WIDTH = 220;
const MIN_HEIGHT = 140;

function capture(handle: HTMLElement, pointerId: number): void {
  if (typeof handle.setPointerCapture === 'function') {
    handle.setPointerCapture(pointerId);
  }
}

function releaseIfCaptured(handle: HTMLElement, pointerId: number): void {
  if (typeof handle.hasPointerCapture !== 'function' || typeof handle.releasePointerCapture !== 'function') {
    return;
  }
  if (handle.hasPointerCapture(pointerId)) {
    handle.releasePointerCapture(pointerId);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/**
 * Fix `container`'s current on-screen box into explicit `position: fixed`
 * pixel styles, overriding any centering (`margin: auto` + `inset: 0`, as
 * used by a modal `<dialog>`) and percentage/viewport size caps so a
 * subsequent pixel-based move or resize is not fought by CSS. Safe to call
 * repeatedly — each call just re-anchors to wherever the box currently is.
 */
function freeze(container: HTMLElement): DOMRect {
  const rect = container.getBoundingClientRect();
  container.style.position = 'fixed';
  container.style.margin = '0';
  container.style.inset = 'auto';
  container.style.left = `${rect.left}px`;
  container.style.top = `${rect.top}px`;
  // Lock the measured box *before* clearing the size caps below: a native
  // <dialog> (and the filter popover) have no explicit width, only
  // `max-width`/`max-height`, so removing those caps without first pinning a
  // width/height lets the box re-shrink-to-fit to its max-content size (e.g.
  // a wide table or long paragraph), which can blow it out to the viewport
  // edge on the very first drag frame (#541).
  container.style.width = `${rect.width}px`;
  container.style.height = `${rect.height}px`;
  container.style.maxWidth = 'none';
  container.style.maxHeight = 'none';
  container.dataset.dragResized = 'true';
  return rect;
}

/** Drag `handle` to move `container` (assumed `position: fixed`), clamped to the visual viewport. */
export function makeDraggable(container: HTMLElement, handle: HTMLElement): void {
  let pointerId: number | null = null;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;

  const onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== pointerId) {
      return;
    }
    const vp = visualViewportRect();
    const width = container.offsetWidth;
    const height = container.offsetHeight;
    const left = clamp(
      startLeft + (event.clientX - startX),
      vp.left + MARGIN,
      vp.left + vp.width - MARGIN - width,
    );
    const top = clamp(
      startTop + (event.clientY - startY),
      vp.top + MARGIN,
      vp.top + vp.height - MARGIN - height,
    );
    container.style.left = `${left}px`;
    container.style.top = `${top}px`;
  };

  const endDrag = (event: PointerEvent): void => {
    if (event.pointerId !== pointerId) {
      return;
    }
    releaseIfCaptured(handle, pointerId);
    pointerId = null;
    handle.removeEventListener('pointermove', onPointerMove);
    handle.removeEventListener('pointerup', endDrag);
    handle.removeEventListener('pointercancel', endDrag);
  };

  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) {
      return;
    }
    const rect = freeze(container);
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    startLeft = rect.left;
    startTop = rect.top;
    capture(handle, pointerId);
    handle.addEventListener('pointermove', onPointerMove);
    handle.addEventListener('pointerup', endDrag);
    handle.addEventListener('pointercancel', endDrag);
    event.preventDefault();
  });
}

/** Drag `handle` (a corner grip) to resize `container`, clamped to a minimum size and the visual viewport. */
export function makeResizable(container: HTMLElement, handle: HTMLElement): void {
  let pointerId: number | null = null;
  let startX = 0;
  let startY = 0;
  let startWidth = 0;
  let startHeight = 0;
  let left = 0;
  let top = 0;

  const onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== pointerId) {
      return;
    }
    const vp = visualViewportRect();
    const maxWidth = Math.max(MIN_WIDTH, vp.left + vp.width - MARGIN - left);
    const maxHeight = Math.max(MIN_HEIGHT, vp.top + vp.height - MARGIN - top);
    const width = clamp(startWidth + (event.clientX - startX), MIN_WIDTH, maxWidth);
    const height = clamp(startHeight + (event.clientY - startY), MIN_HEIGHT, maxHeight);
    container.style.width = `${width}px`;
    container.style.height = `${height}px`;
  };

  const endResize = (event: PointerEvent): void => {
    if (event.pointerId !== pointerId) {
      return;
    }
    releaseIfCaptured(handle, pointerId);
    pointerId = null;
    handle.removeEventListener('pointermove', onPointerMove);
    handle.removeEventListener('pointerup', endResize);
    handle.removeEventListener('pointercancel', endResize);
  };

  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) {
      return;
    }
    const rect = freeze(container);
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    startWidth = rect.width;
    startHeight = rect.height;
    left = rect.left;
    top = rect.top;
    capture(handle, pointerId);
    handle.addEventListener('pointermove', onPointerMove);
    handle.addEventListener('pointerup', endResize);
    handle.addEventListener('pointercancel', endResize);
    event.preventDefault();
  });
}

export type EdgeResizeAxis = 'horizontal' | 'vertical';

/**
 * Drag `handle` (a single edge, not a corner) to resize `container` along one
 * axis — used by the docked, edge-anchored side panel (`openSidePanel`,
 * `src/ui/dialogs/shared.ts`) instead of the floating windows above, which is
 * why this reports a size through `onResize` rather than writing
 * `width`/`height` styles itself: the caller (re)applies the panel's CSS for
 * whichever edge is currently docked. `axis`/`sign` are re-invoked on every
 * pointer move (not cached at drag start) so switching the dock position
 * mid-drag — which cannot happen through the UI today, but might if that
 * changes — would still resize sensibly.`sign` returns `1` when dragging away
 * from the anchored edge grows the panel (e.g. a left-docked panel's handle
 * on its right edge) and `-1` when dragging toward it does (e.g. a
 * right-docked panel's handle on its left edge).
 */
export function makeEdgeResizable(
  handle: HTMLElement,
  axis: () => EdgeResizeAxis,
  sign: () => 1 | -1,
  startSize: () => number,
  minSize: number,
  maxSize: () => number,
  onResize: (size: number) => void,
): void {
  let pointerId: number | null = null;
  let startCoord = 0;
  let baseSize = 0;

  const coordOf = (event: PointerEvent): number => (axis() === 'horizontal' ? event.clientX : event.clientY);

  const onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== pointerId) {
      return;
    }
    const delta = (coordOf(event) - startCoord) * sign();
    onResize(clamp(baseSize + delta, minSize, Math.max(minSize, maxSize())));
  };

  const endResize = (event: PointerEvent): void => {
    if (event.pointerId !== pointerId) {
      return;
    }
    releaseIfCaptured(handle, pointerId);
    pointerId = null;
    handle.removeEventListener('pointermove', onPointerMove);
    handle.removeEventListener('pointerup', endResize);
    handle.removeEventListener('pointercancel', endResize);
  };

  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) {
      return;
    }
    pointerId = event.pointerId;
    startCoord = coordOf(event);
    baseSize = startSize();
    capture(handle, pointerId);
    handle.addEventListener('pointermove', onPointerMove);
    handle.addEventListener('pointerup', endResize);
    handle.addEventListener('pointercancel', endResize);
    event.preventDefault();
  });
}
