// SPDX-License-Identifier: MIT
/**
 * Mouse, touch and pen input: hit testing, click/drag selection, header
 * selection, double-click editing, press-and-hold and double-tap gestures,
 * edge auto-scroll continuation, and the context menu.
 *
 * A collaborator of the grid (see `./core.ts`): it owns no state of its own
 * beyond what is declared here, and reaches shared grid state through
 * `this.core`.
 */
import { isWorkbook } from '../../core/editor-document';
import type { Tab } from '../../app/state';
import { isGridSurface } from '../../app/commands';
import { rangeContains } from '../../core/clipboard';
import { cellLabel } from '../../core/formula';
import { ContextMenu } from '../context-menu';
import { contextMenuEntries, formatToolbarItems } from './context-menu-items';
import { caretOffsetFromPoint } from './cell-paint';
import { frameCoalesced } from './dom-support';
import type { GridCore } from './core';

export class PointerInput {
  constructor(private readonly core: GridCore) {}

  // ----- Hit testing -----

  private cellFromEvent(event: Event): { row: number; col: number } | null {
    const target = event.target as HTMLElement | null;
    const cell = target?.closest<HTMLElement>('[data-row][data-col]');
    if (!cell) {
      return null;
    }
    return { row: Number(cell.dataset.row), col: Number(cell.dataset.col) };
  }

  cellAt(row: number, col: number): HTMLElement | null {
    return this.core.canvas.querySelector<HTMLElement>(`[data-row="${row}"][data-col="${col}"]`);
  }

  /**
   * Hit-test by viewport coordinates instead of an event target. Used by
   * auto-scroll, where a nudge moves the grid's content under a pointer that
   * hasn't itself moved, so there is no fresh event target to read.
   */
  private cellFromPoint(clientX: number, clientY: number): { row: number; col: number } | null {
    const target =
      typeof document.elementFromPoint === 'function' ? document.elementFromPoint(clientX, clientY) : null;
    const cell = (target as HTMLElement | null)?.closest<HTMLElement>('[data-row][data-col]');
    return cell ? { row: Number(cell.dataset.row), col: Number(cell.dataset.col) } : null;
  }

  // ----- Mouse -----

  /** Ends every in-progress drag (resize/fill/move/header/ref/selection), committing
   * whichever one was active — shared by the document `mouseup` and touch `pointerup`/
   * `pointercancel` listeners. */
  endActiveDrags(): void {
    this.core.dragging = false;
    this.core.headerDrag = null;
    this.core.drags.endResize();
    this.core.drags.endFill();
    this.core.drags.endRefDrag();
    this.core.drags.endMove();
    this.core.autoScroll.stop();
  }

  onMouseDown(event: MouseEvent): void {
    const tab = this.core.state.activeTab;
    if (!tab || event.button !== 0) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (
      this.startHandleDrag(tab, target, event) ||
      this.startReferenceEntry(target, event) ||
      this.startEdgeMove(tab, event) ||
      this.startHeaderSelection(tab, target, event, 'row') ||
      this.startHeaderSelection(tab, target, event, 'col')
    ) {
      return;
    }
    const cell = this.cellFromEvent(event);
    if (!cell) {
      return;
    }
    if (this.core.editor && (this.core.editor.row !== cell.row || this.core.editor.col !== cell.col)) {
      this.core.editing.commitEditor();
    }
    if (event.shiftKey && tab.selection) {
      this.core.state.setSelection(tab, cell, tab.anchor ?? tab.selection);
    } else {
      this.core.state.setSelection(tab, cell, null);
      this.core.dragging = true;
    }
    if (!this.core.editor) {
      this.core.editing.focusGrid();
      event.preventDefault();
    }
  }

