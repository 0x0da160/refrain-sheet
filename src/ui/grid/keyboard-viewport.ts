// SPDX-License-Identifier: MIT
/**
 * Keeps the edited cell visible while an on-screen keyboard is open, and puts
 * the grid's scroll position back when it closes (see `src/ui/popup.ts` for
 * how keyboard open/resize is detected).
 */

/**
 * How long after an on-screen keyboard opens a further shrink of the visible
 * area still re-centers the edited cell (the keyboard sliding in).
 */
const KEYBOARD_SETTLE_MS = 1000;

/** What the keyboard viewport needs from the grid that owns it. */
export interface KeyboardViewportHost {
  /** The grid's scroll container. */
  readonly element: HTMLElement;
  /** The grid's current keyboard target (the in-cell editor when editing). */
  sink(): HTMLTextAreaElement;
  /** Whether the grid is showing the active tab's document (nothing to do otherwise). */
  showingActiveDocument(): boolean;
  /** Re-render after the scroll position was restored. */
  render(): void;
  /** Scroll the edited (or selected) cell to the vertical middle of the scroll area. */
  centerTarget(): void;
}

export class KeyboardViewport {
  /**
   * The grid's scroll position just before an on-screen keyboard opened, put
   * back when it closes (see `openChanged`). `null` when the keyboard is
   * closed or its opening did not move the grid.
   */
  private savedScroll: { top: number; left: number } | null = null;
  /**
   * Until this time (`Date.now()`), a change in the visible area's height
   * re-centers the edited cell: the keyboard can still be sliding in after
   * the first open notification. 0 when not settling.
   */
  private settleUntil = 0;
  /**
   * Fields outside the grid that edit the selected cell (the formula bar), so
   * the keyboard opening for one of them centers that cell too
   * (`addEditField`).
   */
  private readonly editFields = new Set<Element>();

  constructor(private readonly host: KeyboardViewportHost) {}

  /**
   * The on-screen keyboard opened or closed (`onKeyboardOpenChange`, fired
   * after `#app` has been refitted to the visible area). On open, when the
   * grid or a registered edit field (the formula bar, see `addEditField`)
   * holds focus, the cell being edited — or the selected cell, for
   * type-to-edit — is scrolled to the vertical middle of the grid's now
   * shorter scroll area, and the scroll position from before editing started
   * is remembered. For a short while after, any further shrink of the
   * visible area (the keyboard still sliding in) re-centers it again
   * (`resized`). On close, the remembered position is put back.
   */
  openChanged(open: boolean): void {
    const element = this.host.element;
    if (!this.host.showingActiveDocument()) {
      this.savedScroll = null;
      this.settleUntil = 0;
      return;
    }
    if (!open) {
      this.settleUntil = 0;
      const saved = this.savedScroll;
      this.savedScroll = null;
      if (saved) {
        element.scrollTop = saved.top;
        element.scrollLeft = saved.left;
        this.host.render();
      }
      return;
    }
    if (!this.editsCell()) {
      this.savedScroll = null;
      return;
    }
    this.savedScroll ??= { top: element.scrollTop, left: element.scrollLeft };
    this.settleUntil = Date.now() + KEYBOARD_SETTLE_MS;
    this.host.centerTarget();
  }

  /** The visible area changed height while the keyboard is open (`onKeyboardResize`). */
  resized(): void {
    if (Date.now() > this.settleUntil) {
      return;
    }
    if (this.host.showingActiveDocument() && this.editsCell()) {
      this.host.centerTarget();
    }
  }

  /**
   * Register a field outside the grid that edits the selected cell (the
   * formula bar): when the on-screen keyboard opens for it, the selected cell
   * is centered in the shrunken grid just as for the in-cell editor.
   */
  addEditField(field: Element): void {
    this.editFields.add(field);
  }

  /**
   * A touch edit-entry gesture is about to bring up the on-screen keyboard:
   * remember where the grid is before selecting the cell scrolls it, to be
   * restored when the keyboard closes.
   */
  rememberScroll(): void {
    this.savedScroll = { top: this.host.element.scrollTop, left: this.host.element.scrollLeft };
  }

  /** The editor closed without a keyboard ever opening: nothing to restore later. */
  forgetScroll(): void {
    this.savedScroll = null;
  }

  /** Whether focus is on the in-cell editor or a registered edit field. */
  private editsCell(): boolean {
    const active = this.host.element.ownerDocument.activeElement;
    if (!active) {
      return false;
    }
    if (active === this.host.sink()) {
      return true;
    }
    for (const field of this.editFields) {
      if (field.contains(active)) {
        return true;
      }
    }
    return false;
  }
}
