// SPDX-License-Identifier: MIT
/**
 * The dashed outline round the active sheet's print area (File > Print
 * Area), so a person sees what "Print area" prints. One overlay spans the
 * part of the area that is rendered; an edge of the area outside the
 * rendered window is left open rather than drawn where the area does not
 * end. While the sheet is sorted its rows are not in document order, so no
 * outline is drawn.
 */
import type { Tab } from '../../app/state';
import { printAreaOf } from '../../app/state/print-area';
import { el } from '../dom';

export function placePrintAreaOutline(canvas: HTMLElement, tab: Tab | null): void {
  canvas.querySelector(':scope > .print-area-outline')?.remove();
  const area = tab ? printAreaOf(tab) : null;
  if (!tab || !area || tab.doc.sort) {
    return;
  }
  let top = Infinity;
  let left = Infinity;
  let bottom = -Infinity;
  let right = -Infinity;
  for (const cell of canvas.querySelectorAll<HTMLElement>('[data-row][data-col]')) {
    const row = Number(cell.dataset.row);
    const col = Number(cell.dataset.col);
    if (row >= area.top && row <= area.bottom && col >= area.left && col <= area.right) {
      top = Math.min(top, row);
      left = Math.min(left, col);
      bottom = Math.max(bottom, row);
      right = Math.max(right, col);
    }
  }
  const at = (row: number, col: number): HTMLElement | null =>
    canvas.querySelector<HTMLElement>(`[data-row="${row}"][data-col="${col}"]`);
  const first = top === Infinity ? null : at(top, left);
  const last = top === Infinity ? null : at(bottom, right);
  if (!first || !last) {
    return;
  }
  const origin = canvas.getBoundingClientRect();
  const a = first.getBoundingClientRect();
  const b = last.getBoundingClientRect();
  const outline = el('div', { className: 'print-area-outline', attrs: { 'aria-hidden': 'true' } });
  outline.classList.toggle('open-top', top !== area.top);
  outline.classList.toggle('open-bottom', bottom !== area.bottom);
  outline.classList.toggle('open-left', left !== area.left);
  outline.classList.toggle('open-right', right !== area.right);
  outline.style.left = `${a.left - origin.left}px`;
  outline.style.top = `${a.top - origin.top}px`;
  outline.style.width = `${b.right - a.left}px`;
  outline.style.height = `${b.bottom - a.top}px`;
  canvas.append(outline);
}
