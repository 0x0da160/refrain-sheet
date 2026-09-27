// SPDX-License-Identifier: MIT
/**
 * The cheap selection repaint: selected-cell highlighting, the fill and move
 * handles, and the copy-source outline — no window rebuild.
 *
 * A collaborator of the grid (see `./core.ts`): it owns no state of its own
 * beyond what is declared here, and reaches shared grid state through
 * `this.core`.
 */
import { isWorkbook } from '../../core/editor-document';
import type { Selection, SelectionKind, Tab } from '../../app/state';
import { t } from '../../app/i18n';
import { rangeContains, type CellRange } from '../../core/clipboard';
import { el } from '../dom';
import type { GridCore } from './core';

export class SelectionView {
  constructor(private readonly core: GridCore) {}

  /** Update selection highlighting only (cheap; used for selection events). */
  refreshSelection(): void {
    const tab = this.core.state.activeTab;
    if (!tab || tab.doc !== this.core.lastDoc) {
      return;
    }
    const range = this.core.state.selectedRange(tab);
    const active = tab.selection;
    const anchor = tab.anchor;
    const kind = tab.selectionKind;
    // Container-level classes let CSS present whole-row / whole-column /
    // whole-sheet selections distinctly from an ordinary cell range.
    const whole =
      range !== null &&
      range.top === 0 &&
      range.left === 0 &&
      range.bottom === tab.doc.rowCount - 1 &&
      range.right === tab.doc.columnCount - 1 &&
      (tab.doc.rowCount > 1 || tab.doc.columnCount > 1);
    this.core.element.classList.toggle('sel-rows', kind === 'row');
    this.core.element.classList.toggle('sel-cols', kind === 'col');
    this.core.element.classList.toggle('sel-all', whole);
    this.core.cells.syncCorner();
    this.markCells(range, active, anchor);
    this.markRowsAndHeaders(range, active, kind);
    this.placeFillHandle(tab, range);
    this.placeMoveHandle(tab, range);
    this.placeCopySourceOutline();
    this.core.editing.positionSink();
  }
  /** Mark the in-range, active, and anchor cells among the rendered ones. */
  private markCells(range: CellRange | null, active: Selection | null, anchor: Selection | null): void {
    const cells = this.core.canvas.querySelectorAll<HTMLElement>('[data-row][data-col]');
    for (const cell of cells) {
      const row = Number(cell.dataset.row);
      const col = Number(cell.dataset.col);
      const inRange = range !== null && rangeContains(range, row, col);
      const isActive = active !== null && active.row === row && active.col === col;
      // The anchor is the opposite corner of a multi-cell range; mark it
      // distinctly from the active cell (but only when they differ).
      const isAnchor =
        anchor !== null && anchor.row === row && anchor.col === col && !isActive && range !== null;
      cell.classList.toggle('in-range', inRange && !isActive);
      cell.classList.toggle('selected', isActive);
      cell.classList.toggle('anchor', isAnchor);
      if (isActive) {
        cell.setAttribute('aria-selected', 'true');
      } else {
        cell.removeAttribute('aria-selected');
      }
    }
  }

  /** Highlight the selected rows and the row/column headers intersecting the selection. */
  private markRowsAndHeaders(range: CellRange | null, active: Selection | null, kind: SelectionKind): void {
    // The active cell's row is highlighted only while a single cell is
    // selected; a multi-cell range already shows where the selection is.
    const multiCell = range !== null && (range.top !== range.bottom || range.left !== range.right);
    const rows = this.core.canvas.querySelectorAll<HTMLElement>('.vgrid-row, .vgrid-stickyrow');
    for (const rowEl of rows) {
      const row = Number(rowEl.dataset.row);
      const inSelRows = range !== null && kind === 'row' && row >= range.top && row <= range.bottom;
      rowEl.classList.toggle(
        'selected-row',
        inSelRows || (!multiCell && active !== null && active.row === row),
      );
    }
    // Highlight the row/column headers intersecting the selection so whole-row
    // and whole-column selections read clearly even outside the data cells.
    for (const head of this.core.canvas.querySelectorAll<HTMLElement>('[data-rowhead]')) {
      const row = Number(head.dataset.rowhead);
      head.classList.toggle('hdr-sel', range !== null && row >= range.top && row <= range.bottom);
    }
    for (const head of this.core.headerEl.querySelectorAll<HTMLElement>('[data-colhead]')) {
      const col = Number(head.dataset.colhead);
      head.classList.toggle('hdr-sel', range !== null && col >= range.left && col <= range.right);
    }
  }

