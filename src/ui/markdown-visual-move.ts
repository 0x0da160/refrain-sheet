// SPDX-License-Identifier: MIT
/**
 * Moving a block of the formatted editor (`markdown-visual.ts`) by holding a
 * finger on it. A finger that rests on a block for `MOVE_HOLD_MS` lifts that
 * block: it follows the finger, the place it would land shows as a line, and it
 * lands where the finger lifts. Before the hold completes, a touch is a tap or a
 * scroll, and the browser handles it as it always has. A mouse or a pen moves a
 * block by its drag grip instead (`markdown-block-tools.ts`).
 */

/**
 * How long a finger must rest on a block before it moves the block (on touch).
 * Shorter than the browser's own long-press, which would start selecting text.
 */
const MOVE_HOLD_MS = 400;
/** How far a resting finger may drift before the touch reads as a scroll, not a move. */
const MOVE_SLOP_PX = 10;

/** What the hold needs from the editor whose blocks it moves. */
interface HoldHost {
  /** The rows of the editor's blocks, in order. */
  rows(): HTMLElement[];
  /** Whether the block at `index` can move: it has source lines, and the editor is not read-only. */
  canMove(index: number): boolean;
  /** Move block `dragged` to just before (`before`) or after block `index`; `focus` puts the caret in it. */
  moveNear(dragged: number, index: number, before: boolean, focus: boolean): void;
  /** Clear the moving block's class and the drop marks from every row. */
  endDrag(): void;
}

/** A finger resting on a row, which moves that row's block once held long enough. */
interface Hold {
  row: HTMLElement;
  pointerId: number;
  x: number;
  y: number;
  timer: ReturnType<typeof setTimeout>;
}

/** The hold-to-move gesture for the blocks of one editor (see the module comment). */
export class HoldToMove {
  private readonly host: HoldHost;
  /** A finger resting on a block, which moves that block once held long enough. */
  private hold: Hold | null = null;
  /** The block a held finger is moving (its row and the finger's pointer id), or null. */
  private moving: { row: HTMLElement; pointerId: number } | null = null;
  /** Set when the current press held long enough to move a block, so the click it would send is dropped. */
  private pressWasHold = false;

  constructor(host: HoldHost) {
    this.host = host;
  }

  /** Give the block whose row is `row` the gesture. */
  attach(row: HTMLElement): void {
    row.addEventListener('pointerdown', (event) => this.onPointerDown(row, event));
    row.addEventListener('pointermove', (event) => this.onPointerMove(event));
    row.addEventListener('pointerup', (event) => this.onPointerEnd(event));
    row.addEventListener('pointercancel', (event) => this.onPointerEnd(event));
    // While a block is being moved the page must not scroll under the finger; the click a held press
    // would send is dropped, so the block is not focused and the keyboard stays down.
    row.addEventListener(
      'touchmove',
      (event) => {
        if (this.moving) {
          event.preventDefault();
        }
      },
      { passive: false },
    );
    row.addEventListener(
      'touchend',
      (event) => {
        if (this.pressWasHold) {
          event.preventDefault();
        }
      },
      { passive: false },
    );
  }

  /** The index of the block whose row is `row`, or -1. */
  private rowIndex(row: HTMLElement): number {
    return this.host.rows().indexOf(row);
  }

  /**
   * A touch on a block that can move starts the hold. The block's own tools are
   * left alone, and a mouse or a pen never starts one.
   */
  private onPointerDown(row: HTMLElement, event: PointerEvent): void {
    this.pressWasHold = false;
    if (event.pointerType !== 'touch' || !this.host.canMove(this.rowIndex(row))) {
      return;
    }
    if (event.target instanceof Element && event.target.closest('.markdown-block-tools')) {
      return;
    }
    this.cancelHold();
    this.hold = {
      row,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      timer: setTimeout(() => this.beginMove(row, event.pointerId), MOVE_HOLD_MS),
    };
  }

  private onPointerMove(event: PointerEvent): void {
    if (this.moving?.pointerId === event.pointerId) {
      event.preventDefault();
      this.showDropTarget(event.clientY);
      return;
    }
    const hold = this.hold;
    if (
      hold?.pointerId === event.pointerId &&
      Math.hypot(event.clientX - hold.x, event.clientY - hold.y) > MOVE_SLOP_PX
    ) {
      // Real movement before the hold completes is a scroll, not a move.
      this.cancelHold();
    }
  }

  private onPointerEnd(event: PointerEvent): void {
    if (this.hold?.pointerId === event.pointerId) {
      this.cancelHold();
    }
    const moving = this.moving;
    if (!moving || moving.pointerId !== event.pointerId) {
      return;
    }
    const from = this.rowIndex(moving.row);
    const target = event.type === 'pointerup' ? this.dropAt(event.clientY) : null;
    this.endMove(moving);
    if (target && from >= 0) {
      // The moved block takes no caret, so the keyboard stays down.
      this.host.moveNear(from, target.index, target.before, false);
    }
  }

  /** Lift the block of `row` for a move: it follows the finger, and no text gets selected under it. */
  private beginMove(row: HTMLElement, pointerId: number): void {
    if (this.hold?.row !== row) {
      return;
    }
    this.hold = null;
    this.pressWasHold = true;
    this.moving = { row, pointerId };
    row.classList.add('dragging');
    if (typeof row.setPointerCapture === 'function') {
      row.setPointerCapture(pointerId);
    }
    document.getSelection()?.removeAllRanges();
    (document.activeElement as HTMLElement | null)?.blur();
  }

  /** Where a block moved to `clientY` would land: before the first block whose middle is below the finger, else after the last. */
  private dropAt(clientY: number): { index: number; before: boolean } | null {
    const rows = this.host.rows();
    for (let index = 0; index < rows.length; index++) {
      const rect = rows[index].getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) {
        return { index, before: true };
      }
    }
    return rows.length > 0 ? { index: rows.length - 1, before: false } : null;
  }

  private showDropTarget(clientY: number): void {
    const rows = this.host.rows();
    rows.forEach((row) => row.classList.remove('drop-before', 'drop-after'));
    const target = this.dropAt(clientY);
    if (target) {
      rows[target.index].classList.add(target.before ? 'drop-before' : 'drop-after');
    }
  }

  /** The moved block is put down: its classes go and the pointer is let go. */
  private endMove(moving: { row: HTMLElement; pointerId: number }): void {
    this.moving = null;
    this.host.endDrag();
    if (
      typeof moving.row.hasPointerCapture === 'function' &&
      moving.row.hasPointerCapture(moving.pointerId)
    ) {
      moving.row.releasePointerCapture(moving.pointerId);
    }
  }

  private cancelHold(): void {
    if (this.hold) {
      clearTimeout(this.hold.timer);
      this.hold = null;
    }
  }
}
