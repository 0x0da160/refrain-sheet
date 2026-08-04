// SPDX-License-Identifier: MIT
import { normalizeRange, type CellRange } from '../core/clipboard';
import { checkValidationValue, findValidation, type CellValidation } from '../core/data-validation';
import { filtersEqual, type SheetFilter } from '../core/filter';
import { cellLabel } from '../core/formula';
import {
  History,
  type CellChange,
  type HistoryEntry,
  type Operation,
  type SheetOperation,
} from '../core/history';
import type { LosslessDocument } from '../core/lossless-document';
import { RsfDocument } from '../core/rsf-document';
import { sortDataTop, type SheetSort } from '../core/sort';
import type { Worksheet } from '../core/worksheet';
import { t } from './i18n';
import { clampSheetZoom, getSheetZoom, getWrapCells } from './settings';
import { safeStorageGet } from './storage';
import { StructuralOpsState } from './state/structural-ops';
import { WorksheetsState } from './state/worksheets';

/**
 * The localized name of a workbook's first worksheet (`Sheet1` / `シート1`).
 * The core layer defaults to the English name because it must stay free of
 * i18n; every workbook created through the application passes this instead.
 */
export function defaultSheetName(): string {
  return t('sheet.defaultName', { n: 1 });
}

/** Either document kind; the shared surface is duck-typed across both. */
export type EditorDocument = LosslessDocument | RsfDocument;

export interface Selection {
  row: number;
  col: number;
}

/**
 * How the current selection was made, so the grid can render it distinctly:
 * a cell/range selection, a whole-row selection (from row headers), or a
 * whole-column selection (from column headers). It does not change the
 * selected rectangle — copy/paste/fill/statistics all use `selectedRange`.
 */
export type SelectionKind = 'cell' | 'row' | 'col';

/**
 * A formula editor (the formula bar) that can receive cell/range references
 * from the grid by pointer. While `isCapturing()` is true, clicking or
 * dragging cells in the grid inserts a reference at the caret instead of
 * moving the selection. `beginRef` marks the insertion point, `setRef`
 * replaces the pending reference text (so a drag keeps rewriting one span),
 * and `endRef` finalizes it.
 */
export interface FormulaRefTarget {
  isCapturing(): boolean;
  beginRef(): void;
  setRef(text: string): void;
  endRef(): void;
}

export interface Tab {
  id: string;
  name: string;
  doc: EditorDocument;
  history: History;
  handle: FileSystemFileHandle | null;
  /** Active cell. */
  selection: Selection | null;
  /** Selection anchor for rectangular ranges (null: single-cell selection). */
  anchor: Selection | null;
  /** How the selection was made (drives distinct rendering). */
  selectionKind: SelectionKind;
  /** The "must be saved as .rsf" explanation was already shown for this tab. */
  rsfSaveExplained: boolean;
  /**
   * Per-column pixel widths for this open document during the session,
   * expressed at 100% zoom. A missing or zero entry means the default width.
   * Stored on the tab so resizing a plain CSV never mutates its bytes; RSF
   * documents persist these in their container on save.
   */
  colWidths: number[];
  /**
   * Spreadsheet zoom percent for this tab. Initialized from the RSF
   * document's stored zoom when present (document wins), otherwise from the
   * application-level preference. Zooming never mutates document content and
   * never marks a document dirty; for RSF documents the current zoom is
   * recorded into the container on the next save.
   */
  zoom: number;
  /**
   * Whether long cells wrap onto several visual lines in this tab. Follows the
   * same precedence as zoom: an RSF worksheet's stored value wins, otherwise
   * the application-level preference applies, and each worksheet of a workbook
   * remembers its own. Purely visual — for a plain CSV it is local application
   * state that never touches the file's bytes.
   */
  wrapCells: boolean;
}

/**
 * State change kinds. `sheets` covers the *worksheets inside* the active RSF
 * workbook (added, renamed, reordered, or switched) and is deliberately
 * distinct from `tabs`, which covers the open documents in the application tab
 * strip — the two strips are independent surfaces.
 */
export type StateEventType = 'tabs' | 'active' | 'doc' | 'selection' | 'view' | 'sheets';

export const STICKY_KEY = 'refrain-csv-html.stickyFirstRow';
export const STICKY_COL_KEY = 'refrain-csv-html.stickyFirstColumn';

let nextTabId = 1;

/**
 * Application state: open tabs, the active tab, selections, and the
 * undo/redo integration. All mutations go through this class so every UI
 * surface (menus, shortcuts, drag-and-drop) observes the same state.
 */