  /**
   * A press on a column-resize, move, or fill handle begins that drag
   * (tracked via document mousemove/up). True when `target` is a handle.
   */
  private startHandleDrag(tab: Tab, target: HTMLElement | null, event: MouseEvent): boolean {
    const resizeHandle = target?.closest<HTMLElement>('[data-colresize]');
    if (resizeHandle) {
      const col = Number(resizeHandle.dataset.colresize);
      this.core.editing.commitEditor();
      this.core.resizing = { col, startX: event.clientX, startWidth: this.core.metrics.colWidth(tab, col) };
      event.preventDefault();
      event.stopPropagation();
      return true;
    }
    if (target?.closest<HTMLElement>('[data-movehandle]')) {
      // Begin a range-move drag from the current selection (RSF only).
      const range = this.core.state.selectedRange(tab);
      if (range && isWorkbook(tab.doc)) {
        this.core.drags.beginMove(tab, range, { row: range.top, col: range.left }, event);
      }
      return true;
    }
    if (target?.closest<HTMLElement>('[data-fillhandle]')) {
      // Begin a fill-handle drag from the current selection.
      const range = this.core.state.selectedRange(tab);
      if (range) {
        this.core.editing.commitEditor();
        this.core.filling = { source: range, target: { row: range.bottom, col: range.right } };
        event.preventDefault();
        event.stopPropagation();
      }
      return true;
    }
    return false;
  }

  /**
   * While a formula is being edited, clicking/dragging cells enters
   * references into the formula instead of moving the grid selection. A click
   * on the inline editor's own input is left alone so the caret can be
   * positioned normally. True when the press started reference entry.
   */
  private startReferenceEntry(target: HTMLElement | null, event: MouseEvent): boolean {
    const refTarget = this.core.state.formulaRefTarget;
    const onEditorInput = this.core.editor !== null && target === this.core.editor.input;
    if (!refTarget?.isCapturing() || onEditorInput) {
      return false;
    }
    const cell = this.cellFromEvent(event);
    if (!cell) {
      return false;
    }
    // preventDefault keeps focus in the formula editor (no blur/commit).
    event.preventDefault();
    event.stopPropagation();
    this.core.refDrag = { anchor: cell };
    refTarget.beginRef();
    refTarget.setRef(cellLabel(cell.row, cell.col));
    return true;
  }

  /**
   * Pressing on the selection's outer border (anywhere along it, not only the
   * corner handle) also drags the selected cells to move them.
   */
  private startEdgeMove(tab: Tab, event: MouseEvent): boolean {
    const edgeCell = event.shiftKey ? null : this.core.drags.moveEdgeHit(tab, event);
    const range = edgeCell ? this.core.state.selectedRange(tab) : null;
    if (!edgeCell || !range) {
      return false;
    }
    this.core.drags.beginMove(tab, range, edgeCell, event);
    return true;
  }

  /**
   * A row or column header press: whole-row / whole-column selection.
   * Shift+Click extends from the current header-selection anchor; a plain
   * click starts a header drag.
   */
  private startHeaderSelection(
    tab: Tab,
    target: HTMLElement | null,
    event: MouseEvent,
    axis: 'row' | 'col',
  ): boolean {
    const head = target?.closest<HTMLElement>(axis === 'row' ? '[data-rowhead]' : '[data-colhead]');
    if (!head) {
      return false;
    }
    const index = Number(axis === 'row' ? head.dataset.rowhead : head.dataset.colhead);
    const select = (from: number, to: number): void =>
      axis === 'row' ? this.selectRows(tab, from, to) : this.selectCols(tab, from, to);
    this.core.editing.commitEditor();
    if (event.shiftKey && tab.selectionKind === axis && tab.anchor) {
      select(axis === 'row' ? tab.anchor.row : tab.anchor.col, index);
    } else {
      select(index, index);
      this.core.headerDrag = { axis, anchor: index, last: index };
    }
    this.core.editing.focusGrid();
    event.preventDefault();
    return true;
  }

