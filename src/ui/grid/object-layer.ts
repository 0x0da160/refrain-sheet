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
import type { Tab } from '../../app/state';
import { t } from '../../app/i18n';
import { isWorkbook } from '../../core/editor-document';
import { isLineKind, isPositionLocked, type SheetObject } from '../../core/workbook/sheet-objects';
import { ContextMenu, type ContextMenuEntry } from '../context-menu';
import { clearChildren, el } from '../dom';
import { buildObjectElement, lineEnds, type ObjectBox } from '../sheet-object-view';
import type { GridCore } from './core';
import type { CommandId } from '../../app/commands';

/** Pointer travel (px) before a press on an object becomes a drag. */
const DRAG_THRESHOLD = 3;
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
}

export class ObjectLayer {
  readonly element: HTMLElement;
  /** Inputs of the last render; an equal set skips the rebuild (scrolling renders often). */
  private signature: unknown[] | null = null;
  private drag: ObjectDrag | null = null;
  /** The picked ids at the last render, to tell a new pick. */
  private lastPicks = '';
  private readonly onMove = (event: PointerEvent): void => this.dragMove(event);
  private readonly onUp = (event: PointerEvent): void => this.dragEnd(event, false);
  private readonly onCancel = (event: PointerEvent): void => this.dragEnd(event, true);

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
    this.element.addEventListener('dblclick', (event) => {
      if (this.objectFrom(event.target)) {
        event.stopPropagation();
        void this.core.commands.run('insert.objectList');
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
    const objects = this.objects(tab);
    const selected = this.core.state.objectSelection.selected(tab);
    const signature = [
      tab.doc,
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
    const image = o.image !== undefined && isWorkbook(tab.doc) ? tab.doc.images.get(o.image) : undefined;
    const node = buildObjectElement(o, box, this.core.metrics.zoomOf(tab), image);
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
    this.core.editing.commitEditor();
    const selected = this.core.state.objectSelection.selected(tab);
    const toggle = event.ctrlKey || event.metaKey || event.shiftKey;
    let next: string[];
    if (toggle) {
      next = selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id];
    } else {
      next = selected.includes(id) ? [...selected] : [id];
    }
    this.core.state.objectSelection.select(tab, next);
    this.elementFor(id)?.focus({ preventScroll: true });
    if (event.button !== 0 || !next.includes(id)) {
      return;
    }
    const handle = (event.target as Element).closest<HTMLElement>('[data-handle]')?.dataset.handle ?? null;
    const picked = new Set(next);
    this.drag = {
      mode: handle ? 'resize' : 'move',
      handle,
      id,
      originals: handle ? [pressed] : objects.filter((o) => picked.has(o.id)),
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      preview: null,
    };
    document.addEventListener('pointermove', this.onMove);
    document.addEventListener('pointerup', this.onUp);
    document.addEventListener('pointercancel', this.onCancel);
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
    event.preventDefault();
    if (drag.mode === 'move') {
      for (const o of drag.originals) {
        const node = this.elementFor(o.id);
        if (node) {
          node.style.translate = `${dx}px ${dy}px`;
        }
      }
      return;
    }
    const o = drag.originals[0];
    drag.preview = this.resized(tab, o, drag.handle ?? 'se', dx, dy, event.shiftKey);
    const node = this.elementFor(o.id);
    node?.replaceWith(this.objectElement(tab, drag.preview, true));
  }

  /**
   * `o` with `handle` dragged by (`dx`, `dy`) screen pixels. A picture
   * keeps its width-to-height ratio unless it may stretch or Shift is held.
   */
  private resized(
    tab: Tab,
    o: SheetObject,
    handle: string,
    dx: number,
    dy: number,
    shift = false,
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
    if (!drag || !tab || !drag.moved || cancelled) {
      this.render(tab, true);
      return;
    }
    let done: boolean;
    if (drag.mode === 'move') {
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      const moved = drag.originals.map((o) => {
        const box = this.boxOf(tab, o);
        return this.placeAt(tab, o, box.x + dx, box.y + dy, event.altKey);
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

  private stopDrag(): void {
    this.drag = null;
    document.removeEventListener('pointermove', this.onMove);
    document.removeEventListener('pointerup', this.onUp);
    document.removeEventListener('pointercancel', this.onCancel);
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
    const step = event.shiftKey ? 10 : 1;
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
    const node = this.objectFrom(event.target);
    const tab = this.core.state.activeTab;
    if (!node || !tab) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const item = (command: CommandId, labelKey: string): ContextMenuEntry => ({
      label: t(labelKey),
      disabled: !this.core.commands.isEnabled(command),
      onSelect: () => void this.core.commands.run(command),
    });
    this.core.pointer.closeContextMenu();
    this.core.contextMenu = ContextMenu.open(
      [
        item('object.bringToFront', 'menu.insert.bringToFront'),
        item('object.bringForward', 'menu.insert.bringForward'),
        item('object.sendBackward', 'menu.insert.sendBackward'),
        item('object.sendToBack', 'menu.insert.sendToBack'),
        'separator',
        item('object.delete', 'menu.insert.deleteObject'),
        'separator',
        item('insert.objectList', 'menu.insert.objectList'),
      ],
      event.clientX,
      event.clientY,
      { onClose: () => (this.core.contextMenu = null) },
    );
  }
}

function lockMessage(objects: readonly SheetObject[]): string {
  return objects.some((o) => o.lockEdit) ? 'object.locked.edit' : 'object.locked.position';
}

/** Whether resizing keeps the object's width-to-height ratio (a picture, unless it may stretch). */
function keepsAspect(o: SheetObject): boolean {
  return o.kind === 'image' && o.aspectFree !== true;
}
