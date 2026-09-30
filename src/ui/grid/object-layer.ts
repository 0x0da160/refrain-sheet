// SPDX-License-Identifier: MIT
/**
 * Shapes over the grid (see `src/core/workbook/sheet-objects.ts`): drawing
 * them in the scrolled canvas, picking them, and moving and resizing them
 * with the pointer or the arrow keys. Each finished gesture is one change
 * through the command layer (`Commands.updateObjects`), which refuses what
 * a lock forbids; nothing here writes the document itself.
 *
 * Positions: an object's box is in canvas pixels, `x = row numbers' width +
 * column offset + dx × zoom` and `y = header height + row offset + dy ×
 * zoom`, so it scrolls with the cells under it. Under a sort, rows are
 * placed by document row, not by where the sort shows them.
 *
 * A collaborator of the grid (see `./core.ts`).
 */
import { editObjectText, INLINE_TEXT_KINDS } from './object-text-editor';
import type { Tab } from '../../app/state';
import { t } from '../../app/i18n';
import { isWorkbook } from '../../core/editor-document';
import { isLineKind, isPositionLocked, type SheetObject } from '../../core/workbook/sheet-objects';
import { clearChildren, el } from '../dom';
import { buildObjectElement, drawObject, lineEnds, type ObjectBox } from '../sheet-object-view';
import { snapMove, unionBox, type GuideBox, type GuideLine } from './object-guides';
import { withGroups } from '../../core/workbook/object-arrange';
import { openObjectMenu, swallowNextAltUp } from './object-menu';
import type { GridCore } from './core';

/** Pointer travel (px) before a press on an object becomes a drag. */
const DRAG_THRESHOLD = 3;
/** Two presses on one object this close in time (ms) and place (px) are a double press. */
const DOUBLE_PRESS_MS = 500;
const DOUBLE_PRESS_SLOP_PX = 6;
const BOX_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;

interface ObjectDrag {
  mode: 'move' | 'resize';
  handle: string | null;
  /** The pressed object, and every object the drag moves (as they were). */
  id: string;
  originals: SheetObject[];
  startX: number;
  startY: number;
  moved: boolean;
  /** The resized object as it would be now (resize only). */
  preview: SheetObject | null;
  /** A move: the moved objects' box and the other shown objects' boxes (canvas px), for guides. */
  bounds: GuideBox | null;
  others: GuideBox[];
  /** A move: the drag so far, after snapping to guides. */
  shift: { dx: number; dy: number };
  /** A press on a member of a picked group: a click (no drag) picks that member alone. */
  pickMember: boolean;
  /** Alt (Option) held: snap to cells. From pointer events and the key's own presses. */
  alt: boolean;
  /** Whether Shift is held (a picture then stretches freely). */
  shiftKey: boolean;
  /** The pointer's latest position, to redraw when only a key changed. */
  lastX: number;
  lastY: number;
}

export class ObjectLayer {
  readonly element: HTMLElement;
  /** Inputs of the last render; an equal set skips the rebuild (scrolling renders often). */
  private signature: unknown[] | null = null;
  private drag: ObjectDrag | null = null;
  /** The object whose text is being typed on it; drawing waits until that ends. */
  private editing: string | null = null;
  /** The picked ids at the last render, to tell a new pick. */
  private lastPicks = '';
  /** The last press on an object, to tell a double press. */
  private lastPress: { id: string; at: number; x: number; y: number } | null = null;
  private readonly onMove = (event: PointerEvent): void => this.dragMove(event);
  private readonly onUp = (event: PointerEvent): void => this.dragEnd(event, false);
  private readonly onCancel = (event: PointerEvent): void => this.dragEnd(event, true);
  private readonly onDragKey = (event: KeyboardEvent): void => this.dragKey(event);

