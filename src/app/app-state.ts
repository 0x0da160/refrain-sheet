// SPDX-License-Identifier: MIT
import { normalizeRange, type CellRange } from '../core/clipboard';
import { adjustFormulaForAxis } from '../core/formula';
import { cellsEntry, History, type CellChange, type HistoryEntry, type Operation } from '../core/history';
import type { LosslessDocument } from '../core/lossless-document';
import { RcsvDocument, RCSV_EXTENSION } from '../core/rcsv-document';

/** Either document kind; the shared surface is duck-typed across both. */
export type EditorDocument = LosslessDocument | RcsvDocument;

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
  /** The "must be saved as .rcsv" explanation was already shown for this tab. */
  rcsvSaveExplained: boolean;
  /**
   * Per-column pixel widths for this open document during the session. A
   * missing or zero entry means the default width. Stored on the tab so
   * resizing a plain CSV never mutates its bytes; RCSV documents persist
   * these in their container.
   */
  colWidths: number[];
}

export type StateEventType = 'tabs' | 'active' | 'doc' | 'selection' | 'view';

const STICKY_KEY = 'refrain-csv-html.stickyFirstRow';

let nextTabId = 1;

function safeStorageGet(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function safeStorageSet(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // Storage may be unavailable; the preference simply is not persisted.
  }
}

/**
 * Application state: open tabs, the active tab, selections, and the
 * undo/redo integration. All mutations go through this class so every UI
 * surface (menus, shortcuts, drag-and-drop) observes the same state.
 */
export class AppState {
  tabs: Tab[] = [];
  activeTabId: string | null = null;
  wrapCells = false;
  /** Keep the first record row pinned below the header while scrolling. */
  stickyFirstRow: boolean;
  /** The formula editor currently able to accept pointer-entered references. */
  formulaRefTarget: FormulaRefTarget | null = null;

  private listeners = new Set<(event: StateEventType) => void>();