export class AppState {
  tabs: Tab[] = [];
  activeTabId: string | null = null;
  /**
   * Announce a non-blocking, already-localized status message (wired to the
   * toast surface, which is a polite live region). Used for changes the
   * application makes on the user's behalf — such as turning wrapping on
   * because a cell now contains a line break — so they are never silent and
   * never block editing. Null outside the browser (unit tests).
   */
  announce: ((message: string) => void) | null = null;
  /** Keep the first record row pinned below the header while scrolling. */
  stickyFirstRow: boolean;
  /** Keep the first data column pinned beside the row headers while scrolling. */
  stickyFirstColumn: boolean;
  /** The formula editor currently able to accept pointer-entered references. */
  formulaRefTarget: FormulaRefTarget | null = null;

  private listeners = new Set<(event: StateEventType) => void>();

  /** Row/column insert-delete, RSF conversion, save-baseline, wrap/zoom/sticky-row — see `StructuralOpsState`. */
  private readonly structuralOps: StructuralOpsState;

  /** Filtering and worksheet lifecycle operations — see `WorksheetsState`. */
  private readonly worksheetsState: WorksheetsState;

  constructor() {
    this.stickyFirstRow = safeStorageGet(STICKY_KEY) === '1';
    this.stickyFirstColumn = safeStorageGet(STICKY_COL_KEY) === '1';
    this.structuralOps = new StructuralOpsState(this);
    this.worksheetsState = new WorksheetsState(this);
  }