  constructor(private readonly core: GridCore) {
    this.element = el('div', { className: 'sheet-objects' });
    this.element.addEventListener('pointerdown', (event) => this.pointerDown(event));
    // The grid starts a cell selection on mousedown; a press on an object is the object's.
    this.element.addEventListener('mousedown', (event) => {
      if (this.objectFrom(event.target)) {
        event.stopPropagation();
        event.preventDefault();
      }
    });
    // A press redraws the object under the pointer, so the browser's own
    // dblclick never arrives: `pointerDown` tells a double press itself.
    this.element.addEventListener('dblclick', (event) => {
      if (this.objectFrom(event.target)) {
        event.stopPropagation();
      }
    });
    this.element.addEventListener('contextmenu', (event) => this.contextMenu(event));
    this.element.addEventListener('keydown', (event) => this.keyDown(event));
  }

  /** Any press on the grid outside an object lets go of the picked objects. */
  gridPointerDown(): void {
    const tab = this.core.state.activeTab;
    if (tab && this.core.state.objectSelection.selected(tab).length > 0) {
      this.core.state.objectSelection.select(tab, []);
    }
  }

  private objects(tab: Tab): readonly SheetObject[] {
    const doc = tab.doc;
    return isWorkbook(doc) && doc.activeSheet.kind === 'grid' ? doc.objects : [];
  }

  /** Draw the active sheet's objects (skipped when nothing they depend on changed). */
  render(tab: Tab | null, force = false): void {
    if (!tab) {
      this.signature = null;
      clearChildren(this.element);
      return;
    }
    if (this.editing !== null) {
      return;
    }
    const objects = this.objects(tab);
    const selected = this.core.state.objectSelection.selected(tab);
    const signature = [
      tab.doc,
      // Charts show cells: redraw when any cell of the file changes.
      isWorkbook(tab.doc) ? tab.doc.revisionCounter : 0,
      objects,
      tab.zoom,
      this.core.metrics.heightsVersion,
      this.core.metrics.colOffsetIndex(tab),
      this.core.metrics.hiddenOf(tab),
      selected.join('\n'),
    ];
    if (
      !force &&
      this.drag === null &&
      this.signature?.length === signature.length &&
      this.signature.every((value, i) => value === signature[i])
    ) {
      return;
    }
    this.signature = signature;
    const active = document.activeElement;
    // Keep the keyboard on the object it was on; a newly picked object (a
    // press, Insert > Rectangle) takes it from the grid.
    const picks = selected.join('\n');
    const newlyPicked = picks !== this.lastPicks && selected.length > 0;
    this.lastPicks = picks;
    const focused =
      this.objectFrom(active)?.dataset.objectId ??
      (newlyPicked && (active === document.body || this.core.element.contains(active))
        ? selected[selected.length - 1]
        : null);
    const picked = new Set(selected);
    const nodes: HTMLElement[] = [];
    for (const o of objects) {
      if (!o.hidden) {
        nodes.push(this.objectElement(tab, o, picked.has(o.id)));
      }
    }
    this.element.replaceChildren(...nodes);
    if (focused) {
      this.elementFor(focused)?.focus({ preventScroll: true });
    }
  }

  private objectElement(tab: Tab, o: SheetObject, selected: boolean): HTMLElement {
    const box = this.boxOf(tab, o);
    const zoom = this.core.metrics.zoomOf(tab);
    const node = isWorkbook(tab.doc) ? drawObject(tab.doc, o, box, zoom) : buildObjectElement(o, box, zoom);
    node.tabIndex = -1;
    if (selected) {
      node.classList.add('selected');
      if (isPositionLocked(o)) {
        node.classList.add('locked');
      } else if (isLineKind(o.kind)) {
        const { x1, y1, x2, y2 } = lineEnds(o, box.w, box.h);
        node.append(this.handle('start', x1, y1), this.handle('end', x2, y2));
      } else {
        // A picture keeps its shape: corner handles only, unless it may stretch.
        const handles = keepsAspect(o) ? BOX_HANDLES.filter((name) => name.length === 2) : BOX_HANDLES;
        for (const name of handles) {
          const x = name.includes('w') ? 0 : name.includes('e') ? box.w : box.w / 2;
          const y = name.includes('n') ? 0 : name.includes('s') ? box.h : box.h / 2;
          node.append(this.handle(name, x, y));
        }
      }
    }
    return node;
  }

