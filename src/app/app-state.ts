// SPDX-License-Identifier: MIT
import { normalizeRange, type CellRange } from '../core/clipboard';
import { computeHiddenRows, filtersEqual, type SheetFilter } from '../core/filter';
import {
  adjustFormulaForAxis,
  formulaReferencesSheet,
  invalidateSheetRefsInFormula,
  isFormula,
  renameSheetInFormula,
  sheetNameKey,
  shiftFormulaRefs,
} from '../core/formula';
import {
  cellsEntry,
  History,
  type CellChange,
  type HistoryEntry,
  type Operation,
  type SheetOperation,
} from '../core/history';
import type { LosslessDocument } from '../core/lossless-document';
import { MAX_WORKSHEETS, NEW_DOC_COLS, NEW_DOC_ROWS, RsfDocument, RSF_EXTENSION } from '../core/rsf-document';
import type { Worksheet } from '../core/worksheet';
import { t } from './i18n';
import { clampSheetZoom, getSheetZoom, setSheetZoom } from './settings';

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
}

/**
 * State change kinds. `sheets` covers the *worksheets inside* the active RSF
 * workbook (added, renamed, reordered, or switched) and is deliberately
 * distinct from `tabs`, which covers the open documents in the application tab
 * strip — the two strips are independent surfaces.
 */
