// SPDX-License-Identifier: MIT
import { type EditorDocument, isCsv, isWorkbook, workbookOf } from '../../core/editor-document';
import { normalizeRange, type CellRange } from '../../core/clipboard';
import type { CellConditionalFormat } from '../../core/workbook/conditional-format';
import type { CellValidation } from '../../core/workbook/data-validation';
import type { SheetFilter } from '../../core/workbook/filter';
import { History, type CellChange, type HistoryEntry, type Operation } from '../../core/workbook/history';
import type { RsfDocument } from '../../core/workbook/rsf-document';
import type { SheetSort } from '../../core/workbook/sort';
import type { FreezePanes, Worksheet } from '../../core/workbook/worksheet';
import { getWrapCells } from '../settings';
import { safeStorageGet } from '../storage';
import { STICKY_COL_KEY, STICKY_KEY } from './defaults';
import { StructuralOpsState } from './structural-ops';
import { resolveWrap, resolveZoom } from './view-layers';
import { EditingState } from './editing';
import type { FormulaRefTarget, Selection, SelectionKind, StateEventType, Tab } from './types';
import { WorksheetsState } from './worksheets';
import { WriteGuards } from './write-guards';

export type { FormulaRefTarget, Selection, SelectionKind, StateEventType, Tab } from './types';

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
  /**
   * Told about every refused mutation attempt against a protected book or a
   * locked worksheet (see `refuseReadOnlyWrite`/`refuseLockedSheetWrite`
   * below), so a blocking warning dialog can interrupt the attempt and offer
   * to unlock — rather than the silent/toast-only refusal a plain
   * `announce` would give, since unblocking editing needs an explicit
   * decision, not just a notice. Null outside the browser (unit tests),
   * exactly like `announce`; `Commands`-layer callers with their own
   * `UiPort` access (e.g. `FileIoCommands.ensureRsf`) call
   * `warnProtectedAndOfferUnlock` directly instead of going through this.
   * `retry` repeats the refused call; it is run once the user unlocks, so
   * the edit that asked for unlocking still happens.
   */
  warnBlocked: ((tab: Tab, scope: 'book' | 'sheet', retry: () => void, sheetId?: string) => void) | null =
    null;
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

  /** The checks every user-initiated write passes — see `WriteGuards`. */
  private readonly guards: WriteGuards;

  /** Edits, prebuilt entries, reverts, and undo/redo — see `EditingState`. */
  private readonly editing: EditingState;

  constructor() {
    this.stickyFirstRow = safeStorageGet(STICKY_KEY) === '1';
    this.stickyFirstColumn = safeStorageGet(STICKY_COL_KEY) === '1';
    this.structuralOps = new StructuralOpsState(this);
    this.worksheetsState = new WorksheetsState(this);
    this.guards = new WriteGuards(this);
    this.editing = new EditingState(this, this.guards, this.structuralOps, this.worksheetsState);
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

  /**
   * `startsReadOnly` is true for every "open an existing file" entry point
   * (File > Open, drag-and-drop, Google Drive open, the legacy `.rcsv` and
   * `.xlsx` import paths) and false for a newly created blank document or one
   * derived in memory (e.g. the explicit `Convert to RSF…` copy) — see `Tab.readOnly`.
   */
  addTab(
    name: string,
    doc: EditorDocument,
    handle: FileSystemFileHandle | null,
    startsReadOnly = false,
  ): Tab {
    // Zoom and wrap are layered: worksheet > file > browser (see
    // `state/view-layers.ts`); column widths come from the document alone.
    const stored = workbookOf(doc);
    const tab: Tab = {
      id: `tab-${nextTabId++}`,
      name,
      doc,
      history: new History(),
      handle,
      diskStamp: null,
      selection: doc.rowCount > 0 ? { row: 0, col: 0 } : null,
      anchor: null,
      selectionKind: 'cell',
      rsfSaveExplained: false,
      drive: null,
      colWidths: stored ? stored.displayColWidths.slice() : [],
      zoom: resolveZoom(doc).value,
      wrapCells: resolveWrap(doc).value,
      tabEntryCol: null,
      freeze: null,
      readOnly: startsReadOnly,
      neverSaved: false,
      textFile: null,
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
      if (tab.name !== name || !isCsv(tab.doc) || tab.doc.bytes.length !== bytes.length) {
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
   * rendering only); it defaults to a cell/range selection. `preserveTabEntryCol`
   * keeps the tab's remembered Tab-then-Enter start column intact — set only by
   * the grid's Tab/Enter handling itself; every other caller (a click, an arrow
   * key, opening a menu, and so on) leaves it at the default `false`, which
   * clears that tracked column.
   */
  setSelection(
    tab: Tab,
    selection: Selection | null,
    anchor: Selection | null = null,
    kind: SelectionKind = 'cell',
    preserveTabEntryCol = false,
  ): void {
    tab.selection = selection;
    tab.anchor = selection ? anchor : null;
    tab.selectionKind = selection ? kind : 'cell';
    if (!preserveTabEntryCol) {
      tab.tabEntryCol = null;
    }
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
   * cells are free to write. See `WriteGuards.spillBlocked`.
   */
  spillBlocked(
    tab: Tab,
    cells: ReadonlyArray<{ row: number; col: number }>,
  ): { row: number; col: number } | null {
    return this.guards.spillBlocked(tab, cells);
  }

  /**
   * Toggle a tab's read-only protection (File > Protect Document, or the
   * status bar control). Purely a session-only UI guard — see `Tab.readOnly`.
   */
  setReadOnly(tab: Tab, readOnly: boolean): void {
    if (tab.readOnly === readOnly) {
      return;
    }
    tab.readOnly = readOnly;
    this.emit('tabs');
  }

  /**
   * Adopt the file name the user chose when saving (the save picker's file
   * name, or the name typed for a Drive upload) as the tab's name, so the
   * tab label and later downloads follow the saved file.
   * An empty name is ignored. Emits `tabs` only when the name changed.
   */
  adoptSavedName(tab: Tab, name: string): void {
    if (!name || tab.name === name) {
      return;
    }
    tab.name = name;
    if (isWorkbook(tab.doc)) {
      tab.doc.name = name;
    }
    this.emit('tabs');
  }

  // ----- Edits and undo/redo — see `EditingState` -----

  /** Set one cell's value as a single undoable operation. */
  editCell(tab: Tab, row: number, col: number, value: string, label = 'history.editCell'): boolean {
    return this.editing.editCell(tab, row, col, value, label);
  }

  /** Apply several cell changes as one atomic, singly-undoable operation. */
  bulkEdit(tab: Tab, changes: CellChange[], label: string): boolean {
    return this.editing.bulkEdit(tab, changes, label);
  }

  /** Push and apply a prebuilt multi-op entry atomically. */
  pushEntry(tab: Tab, entry: HistoryEntry): boolean {
    return this.editing.pushEntry(tab, entry);
  }

  revertCell(tab: Tab, row: number, col: number): boolean {
    return this.editing.revertCell(tab, row, col);
  }

  revertAll(tab: Tab): boolean {
    return this.editing.revertAll(tab);
  }

  undo(tab: Tab): HistoryEntry | null {
    return this.editing.undo(tab);
  }

  redo(tab: Tab): HistoryEntry | null {
    return this.editing.redo(tab);
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
   * Move `count` whole rows/columns from `from` to the boundary `to` (in the
   * current layout) as one undoable reorder; see `StructuralOpsState.moveAxis`.
   */
  moveAxis(tab: Tab, axis: 'row' | 'col', from: number, count: number, to: number): boolean {
    return this.structuralOps.moveAxis(tab, axis, from, count, to);
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
   * Turn wrapping on/off for the active tab. Purely visual; written to the
   * level that currently decides it — see `StructuralOpsState.setWrapCells`.
   */
  setWrapCells(wrap: boolean): void {
    this.structuralOps.setWrapCells(wrap);
  }

  /**
   * Set the active tab's spreadsheet zoom (clamped percent). Purely visual;
   * written to the level that currently decides the zoom — see
   * `StructuralOpsState.setTabZoom`.
   */
  setTabZoom(tab: Tab, zoom: number): void {
    this.structuralOps.setTabZoom(tab, zoom);
  }

  /** Re-resolve every tab's zoom and wrap after a browser/file-level change, and repaint. */
  reapplyViewSettings(): void {
    this.structuralOps.reapplyViewSettings();
    this.emit('view');
  }

  /**
   * Turn the sticky first row preference on/off. Also drops the active tab's
   * freeze-at-selection, so the choice visibly takes effect there.
   */
  setStickyFirstRow(sticky: boolean): void {
    this.structuralOps.setStickyFirstRow(sticky);
  }

  /** Column counterpart of {@link setStickyFirstRow}. */
  setStickyFirstColumn(sticky: boolean): void {
    this.structuralOps.setStickyFirstColumn(sticky);
  }

  /** Whether the active tab currently shows a sticky first row from the preference (menu check). */
  get stickyFirstRowShown(): boolean {
    return this.stickyFirstRow && !this.activeTab?.freeze;
  }

  /** Whether the active tab currently shows a sticky first column from the preference (menu check). */
  get stickyFirstColumnShown(): boolean {
    return this.stickyFirstColumn && !this.activeTab?.freeze;
  }

  /**
   * How many display rows (from the top) and columns (from the left) of a
   * tab stay on screen while the rest scrolls: the tab's own
   * freeze-at-selection when set, otherwise the sticky first row / first
   * column preferences. Clamped to the document's size.
   */
  frozenPanes(tab: Tab): FreezePanes {
    const freeze = tab.freeze ?? {
      rows: this.stickyFirstRow ? 1 : 0,
      cols: this.stickyFirstColumn ? 1 : 0,
    };
    return {
      rows: Math.max(0, Math.min(freeze.rows, tab.doc.rowCount)),
      cols: Math.max(0, Math.min(freeze.cols, tab.doc.columnCount)),
    };
  }

  /**
   * Freeze a tab at a split point (rows above, columns left of it), or clear
   * it with null. Purely visual: it never changes document content, CSV
   * bytes, the dirty state, or the undo history.
   */
  setTabFreeze(tab: Tab, freeze: FreezePanes | null): void {
    this.structuralOps.setTabFreeze(tab, freeze);
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

  // ----- Conditional formatting (RSF spreadsheet documents only; view-only, unsaved) -----

  /**
   * Apply (add or replace) a conditional-formatting rule. Session-only view
   * state, not an undoable history entry and never saved to the container —
   * see {@link Worksheet.conditionalFormats}.
   */
  setConditionalFormat(tab: Tab, format: CellConditionalFormat): boolean {
    return this.worksheetsState.setConditionalFormat(tab, format);
  }

  /** Clear the conditional-formatting rule covering exactly `range`, if one exists. */
  clearConditionalFormat(
    tab: Tab,
    range: Pick<CellConditionalFormat, 'top' | 'left' | 'bottom' | 'right'>,
  ): boolean {
    return this.worksheetsState.clearConditionalFormat(tab, range);
  }

  /** The rule covering exactly `range` on the active worksheet, or null. */
  conditionalFormatForRange(
    tab: Tab,
    range: Pick<CellConditionalFormat, 'top' | 'left' | 'bottom' | 'right'>,
  ): CellConditionalFormat | null {
    return this.worksheetsState.conditionalFormatForRange(tab, range);
  }

  // ----- Cell comments (RSF spreadsheet documents only) -----

  /** The comment on one cell of the active worksheet, or null. */
  commentAt(tab: Tab, row: number, col: number): string | null {
    return this.worksheetsState.commentAt(tab, row, col);
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
   * Add a new worksheet holding one empty Markdown document after the active
   * one, as one atomic, undoable operation, and activate it. `name` must
   * already be validated and unique (see the command layer).
   */
  addMarkdownSheet(tab: Tab, name: string): Worksheet | null {
    return this.worksheetsState.addMarkdownSheet(tab, name);
  }

  /**
   * Add a new worksheet holding one empty JSON document after the active
   * one, as one atomic, undoable operation, and activate it. `name` must
   * already be validated and unique (see the command layer).
   */
  addJsonSheet(tab: Tab, name: string): Worksheet | null {
    return this.worksheetsState.addJsonSheet(tab, name);
  }

  /**
   * Add a new worksheet holding one empty YAML document after the active
   * one, as one atomic, undoable operation, and activate it. `name` must
   * already be validated and unique (see the command layer).
   */
  addYamlSheet(tab: Tab, name: string): Worksheet | null {
    return this.worksheetsState.addYamlSheet(tab, name);
  }

  /**
   * Add a new worksheet holding one empty plain-text document after the
   * active one, as one atomic, undoable operation, and activate it. `name`
   * must already be validated and unique (see the command layer).
   */
  addTextSheet(tab: Tab, name: string): Worksheet | null {
    return this.worksheetsState.addTextSheet(tab, name);
  }

  /**
   * Duplicate a worksheet (deep copy, inserted immediately after the source)
   * as one atomic, undoable operation, and activate the copy. Formulas are
   * copied verbatim: worksheet-qualified references keep pointing at the
   * worksheets they name, and unqualified references stay relative to the copy
   * (the documented, tested policy — see knowledge/formats/rsf/index.md).
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

  /** Set or clear a worksheet's tab color; see `WorksheetsState.setSheetTabColor`. */
  setSheetTabColor(tab: Tab, sheetId: string, color: string | undefined): boolean {
    return this.worksheetsState.setSheetTabColor(tab, sheetId, color);
  }

  /** Toggle a worksheet's lock; see `WorksheetsState.setSheetLocked`. */
  setSheetLocked(tab: Tab, sheetId: string, locked: boolean): boolean {
    return this.worksheetsState.setSheetLocked(tab, sheetId, locked);
  }

  /**
   * How many formulas across the workbook reference `sheetId`'s worksheet.
   * Used to warn — truthfully — before a deletion breaks them.
   */
  countReferencesToSheet(doc: RsfDocument, sheetId: string): number {
    return this.worksheetsState.countReferencesToSheet(doc, sheetId);
  }
}