  private handle(name: string, x: number, y: number): HTMLElement {
    const node = el('div', {
      className: `sheet-object-handle handle-${name}`,
      attrs: { 'data-handle': name, 'aria-hidden': 'true' },
    });
    node.style.left = `${x}px`;
    node.style.top = `${y}px`;
    return node;
  }

  private elementFor(id: string): HTMLElement | null {
    return (
      [...this.element.querySelectorAll<HTMLElement>('.sheet-object')].find(
        (node) => node.dataset.objectId === id,
      ) ?? null
    );
  }

  private objectFrom(target: EventTarget | null): HTMLElement | null {
    return target instanceof Element ? target.closest<HTMLElement>('.sheet-object') : null;
  }

  // ----- Geometry -----

  /** Where an object is drawn, in canvas pixels. */
  boxOf(tab: Tab, o: SheetObject): ObjectBox {
    const z = this.core.metrics.zoomOf(tab);
    return {
      x: this.core.metrics.headW(tab) + this.core.metrics.colOffset(tab, o.col) + o.dx * z,
      y: this.core.metrics.rowH(tab) + this.core.metrics.heightIndex(tab).offsetOf(o.row) + o.dy * z,
      w: o.width * z,
      h: o.height * z,
    };
  }

  /** The column (`x`) or row (`y`) edge nearest canvas position `at`. */
  private toCellEdge(tab: Tab, axis: 'x' | 'y', at: number): number {
    if (axis === 'x') {
      const head = this.core.metrics.headW(tab);
      const colIdx = this.core.metrics.colOffsetIndex(tab);
      const x = Math.max(0, at - head);
      const col = Math.max(0, Math.min(tab.doc.columnCount - 1, colIdx.colAtOrBefore(x)));
      const start = colIdx.offsetOf(col);
      const end = start + this.core.metrics.colWidth(tab, col);
      return head + (x - start <= end - x ? start : end);
    }
    const head = this.core.metrics.rowH(tab);
    const idx = this.core.metrics.heightIndex(tab);
    const y = Math.max(0, at - head);
    const row = Math.max(0, Math.min(tab.doc.rowCount - 1, idx.rowAtOffset(y, tab.doc.rowCount)));
    const start = idx.offsetOf(row);
    const end = start + idx.heightOf(row);
    return head + (y - start <= end - y ? start : end);
  }

  /** Box edges `[left, top, right, bottom]` with the ones `handle` drags (both ends of a line) on the nearest cell edges. */
  private toCellEdges(tab: Tab, handle: string, edges: readonly number[]): [number, number, number, number] {
    const line = handle === 'start' || handle === 'end';
    const [left, top, right, bottom] = edges;
    const snap = (side: string, axis: 'x' | 'y', at: number): number =>
      line || handle.includes(side) ? this.toCellEdge(tab, axis, at) : at;
    return [snap('w', 'x', left), snap('n', 'y', top), snap('e', 'x', right), snap('s', 'y', bottom)];
  }

  /** The object with its top-left corner moved to canvas point (`x`, `y`). */
  placeAt(tab: Tab, o: SheetObject, x: number, y: number, snap = false): SheetObject {
    const z = this.core.metrics.zoomOf(tab);
    const colIdx = this.core.metrics.colOffsetIndex(tab);
    const idx = this.core.metrics.heightIndex(tab);
    const cx = Math.max(0, x - this.core.metrics.headW(tab));
    const cy = Math.max(0, y - this.core.metrics.rowH(tab));
    let col = Math.max(0, Math.min(tab.doc.columnCount - 1, colIdx.colAtOrBefore(cx)));
    let row = Math.max(0, Math.min(tab.doc.rowCount - 1, idx.rowAtOffset(cy, tab.doc.rowCount)));
    if (snap) {
      // To the nearest cell corner.
      if (
        cx - colIdx.offsetOf(col) > this.core.metrics.colWidth(tab, col) / 2 &&
        col < tab.doc.columnCount - 1
      ) {
        col += 1;
      }
      if (cy - idx.offsetOf(row) > idx.heightOf(row) / 2 && row < tab.doc.rowCount - 1) {
        row += 1;
      }
      return { ...o, row, col, dx: 0, dy: 0 };
    }
    const dx = Math.max(0, Math.round((cx - colIdx.offsetOf(col)) / z));
    const dy = Math.max(0, Math.round((cy - idx.offsetOf(row)) / z));
    return { ...o, row, col, dx, dy };
  }