  /**
   * Frame-coalesced pointer-drag appliers: the DOM/state updates for drag
   * selection and the fill preview run at most once per frame (the first
   * event in a frame applies immediately), so rapid mousemove streams never
   * queue redundant renders. Guards re-check the live drag state because a
   * trailing application may run just after the drag ended.
   */
  private readonly applyDragSelection = frameCoalesced<{ tab: Tab; cell: { row: number; col: number } }>(
    ({ tab, cell }) => {
      if (!this.core.dragging || this.core.state.activeTab !== tab || !tab.selection) {
        return;
      }
      this.core.state.setSelection(tab, cell, tab.anchor ?? tab.selection);
    },
  );

  private readonly applyFillPreview = frameCoalesced<null>(() => {
    if (this.core.filling) {
      this.core.drags.updateFillPreview();
    }
  });

  /** Whole-row selection spanning rows [anchorRow, targetRow] across all columns. */
  private selectRows(tab: Tab, anchorRow: number, targetRow: number): void {
    const rows = tab.doc.rowCount;
    if (rows === 0) {
      return;
    }
    const a = Math.max(0, Math.min(rows - 1, anchorRow));
    const b = Math.max(0, Math.min(rows - 1, targetRow));
    const lastCol = Math.max(0, tab.doc.columnCount - 1);
    // Active cell at the target row (column 0); anchor at the far corner so the
    // normalized range covers every column of every selected row.
    this.core.state.setSelection(tab, { row: b, col: 0 }, { row: a, col: lastCol }, 'row');
  }

  /** Whole-column selection spanning columns [anchorCol, targetCol] across all rows. */
  private selectCols(tab: Tab, anchorCol: number, targetCol: number): void {
    const cols = tab.doc.columnCount;
    if (cols === 0 || tab.doc.rowCount === 0) {
      return;
    }
    const a = Math.max(0, Math.min(cols - 1, anchorCol));
    const b = Math.max(0, Math.min(cols - 1, targetCol));
    const lastRow = Math.max(0, tab.doc.rowCount - 1);
    this.core.state.setSelection(tab, { row: 0, col: b }, { row: lastRow, col: a }, 'col');
  }

  /** Row index under the pointer (a data cell or a row header), or null. */
  private rowFromEvent(event: Event): number | null {
    const target = event.target as HTMLElement | null;
    const head = target?.closest<HTMLElement>('[data-rowhead]');
    if (head) {
      return Number(head.dataset.rowhead);
    }
    const cell = target?.closest<HTMLElement>('[data-row]');
    return cell ? Number(cell.dataset.row) : null;
  }

  /** Column index under the pointer (a data cell or a column header), or null. */
  private colFromEvent(event: Event): number | null {
    const target = event.target as HTMLElement | null;
    const head = target?.closest<HTMLElement>('[data-colhead]');
    if (head) {
      return Number(head.dataset.colhead);
    }
    const cell = target?.closest<HTMLElement>('[data-col]');
    return cell ? Number(cell.dataset.col) : null;
  }

  onMouseMove(event: MouseEvent): void {
    if (this.core.headerDrag) {
      const tab = this.core.state.activeTab;
      if (!tab) {
        return;
      }
      if (this.core.headerDrag.axis === 'row') {
        const row = this.rowFromEvent(event);
        if (row !== null && row !== this.core.headerDrag.last) {
          this.core.headerDrag.last = row;
          this.selectRows(tab, this.core.headerDrag.anchor, row);
        }
      } else {
        const col = this.colFromEvent(event);
        if (col !== null && col !== this.core.headerDrag.last) {
          this.core.headerDrag.last = col;
          this.selectCols(tab, this.core.headerDrag.anchor, col);
        }
      }
      return;
    }
    if (this.core.movingRange) {
      const tab = this.core.state.activeTab;
      const cell = this.cellFromEvent(event);
      if (tab && cell) {
        this.core.movingRange.delta = {
          row: cell.row - this.core.movingRange.origin.row,
          col: cell.col - this.core.movingRange.origin.col,
        };
        this.core.drags.updateMovePreview(tab);
      }
      return;
    }
    if (this.core.refDrag) {
      const cell = this.cellFromEvent(event);
      const refTarget = this.core.state.formulaRefTarget;
      if (cell && refTarget) {
        refTarget.setRef(this.core.drags.refText(this.core.refDrag.anchor, cell));
      }
      return;
    }
    if (this.core.filling) {
      const cell = this.cellFromEvent(event);
      if (cell) {
        // Track the target synchronously (commit correctness), render the
        // lightweight preview at most once per frame.
        this.core.filling.target = cell;
        this.applyFillPreview(null);
      }
      return;
    }
    if (!this.core.dragging) {
      // Hovering the selection's border shows the move cursor.
      const hoverTab = this.core.state.activeTab;
      this.core.element.classList.toggle(
        'move-edge',
        hoverTab !== null && this.core.drags.moveEdgeHit(hoverTab, event) !== null,
      );
      return;
    }
    const tab = this.core.state.activeTab;
    if (!tab || !tab.selection) {
      return;
    }
    const cell = this.cellFromEvent(event);
    if (!cell) {
      return;
    }
    if (cell.row === tab.selection.row && cell.col === tab.selection.col && tab.anchor !== null) {
      return; // no movement
    }
    this.applyDragSelection({ tab, cell });
  }