  constructor() {
    this.stickyFirstRow = safeStorageGet(STICKY_KEY) === '1';
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
    const tab: Tab = {
      id: `tab-${nextTabId++}`,
      name,
      doc,
      history: new History(),
      handle,
      selection: doc.rowCount > 0 ? { row: 0, col: 0 } : null,
      anchor: null,
      selectionKind: 'cell',
      rcsvSaveExplained: false,
      colWidths: [],
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
      tab.history.push(cellsEntry(label, [{ row, col, before, after }]));
      this.applyChange(tab, { row, col, before, after }, 'after');
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
    tab.history.push(cellsEntry(label, [{ row, col, before, after: value }]));
    this.applyChange(tab, { row, col, before, after: value }, 'after');
    this.emit('doc');
    return true;
  }

  /** Apply several cell changes as one atomic, singly-undoable operation. */
  bulkEdit(tab: Tab, changes: CellChange[], label: string): boolean {
    const effective = changes.filter((c) => c.before !== c.after);
    if (effective.length === 0) {
      return false;
    }
    tab.history.push(cellsEntry(label, effective));
    for (const change of effective) {
      this.applyChange(tab, change, 'after');
    }
    this.emit('doc');
    return true;
  }

  /** Push and apply a prebuilt multi-op entry atomically. */
  pushEntry(tab: Tab, entry: HistoryEntry): boolean {
    const nonEmpty = entry.ops.some((op) => (op.type === 'cells' ? op.changes.length > 0 : op.count > 0));
    if (!nonEmpty) {
      return false;
    }
    tab.history.push(entry);
    this.applyEntry(tab, entry, 'after');
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

  // ----- Structural operations (RCSV spreadsheet documents only) -----

  /**
   * Insert empty rows. Formula references in the whole sheet are adjusted
   * consistently; the structural change plus every formula rewrite form one
   * atomic history entry.
   */
  insertRows(tab: Tab, index: number, count: number): boolean {
    const doc = tab.doc;
    if (doc.kind !== 'rcsv' || count < 1) {
      return false;
    }
    const rewrites = this.formulaRewrites(doc, 'row', 'insert', index, count);
    const entry: HistoryEntry = {
      label: 'history.insertRows',
      ops: [
        { type: 'rows', action: 'insert', index, count, data: Array.from({ length: count }, () => []) },
        { type: 'cells', changes: rewrites },
      ],
    };
    return this.pushEntry(tab, entry);
  }

  /** Delete rows (never all of them). Referencing formulas get #REF! or clamped ranges. */
  deleteRows(tab: Tab, index: number, count: number): boolean {
    const doc = tab.doc;
    if (doc.kind !== 'rcsv' || count < 1 || index < 0 || index + count > doc.rowCount) {
      return false;
    }
    if (count >= doc.rowCount) {
      return false; // the last remaining rows cannot be deleted
    }
    const data: string[][] = [];
    for (let r = index; r < index + count; r++) {
      const row: string[] = [];
      for (let c = 0; c < doc.columnCount; c++) {
        row.push(doc.getValue(r, c));
      }
      data.push(row);
    }
    const rewrites = this.formulaRewrites(doc, 'row', 'delete', index, count);
    const entry: HistoryEntry = {
      label: 'history.deleteRows',
      ops: [
        { type: 'rows', action: 'delete', index, count, data },
        { type: 'cells', changes: rewrites },
      ],
    };
    return this.pushEntry(tab, entry);
  }

  insertCols(tab: Tab, index: number, count: number): boolean {
    const doc = tab.doc;
    if (doc.kind !== 'rcsv' || count < 1) {
      return false;
    }
    const rewrites = this.formulaRewrites(doc, 'col', 'insert', index, count);
    const entry: HistoryEntry = {
      label: 'history.insertCols',
      ops: [
        { type: 'cols', action: 'insert', index, count, data: Array.from({ length: count }, () => []) },
        { type: 'cells', changes: rewrites },
      ],
    };
    return this.pushEntry(tab, entry);
  }

  deleteCols(tab: Tab, index: number, count: number): boolean {
    const doc = tab.doc;
    if (doc.kind !== 'rcsv' || count < 1 || index < 0 || index + count > doc.columnCount) {
      return false;
    }
    if (count >= doc.columnCount) {
      return false;
    }
    const data: string[][] = Array.from({ length: count }, (_, i) => {
      const col: string[] = [];
      for (let r = 0; r < doc.rowCount; r++) {
        col.push(doc.getValue(r, index + i));
      }
      return col;
    });
    const rewrites = this.formulaRewrites(doc, 'col', 'delete', index, count);
    const entry: HistoryEntry = {
      label: 'history.deleteCols',
      ops: [
        { type: 'cols', action: 'delete', index, count, data },
        { type: 'cells', changes: rewrites },
      ],
    };
    return this.pushEntry(tab, entry);
  }

  /** True when any cell in the given rows (or columns) is non-empty. */
  hasContent(tab: Tab, axis: 'row' | 'col', index: number, count: number): boolean {
    const doc = tab.doc;
    for (let i = index; i < index + count; i++) {
      const limit = axis === 'row' ? doc.fieldCount(i) : doc.rowCount;
      for (let j = 0; j < limit; j++) {
        const value = axis === 'row' ? doc.getValue(i, j) : doc.getValue(j, i);
        if (value !== '') {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Convert a CSV tab to an RCSV spreadsheet document (explicit, user
   * confirmed). The tab is renamed to `.rcsv`, detached from the original
   * file handle so the `.csv` can never be silently overwritten, and the
   * undo history is cleared (the conversion itself is not undoable; the
   * original file on disk stays untouched).
   */
  convertToRcsv(tab: Tab): RcsvDocument | null {
    if (tab.doc.kind !== 'csv') {
      return tab.doc.kind === 'rcsv' ? (tab.doc as RcsvDocument) : null;
    }
    const base = tab.name.replace(/\.(csv|tsv|txt)$/i, '');
    const name = `${base}${RCSV_EXTENSION}`;
    const doc = RcsvDocument.fromLossless(tab.doc, name);
    tab.doc = doc;
    tab.name = name;
    tab.handle = null;
    tab.history.clear();
    tab.rcsvSaveExplained = false;
    this.clampSelection(tab);
    this.emit('tabs');
    return doc;
  }

  /**
   * Explicit `Convert to RCSV…`: build a new RCSV spreadsheet from a CSV tab's
   * current (edited) values and open it in a new active tab. The source CSV
   * tab, its unsaved edits, its file handle, and the file on disk are all left
   * untouched — this never converts in place. The new document is marked
   * unsaved (it exists only in memory until saved). Returns the new document,
   * or null when the tab is not a CSV.
   */
  convertToRcsvNewTab(tab: Tab): RcsvDocument | null {
    if (tab.doc.kind !== 'csv') {
      return null;
    }
    const base = tab.name.replace(/\.(csv|tsv|txt)$/i, '');
    const name = `${base}${RCSV_EXTENSION}`;
    const doc = RcsvDocument.fromLossless(tab.doc, name);
    doc.markUnsaved();
    this.addTab(name, doc, null);
    return doc;
  }

  /**
   * After a successful save, the saved byte sequence becomes the new
   * baseline document and the history is cleared.
   */
  setBaseline(tab: Tab, doc: EditorDocument): void {
    tab.doc = doc;
    tab.history.clear();
    this.clampSelection(tab);
    this.emit('doc');
  }

  /** Mark an RCSV tab saved (its in-memory document is the baseline). */
  markTabSaved(tab: Tab): void {
    if (tab.doc.kind === 'rcsv') {
      tab.doc.markSaved();
      tab.history.clear();
      this.emit('doc');
    }
  }

  setWrapCells(wrap: boolean): void {
    this.wrapCells = wrap;
    this.emit('view');
  }

  setStickyFirstRow(sticky: boolean): void {
    this.stickyFirstRow = sticky;
    safeStorageSet(STICKY_KEY, sticky ? '1' : '0');
    this.emit('view');
  }

  // ----- Internals -----

  /** Formula rewrites for a structural change, targeting post-change coordinates. */
  private formulaRewrites(
    doc: RcsvDocument,
    axis: 'row' | 'col',
    op: 'insert' | 'delete',
    index: number,
    count: number,
  ): CellChange[] {
    const changes: CellChange[] = [];
    for (const { row, col, src } of doc.listFormulaCells()) {
      const pos = axis === 'row' ? row : col;
      if (op === 'delete' && pos >= index && pos < index + count) {
        continue; // the cell itself is deleted with its row/column
      }
      const after = adjustFormulaForAxis(src, axis, op, index, count);
      if (after === src) {
        continue;
      }
      let postRow = row;
      let postCol = col;
      if (axis === 'row') {
        postRow =
          op === 'insert' ? (row >= index ? row + count : row) : row >= index + count ? row - count : row;
      } else {
        postCol =
          op === 'insert' ? (col >= index ? col + count : col) : col >= index + count ? col - count : col;
      }
      changes.push({ row: postRow, col: postCol, before: src, after });
    }
    return changes;
  }

  private applyEntry(tab: Tab, entry: HistoryEntry, direction: 'before' | 'after'): void {
    const ops = direction === 'after' ? entry.ops : [...entry.ops].reverse();
    for (const op of ops) {
      this.applyOp(tab, op, direction);
    }
  }

  private applyOp(tab: Tab, op: Operation, direction: 'before' | 'after'): void {
    if (op.type === 'cells') {
      const changes = direction === 'after' ? op.changes : [...op.changes].reverse();
      for (const change of changes) {
        this.applyChange(tab, change, direction);
      }
      return;
    }
    const doc = tab.doc;
    if (doc.kind !== 'rcsv') {
      return;
    }
    const effective = direction === 'after' ? op.action : op.action === 'insert' ? 'delete' : 'insert';
    if (op.type === 'rows') {
      if (effective === 'insert') {
        doc.insertRows(op.index, op.data.length > 0 ? op.data : Array.from({ length: op.count }, () => []));
      } else {
        doc.deleteRows(op.index, op.count);
      }
    } else {
      if (effective === 'insert') {
        doc.insertCols(op.index, op.data.length > 0 ? op.data : Array.from({ length: op.count }, () => []));
      } else {
        doc.deleteCols(op.index, op.count);
      }
    }
  }

  private applyChange(tab: Tab, change: CellChange, direction: 'before' | 'after'): void {
    const value = direction === 'before' ? change.before : change.after;
    if (tab.doc.kind === 'csv') {
      if (value === null) {
        tab.doc.revert(change.row, change.col);
      } else {
        tab.doc.setValue(change.row, change.col, value);
      }
    } else {
      tab.doc.setCell(change.row, change.col, value ?? '');
    }
  }
}
