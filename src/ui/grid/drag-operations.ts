// SPDX-License-Identifier: MIT
/**
 * The drag operations that commit on release: column resize, the fill
 * handle, range move, and pointer reference entry into a formula. Escape
 * aborts any of them without committing.
 *
 * A collaborator of the grid (see `./core.ts`): it owns no state of its own
 * beyond what is declared here, and reaches shared grid state through
 * `this.core`.
 */
import { isWorkbook } from '../../core/editor-document';
import type { Tab } from '../../app/state';
import { normalizeRange, type CellRange } from '../../core/clipboard';
import { cellLabel } from '../../core/formula';
import { MOVE_EDGE_PX, onRangeEdge } from './range-edge';
import { MAX_COL_WIDTH, MIN_COL_WIDTH } from './geometry';
import { frameCoalesced } from './dom-support';
import type { GridCore } from './core';

export class DragOperations {
  constructor(private readonly core: GridCore) {}

  // ----- Column resizing -----

  /**
   * Set a column's width from an on-screen pixel width and re-lay-out. The
   * stored width is normalized to 100% zoom (clamped), so resizing means the
   * same thing at every zoom level and persists zoom-independently. Never
   * marks the document dirty.
   */
  private setColWidth(tab: Tab, col: number, screenWidth: number): void {
    const w = Math.max(
      MIN_COL_WIDTH,
      Math.min(MAX_COL_WIDTH, Math.round(screenWidth / this.core.metrics.zoomOf(tab))),
    );
    if (tab.colWidths[col] === w) {
      return;
    }
    tab.colWidths[col] = w;
    // A width change alters which cells wrap, so cached wrap heights are stale.
    this.core.renderer.invalidateRowHeights(tab);
    this.core.metrics.invalidateColOffsets(tab);
    this.core.window = null; // force a re-layout with the new width
    this.core.renderer.render(tab);
  }

  /** Frame-coalesced column-width application (a resize re-lays-out the window). */
  readonly applyResize = frameCoalesced<{ tab: Tab; col: number; width: number }>(({ tab, col, width }) => {
    if (!this.core.resizing || this.core.state.activeTab !== tab) {
      return;
    }
    this.setColWidth(tab, col, width);
  });

  onResizeMove(event: MouseEvent): void {
    const drag = this.core.resizing;
    if (!drag) {
      return;
    }
    const tab = this.core.state.activeTab;
    if (!tab) {
      return;
    }
    this.applyResize({ tab, col: drag.col, width: drag.startWidth + (event.clientX - drag.startX) });
  }

  endResize(): void {
    this.core.resizing = null;
  }

  /** Abort a column-resize drag, restoring the width it started at. */
  cancelResize(): void {
    const drag = this.core.resizing;
    if (!drag) {
      return;
    }
    this.core.resizing = null;
    const tab = this.core.state.activeTab;
    if (tab) {
      this.setColWidth(tab, drag.col, drag.startWidth);
    }
  }

  // ----- Fill handle -----

  /**
   * The destination rectangle for the current fill drag: the source extended
   * along the dominant axis (downward or rightward) toward the drag target.
   */
  private fillDest(): CellRange | null {
    if (!this.core.filling) {
      return null;
    }
    const { source, target } = this.core.filling;
    const downExt = Math.max(0, target.row - source.bottom);
    const rightExt = Math.max(0, target.col - source.right);
    if (downExt === 0 && rightExt === 0) {
      return null;
    }
    if (downExt >= rightExt) {
      return { top: source.top, left: source.left, right: source.right, bottom: target.row };
    }
    return { top: source.top, left: source.left, bottom: source.bottom, right: target.col };
  }

  updateFillPreview(): void {
    for (const cell of this.core.canvas.querySelectorAll('.fill-target')) {
      cell.classList.remove('fill-target');
    }
    const dest = this.fillDest();
    if (!dest || !this.core.filling) {
      return;
    }
    const { source } = this.core.filling;
    for (const cell of this.core.canvas.querySelectorAll<HTMLElement>('[data-row][data-col]')) {
      const row = Number(cell.dataset.row);
      const col = Number(cell.dataset.col);
      const inDest = row >= dest.top && row <= dest.bottom && col >= dest.left && col <= dest.right;
      const inSource = row >= source.top && row <= source.bottom && col >= source.left && col <= source.right;
      if (inDest && !inSource) {
        cell.classList.add('fill-target');
      }
    }
  }

  // ----- Range move (drag the selection to move it) -----

  /**
   * Start a range-move drag of `source`. `origin` is the cell the drag was
   * grabbed at, so the destination follows the pointer from there.
   */
  beginMove(tab: Tab, source: CellRange, origin: { row: number; col: number }, event: Event): void {
    this.core.editing.commitEditor();
    this.core.element.classList.remove('move-edge');
    this.core.movingRange = { source, origin, delta: { row: 0, col: 0 }, valid: false };
    this.updateMovePreview(tab);
    event.preventDefault();
    event.stopPropagation();
  }