  /** The grid-paper square in canvas pixels (zoomed), or null on an ordinary sheet. */
  private paperSquare(tab: Tab): number | null {
    const paper = this.core.metrics.paperOf(tab);
    return paper === undefined ? null : paper * this.core.metrics.zoomOf(tab);
  }

  /** A move of the box `bounds` by (`dx`, `dy`), corrected so its corner lands on a square's corner. */
  private squareMove(
    tab: Tab,
    bounds: GuideBox,
    dx: number,
    dy: number,
  ): { dx: number; dy: number; guides: [] } {
    const [x] = this.toSquareEdges(tab, 'x', bounds.x + dx, bounds.x + dx, true);
    const [y] = this.toSquareEdges(tab, 'y', bounds.y + dy, bounds.y + dy, true);
    return { dx: x - bounds.x, dy: y - bounds.y, guides: [] };
  }

  /** Two canvas edges on one axis moved to the nearest square edges, `from` before `to` (and a square apart unless `flat`). */
  private toSquareEdges(
    tab: Tab,
    axis: 'x' | 'y',
    from: number,
    to: number,
    flat: boolean,
  ): [number, number] {
    const square = this.paperSquare(tab) ?? 1;
    const origin = axis === 'x' ? this.core.metrics.headW(tab) : this.core.metrics.rowH(tab);
    const snap = (v: number): number => origin + Math.max(0, Math.round((v - origin) / square)) * square;
    const a = snap(from);
    const b = snap(to);
    return flat || b > a ? [a, b] : [a, a + square];
  }

  /** An object's top-left corner from the sheet's top-left corner, in pixels at 100%. */
  positionOf(tab: Tab, o: SheetObject): { x: number; y: number } {
    const box = this.boxOf(tab, o);
    const z = this.core.metrics.zoomOf(tab);
    return {
      x: Math.round((box.x - this.core.metrics.headW(tab)) / z),
      y: Math.round((box.y - this.core.metrics.rowH(tab)) / z),
    };
  }

  /** The object moved so its top-left corner is at (`x`, `y`) from the sheet's, in pixels at 100%. */
  movedTo(tab: Tab, o: SheetObject, x: number, y: number): SheetObject {
    const z = this.core.metrics.zoomOf(tab);
    return this.placeAt(tab, o, this.core.metrics.headW(tab) + x * z, this.core.metrics.rowH(tab) + y * z);
  }

  // ----- Pointer -----

