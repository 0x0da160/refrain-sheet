// SPDX-License-Identifier: MIT
/**
 * The edge on the right of the sheet list when the sheet tabs stand down the
 * left side (`sheet-bar.ts`): drag it, or focus it and use the arrow keys,
 * to change the list's width; a double-click goes back to the standard
 * width. The width is a browser setting (`getSheetTabsWidth`), shown as
 * `--sheet-tabs-width` on the list.
 */
import { clampSheetTabsWidth, getSheetTabsWidth, setSheetTabsWidth, SHEET_TABS_WIDTH } from '../app/settings';
import { el } from './dom';

/** How far one arrow key moves the edge, in pixels. */
const KEY_STEP = 16;

/** The width a key asks for, or null for a key that does not move the edge. */
function widthForKey(key: string, width: number): number | null {
  switch (key) {
    case 'ArrowLeft':
      return width - KEY_STEP;
    case 'ArrowRight':
      return width + KEY_STEP;
    case 'Home':
      return SHEET_TABS_WIDTH.min;
    case 'End':
      return SHEET_TABS_WIDTH.max;
    default:
      return null;
  }
}

/** Build the edge for `list` (whose width it sets), showing the stored width at once. */
export function buildSheetListResizer(list: HTMLElement): HTMLElement {
  const resizer = el('div', {
    className: 'sheet-bar-resize',
    attrs: {
      role: 'separator',
      tabindex: '0',
      'aria-orientation': 'vertical',
      'aria-valuemin': String(SHEET_TABS_WIDTH.min),
      'aria-valuemax': String(SHEET_TABS_WIDTH.max),
    },
  });
  const show = (width: number): void => {
    list.style.setProperty('--sheet-tabs-width', `${width}px`);
    resizer.setAttribute('aria-valuenow', String(width));
  };
  const set = (width: number): void => {
    const next = clampSheetTabsWidth(width);
    setSheetTabsWidth(next);
    show(next);
  };
  resizer.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = list.getBoundingClientRect().width;
    const move = (e: PointerEvent): void => show(clampSheetTabsWidth(startWidth + e.clientX - startX));
    const end = (e: PointerEvent): void => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', end);
      document.removeEventListener('pointercancel', end);
      set(startWidth + e.clientX - startX);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', end);
    document.addEventListener('pointercancel', end);
  });
  resizer.addEventListener('dblclick', () => set(SHEET_TABS_WIDTH.standard));
  resizer.addEventListener('keydown', (event) => {
    const next = widthForKey(event.key, getSheetTabsWidth());
    if (next !== null) {
      event.preventDefault();
      set(next);
    }
  });
  show(getSheetTabsWidth());
  return resizer;
}