  /**
   * The selected cell under a mouse event when the pointer sits on the
   * selection's outer border (see `onRangeEdge`), or null. Only RSF
   * worksheets can move ranges, and never while a cell is being edited.
   */
  moveEdgeHit(tab: Tab, event: MouseEvent): { row: number; col: number } | null {
    if (!isWorkbook(tab.doc) || this.core.editor !== null || tab.doc !== this.core.lastDoc) {
      return null;
    }
    const range = this.core.state.selectedRange(tab);
    const cellEl = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-row][data-col]');
    if (!range || !cellEl) {
      return null;
    }
    const rect = cellEl.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) {
      return null; // not laid out (no geometry to measure the border against)
    }
    const row = Number(cellEl.dataset.row);
    const col = Number(cellEl.dataset.col);
    const point = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      width: rect.width,
      height: rect.height,
    };
    return onRangeEdge(range, row, col, point, MOVE_EDGE_PX * this.core.metrics.zoomOf(tab))
      ? { row, col }
      : null;
  }

  /** The current move destination rectangle, or null when nothing is dragging. */
  private moveDest(): CellRange | null {
    if (!this.core.movingRange) {
      return null;
    }
    const { source, delta } = this.core.movingRange;
    return normalizeRange(
      { row: source.top + delta.row, col: source.left + delta.col },
      { row: source.bottom + delta.row, col: source.right + delta.col },
    );
  }

  /**
   * Repaint the drag preview: the moved rectangle at its proposed destination,
   * marked valid or invalid. The invalid state is conveyed by a distinct class
   * (and a `not-allowed` cursor), never by color alone. Validity is whether the
   * destination fits inside the worksheet and actually moves the cells.
   */
  updateMovePreview(tab: Tab): void {
    for (const cell of this.core.canvas.querySelectorAll(
      '.move-target, .move-target-invalid, .move-source',
    )) {
      cell.classList.remove('move-target', 'move-target-invalid', 'move-source');
    }
    const moving = this.core.movingRange;
    const dest = this.moveDest();
    if (!moving || !dest) {
      return;
    }
    const rows = tab.doc.rowCount;
    const cols = tab.doc.columnCount;
    const inBounds = dest.top >= 0 && dest.left >= 0 && dest.bottom < rows && dest.right < cols;
    const moved = moving.delta.row !== 0 || moving.delta.col !== 0;
    moving.valid = inBounds && moved;
    this.core.element.classList.toggle('moving-range', true);
    this.core.element.classList.toggle('move-invalid', !moving.valid);
    const source = moving.source;
    for (const cell of this.core.canvas.querySelectorAll<HTMLElement>('[data-row][data-col]')) {
      const row = Number(cell.dataset.row);
      const col = Number(cell.dataset.col);
      if (row >= source.top && row <= source.bottom && col >= source.left && col <= source.right) {
        cell.classList.add('move-source');
      }
      if (moved && row >= dest.top && row <= dest.bottom && col >= dest.left && col <= dest.right) {
        cell.classList.add(moving.valid ? 'move-target' : 'move-target-invalid');
      }
    }
  }

  /** Clear all move-preview styling and drag state. */
  private clearMoveState(): void {
    for (const cell of this.core.canvas.querySelectorAll(
      '.move-target, .move-target-invalid, .move-source',
    )) {
      cell.classList.remove('move-target', 'move-target-invalid', 'move-source');
    }
    this.core.element.classList.remove('moving-range', 'move-invalid');
    this.core.movingRange = null;
  }

  /** Abort a range-move drag without committing anything. */
  cancelMove(): void {
    if (this.core.movingRange) {
      this.clearMoveState();
    }
  }

  /** Commit a range-move drag on mouseup (runs the shared, confirmed command). */
  endMove(): void {
    const moving = this.core.movingRange;
    if (!moving) {
      return;
    }
    const tab = this.core.state.activeTab;
    const valid = moving.valid;
    const { source, delta } = moving;
    this.clearMoveState();
    if (valid && tab && tab.doc === this.core.lastDoc && (delta.row !== 0 || delta.col !== 0)) {
      void this.core.commands.moveRange(tab, source, delta.row, delta.col);
    }
  }

  // ----- Pointer reference entry -----

  /** Reference text for a single cell or a rectangle (`A1` or `A1:B3`). */
  refText(anchor: { row: number; col: number }, cell: { row: number; col: number }): string {
    if (anchor.row === cell.row && anchor.col === cell.col) {
      return cellLabel(cell.row, cell.col);
    }
    const range = normalizeRange(anchor, cell);
    return `${cellLabel(range.top, range.left)}:${cellLabel(range.bottom, range.right)}`;
  }

  endRefDrag(): void {
    if (!this.core.refDrag) {
      return;
    }
    this.core.refDrag = null;
    this.core.state.formulaRefTarget?.endRef();
  }

  endFill(): void {
    const filling = this.core.filling;
    if (!filling) {
      return;
    }
    const dest = this.fillDest();
    const source = filling.source;
    const tab = this.core.state.activeTab;
    this.core.filling = null;
    for (const cell of this.core.canvas.querySelectorAll('.fill-target')) {
      cell.classList.remove('fill-target');
    }
    if (dest && tab && tab.doc === this.core.lastDoc) {
      void this.core.commands.applyFill(tab, source, dest);
    }
  }

  /** Abort a fill-handle drag without committing anything. */
  cancelFill(): void {
    if (!this.core.filling) {
      return;
    }
    this.core.filling = null;
    for (const cell of this.core.canvas.querySelectorAll('.fill-target')) {
      cell.classList.remove('fill-target');
    }
  }
}