  // ----- Touch / pen (#290) -----
  //
  // The fill/resize/move handles begin dragging on the very first touch,
  // exactly like a mouse press — each already opts out of native panning via
  // `touch-action: none` in styles.css, so there is no scroll to conflict
  // with. A touch that starts anywhere else (a cell, or a row/column header)
  // could equally be the start of a scroll, so it only arms a drag after a
  // brief press-and-hold with no real movement; a quick tap is left alone
  // and keeps working exactly as before, through the browser's own
  // synthetic mousedown/click for that touch.

  onPointerDown(event: PointerEvent): void {
    // Pointer events fire before their mouse-compatibility counterparts, so
    // this always lands before the `focusGrid()` call the resulting
    // mousedown/click triggers — see `lastPointerType`.
    this.core.lastPointerType = event.pointerType;
    if (event.pointerType === 'mouse') {
      return;
    }
    const target = event.target as HTMLElement | null;
    const onHandle = !!target?.closest('[data-colresize], [data-movehandle], [data-fillhandle]');
    if (onHandle) {
      this.onMouseDown(event);
      if (this.core.resizing || this.core.movingRange || this.core.filling) {
        this.capturePointer(event.pointerId);
      }
      return;
    }
    this.armLongPressDrag(event);
  }

  onPointerMove(event: PointerEvent): void {
    if (event.pointerType === 'mouse') {
      return;
    }
    if (this.core.longPress.pending) {
      if (this.core.longPress.movedFromOrigin(event)) {
        // Real movement before the hold completes reads as a scroll, not a
        // drag — cancel the pending long-press and leave the touch to the
        // browser's native panning.
        this.core.longPress.clear();
      }
      return;
    }
    if (
      !this.core.resizing &&
      !this.core.movingRange &&
      !this.core.filling &&
      !this.core.dragging &&
      !this.core.headerDrag &&
      !this.core.refDrag
    ) {
      return;
    }
    if (this.core.longPress.menuTarget) {
      if (this.core.longPress.menuTargetHeld(event)) {
        // A held finger keeps reporting small jitter even while stationary —
        // only movement past the tolerance means the completed hold turned
        // into a drag (#475); a jittery `pointermove` here is not that.
        return;
      }
      // Real movement past the tolerance: the completed long-press turned
      // into a drag rather than a stationary hold — the pending
      // context-menu-on-release no longer applies.
      this.core.longPress.menuTarget = null;
    }
    // A drag is confirmed and moving: block the native scroll/pan this touch
    // would otherwise start, and drive the drag through the same code the
    // mouse path uses.
    event.preventDefault();
    this.core.drags.onResizeMove(event);
    this.core.autoScroll.track(event);
    this.onMouseMove(event);
  }