  private pointerDown(event: PointerEvent): void {
    const node = this.objectFrom(event.target);
    const tab = this.core.state.activeTab;
    if (!node || !tab) {
      return;
    }
    event.stopPropagation();
    const id = node.dataset.objectId ?? '';
    const objects = this.objects(tab);
    const pressed = objects.find((o) => o.id === id);
    if (!pressed) {
      return;
    }
    const handle = (event.target as Element).closest<HTMLElement>('[data-handle]')?.dataset.handle ?? null;
    if (this.doublePress(event, id, handle !== null)) {
      return;
    }
    this.core.editing.commitEditor();
    const selected = this.core.state.objectSelection.selected(tab);
    const toggle = event.ctrlKey || event.metaKey || event.shiftKey;
    // A press picks the object's whole group; pressing a member of a picked group again picks it alone.
    const group = withGroups(objects, [id]);
    let next: string[];
    if (toggle) {
      next = selected.includes(id)
        ? selected.filter((s) => !group.includes(s))
        : [...selected, ...group.filter((g) => !selected.includes(g))];
    } else {
      next = selected.includes(id) ? [...selected] : group;
    }
    const pickMember =
      !toggle && selected.includes(id) && group.length > 1 && group.every((g) => selected.includes(g));
    this.core.state.objectSelection.select(tab, next);
    this.elementFor(id)?.focus({ preventScroll: true });
    if (event.button !== 0 || !next.includes(id)) {
      return;
    }
    const picked = new Set(next);
    const originals = handle ? [pressed] : objects.filter((o) => picked.has(o.id));
    this.drag = {
      mode: handle ? 'resize' : 'move',
      handle,
      id,
      originals,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      preview: null,
      bounds: handle ? null : unionBox(originals.map((o) => this.boxOf(tab, o))),
      others: objects.filter((o) => !o.hidden && !picked.has(o.id)).map((o) => this.boxOf(tab, o)),
      shift: { dx: 0, dy: 0 },
      pickMember,
      alt: event.altKey,
      shiftKey: event.shiftKey,
      lastX: event.clientX,
      lastY: event.clientY,
    };
    document.addEventListener('pointermove', this.onMove);
    document.addEventListener('pointerup', this.onUp);
    document.addEventListener('pointercancel', this.onCancel);
    document.addEventListener('keydown', this.onDragKey, true);
    document.addEventListener('keyup', this.onDragKey, true);
  }

  /** Alt pressed or let go mid-drag: snap (or stop) at once, keeping the key from the browser's menu. */
  private dragKey(event: KeyboardEvent): void {
    const drag = this.drag;
    if (!drag || (event.key !== 'Alt' && event.key !== 'Shift')) {
      return;
    }
    const down = event.type === 'keydown';
    if (event.key === 'Alt') {
      event.preventDefault();
      drag.alt = down;
    } else {
      drag.shiftKey = down;
    }
    if (drag.moved) {
      this.dragTo(drag.lastX, drag.lastY);
    }
  }