export type StateEventType = 'tabs' | 'active' | 'doc' | 'selection' | 'view' | 'sheets';

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

  /**
   * Hidden-row snapshots per filter object. A filter's hidden set is computed
   * when the filter is applied/edited/restored (documented snapshot
   * semantics: editing cells afterwards does not re-evaluate the filter —
   * re-apply it from the Filter dialog to re-evaluate). Filter objects are
   * immutable, so a WeakMap keyed by them caches undo/redo restores for free
   * and releases the sets with their filters.
   */
  private readonly hiddenRowsCache = new WeakMap<SheetFilter, Set<number>>();

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
    const nonEmpty = entry.ops.some((op) => {
      if (op.type === 'cells') {
        return op.changes.length > 0;
      }
      if (op.type === 'filter') {
        return !filtersEqual(op.before, op.after);
      }
      if (op.type === 'sheets') {
        return true;
      }
      return op.count > 0;
    });
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

  // ----- Structural operations (RSF spreadsheet documents only) -----

  /**
   * Insert empty rows. Formula references in the whole sheet are adjusted
   * consistently; the structural change plus every formula rewrite form one
   * atomic history entry.
   */
  insertRows(tab: Tab, index: number, count: number): boolean {
    const doc = tab.doc;
    if (doc.kind !== 'rsf' || count < 1) {
      return false;
    }
    const rewrites = this.formulaRewrites(doc, 'row', 'insert', index, count);
    const sheetId = doc.activeSheetId;
    const entry: HistoryEntry = {
      label: 'history.insertRows',
      sheetId,
      ops: [
        ...this.filterClearOps(doc),
        {
          type: 'rows',
          action: 'insert',
          index,
          count,
          data: Array.from({ length: count }, () => []),
          sheetId,
        },
        { type: 'cells', changes: rewrites.active, sheetId },
        ...rewrites.others,
      ],
    };
    return this.pushEntry(tab, entry);
  }

  /** Delete rows (never all of them). Referencing formulas get #REF! or clamped ranges. */
  deleteRows(tab: Tab, index: number, count: number): boolean {
    const doc = tab.doc;
    if (doc.kind !== 'rsf' || count < 1 || index < 0 || index + count > doc.rowCount) {
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
    const sheetId = doc.activeSheetId;
    const entry: HistoryEntry = {
      label: 'history.deleteRows',
      sheetId,
      ops: [
        ...this.filterClearOps(doc),
        { type: 'rows', action: 'delete', index, count, data, sheetId },
        { type: 'cells', changes: rewrites.active, sheetId },
        ...rewrites.others,
      ],
    };
    return this.pushEntry(tab, entry);
  }

  insertCols(tab: Tab, index: number, count: number): boolean {
    const doc = tab.doc;
    if (doc.kind !== 'rsf' || count < 1) {
      return false;
    }
    const rewrites = this.formulaRewrites(doc, 'col', 'insert', index, count);
    const sheetId = doc.activeSheetId;
    const entry: HistoryEntry = {
      label: 'history.insertCols',
      sheetId,
      ops: [
        ...this.filterClearOps(doc),
        {
          type: 'cols',
          action: 'insert',
          index,
          count,
          data: Array.from({ length: count }, () => []),
          sheetId,
        },
        { type: 'cells', changes: rewrites.active, sheetId },
        ...rewrites.others,
      ],
    };
    return this.pushEntry(tab, entry);
  }

  deleteCols(tab: Tab, index: number, count: number): boolean {
    const doc = tab.doc;
    if (doc.kind !== 'rsf' || count < 1 || index < 0 || index + count > doc.columnCount) {
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
    const sheetId = doc.activeSheetId;
    const entry: HistoryEntry = {
      label: 'history.deleteCols',
      sheetId,
      ops: [
        ...this.filterClearOps(doc),
        { type: 'cols', action: 'delete', index, count, data, sheetId },
        { type: 'cells', changes: rewrites.active, sheetId },
        ...rewrites.others,
      ],
    };
    return this.pushEntry(tab, entry);
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
    const doc = tab.doc;
    if (doc.kind !== 'rsf' || matrix.length === 0 || matrix[0].length === 0) {
      return false;
    }
    const height = matrix.length;
    const width = matrix[0].length;
    const sheetId = doc.activeSheetId;
    const ops: Operation[] = [...this.filterClearOps(doc)];
    let rewrites: { active: CellChange[]; others: Operation[] };
    if (direction === 'down') {
      rewrites = this.formulaRewrites(doc, 'row', 'insert', at.row, height);
      ops.push({
        type: 'rows',
        action: 'insert',
        index: at.row,
        count: height,
        data: Array.from({ length: height }, () => []),
        sheetId,
      });
      const needCols = Math.max(0, at.col + width - doc.columnCount);
      if (needCols > 0) {
        ops.push({
          type: 'cols',
          action: 'insert',
          index: doc.columnCount,
          count: needCols,
          data: Array.from({ length: needCols }, () => []),
          sheetId,
        });
      }
    } else {
      rewrites = this.formulaRewrites(doc, 'col', 'insert', at.col, width);
      ops.push({
        type: 'cols',
        action: 'insert',
        index: at.col,
        count: width,
        data: Array.from({ length: width }, () => []),
        sheetId,
      });
      const needRows = Math.max(0, at.row + height - doc.rowCount);
      if (needRows > 0) {
        ops.push({
          type: 'rows',
          action: 'insert',
          index: doc.rowCount,
          count: needRows,
          data: Array.from({ length: needRows }, () => []),
          sheetId,
        });
      }
    }
    ops.push(...rewrites.others);
    const deltaRow = origin ? at.row - origin.row : 0;
    const deltaCol = origin ? at.col - origin.col : 0;
    const changes: CellChange[] = [...rewrites.active];
    for (let i = 0; i < height; i++) {
      for (let j = 0; j < width; j++) {
        let value = matrix[i][j];
        if (value === '') {
          continue; // freshly inserted cells are already empty
        }
        if (origin && isFormula(value) && (deltaRow !== 0 || deltaCol !== 0)) {
          value = shiftFormulaRefs(value, deltaRow, deltaCol);
        }
        changes.push({ row: at.row + i, col: at.col + j, before: '', after: value });
      }
    }
    ops.push({ type: 'cells', changes, sheetId });
    const applied = this.pushEntry(tab, { label: 'history.insertCells', sheetId, ops });
    if (applied) {
      this.setSelection(
        tab,
        { row: at.row, col: at.col },
        { row: at.row + height - 1, col: at.col + width - 1 },
      );
    }
    return applied;
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
   * Convert a CSV tab to an RSF spreadsheet document (explicit, user
   * confirmed). The tab is renamed to `.rsf`, detached from the original
   * file handle so the `.csv` can never be silently overwritten, and the
   * undo history is cleared (the conversion itself is not undoable; the
   * original file on disk stays untouched).
   */
  convertToRsf(tab: Tab, prebuilt?: RsfDocument): RsfDocument | null {
    if (tab.doc.kind !== 'csv') {
      return tab.doc.kind === 'rsf' ? (tab.doc as RsfDocument) : null;
    }
    const base = tab.name.replace(/\.(csv|tsv|txt)$/i, '');
    const name = `${base}${RSF_EXTENSION}`;
    // `prebuilt` comes from the time-sliced conversion of large documents
    // (identical content, collected with progress instead of one long loop).
    const doc = prebuilt ?? RsfDocument.fromLossless(tab.doc, name, defaultSheetName());
    doc.name = name;
    tab.doc = doc;
    tab.name = name;
    tab.handle = null;
    tab.history.clear();
    tab.rsfSaveExplained = false;
    this.clampSelection(tab);
    this.emit('tabs');
    return doc;
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
    if (tab.doc.kind !== 'csv') {
      return null;
    }
    const base = tab.name.replace(/\.(csv|tsv|txt)$/i, '');
    const name = `${base}${RSF_EXTENSION}`;
    const doc = prebuilt ?? RsfDocument.fromLossless(tab.doc, name, defaultSheetName());
    doc.name = name;
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

  /** Mark an RSF tab saved (its in-memory document is the baseline). */
  markTabSaved(tab: Tab): void {
    if (tab.doc.kind === 'rsf') {
      tab.doc.markSaved();
      tab.history.clear();
      this.emit('doc');
    }
  }

  setWrapCells(wrap: boolean): void {
    this.wrapCells = wrap;
    this.emit('view');
  }

  /**
   * Set the active tab's spreadsheet zoom (clamped percent). Purely visual:
   * it never changes document content, CSV bytes, or the dirty state. The
   * chosen zoom also becomes the application-level preference (used by tabs
   * whose document stores no zoom of its own), and RSF documents remember it
   * for persistence with the next save.
   */
  setTabZoom(tab: Tab, zoom: number): void {
    const z = clampSheetZoom(zoom);
    setSheetZoom(z);
    if (tab.doc.kind === 'rsf') {
      tab.doc.displayZoom = z;
    }
    if (tab.zoom !== z) {
      tab.zoom = z;
      this.emit('view');
    }
  }

  setStickyFirstRow(sticky: boolean): void {
    this.stickyFirstRow = sticky;
    safeStorageSet(STICKY_KEY, sticky ? '1' : '0');
    this.emit('view');
  }

  // ----- Filtering (RSF spreadsheet documents only) -----

  /**
   * The hidden data rows of a tab's active filter, or null when nothing is
   * filtered. Computed once per filter object (snapshot semantics — see
   * {@link hiddenRowsCache}); the filter-apply command seeds this with its
   * time-sliced result via {@link seedHiddenRows} so large filters never
   * compute twice.
   */
  hiddenRows(tab: Tab): Set<number> | null {
    const doc = tab.doc;
    if (doc.kind !== 'rsf' || doc.filter === null) {
      return null;
    }
    let hidden = this.hiddenRowsCache.get(doc.filter);
    if (!hidden) {
      hidden = computeHiddenRows(doc.filter, (r, c) => doc.getDisplayValue(r, c));
      this.hiddenRowsCache.set(doc.filter, hidden);
    }
    return hidden;
  }

  /** Pre-store a filter's hidden-row set (computed with slicing/progress). */
  seedHiddenRows(filter: SheetFilter, hidden: Set<number>): void {
    this.hiddenRowsCache.set(filter, hidden);
  }

  /** True when a row is hidden by the tab's active filter. */
  isRowHidden(tab: Tab, row: number): boolean {
    return this.hiddenRows(tab)?.has(row) ?? false;
  }

  /**
   * Set (or clear, with null) the document's filter as one atomic, undoable
   * history entry. Never touches cell values. Returns false when the tab is
   * not an RSF document or the filter is unchanged.
   */
  setFilter(tab: Tab, filter: SheetFilter | null): boolean {
    const doc = tab.doc;
    if (doc.kind !== 'rsf' || filtersEqual(doc.filter, filter)) {
      return false;
    }
    const entry: HistoryEntry = {
      label: 'history.filter',
      ops: [{ type: 'filter', before: doc.filter, after: filter }],
    };
    return this.pushEntry(tab, entry);
  }

  /**
   * A filter-clearing operation to prepend to a structural entry. Structural
   * row/column insertion and deletion clear an active filter as part of the
   * same atomic entry (documented behavior): the stored range would otherwise
   * silently drift against the moved rows. Undo restores structure *and*
   * filter together.
   */
  private filterClearOps(doc: RsfDocument): Operation[] {
    return doc.filter !== null
      ? [{ type: 'filter', before: doc.filter, after: null, sheetId: doc.activeSheetId }]
      : [];
  }

  // ----- Worksheets (RSF workbooks only) -----

  /** The active tab's workbook, or null when it is not an RSF document. */
  activeWorkbook(): RsfDocument | null {
    const tab = this.activeTab;
    return tab && tab.doc.kind === 'rsf' ? tab.doc : null;
  }

  /**
   * Snapshot the active worksheet's live view (selection, zoom, column widths)
   * into the worksheet, so switching away and back restores where you were.
   * Zoom and widths are also written to the worksheet's persisted display
   * settings, which is what makes them per-worksheet in the saved file.
   */
  private saveSheetView(tab: Tab, doc: RsfDocument): void {
    const view = doc.activeSheet.view;
    view.selection = tab.selection;
    view.anchor = tab.anchor;
    view.selectionKind = tab.selectionKind;
    view.zoom = tab.zoom;
    view.colWidths = tab.colWidths.slice();
    doc.activeSheet.displayZoom = tab.zoom;
    doc.activeSheet.displayColWidths = tab.colWidths.slice();
  }

  /** Load the (now) active worksheet's remembered view into the tab. */
  private adoptActiveSheetView(tab: Tab, doc: RsfDocument): void {
    const sheet = doc.activeSheet;
    const view = sheet.view;
    tab.selection = view.selection ?? (sheet.rowCount > 0 ? { row: 0, col: 0 } : null);
    tab.anchor = view.anchor;
    tab.selectionKind = view.selectionKind;
    tab.zoom = clampSheetZoom(view.zoom ?? sheet.displayZoom ?? getSheetZoom());
    tab.colWidths = view.colWidths.length > 0 ? view.colWidths.slice() : sheet.displayColWidths.slice();
    this.clampSelection(tab);
  }

  /** Switch worksheets, preserving each worksheet's own view state. */
  private activateSheet(tab: Tab, doc: RsfDocument, sheetId: string): void {
    if (doc.activeSheetId === sheetId) {
      return;
    }
    this.saveSheetView(tab, doc);
    if (doc.setActiveSheetId(sheetId)) {
      this.adoptActiveSheetView(tab, doc);
    }
  }

  /**
   * Activate a worksheet of the active workbook. Switching worksheets is a
   * view change, not a document edit: it is remembered in the container on the
   * next save but never marks the workbook dirty and is not undoable.
   */
  setActiveSheet(tab: Tab, sheetId: string): boolean {
    const doc = tab.doc;
    if (doc.kind !== 'rsf' || doc.activeSheetId === sheetId || !doc.sheetById(sheetId)) {
      return false;
    }
    this.activateSheet(tab, doc, sheetId);
    this.emit('sheets');
    return true;
  }

  /**
   * Add a new empty worksheet after the active one, as one atomic, undoable
   * operation, and activate it. `name` must already be validated and unique
   * (see the command layer).
   */
  addSheet(tab: Tab, name: string): Worksheet | null {
    const doc = tab.doc;
    if (doc.kind !== 'rsf' || doc.sheetCount >= MAX_WORKSHEETS) {
      return null;
    }
    const sheet = doc.createWorksheet(name, NEW_DOC_ROWS, NEW_DOC_COLS);
    const index = doc.sheetIndex(doc.activeSheetId) + 1;
    // The view is saved before the entry runs, because applying it activates
    // the new worksheet and would otherwise capture the wrong sheet's view.
    this.saveSheetView(tab, doc);
    const applied = this.pushEntry(tab, {
      label: 'history.addSheet',
      ops: [{ type: 'sheets', op: { action: 'add', sheet, index } }],
    });
    if (!applied) {
      return null;
    }
    this.emit('sheets');
    return sheet;
  }

  /**
   * Duplicate a worksheet (deep copy, inserted immediately after the source)
   * as one atomic, undoable operation, and activate the copy. Formulas are
   * copied verbatim: worksheet-qualified references keep pointing at the
   * worksheets they name, and unqualified references stay relative to the copy
   * (the documented, tested policy — see docs/rsf-format.md).
   */
  duplicateSheet(tab: Tab, sourceId: string, name: string, prebuilt?: Worksheet): Worksheet | null {
    const doc = tab.doc;
    if (doc.kind !== 'rsf' || doc.sheetCount >= MAX_WORKSHEETS) {
      return null;
    }
    // `prebuilt` comes from the time-sliced duplication of large worksheets
    // (identical content, collected with progress instead of one long loop).
    const copy = prebuilt ?? doc.duplicateWorksheet(sourceId, name);
    if (!copy) {
      return null;
    }
    const index = doc.sheetIndex(sourceId) + 1;
    this.saveSheetView(tab, doc);
    const applied = this.pushEntry(tab, {
      label: 'history.duplicateSheet',
      ops: [{ type: 'sheets', op: { action: 'add', sheet: copy, index } }],
    });
    if (!applied) {
      return null;
    }
    this.emit('sheets');
    return copy;
  }

  /**
   * Rename a worksheet and update every formula that referenced it, across the
   * whole workbook, as one atomic, undoable operation. Quoting is recomputed
   * for the new name, and no formula changes what it computes.
   */
  renameSheet(tab: Tab, sheetId: string, name: string): boolean {
    const doc = tab.doc;
    if (doc.kind !== 'rsf') {
      return false;
    }
    const sheet = doc.sheetById(sheetId);
    if (!sheet || sheet.name === name) {
      return false;
    }
    const before = sheet.name;
    const ops: Operation[] = [{ type: 'sheets', op: { action: 'rename', sheetId, before, after: name } }];
    // Redo renames first, then rewrites the references; undo replays these in
    // reverse, restoring the references before restoring the old name.
    for (const target of doc.sheets) {
      const changes: CellChange[] = [];
      for (const { row, col, src } of target.listFormulaCells()) {
        const after = renameSheetInFormula(src, before, name);
        if (after !== src) {
          changes.push({ row, col, before: src, after });
        }
      }
      if (changes.length > 0) {
        ops.push({ type: 'cells', changes, sheetId: target.id });
      }
    }
    const applied = this.pushEntry(tab, { label: 'history.renameSheet', ops });
    if (applied) {
      this.emit('sheets');
    }
    return applied;
  }

  /**
   * Delete a worksheet as one atomic, undoable operation. Every formula in the
   * remaining worksheets that referenced it becomes the explicit #REF! error —
   * references are never silently redirected to another worksheet. A workbook
   * always keeps at least one worksheet, so deleting the last one is refused.
   */
  deleteSheet(tab: Tab, sheetId: string): boolean {
    const doc = tab.doc;
    if (doc.kind !== 'rsf' || doc.sheetCount <= 1) {
      return false;
    }
    const index = doc.sheetIndex(sheetId);
    const sheet = doc.sheetById(sheetId);
    if (!sheet || index < 0) {
      return false;
    }
    // Invalidate references first (while the worksheet still exists), then
    // remove it; undo re-inserts the worksheet before restoring the formulas.
    const ops: Operation[] = [];
    for (const target of doc.sheets) {
      if (target.id === sheetId) {
        continue;
      }
      const changes: CellChange[] = [];
      for (const { row, col, src } of target.listFormulaCells()) {
        const after = invalidateSheetRefsInFormula(src, sheet.name);
        if (after !== src) {
          changes.push({ row, col, before: src, after });
        }
      }
      if (changes.length > 0) {
        ops.push({ type: 'cells', changes, sheetId: target.id });
      }
    }
    ops.push({ type: 'sheets', op: { action: 'remove', sheet, index } });
    this.saveSheetView(tab, doc);
    const applied = this.pushEntry(tab, { label: 'history.deleteSheet', ops });
    if (applied) {
      this.emit('sheets');
    }
    return applied;
  }

  /** Move a worksheet to a new position as one atomic, undoable operation. */
  moveSheet(tab: Tab, sheetId: string, toIndex: number): boolean {
    const doc = tab.doc;
    if (doc.kind !== 'rsf') {
      return false;
    }
    const from = doc.sheetIndex(sheetId);
    if (from < 0) {
      return false;
    }
    const to = Math.max(0, Math.min(doc.sheetCount - 1, toIndex));
    if (from === to) {
      return false;
    }
    const applied = this.pushEntry(tab, {
      label: 'history.moveSheet',
      ops: [{ type: 'sheets', op: { action: 'move', sheetId, from, to } }],
    });
    if (applied) {
      this.emit('sheets');
    }
    return applied;
  }

  /**
   * How many formulas across the workbook reference `sheetId`'s worksheet.
   * Used to warn — truthfully — before a deletion breaks them.
   */
  countReferencesToSheet(doc: RsfDocument, sheetId: string): number {
    const sheet = doc.sheetById(sheetId);
    if (!sheet) {
      return 0;
    }
    let count = 0;
    for (const target of doc.sheets) {
      if (target.id === sheetId) {
        continue;
      }
      for (const { src } of target.listFormulaCells()) {
        if (formulaReferencesSheet(src, sheet.name)) {
          count += 1;
        }
      }
    }
    return count;
  }

  // ----- Internals -----

  /**
   * Formula rewrites for a structural change on the active worksheet.
   *
   * Two groups of formulas are affected, and only these two:
   * - formulas **on the edited worksheet** whose unqualified references move
   *   (their own coordinates also shift, so they target post-change positions);
   * - formulas **on any other worksheet** that reference the edited worksheet
   *   explicitly (`Sheet1!A5`) — their own coordinates do not move.
   *
   * A formula on another worksheet with unqualified references is untouched:
   * those point at its own worksheet, which is not being edited. The returned
   * `others` operations are already scoped to their worksheets.
   */
  private formulaRewrites(
    doc: RsfDocument,
    axis: 'row' | 'col',
    op: 'insert' | 'delete',
    index: number,
    count: number,
  ): { active: CellChange[]; others: Operation[] } {
    const target = doc.activeSheet;
    const targetKey = sheetNameKey(target.name);
    const shouldMapCoords = (sheet: string | null): boolean =>
      sheet !== null && sheetNameKey(sheet) === targetKey;

    const active: CellChange[] = [];
    for (const { row, col, src } of target.listFormulaCells()) {
      const pos = axis === 'row' ? row : col;
      if (op === 'delete' && pos >= index && pos < index + count) {
        continue; // the cell itself is deleted with its row/column
      }
      const after = adjustFormulaForAxis(src, axis, op, index, count, {
        homeSheet: target.name,
        shouldMapCoords,
      });
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
      active.push({ row: postRow, col: postCol, before: src, after });
    }

    const others: Operation[] = [];
    for (const sheet of doc.sheets) {
      if (sheet.id === target.id) {
        continue;
      }
      const changes: CellChange[] = [];
      for (const { row, col, src } of sheet.listFormulaCells()) {
        const after = adjustFormulaForAxis(src, axis, op, index, count, {
          homeSheet: sheet.name,
          shouldMapCoords,
        });
        if (after !== src) {
          changes.push({ row, col, before: src, after });
        }
      }
      if (changes.length > 0) {
        others.push({ type: 'cells', changes, sheetId: sheet.id });
      }
    }
    return { active, others };
  }

  private applyEntry(tab: Tab, entry: HistoryEntry, direction: 'before' | 'after'): void {
    const ops = direction === 'after' ? entry.ops : [...entry.ops].reverse();
    for (const op of ops) {
      this.applyOp(tab, op, direction);
    }
    // Undo/redo must show the change where it happened rather than silently
    // altering a worksheet the user is not looking at.
    const doc = tab.doc;
    if (entry.sheetId !== undefined && doc.kind === 'rsf' && doc.sheetById(entry.sheetId)) {
      this.activateSheet(tab, doc, entry.sheetId);
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
          this.activateSheet(tab, doc, op.sheet.id);
        } else {
          doc.removeSheet(op.sheet.id);
          this.adoptActiveSheetView(tab, doc);
        }
        return;
      case 'remove':
        if (forward) {
          doc.removeSheet(op.sheet.id);
          this.adoptActiveSheetView(tab, doc);
        } else {
          doc.insertSheetAt(op.index, op.sheet);
          this.activateSheet(tab, doc, op.sheet.id);
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