  onPointerEnd(event: PointerEvent): void {
    if (event.pointerType === 'mouse') {
      return;
    }
    // A quick tap is one that lifts before the long-press timer fires (and
    // without enough movement to have cancelled it already) — the same
    // gesture the browser's own synthetic click already treats as a plain
    // tap-to-select, and the only kind eligible to pair into a double-tap.
    const wasQuickTap = this.core.longPress.quickTap;
    this.core.longPress.clear();
    const menuTarget = this.core.longPress.menuTarget;
    this.core.longPress.menuTarget = null;
    this.releasePointerIfCaptured(event.pointerId);
    this.endActiveDrags();
    // The hold completed and lifted without ever turning into a drag: treat
    // it as the touch equivalent of a right-click. `pointercancel` (the OS
    // taking the gesture away, e.g. for a scroll or an interruption) does not
    // count as a completed press, so the menu only opens on a real lift.
    if (menuTarget && event.type === 'pointerup') {
      this.onContextMenu(menuTarget.event);
      return;
    }
    if (wasQuickTap && event.type === 'pointerup') {
      this.handleQuickTap(event);
    }
  }

  /**
   * Pairs successive quick taps into a double-tap that opens the inline
   * editor, mirroring `onDoubleClick` — see `DOUBLE_TAP_MS`. The first tap of
   * a pair only arms a pending-tap window; the second, landing on the same
   * cell within that window and the long-press move tolerance, opens the
   * editor with the caret placed under the tap, then clears the pending
   * state so a third tap doesn't retrigger it.
   */
  private handleQuickTap(event: PointerEvent): void {
    const tab = this.core.state.activeTab;
    if (!tab) {
      return;
    }
    const cell = this.cellFromEvent(event);
    if (!cell) {
      return;
    }
    if (this.core.doubleTap.tap(cell, event)) {
      const cellEl = this.cellAt(cell.row, cell.col);
      const caretOffset = cellEl ? caretOffsetFromPoint(cellEl, event.clientX, event.clientY) : null;
      this.core.editing.openEditor(tab, cell.row, cell.col, null, caretOffset ?? undefined);
    }
  }

  /** Arms a drag-selection/header-drag after a press-and-hold with no real movement. */
  private armLongPressDrag(event: PointerEvent): void {
    this.core.longPress.arm(event, (press) => {
      this.onMouseDown(press);
      if (this.core.dragging || this.core.headerDrag || this.core.refDrag) {
        this.capturePointer(press.pointerId);
      }
    });
  }

  /** Pointer capture keeps a touch drag's move/up events targeted at the grid even
   * once the finger moves outside its bounds. jsdom (tests) implements neither
   * method, hence the feature checks. */
  private capturePointer(pointerId: number): void {
    if (typeof this.core.element.setPointerCapture === 'function') {
      this.core.element.setPointerCapture(pointerId);
    }
  }

  private releasePointerIfCaptured(pointerId: number): void {
    if (
      typeof this.core.element.hasPointerCapture !== 'function' ||
      typeof this.core.element.releasePointerCapture !== 'function'
    ) {
      return;
    }
    if (this.core.element.hasPointerCapture(pointerId)) {
      this.core.element.releasePointerCapture(pointerId);
    }
  }

  // ----- Auto-scroll (drag past the grid edge) -----

  /** Whether a drag that should auto-scroll the viewport on approaching an edge is active. */
  hasEdgeScrollableDrag(): boolean {
    return (
      this.core.dragging ||
      this.core.filling !== null ||
      this.core.movingRange !== null ||
      this.core.resizing !== null
    );
  }