  subscribe(fn: (event: StateEventType) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(event: StateEventType): void {
    for (const fn of this.listeners) {
      fn(event);
    }
  }

  get activeTab(): Tab | null {
    return this.tabs.find((t) => t.id === this.activeTabId) ?? null;
  }

  addTab(name: string, doc: EditorDocument, handle: FileSystemFileHandle | null): Tab {
    // Display precedence: an RSF document's stored settings win; anything the
    // document does not carry falls back to the application-level preference.
    const stored = doc.kind === 'rsf' ? doc : null;
    const tab: Tab = {
      id: `tab-${nextTabId++}`,
      name,
      doc,
      history: new History(),
      handle,
      selection: doc.rowCount > 0 ? { row: 0, col: 0 } : null,
      anchor: null,
      selectionKind: 'cell',
      rsfSaveExplained: false,
      colWidths: stored ? stored.displayColWidths.slice() : [],
      zoom: clampSheetZoom(stored?.displayZoom ?? getSheetZoom()),
      wrapCells: stored?.displayWrap ?? getWrapCells(),
    };
    this.tabs.push(tab);
    this.activeTabId = tab.id;
    this.emit('tabs');
    return tab;
  }

  closeTab(id: string): void {
    const index = this.tabs.findIndex((t) => t.id === id);
    if (index < 0) {
      return;
    }
    this.tabs.splice(index, 1);
    if (this.activeTabId === id) {
      const next = this.tabs[Math.min(index, this.tabs.length - 1)];
      this.activeTabId = next ? next.id : null;
    }
    this.emit('tabs');
  }

  activateTab(id: string): void {
    if (this.activeTabId === id || !this.tabs.some((t) => t.id === id)) {
      return;
    }
    this.activeTabId = id;
    this.emit('active');
  }

  /** 0-based position of a tab in the strip, or -1. */
  tabIndex(id: string): number {
    return this.tabs.findIndex((t) => t.id === id);
  }

  /**
   * Move a tab to a new position in the strip. Only the array order changes:
   * the tab object (document, history, selection, handle, dirty state) is
   * untouched and the active tab stays active. Tab order is session-only and
   * never persisted.
   */
  moveTab(id: string, toIndex: number): boolean {
    const from = this.tabIndex(id);
    if (from < 0) {
      return false;
    }
    const to = Math.max(0, Math.min(this.tabs.length - 1, toIndex));
    if (from === to) {
      return false;
    }
    const [tab] = this.tabs.splice(from, 1);
    this.tabs.splice(to, 0, tab);
    this.emit('tabs');
    return true;
  }

  cycleTab(offset: number): void {
    if (this.tabs.length < 2 || this.activeTabId === null) {
      return;
    }
    const index = this.tabs.findIndex((t) => t.id === this.activeTabId);
    const next = this.tabs[(index + offset + this.tabs.length) % this.tabs.length];
    this.activateTab(next.id);
  }

  /**
   * Best-effort match for "the same file is already open": same name and
   * byte-identical original content. Strict file identity is not always
   * detectable through browser file APIs (see README). Only CSV documents
   * keep original bytes to compare.
   */
  findTabForFile(name: string, bytes: Uint8Array): Tab | null {
    for (const tab of this.tabs) {
      if (tab.name !== name || tab.doc.kind !== 'csv' || tab.doc.bytes.length !== bytes.length) {
        continue;
      }
      let same = true;
      for (let i = 0; i < bytes.length; i++) {
        if (tab.doc.bytes[i] !== bytes[i]) {
          same = false;
          break;
        }
      }
      if (same) {
        return tab;
      }
    }
    return null;
  }

  /**
   * Set the active cell. `anchor` extends/keeps a rectangular selection:
   * null collapses the range to the active cell. `kind` records whether the
   * selection is a cell/range, a whole-row, or a whole-column selection (for
   * rendering only); it defaults to a cell/range selection.
   */
  setSelection(
    tab: Tab,
    selection: Selection | null,
    anchor: Selection | null = null,
    kind: SelectionKind = 'cell',
  ): void {
    tab.selection = selection;
    tab.anchor = selection ? anchor : null;
    tab.selectionKind = selection ? kind : 'cell';
    this.emit('selection');
  }

  /** The selected rectangle (1x1 when no anchor is set), or null. */
  selectedRange(tab: Tab): CellRange | null {
    if (!tab.selection) {
      return null;
    }
    return normalizeRange(tab.anchor ?? tab.selection, tab.selection);
  }

  /** Clamp the selection into the document bounds (after structural changes). */
  clampSelection(tab: Tab): void {
    if (!tab.selection) {
      return;
    }
    const rows = tab.doc.rowCount;
    if (rows === 0) {
      tab.selection = null;
      tab.anchor = null;
      return;
    }
    const clamp = (sel: Selection): Selection => {
      const row = Math.max(0, Math.min(rows - 1, sel.row));
      const cols = tab.doc.fieldCount(row);
      return { row, col: Math.max(0, Math.min(Math.max(0, cols - 1), sel.col)) };
    };
    tab.selection = clamp(tab.selection);
    tab.anchor = tab.anchor ? clamp(tab.anchor) : null;
  }

  /**
   * The dynamic-array spill anchor a write would land inside, or null when the
   * cells are free to write.
   *
   * Derived spill cells are not independent values — they are one formula's
   * output — so writing into one would be silently undone by the next
   * recalculation. Every user-initiated write path consults this and refuses,
   * pointing the user at the anchor instead. Undo and redo deliberately do
   * **not**: they restore inputs, and a derived cell's input is always empty.
   */
  spillBlocked(
    tab: Tab,
    cells: ReadonlyArray<{ row: number; col: number }>,
  ): { row: number; col: number } | null {
    const doc = tab.doc;
    if (doc.kind !== 'rsf' || cells.length === 0 || !doc.hasSpills()) {
      return null;
    }
    const sheetId = doc.activeSheetId;
    for (const cell of cells) {
      if (doc.isSpillDerivedCell(sheetId, cell.row, cell.col)) {
        const anchor = doc.spillAnchorAt(sheetId, cell.row, cell.col);
        return anchor ? { row: anchor.row, col: anchor.col } : { row: cell.row, col: cell.col };
      }
    }
    return null;
  }

  /**
   * Refuse a write that would land in a spill range, announcing why.
   * Returns true when the caller must stop.
   */
  private refuseSpillWrite(tab: Tab, cells: ReadonlyArray<{ row: number; col: number }>): boolean {
    const anchor = this.spillBlocked(tab, cells);
    if (!anchor) {
      return false;
    }
    this.announce?.(t('notify.spillProtected', { cell: cellLabel(anchor.row, anchor.col) }));
    return true;
  }

  /**
   * Refuse a write that would land inside an active sort's range, announcing
   * why. Editing a sorted range is disabled — rather than translated cell by
   * cell — so a sort can never turn "edit what I see" into a silent write to
   * an unrelated document row; clearing the sort (Sheet ▸ Clear Sort) always
   * re-enables editing. Returns true when the caller must stop.
   */
  private refuseSortedWrite(tab: Tab, cells: ReadonlyArray<{ row: number; col: number }>): boolean {
    const doc = tab.doc;
    if (doc.kind !== 'rsf' || doc.sort === null) {
      return false;
    }
    const sort = doc.sort;
    const dataTop = sortDataTop(sort);
    if (!cells.some((cell) => cell.row >= dataTop && cell.row <= sort.bottom)) {
      return false;
    }
    this.announce?.(t('notify.sortedRangeReadOnly'));
    return true;
  }

  /**
   * Refuse a write whose new value violates the data-validation rule covering
   * that cell, announcing why. Blank values always pass (clearing a cell is
   * never itself invalid), and only RSF documents carry rules. Returns true
   * when the caller must stop.
   */
  private refuseInvalidWrite(
    tab: Tab,
    changes: ReadonlyArray<{ row: number; col: number; after: string | null }>,
  ): boolean {
    const doc = tab.doc;
    if (doc.kind !== 'rsf' || doc.validations.length === 0) {
      return false;
    }
    for (const change of changes) {
      const rule = findValidation(doc.validations, change.row, change.col);
      if (rule && !checkValidationValue(rule.rule, change.after ?? '')) {
        this.announce?.(t('notify.invalidValue', { cell: cellLabel(change.row, change.col) }));
        return true;
      }
    }
    return false;
  }

  /** Set one cell's value as a single undoable operation. */
  editCell(tab: Tab, row: number, col: number, value: string, label = 'history.editCell'): boolean {
    if (tab.doc.kind === 'csv') {
      const field = tab.doc.getField(row, col);
      if (!field) {
        return false;
      }
      const before = tab.doc.isEdited(row, col) ? tab.doc.getValue(row, col) : null;
      const after = value === field.value ? null : value;
      if (before === after) {
        return false;
      }
      const changes = [{ row, col, before, after }];
      this.applyChange(tab, changes[0], 'after');
      // A committed line break turns wrapping on, in the same history entry.
      const ops: Operation[] = [{ type: 'cells', changes }];
      this.structuralOps.appendAutoWrap(tab, changes, ops);
      tab.history.push({ label, ops });
      this.emit('doc');
      return true;
    }
    if (row < 0 || row >= tab.doc.rowCount || col < 0 || col >= tab.doc.columnCount) {
      return false;
    }
    const before = tab.doc.getValue(row, col);
    if (before === value) {
      return false;
    }
    if (
      this.refuseSpillWrite(tab, [{ row, col }]) ||
      this.refuseSortedWrite(tab, [{ row, col }]) ||
      this.refuseInvalidWrite(tab, [{ row, col, after: value }])
    ) {
      return false;
    }
    const sheetId = tab.doc.activeSheetId;
    const changes = [{ row, col, before, after: value }];
    this.applyChange(tab, changes[0], 'after', sheetId);
    const ops: Operation[] = [{ type: 'cells', changes, sheetId }];
    this.structuralOps.appendAutoWrap(tab, changes, ops, sheetId);
    tab.history.push({ label, ops, sheetId });
    this.emit('doc');
    return true;
  }

  /** Apply several cell changes as one atomic, singly-undoable operation. */
  bulkEdit(tab: Tab, changes: CellChange[], label: string): boolean {
    const effective = changes.filter((c) => c.before !== c.after);
    if (effective.length === 0) {
      return false;
    }
    if (
      this.refuseSpillWrite(tab, effective) ||
      this.refuseSortedWrite(tab, effective) ||
      this.refuseInvalidWrite(tab, effective)
    ) {
      return false;
    }
    const sheetId = tab.doc.kind === 'rsf' ? tab.doc.activeSheetId : undefined;
    for (const change of effective) {
      this.applyChange(tab, change, 'after', sheetId);
    }
    const ops: Operation[] = [{ type: 'cells', changes: effective, ...(sheetId ? { sheetId } : {}) }];
    this.structuralOps.appendAutoWrap(tab, effective, ops, sheetId);
    tab.history.push({ label, ops, ...(sheetId ? { sheetId } : {}) });
    this.emit('doc');
    return true;
  }

  /** Push and apply a prebuilt multi-op entry atomically. */
  pushEntry(tab: Tab, entry: HistoryEntry): boolean {
    const nonEmpty = entry.ops.some((op) => {
      if (op.type === 'cells' || op.type === 'styles') {
        return op.changes.length > 0;
      }
      if (op.type === 'filter') {
        return !filtersEqual(op.before, op.after);
      }
      if (op.type === 'wrap') {
        return op.before !== op.after;
      }
      if (op.type === 'sheets') {
        return true;
      }
      return op.count > 0;
    });
    if (!nonEmpty) {
      return false;
    }
    // Structural operations (row/column insert and delete) move a spill's
    // anchor rather than writing into it, so only the cell writes are checked.
    for (const op of entry.ops) {
      if (
        op.type === 'cells' &&
        (this.refuseSpillWrite(tab, op.changes) ||
          this.refuseSortedWrite(tab, op.changes) ||
          this.refuseInvalidWrite(tab, op.changes))
      ) {
        return false;
      }
    }
    // Applied before the entry is recorded so the automatic wrap enable — which
    // is decided from the *committed* values — can join the same entry and
    // therefore undo together with the edit that caused it.
    this.applyEntry(tab, entry, 'after');
    for (const op of entry.ops) {
      if (op.type === 'cells' && op.changes.length > 0) {
        this.structuralOps.appendAutoWrap(tab, op.changes, entry.ops, op.sheetId);
        break;
      }
    }
    tab.history.push(entry);
    this.clampSelection(tab);
    this.emit('doc');
    return true;
  }

  revertCell(tab: Tab, row: number, col: number): boolean {
    if (tab.doc.kind !== 'csv' || !tab.doc.isEdited(row, col)) {
      return false;
    }
    return this.editCell(tab, row, col, tab.doc.getOriginalValue(row, col), 'history.revertCell');
  }

  revertAll(tab: Tab): boolean {
    if (tab.doc.kind !== 'csv') {
      return false;
    }
    const changes: CellChange[] = tab.doc
      .listEdits()
      .map(({ row, col, value }) => ({ row, col, before: value, after: null }));
    return this.bulkEdit(tab, changes, 'history.revertAll');
  }

  undo(tab: Tab): HistoryEntry | null {
    const entry = tab.history.undo();
    if (!entry) {
      return null;
    }
    this.applyEntry(tab, entry, 'before');
    this.clampSelection(tab);
    this.emit('doc');
    return entry;
  }

  redo(tab: Tab): HistoryEntry | null {
    const entry = tab.history.redo();
    if (!entry) {
      return null;
    }
    this.applyEntry(tab, entry, 'after');
    this.clampSelection(tab);
    this.emit('doc');
    return entry;
  }

  // ----- Structural operations (RSF spreadsheet documents only) -----
  //
  // These are thin delegating wrappers over `StructuralOpsState` — see
  // `src/app/state/structural-ops.ts` for the implementations.

  /**
   * Insert empty rows. Formula references in the whole sheet are adjusted
   * consistently; the structural change plus every formula rewrite form one
   * atomic history entry.
   */
  insertRows(tab: Tab, index: number, count: number): boolean {
    return this.structuralOps.insertRows(tab, index, count);
  }

  /** Delete rows (never all of them). Referencing formulas get #REF! or clamped ranges. */
  deleteRows(tab: Tab, index: number, count: number): boolean {
    return this.structuralOps.deleteRows(tab, index, count);
  }

  insertCols(tab: Tab, index: number, count: number): boolean {
    return this.structuralOps.insertCols(tab, index, count);
  }

  deleteCols(tab: Tab, index: number, count: number): boolean {
    return this.structuralOps.deleteCols(tab, index, count);
  }

  /**
   * Insert a copied rectangular range at `at`, shifting existing cells by
   * inserting whole rows (`down`) or whole columns (`right`) across the sheet.
   * Whole-axis insertion keeps every formula consistent: references are
   * adjusted by the same rules as Insert Rows/Columns, and relative references
   * in the inserted formulas shift by the offset from the copy origin (like a
   * paste). The structural insertion, all formula rewrites, and the inserted
   * values form one atomic, singly-undoable history entry.
   */
  insertCopiedCells(
    tab: Tab,
    at: Selection,
    matrix: string[][],
    direction: 'down' | 'right',
    origin: Selection | null,
  ): boolean {
    return this.structuralOps.insertCopiedCells(tab, at, matrix, direction, origin);
  }

  /** True when any cell in the given rows (or columns) is non-empty. */
  hasContent(tab: Tab, axis: 'row' | 'col', index: number, count: number): boolean {
    return this.structuralOps.hasContent(tab, axis, index, count);
  }

  /**
   * Convert a CSV tab to an RSF spreadsheet document (explicit, user
   * confirmed). The tab is renamed to `.rsf`, detached from the original
   * file handle so the `.csv` can never be silently overwritten, and the
   * undo history is cleared (the conversion itself is not undoable; the
   * original file on disk stays untouched).
   */
  convertToRsf(tab: Tab, prebuilt?: RsfDocument): RsfDocument | null {
    return this.structuralOps.convertToRsf(tab, prebuilt);
  }

  /**
   * Explicit `Convert to RSF…`: build a new RSF spreadsheet from a CSV tab's
   * current (edited) values and open it in a new active tab. The source CSV
   * tab, its unsaved edits, its file handle, and the file on disk are all left
   * untouched — this never converts in place. The new document is marked
   * unsaved (it exists only in memory until saved). Returns the new document,
   * or null when the tab is not a CSV.
   */
  convertToRsfNewTab(tab: Tab, prebuilt?: RsfDocument): RsfDocument | null {
    return this.structuralOps.convertToRsfNewTab(tab, prebuilt);
  }

  /**
   * After a successful save, the saved byte sequence becomes the new
   * baseline document and the history is cleared.
   */
  setBaseline(tab: Tab, doc: EditorDocument): void {
    this.structuralOps.setBaseline(tab, doc);
  }

  /** Mark an RSF tab saved (its in-memory document is the baseline). */
  markTabSaved(tab: Tab): void {
    this.structuralOps.markTabSaved(tab);
  }

  /**
   * Whether the active tab wraps long cells. Falls back to the
   * application-level preference when nothing is open, so menus and the grid
   * always have an answer.
   */
  get wrapCells(): boolean {
    return this.activeTab?.wrapCells ?? getWrapCells();
  }

  /**
   * Turn wrapping on/off for the active tab. Purely visual: it never changes
   * document content, CSV bytes, or the dirty state. The choice also becomes
   * the application-level preference (used by documents that store none), and
   * an RSF worksheet remembers it for persistence with the next save.
   */
  setWrapCells(wrap: boolean): void {
    this.structuralOps.setWrapCells(wrap);
  }

  /**
   * Set the active tab's spreadsheet zoom (clamped percent). Purely visual:
   * it never changes document content, CSV bytes, or the dirty state. The
   * chosen zoom also becomes the application-level preference (used by tabs
   * whose document stores no zoom of its own), and RSF documents remember it
   * for persistence with the next save.
   */
  setTabZoom(tab: Tab, zoom: number): void {
    this.structuralOps.setTabZoom(tab, zoom);
  }

  setStickyFirstRow(sticky: boolean): void {
    this.structuralOps.setStickyFirstRow(sticky);
  }

  setStickyFirstColumn(sticky: boolean): void {
    this.structuralOps.setStickyFirstColumn(sticky);
  }

  // ----- Filtering (RSF spreadsheet documents only) -----

  /**
   * The hidden data rows of a tab's active filter, or null when nothing is
   * filtered. Computed once per filter object (snapshot semantics); the
   * filter-apply command seeds this with its time-sliced result via
   * {@link seedHiddenRows} so large filters never compute twice.
   */
  hiddenRows(tab: Tab): Set<number> | null {
    return this.worksheetsState.hiddenRows(tab);
  }

  /** Pre-store a filter's hidden-row set (computed with slicing/progress). */
  seedHiddenRows(filter: SheetFilter, hidden: Set<number>): void {
    this.worksheetsState.seedHiddenRows(filter, hidden);
  }

  /** True when a row is hidden by the tab's active filter. */
  isRowHidden(tab: Tab, row: number): boolean {
    return this.worksheetsState.isRowHidden(tab, row);
  }

  /**
   * Set (or clear, with null) the document's filter as one atomic, undoable
   * history entry. Never touches cell values. Returns false when the tab is
   * not an RSF document or the filter is unchanged.
   */
  setFilter(tab: Tab, filter: SheetFilter | null): boolean {
    return this.worksheetsState.setFilter(tab, filter);
  }

  /**
   * A filter-clearing operation to prepend to a structural entry. Structural
   * row/column insertion and deletion clear an active filter as part of the
   * same atomic entry (documented behavior): the stored range would otherwise
   * silently drift against the moved rows. Undo restores structure *and*
   * filter together.
   */
  filterClearOpsFor(doc: RsfDocument): Operation[] {
    return this.worksheetsState.filterClearOpsFor(doc);
  }

  // ----- Sorting (RSF spreadsheet documents only; view-only, unsaved) -----

  /**
   * The active tab's sort display order, or null when nothing is sorted.
   * `order[slot]` is the document row rendered/edited at display position
   * `slot`. Computed once per sort object; the sort-apply command seeds this
   * with its time-sliced result via {@link seedSortOrder}.
   */
  sortOrder(tab: Tab): number[] | null {
    return this.worksheetsState.sortOrder(tab);
  }

  /** Pre-store a sort's display order (computed with slicing/progress). */
  seedSortOrder(sort: SheetSort, order: number[]): void {
    this.worksheetsState.seedSortOrder(sort, order);
  }

  /** The document row displayed/edited at a tab's display slot `row`. */
  docRow(tab: Tab, row: number): number {
    return this.worksheetsState.docRow(tab, row);
  }

  /** The display slot a document row currently occupies (inverse of {@link docRow}). */
  sortSlot(tab: Tab, row: number): number {
    return this.worksheetsState.sortSlot(tab, row);
  }

  /**
   * Set (or clear, with null) the active worksheet's sort. Session-only view
   * state, not an undoable history entry and never saved to the container —
   * see {@link Worksheet.sort}.
   */
  setSort(tab: Tab, sort: SheetSort | null): boolean {
    return this.worksheetsState.setSort(tab, sort);
  }

  // ----- Data validation (RSF spreadsheet documents only; view-only, unsaved) -----

  /**
   * Apply (add or replace) a data-validation rule. Session-only view state,
   * not an undoable history entry and never saved to the container — see
   * {@link Worksheet.validations}.
   */
  setValidation(tab: Tab, validation: CellValidation): boolean {
    return this.worksheetsState.setValidation(tab, validation);
  }

  /** Clear the data-validation rule covering exactly `range`, if one exists. */
  clearValidation(tab: Tab, range: Pick<CellValidation, 'top' | 'left' | 'bottom' | 'right'>): boolean {
    return this.worksheetsState.clearValidation(tab, range);
  }

  /** The rule covering exactly `range` on the active worksheet, or null. */
  validationForRange(
    tab: Tab,
    range: Pick<CellValidation, 'top' | 'left' | 'bottom' | 'right'>,
  ): CellValidation | null {
    return this.worksheetsState.validationForRange(tab, range);
  }

  /** The rule applying to one cell on the active worksheet, or null. */
  validationAt(tab: Tab, row: number, col: number): CellValidation | null {
    return this.worksheetsState.validationAt(tab, row, col);
  }

  // ----- Worksheets (RSF workbooks only) -----
  //
  // These are thin delegating wrappers over `WorksheetsState` — see
  // `src/app/state/worksheets.ts` for the implementations.

  /** The active tab's workbook, or null when it is not an RSF document. */
  activeWorkbook(): RsfDocument | null {
    return this.worksheetsState.activeWorkbook();
  }

  /**
   * Activate a worksheet of the active workbook. Switching worksheets is a
   * view change, not a document edit: it is remembered in the container on the
   * next save but never marks the workbook dirty and is not undoable.
   */
  setActiveSheet(tab: Tab, sheetId: string): boolean {
    return this.worksheetsState.setActiveSheet(tab, sheetId);
  }

  /**
   * Add a new empty worksheet after the active one, as one atomic, undoable
   * operation, and activate it. `name` must already be validated and unique
   * (see the command layer).
   */
  addSheet(tab: Tab, name: string): Worksheet | null {
    return this.worksheetsState.addSheet(tab, name);
  }

  /**
   * Duplicate a worksheet (deep copy, inserted immediately after the source)
   * as one atomic, undoable operation, and activate the copy. Formulas are
   * copied verbatim: worksheet-qualified references keep pointing at the
   * worksheets they name, and unqualified references stay relative to the copy
   * (the documented, tested policy — see docs/rsf-format.md).
   */
  duplicateSheet(tab: Tab, sourceId: string, name: string, prebuilt?: Worksheet): Worksheet | null {
    return this.worksheetsState.duplicateSheet(tab, sourceId, name, prebuilt);
  }

  /**
   * Rename a worksheet and update every formula that referenced it, across the
   * whole workbook, as one atomic, undoable operation. Quoting is recomputed
   * for the new name, and no formula changes what it computes.
   */
  renameSheet(tab: Tab, sheetId: string, name: string): boolean {
    return this.worksheetsState.renameSheet(tab, sheetId, name);
  }

  /**
   * Delete a worksheet as one atomic, undoable operation. Every formula in the
   * remaining worksheets that referenced it becomes the explicit #REF! error —
   * references are never silently redirected to another worksheet. A workbook
   * always keeps at least one worksheet, so deleting the last one is refused.
   */
  deleteSheet(tab: Tab, sheetId: string): boolean {
    return this.worksheetsState.deleteSheet(tab, sheetId);
  }

  /** Move a worksheet to a new position as one atomic, undoable operation. */
  moveSheet(tab: Tab, sheetId: string, toIndex: number): boolean {
    return this.worksheetsState.moveSheet(tab, sheetId, toIndex);
  }

  /**
   * How many formulas across the workbook reference `sheetId`'s worksheet.
   * Used to warn — truthfully — before a deletion breaks them.
   */
  countReferencesToSheet(doc: RsfDocument, sheetId: string): number {
    return this.worksheetsState.countReferencesToSheet(doc, sheetId);
  }

  // ----- Internals -----

  private applyEntry(tab: Tab, entry: HistoryEntry, direction: 'before' | 'after'): void {
    const ops = direction === 'after' ? entry.ops : [...entry.ops].reverse();
    for (const op of ops) {
      this.applyOp(tab, op, direction);
    }
    // Undo/redo must show the change where it happened rather than silently
    // altering a worksheet the user is not looking at.
    const doc = tab.doc;
    if (entry.sheetId !== undefined && doc.kind === 'rsf' && doc.sheetById(entry.sheetId)) {
      this.worksheetsState.activateSheet(tab, doc, entry.sheetId);
    }
  }

  private applyOp(tab: Tab, op: Operation, direction: 'before' | 'after'): void {
    if (op.type === 'cells') {
      const changes = direction === 'after' ? op.changes : [...op.changes].reverse();
      for (const change of changes) {
        this.applyChange(tab, change, direction, op.sheetId);
      }
      return;
    }
    if (op.type === 'styles') {
      if (tab.doc.kind !== 'rsf') {
        return;
      }
      const changes = direction === 'after' ? op.changes : [...op.changes].reverse();
      for (const change of changes) {
        tab.doc.setCellStyleOn(
          op.sheetId,
          change.row,
          change.col,
          direction === 'before' ? change.before : change.after,
        );
      }
      return;
    }
    if (op.type === 'wrap') {
      // Presentational: applies to plain CSV tabs too (as local view state),
      // and never marks anything dirty.
      this.structuralOps.applyWrap(tab, direction === 'after' ? op.after : op.before, op.sheetId);
      return;
    }
    const doc = tab.doc;
    if (doc.kind !== 'rsf') {
      return;
    }
    if (op.type === 'sheets') {
      this.applySheetOp(tab, doc, op.op, direction);
      return;
    }
    if (op.type === 'filter') {
      doc.setFilterStateOn(op.sheetId, direction === 'after' ? op.after : op.before);
      return;
    }
    const effective = direction === 'after' ? op.action : op.action === 'insert' ? 'delete' : 'insert';
    if (op.type === 'rows') {
      if (effective === 'insert') {
        doc.insertRowsOn(
          op.sheetId,
          op.index,
          op.data.length > 0 ? op.data : Array.from({ length: op.count }, () => []),
        );
      } else {
        doc.deleteRowsOn(op.sheetId, op.index, op.count);
      }
    } else {
      if (effective === 'insert') {
        doc.insertColsOn(
          op.sheetId,
          op.index,
          op.data.length > 0 ? op.data : Array.from({ length: op.count }, () => []),
        );
      } else {
        doc.deleteColsOn(op.sheetId, op.index, op.count);
      }
    }
  }

  /** Apply (or invert) a worksheet lifecycle operation on the workbook. */
  private applySheetOp(tab: Tab, doc: RsfDocument, op: SheetOperation, direction: 'before' | 'after'): void {
    const forward = direction === 'after';
    switch (op.action) {
      case 'add':
        if (forward) {
          doc.insertSheetAt(op.index, op.sheet);
          this.worksheetsState.activateSheet(tab, doc, op.sheet.id);
        } else {
          doc.removeSheet(op.sheet.id);
          this.worksheetsState.adoptActiveSheetView(tab, doc);
        }
        return;
      case 'remove':
        if (forward) {
          doc.removeSheet(op.sheet.id);
          this.worksheetsState.adoptActiveSheetView(tab, doc);
        } else {
          doc.insertSheetAt(op.index, op.sheet);
          this.worksheetsState.activateSheet(tab, doc, op.sheet.id);
        }
        return;
      case 'rename':
        doc.renameSheet(op.sheetId, forward ? op.after : op.before);
        return;
      case 'move':
        doc.moveSheet(op.sheetId, forward ? op.to : op.from);
        return;
    }
  }

  private applyChange(tab: Tab, change: CellChange, direction: 'before' | 'after', sheetId?: string): void {
    const value = direction === 'before' ? change.before : change.after;
    if (tab.doc.kind === 'csv') {
      if (value === null) {
        tab.doc.revert(change.row, change.col);
      } else {
        tab.doc.setValue(change.row, change.col, value);
      }
    } else {
      tab.doc.setCellOn(sheetId, change.row, change.col, value ?? '');
    }
  }
}
