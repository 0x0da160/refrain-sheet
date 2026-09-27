// SPDX-License-Identifier: MIT
/**
 * Keyboard navigation and selection movement: arrow/page/data-edge moves
 * over visible rows, scrolling a cell into view (also above an on-screen
 * keyboard), and the grid's keydown handling.
 *
 * A collaborator of the grid (see `./core.ts`): it owns no state of its own
 * beyond what is declared here, and reaches shared grid state through
 * `this.core`.
 */
import { isWorkbook } from '../../core/editor-document';
import type { Tab } from '../../app/state';
import { centeredScrollOffset } from './center-scroll';
import { findDataEdge } from './data-edge';
import { pageStep } from './page-step';
import { beginsTextEntry, isComposingKey } from '../ime';
import type { GridCore } from './core';

/** The four arrow keys, for Ctrl+Arrow data-edge jumps. */
const ARROW_KEYS: ReadonlySet<string> = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export class Navigator {
  constructor(private readonly core: GridCore) {}

  // ----- Selection movement -----

  select(tab: Tab, row: number, col: number, scroll = false): void {
    this.core.editing.commitEditor();
    const clampedRow = Math.max(0, Math.min(tab.doc.rowCount - 1, row));
    const fieldCount = tab.doc.fieldCount(clampedRow);
    const clampedCol = Math.max(0, Math.min(Math.max(0, fieldCount - 1), col));
    // Re-selecting the cell that is already active happens as a side effect of
    // opening the editor on it (typing, F2, IME start) mid Tab-entry pass —
    // that must not clear the remembered start column. An actual jump to a
    // different cell (a click, double-click, or `reveal`) does.
    const sameCell = tab.selection?.row === clampedRow && tab.selection?.col === clampedCol;
    this.core.state.setSelection(tab, { row: clampedRow, col: clampedCol }, null, 'cell', sameCell);
    if (scroll) {
      this.scrollCellIntoView(tab, clampedRow, clampedCol);
    }
  }

  /** Select a cell and scroll it into view (used by find). */
  reveal(row: number, col: number): void {
    const tab = this.core.state.activeTab;
    if (!tab) {
      return;
    }
    this.select(tab, row, col, true);
  }

  /** The on-screen keyboard opened or closed — see `KeyboardViewport.openChanged`. */
  keyboardOpenChanged(open: boolean): void {
    this.core.keyboard.openChanged(open);
  }

  /** The visible area changed height while the keyboard is open (`onKeyboardResize`). */
  keyboardResized(): void {
    this.core.keyboard.resized();
  }

  /**
   * Register a field outside the grid that edits the selected cell (the
   * formula bar): when the on-screen keyboard opens for it, the selected cell
   * is centered in the shrunken grid just as for the in-cell editor.
   */
  addKeyboardEditField(field: Element): void {
    this.core.keyboard.addEditField(field);
  }

  /** Scroll the edited (or selected) cell to the vertical middle of the grid's scroll area. */
  centerKeyboardTarget(tab: Tab): void {
    const target = this.core.editor ?? tab.selection;
    if (!target) {
      return;
    }
    const slot = this.core.state.sortSlot(tab, target.row);
    if (slot >= this.core.metrics.scrollRowBase(tab)) {
      const idx = this.core.metrics.heightIndex(tab);
      const y = idx.offsetOf(slot) - idx.offsetOf(this.core.metrics.scrollRowBase(tab));
      // The scroll area is the grid minus the sticky header (and sticky
      // first row), i.e. exactly the band `scrollCellIntoView` keeps a cell in.
      const viewH = this.core.element.clientHeight - this.core.metrics.overlayHeight(tab);
      const maxScroll = this.core.element.scrollHeight - this.core.element.clientHeight;
      this.core.element.scrollTop = centeredScrollOffset(y, idx.heightOf(slot), viewH, maxScroll);
    }
    // Horizontal: just make sure the column is in view (renders either way).
    this.scrollCellIntoView(tab, target.row, target.col);
  }

  /** Rows one PageUp / PageDown moves: a screenful at the selected row's height. */
  private pageRows(tab: Tab): number {
    const slot = this.core.state.sortSlot(tab, tab.selection?.row ?? 0);
    const viewH = this.core.element.clientHeight - this.core.metrics.overlayHeight(tab);
    return pageStep(viewH, this.core.metrics.heightIndex(tab).heightOf(slot));
  }

  /** `renderIfUnmoved: false` skips the repaint when the cell was already in view. */
  scrollCellIntoView(tab: Tab, row: number, col: number, renderIfUnmoved = true): void {
    const scrollTop = this.core.element.scrollTop;
    const scrollLeft = this.core.element.scrollLeft;
    const idx = this.core.metrics.heightIndex(tab);
    const overlay = this.core.metrics.overlayHeight(tab);
    // The height index is keyed by display slot, not document row.
    const slot = this.core.state.sortSlot(tab, row);
    if (slot >= this.core.metrics.scrollRowBase(tab)) {
      const startRow = this.core.metrics.scrollRowBase(tab);
      const y = idx.offsetOf(slot) - idx.offsetOf(startRow);
      const rowH = idx.heightOf(slot);
      const viewH = this.core.element.clientHeight - overlay;
      if (y < this.core.element.scrollTop) {
        this.core.element.scrollTop = y;
      } else if (y + rowH > this.core.element.scrollTop + viewH) {
        this.core.element.scrollTop = y + rowH - viewH;
      }
    }
    const frozenCols = this.core.metrics.frozenColCount(tab);
    if (col >= frozenCols) {
      // Scrolled columns keep their natural x; the pinned columns cover the
      // first `frozenW` pixels of the band right of the row numbers.
      const frozenW = this.core.metrics.frozenColsWidth(tab);
      const x = this.core.metrics.colOffset(tab, col) - frozenW;
      const w = this.core.metrics.colWidth(tab, col);
      const viewW = this.core.element.clientWidth - this.core.metrics.overlayWidth(tab);
      if (x < this.core.element.scrollLeft) {
        this.core.element.scrollLeft = Math.max(0, x);
      } else if (x + w > this.core.element.scrollLeft + viewW) {
        this.core.element.scrollLeft = x + w - viewW;
      }
    }
    if (
      !renderIfUnmoved &&
      this.core.element.scrollTop === scrollTop &&
      this.core.element.scrollLeft === scrollLeft
    ) {
      return;
    }
    const current = this.core.state.activeTab;
    if (current) {
      this.core.renderer.render(current);
    }
  }

  /**
   * Step a document row by `delta` counting only visible *display slots*, so
   * keyboard navigation (arrows, PageUp/Down) walks the grid in the order
   * rows actually appear on screen — skipping rows hidden by an active
   * filter, and following an active sort's reordering — exactly like the
   * rows are stacked visually. Without a filter or sort this reduces to a
   * plain clamped addition (`from`'s slot equals `from` itself).
   */
  private stepVisibleRow(tab: Tab, from: number, delta: number): number {
    const hidden = this.core.metrics.hiddenOf(tab);
    const rowCount = tab.doc.rowCount;
    const sorted = isWorkbook(tab.doc) && tab.doc.sort !== null;
    if ((!hidden || hidden.size === 0) && !sorted) {
      return Math.max(0, Math.min(rowCount - 1, from + delta));
    }
    const dir = delta > 0 ? 1 : -1;
    let steps = Math.abs(delta);
    let slot = this.core.state.sortSlot(tab, from);
    while (steps > 0) {
      let next = slot + dir;
      while (next >= 0 && next < rowCount && hidden?.has(this.core.metrics.docRowOf(tab, next))) {
        next += dir;
      }
      if (next < 0 || next >= rowCount) {
        break; // no further visible row in this direction
      }
      slot = next;
      steps -= 1;
    }
    return this.core.metrics.docRowOf(tab, slot);
  }

  /**
   * Ctrl+Arrow: move (or, with Shift, extend) the selection to the edge of
   * the data in that direction (see `findDataEdge`). Vertical moves walk
   * visible rows in display order, so filtered-out rows are skipped and a
   * sorted view is followed as shown.
   */
  private jumpToDataEdge(tab: Tab, key: string, extend: boolean): void {
    const sel = tab.selection ?? this.core.clearedAt.get(tab) ?? { row: 0, col: 0 };
    const doc = tab.doc;
    let row = sel.row;
    let col = sel.col;
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      const last = doc.fieldCount(row) - 1;
      const step = key === 'ArrowRight' ? 1 : -1;
      col = findDataEdge(
        Math.max(0, Math.min(col, last)),
        (c) => (c + step >= 0 && c + step <= last ? c + step : null),
        (c) => doc.getValue(row, c) !== '',
      );
    } else {
      const delta = key === 'ArrowDown' ? 1 : -1;
      row = findDataEdge(
        row,
        (r) => {
          const next = this.stepVisibleRow(tab, r, delta);
          return next === r ? null : next;
        },
        (r) => col < doc.fieldCount(r) && doc.getValue(r, col) !== '',
      );
      col = Math.max(0, Math.min(col, doc.fieldCount(row) - 1));
    }
    this.core.editing.commitEditor();
    this.core.state.setSelection(tab, { row, col }, extend ? (tab.anchor ?? sel) : null, 'cell');
    this.scrollCellIntoView(tab, row, col);
    this.core.editing.focusGrid();
  }

  /**
   * `entryTracking` drives the Tab-then-Enter "return to start column"
   * convention (Excel/Sheets/Calc): `'tab'` remembers `tab.tabEntryCol` as the
   * column this call started from (only if a pass is not already in
   * progress); `'enter'` moves to that remembered column instead of `dCol`
   * when one is tracked. Both preserve the tracked column across the call.
   * The default, `'reset'`, is every other kind of move (arrows, PageUp/Down,
   * Home/End) and always clears it — those are exactly the moves that should
   * interrupt a Tab-entry pass.
   */
  moveSelection(
    tab: Tab,
    dRow: number,
    dCol: number,
    extend: boolean,
    entryTracking: 'tab' | 'enter' | 'reset' = 'reset',
  ): void {
    const sel = tab.selection ?? this.core.clearedAt.get(tab) ?? { row: 0, col: 0 };
    const row = dRow === 0 ? sel.row : this.stepVisibleRow(tab, sel.row, dRow);
    let col = entryTracking === 'enter' && tab.tabEntryCol !== null ? tab.tabEntryCol : sel.col + dCol;
    const fieldCount = tab.doc.fieldCount(row);
    if (col >= fieldCount) col = fieldCount - 1;
    if (col < 0) col = 0;
    this.core.editing.commitEditor();
    const preserveTabEntryCol = entryTracking !== 'reset';
    if (extend) {
      this.core.state.setSelection(tab, { row, col }, tab.anchor ?? sel, 'cell', preserveTabEntryCol);
    } else {
      this.core.state.setSelection(tab, { row, col }, null, 'cell', preserveTabEntryCol);
    }
    if (entryTracking === 'tab' && tab.tabEntryCol === null) {
      tab.tabEntryCol = sel.col;
    }
    this.scrollCellIntoView(tab, row, col);
    this.core.editing.focusGrid();
  }

  // ----- Keyboard -----

  onKeyDown(event: KeyboardEvent): void {
    const tab = this.core.state.activeTab;
    if (!tab || this.core.editor) {
      return;
    }
    const mod = event.ctrlKey || event.metaKey;
    // Ctrl/Cmd+Arrow jumps to the edge of the data (Shift extends the
    // selection there). Like Ctrl+Home / Ctrl+End it is grid navigation, so
    // it is handled here rather than in `app/shortcuts.ts`.
    if (mod && !event.altKey && ARROW_KEYS.has(event.key) && !isComposingKey(event, this.core.composing)) {
      event.preventDefault();
      this.jumpToDataEdge(tab, event.key, event.shiftKey);
      return;
    }
    // Every other Ctrl/Cmd combination is left to the application shortcut
    // layer (`app/shortcuts.ts`) except Ctrl+Home / Ctrl+End, which are grid
    // navigation (jump to A1 / the last used cell) and so belong here
    // alongside the other navigation keys below.
    if (event.altKey && !mod && event.key === 'ArrowDown' && this.openHeaderMenuFromKey(tab, event)) {
      return;
    }
    if (event.altKey || (mod && event.key !== 'Home' && event.key !== 'End')) {
      return;
    }
    // A composition keystroke never navigates, commits, or runs a shortcut.
    // The very first one (keyCode 229 / "Process", which can arrive before
    // compositionstart) still begins a typed edit so the composition lands in
    // the promoted cell editor — the initiating key is never consumed or
    // synthesized; the browser delivers it into the already-focused sink.
    if (isComposingKey(event, this.core.composing)) {
      if (tab.selection && beginsTextEntry(event)) {
        this.core.editing.openEditor(tab, tab.selection.row, tab.selection.col, '');
      }
      return;
    }
    const move = this.movementFor(tab, event.key, mod);
    if (move) {
      event.preventDefault();
      this.moveSelection(tab, move[0], move[1], event.shiftKey);
      return;
    }
    this.onEntryKey(tab, event);
  }

  /**
   * Alt+Down on a header-row filter cell opens its column menu, the keyboard
   * route to what the cell's button does. True when it did.
   */
  private openHeaderMenuFromKey(tab: Tab, event: KeyboardEvent): boolean {
    if (!tab.selection) {
      return false;
    }
    const { row, col } = tab.selection;
    if (!this.core.cells.isHeaderFilterCell(tab, row, col)) {
      return false;
    }
    event.preventDefault();
    this.core.cells.openColumnMenu(
      tab,
      col,
      this.core.pointer.cellAt(row, col)?.querySelector('.header-filter-button') ?? null,
    );
    return true;
  }

  /**
   * The [rows, columns] a navigation key moves the selection by, or null for
   * any other key. Ctrl/Cmd+Home jumps to A1 and Ctrl/Cmd+End to the last used
   * cell; plain Home / End only move to the first / last field of the row.
   */
  private movementFor(tab: Tab, key: string, mod: boolean): [number, number] | null {
    const far = Number.MAX_SAFE_INTEGER;
    switch (key) {
      case 'ArrowDown':
        return [1, 0];
      case 'ArrowUp':
        return [-1, 0];
      case 'ArrowLeft':
        return [0, -1];
      case 'ArrowRight':
        return [0, 1];
      case 'PageDown':
        return [this.pageRows(tab), 0];
      case 'PageUp':
        return [-this.pageRows(tab), 0];
      case 'Home':
        return [mod ? -far : 0, -far];
      case 'End':
        return [mod ? far : 0, far];
      default:
        return null;
    }
  }

  /** Enter / Tab / F2 / Escape / Delete, and typing that starts an edit. */
  private onEntryKey(tab: Tab, event: KeyboardEvent): void {
    switch (event.key) {
      case 'Enter':
        event.preventDefault();
        this.moveSelection(tab, event.shiftKey ? -1 : 1, 0, false, 'enter');
        return;
      case 'Tab': {
        // Tab / Shift+Tab move right / left within the row. At the row's
        // edge the key is left to the browser, so keyboard users can always
        // Tab out of the grid (no keyboard trap).
        const sel = tab.selection;
        if (!sel) return;
        const step = event.shiftKey ? -1 : 1;
        const target = sel.col + step;
        if (target < 0 || target >= tab.doc.fieldCount(sel.row)) return;
        event.preventDefault();
        this.moveSelection(tab, 0, step, false, 'tab');
        return;
      }
      case 'F2':
        event.preventDefault();
        if (tab.selection) this.core.editing.openEditor(tab, tab.selection.row, tab.selection.col, null);
        return;
      case 'Escape':
        this.onEscape(tab, event);
        return;
      case 'Delete':
      case 'Backspace':
        event.preventDefault();
        this.core.commands.clearRange(tab);
        return;
      default:
        // Typing starts a fresh edit — but IME-safely. We open an EMPTY editor
        // and focus it, then deliberately do NOT preventDefault and do NOT seed
        // the character ourselves: the browser routes this keystroke (and any
        // IME composition it begins) into the just-focused field, so Japanese
        // Romaji composes correctly from the very first key instead of leaking
        // a literal Latin character.
        if (tab.selection && beginsTextEntry(event)) {
          this.core.editing.openEditor(tab, tab.selection.row, tab.selection.col, '');
        }
    }
  }

  /**
   * Escape first dismisses whatever is in progress (a copy outline, a drag —
   * see the document-level listener); only when nothing is does it clear the
   * cell selection itself.
   */
  private onEscape(tab: Tab, event: KeyboardEvent): void {
    const core = this.core;
    if (
      !tab.selection ||
      core.copySource ||
      core.movingRange ||
      core.filling ||
      core.resizing ||
      core.dragging
    ) {
      return;
    }
    event.preventDefault();
    core.clearedAt.set(tab, tab.selection);
    core.state.setSelection(tab, null, null);
  }
}