  /**
   * Re-applies the active drag's update for the cell now under
   * `(clientX, clientY)` — used after an auto-scroll nudge moves the grid
   * content under a pointer that hasn't itself moved.
   */
  continueDragAt(tab: Tab, clientX: number, clientY: number): void {
    if (this.core.resizing) {
      this.core.drags.applyResize({
        tab,
        col: this.core.resizing.col,
        width: this.core.resizing.startWidth + (clientX - this.core.resizing.startX),
      });
      return;
    }
    const cell = this.cellFromPoint(clientX, clientY);
    if (!cell) {
      return;
    }
    if (this.core.movingRange) {
      this.core.movingRange.delta = {
        row: cell.row - this.core.movingRange.origin.row,
        col: cell.col - this.core.movingRange.origin.col,
      };
      this.core.drags.updateMovePreview(tab);
      return;
    }
    if (this.core.filling) {
      this.core.filling.target = cell;
      this.applyFillPreview(null);
      return;
    }
    if (this.core.dragging && tab.selection) {
      this.applyDragSelection({ tab, cell });
    }
  }

  onDoubleClick(event: MouseEvent): void {
    const tab = this.core.state.activeTab;
    if (!tab) {
      return;
    }
    const target = event.target as HTMLElement | null;
    const resizeHandle = target?.closest<HTMLElement>('[data-colresize]');
    if (resizeHandle && isGridSurface(tab)) {
      event.preventDefault();
      const col = Number(resizeHandle.dataset.colresize);
      // When whole columns are selected (column headers / Shift+Click / drag,
      // or any selection spanning every row — including Select All) and the
      // double-clicked handle belongs to one of them, auto-fit applies to
      // every selected column; otherwise only the handle's own column fits.
      const range = this.core.state.selectedRange(tab);
      const wholeCols =
        range !== null &&
        range.right > range.left &&
        col >= range.left &&
        col <= range.right &&
        (tab.selectionKind === 'col' || (range.top === 0 && range.bottom === tab.doc.rowCount - 1));
      const cols: number[] = [];
      if (wholeCols && range) {
        for (let c = range.left; c <= range.right; c++) {
          cols.push(c);
        }
      } else {
        cols.push(col);
      }
      void this.core.autofit.autoFitColumns(tab, cols);
      return;
    }
    const cell = this.cellFromEvent(event);
    if (cell) {
      const cellEl = this.cellAt(cell.row, cell.col);
      const caretOffset = cellEl ? caretOffsetFromPoint(cellEl, event.clientX, event.clientY) : null;
      this.core.editing.openEditor(tab, cell.row, cell.col, null, caretOffset ?? undefined);
    }
  }

  // ----- Context menu -----

  onContextMenu(event: MouseEvent): void {
    const tab = this.core.state.activeTab;
    if (!tab) {
      return;
    }
    const target = event.target as HTMLElement | null;
    const rowHead = target?.closest<HTMLElement>('[data-rowhead]');
    const colHead = target?.closest<HTMLElement>('[data-colhead]');
    const cell = this.cellFromEvent(event);
    if (!rowHead && !colHead && !cell) {
      return;
    }
    event.preventDefault();
    this.core.editing.commitEditor();
    if (rowHead) {
      const row = Number(rowHead.dataset.rowhead);
      const range = this.core.state.selectedRange(tab);
      if (!range || row < range.top || row > range.bottom) {
        this.selectRows(tab, row, row);
      }
    } else if (colHead) {
      const col = Number(colHead.dataset.colhead);
      const range = this.core.state.selectedRange(tab);
      if (!range || col < range.left || col > range.right) {
        this.selectCols(tab, col, col);
      }
    } else if (cell) {
      const range = this.core.state.selectedRange(tab);
      if (!range || !rangeContains(range, cell.row, cell.col)) {
        this.core.state.setSelection(tab, cell, null);
      }
    }
    this.openContextMenu(tab, event.clientX, event.clientY);
  }

  private openContextMenu(tab: Tab, x: number, y: number): void {
    this.closeContextMenu();
    this.core.contextMenu = ContextMenu.open(contextMenuEntries(this.core.commands, tab), x, y, {
      onClose: () => (this.core.contextMenu = null),
      toolbar: formatToolbarItems(this.core.commands, tab),
    });
  }

  closeContextMenu(): void {
    this.core.contextMenu?.close();
    this.core.contextMenu = null;
  }
}