  /**
   * Put an accessible move handle on the top-left cell of the current selection
   * for RSF worksheets (moving a range is a structural edit a byte-preserving
   * CSV cannot represent, so it is offered only where it is possible). Dragging
   * it moves the selected range; the same move is available without a pointer
   * via the "Move Selected Cells…" command.
   */
  private placeMoveHandle(tab: Tab, range: CellRange | null): void {
    for (const old of this.core.canvas.querySelectorAll('.move-handle')) {
      old.remove();
    }
    if (!range || !isWorkbook(tab.doc) || tab.doc.rowCount === 0) {
      return;
    }
    const cell = this.core.pointer.cellAt(range.top, range.left);
    if (!cell) {
      return; // the corner is scrolled out of view
    }
    const handle = el('div', {
      className: 'move-handle',
      attrs: { 'data-movehandle': 'true', 'aria-hidden': 'true', title: t('grid.moveHandleTitle') },
    });
    cell.append(handle);
  }

  /** Put the fill handle on the bottom-right cell of the current selection. */
  private placeFillHandle(tab: Tab, range: CellRange | null): void {
    for (const old of this.core.canvas.querySelectorAll('.fill-handle')) {
      old.remove();
    }
    if (!range || tab.doc.rowCount === 0) {
      return;
    }
    const cell = this.core.pointer.cellAt(range.bottom, range.right);
    if (!cell) {
      return; // the corner is scrolled out of view
    }
    const handle = el('div', {
      className: 'fill-handle',
      attrs: { 'data-fillhandle': 'true', 'aria-hidden': 'true', title: t('grid.fillTitle') },
    });
    cell.append(handle);
  }

  /**
   * Set (or clear, with `null`) the range to outline as a copy source — an
   * animated "marching ants" border so the origin of an in-progress copy
   * stays visible while the user picks where to paste it. Purely a view
   * concern (`main.ts` drives it from `ClipboardController`), not part of
   * `Tab`/`AppState`: it never affects selection, is never persisted, and is
   * cleared independently of the selection itself.
   */
  setCopySource(range: CellRange | null): void {
    if (this.core.copySource === range) {
      return;
    }
    this.core.copySource = range;
    this.placeCopySourceOutline();
  }

  /**
   * Position a single overlay `div` over the copy-source range's rendered
   * pixel rect, the same way `placeMoveHandle`/`placeFillHandle` above
   * anchor to one corner cell — except this one must span the *whole*
   * rectangle, not just a corner, so it is measured from both corner cells'
   * `getBoundingClientRect()` relative to the canvas's own, the same
   * technique `placeSinkOverCell` uses. Like those handles, a corner that has
   * scrolled out of the rendered window simply means no overlay this frame —
   * it reappears once the range scrolls back into view.
   */
  private placeCopySourceOutline(): void {
    for (const old of this.core.canvas.querySelectorAll('.copy-source-outline')) {
      old.remove();
    }
    const range = this.core.copySource;
    if (!range) {
      return;
    }
    const topLeft = this.core.pointer.cellAt(range.top, range.left);
    const bottomRight = this.core.pointer.cellAt(range.bottom, range.right);
    if (!topLeft || !bottomRight) {
      return; // a corner is scrolled out of view
    }
    const origin = this.core.canvas.getBoundingClientRect();
    const tl = topLeft.getBoundingClientRect();
    const br = bottomRight.getBoundingClientRect();
    const outline = el('div', { className: 'copy-source-outline', attrs: { 'aria-hidden': 'true' } });
    outline.style.left = `${tl.left - origin.left}px`;
    outline.style.top = `${tl.top - origin.top}px`;
    outline.style.width = `${br.right - tl.left}px`;
    outline.style.height = `${br.bottom - tl.top}px`;
    this.core.canvas.append(outline);
  }
}