  private dragMove(event: PointerEvent): void {
    const drag = this.drag;
    const tab = this.core.state.activeTab;
    if (!drag || !tab) {
      return;
    }
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) {
      return;
    }
    if (!drag.moved && drag.originals.some(isPositionLocked)) {
      this.core.commands.notify(t(lockMessage(drag.originals)), 'warn');
      this.stopDrag();
      return;
    }
    drag.moved = true;
    drag.alt = event.altKey;
    drag.shiftKey = event.shiftKey;
    event.preventDefault();
    this.dragTo(event.clientX, event.clientY);
  }

  /** Show the drag with the pointer at (`x`, `y`) and the keys as `this.drag` holds them. */
  private dragTo(x: number, y: number): void {
    const drag = this.drag;
    const tab = this.core.state.activeTab;
    if (!drag || !tab) {
      return;
    }
    drag.lastX = x;
    drag.lastY = y;
    const dx = x - drag.startX;
    const dy = y - drag.startY;
    if (drag.mode === 'move') {
      if (drag.alt && !this.paperSquare(tab)) {
        // Alt: each moved object's corner lands on the nearest cell corner,
        // shown while dragging, exactly where the release will put it.
        drag.shift = { dx, dy };
        for (const o of drag.originals) {
          const node = this.elementFor(o.id);
          if (node) {
            const box = this.boxOf(tab, o);
            const to = this.boxOf(tab, this.placeAt(tab, o, box.x + dx, box.y + dy, true));
            node.style.translate = `${to.x - box.x}px ${to.y - box.y}px`;
          }
        }
        this.showGuides([]);
        return;
      }
      // On grid paper the moved objects step from square to square.
      const snap = drag.bounds
        ? this.paperSquare(tab)
          ? this.squareMove(tab, drag.bounds, dx, dy)
          : snapMove(drag.bounds, drag.others, dx, dy)
        : { dx, dy, guides: [] };
      drag.shift = { dx: snap.dx, dy: snap.dy };
      for (const o of drag.originals) {
        const node = this.elementFor(o.id);
        if (node) {
          node.style.translate = `${snap.dx}px ${snap.dy}px`;
        }
      }
      this.showGuides(snap.guides);
      return;
    }
    const o = drag.originals[0];
    drag.preview = this.resized(tab, o, drag.handle ?? 'se', dx, dy, drag.shiftKey, drag.alt);
    const node = this.elementFor(o.id);
    node?.replaceWith(this.objectElement(tab, drag.preview, true));
  }

  /**
   * `o` with `handle` dragged by (`dx`, `dy`) screen pixels. A picture
   * keeps its width-to-height ratio unless it may stretch or Shift is held.
   * With Alt held the edges being dragged land on the nearest cell edges.
   */
  private resized(
    tab: Tab,
    o: SheetObject,
    handle: string,
    dx: number,
    dy: number,
    shift = false,
    alt = false,
  ): SheetObject {
    const z = this.core.metrics.zoomOf(tab);
    const box = this.boxOf(tab, o);
    // Into the object's own (unrotated) frame.
    const r = (-(o.rotation ?? 0) * Math.PI) / 180;
    const ldx = dx * Math.cos(r) - dy * Math.sin(r);
    const ldy = dx * Math.sin(r) + dy * Math.cos(r);
    let left = box.x;
    let top = box.y;
    let right = box.x + box.w;
    let bottom = box.y + box.h;
    let flipH = o.flipH === true;
    let flipV = o.flipV === true;
    if (handle === 'start' || handle === 'end') {
      const ends = lineEnds(o, box.w, box.h);
      const start = { x: box.x + ends.x1, y: box.y + ends.y1 };
      const end = { x: box.x + ends.x2, y: box.y + ends.y2 };
      const point = handle === 'start' ? start : end;
      point.x += ldx;
      point.y += ldy;
      left = Math.min(start.x, end.x);
      right = Math.max(start.x, end.x);
      top = Math.min(start.y, end.y);
      bottom = Math.max(start.y, end.y);
      flipH = start.x > end.x;
      flipV = start.y > end.y;
    } else if (keepsAspect(o) && !shift && handle.length === 2 && box.w > 0 && box.h > 0) {
      // Scale about the opposite corner by the larger of the two stretches.
      const sx = (box.w + (handle.includes('w') ? -ldx : ldx)) / box.w;
      const sy = (box.h + (handle.includes('n') ? -ldy : ldy)) / box.h;
      const scale = Math.max(sx, sy, 1 / Math.min(box.w, box.h));
      const w = box.w * scale;
      const h = box.h * scale;
      if (handle.includes('w')) left = right - w;
      else right = left + w;
      if (handle.includes('n')) top = bottom - h;
      else bottom = top + h;
    } else {
      if (handle.includes('w')) left += ldx;
      if (handle.includes('e')) right += ldx;
      if (handle.includes('n')) top += ldy;
      if (handle.includes('s')) bottom += ldy;
      if (left > right) {
        [left, right] = [right, left];
        flipH = !flipH;
      }
      if (top > bottom) {
        [top, bottom] = [bottom, top];
        flipV = !flipV;
      }
    }
    if (this.paperSquare(tab)) {
      // On grid paper every edge lands on a square's edge, at least a square apart (a line may lie flat).
      [left, right] = this.toSquareEdges(tab, 'x', left, right, isLineKind(o.kind));
      [top, bottom] = this.toSquareEdges(tab, 'y', top, bottom, isLineKind(o.kind));
    } else if (alt) {
      [left, top, right, bottom] = this.toCellEdges(tab, handle, [left, top, right, bottom]);
    }
    const placed = this.placeAt(tab, o, left, top);
    const next: SheetObject = {
      ...placed,
      width: Math.round((right - left) / z),
      height: Math.round((bottom - top) / z),
    };
    delete next.flipH;
    delete next.flipV;
    // A line keeps its direction, a picture its mirroring; other shapes are symmetric.
    if (isLineKind(o.kind) || o.kind === 'image') {
      if (flipH) next.flipH = true;
      if (flipV) next.flipV = true;
    }
    return next;
  }

  private dragEnd(event: PointerEvent, cancelled: boolean): void {
    const drag = this.drag;
    const tab = this.core.state.activeTab;
    this.stopDrag();
    if (drag && tab && !drag.moved && !cancelled && drag.pickMember) {
      this.core.state.objectSelection.select(tab, [drag.id]);
    }
    if (!drag || !tab || !drag.moved || cancelled) {
      this.render(tab, true);
      return;
    }
    let done: boolean;
    // Alt as the release reports it, or as its own key press last said.
    const alt = (event.altKey || drag.alt) && !this.paperSquare(tab);
    if (alt) {
      swallowNextAltUp();
    }
    if (drag.mode === 'move') {
      const { dx, dy } = alt
        ? { dx: event.clientX - drag.startX, dy: event.clientY - drag.startY }
        : drag.shift;
      const moved = drag.originals.map((o) => {
        const box = this.boxOf(tab, o);
        return this.placeAt(tab, o, box.x + dx, box.y + dy, alt);
      });
      done = this.core.commands.updateObjects(tab, moved, 'history.moveObject');
    } else {
      done =
        drag.preview !== null &&
        this.core.commands.updateObjects(tab, [drag.preview], 'history.resizeObject');
    }
    if (!done) {
      this.render(tab, true);
    }
    // The resize preview replaced the focused element: the keys stay with the object.
    this.elementFor(drag.id)?.focus({ preventScroll: true });
  }

  /** Draw the guide lines of the current move (none: remove them). */
  private showGuides(guides: readonly GuideLine[]): void {
    for (const old of this.element.querySelectorAll('.sheet-object-guide')) {
      old.remove();
    }
    for (const g of guides) {
      const line = el('div', {
        className: `sheet-object-guide guide-${g.axis}`,
        attrs: { 'aria-hidden': 'true' },
      });
      line.style.left = `${g.axis === 'x' ? g.at : g.from}px`;
      line.style.top = `${g.axis === 'x' ? g.from : g.at}px`;
      line.style[g.axis === 'x' ? 'height' : 'width'] = `${g.to - g.from}px`;
      this.element.append(line);
    }
  }

  private stopDrag(): void {
    this.showGuides([]);
    this.drag = null;
    document.removeEventListener('pointermove', this.onMove);
    document.removeEventListener('pointerup', this.onUp);
    document.removeEventListener('pointercancel', this.onCancel);
    document.removeEventListener('keydown', this.onDragKey, true);
    document.removeEventListener('keyup', this.onDragKey, true);
  }

  /** Escape during a drag puts everything back. */
  cancelDrag(): boolean {
    if (!this.drag) {
      return false;
    }
    this.stopDrag();
    this.render(this.core.state.activeTab, true);
    return true;
  }

  // ----- Typing a shape's text on it -----

  /**
   * Whether this press on object `id` is the second of a double press (the
   * same object, soon after, in about the same place). A double press opens
   * the object's settings and, on a shape or text box whose text is not
   * locked, also starts typing its text on it — the settings panel beside
   * it does not take the keyboard. Either way it picks that one object, out
   * of its group too. Presses on a resize handle never count.
   */
  private doublePress(event: PointerEvent, id: string, onHandle: boolean): boolean {
    const last = this.lastPress;
    const now = event.timeStamp;
    this.lastPress = onHandle ? null : { id, at: now, x: event.clientX, y: event.clientY };
    const plain = event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;
    if (
      !plain ||
      !last ||
      last.id !== id ||
      now - last.at > DOUBLE_PRESS_MS ||
      Math.hypot(event.clientX - last.x, event.clientY - last.y) > DOUBLE_PRESS_SLOP_PX
    ) {
      return false;
    }
    this.lastPress = null;
    event.preventDefault();
    this.core.editing.commitEditor();
    const tab = this.core.state.activeTab;
    if (tab) {
      this.core.state.objectSelection.select(tab, [id]);
    }
    void this.core.commands.run('insert.objectList');
    this.editText(id);
    return true;
  }

  /** Start typing the text of object `id` on it; false when its text is not typed on it. */
  private editText(id: string): boolean {
    const tab = this.core.state.activeTab;
    const o = tab && this.objects(tab).find((item) => item.id === id);
    const node = this.elementFor(id);
    if (!tab || !o || !node || !INLINE_TEXT_KINDS.has(o.kind) || o.lockEdit || tab.readOnly) {
      return false;
    }
    this.editing = o.id;
    editObjectText(node, o, (text) => {
      this.editing = null;
      const current = this.objects(tab).find((item) => item.id === o.id);
      if (text !== null && current) {
        const next: SheetObject = { ...current, text };
        if (text === '') {
          delete next.text;
        }
        this.core.commands.updateObjects(tab, [next], 'history.editObject');
      }
      this.render(this.core.state.activeTab, true);
      this.elementFor(o.id)?.focus({ preventScroll: true });
    });
    return true;
  }

  // ----- Keyboard and context menu -----

  private keyDown(event: KeyboardEvent): void {
    const tab = this.core.state.activeTab;
    if (!tab || !this.objectFrom(event.target) || event.isComposing) {
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return; // application shortcuts (Undo, Redo, …) still apply
    }
    // Every other key stays with the objects (typing must not start a cell edit).
    event.stopPropagation();
    const selected = new Set(this.core.state.objectSelection.selected(tab));
    const picked = this.objects(tab).filter((o) => selected.has(o.id));
    const paper = this.core.metrics.paperOf(tab);
    const step = (paper ?? 1) * (event.shiftKey ? (paper ? 5 : 10) : 1);
    const arrows: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const arrow = arrows[event.key];
    if (arrow && picked.length > 0) {
      event.preventDefault();
      const moved = picked.map((o) => {
        const at = this.positionOf(tab, o);
        return this.movedTo(tab, o, Math.max(0, at.x + arrow[0]), Math.max(0, at.y + arrow[1]));
      });
      this.core.commands.updateObjects(tab, moved, 'history.moveObject');
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      void this.core.commands.run('object.delete');
    } else if (event.key === 'F2') {
      event.preventDefault();
      const node = this.objectFrom(event.target);
      if (node?.dataset.objectId) {
        this.editText(node.dataset.objectId);
      }
    } else if (event.key === 'Enter') {
      event.preventDefault();
      void this.core.commands.run('insert.objectList');
    } else if (event.key === 'Tab') {
      event.preventDefault();
      this.cycle(tab, event.shiftKey ? -1 : 1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.core.state.objectSelection.select(tab, []);
      this.core.editing.focusSinkSilently();
    }
  }

  /** Pick the next (or previous) shown object. */
  private cycle(tab: Tab, direction: 1 | -1): void {
    const shown = this.objects(tab).filter((o) => !o.hidden);
    if (shown.length === 0) {
      return;
    }
    const selected = this.core.state.objectSelection.selected(tab);
    const current = selected[selected.length - 1];
    const at = shown.findIndex((o) => o.id === current);
    const next = shown[(at + direction + shown.length) % shown.length];
    this.core.state.objectSelection.select(tab, [next.id]);
    this.elementFor(next.id)?.focus({ preventScroll: true });
  }

  private contextMenu(event: MouseEvent): void {
    if (!this.objectFrom(event.target) || !this.core.state.activeTab) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    openObjectMenu(this.core, event.clientX, event.clientY);
  }
}

function lockMessage(objects: readonly SheetObject[]): string {
  return objects.some((o) => o.lockEdit) ? 'object.locked.edit' : 'object.locked.position';
}

/** Whether resizing keeps the object's width-to-height ratio (a picture, unless it may stretch). */
function keepsAspect(o: SheetObject): boolean {
  return o.kind === 'image' && o.aspectFree !== true;
}
