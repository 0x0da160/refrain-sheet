// SPDX-License-Identifier: MIT
import { conditionalFormatRangesEqual, type CellConditionalFormat } from '../../core/conditional-format';
import { findValidation, validationRangesEqual, type CellValidation } from '../../core/data-validation';
import { computeHiddenRows, filtersEqual, type SheetFilter } from '../../core/filter';
import {
  formulaReferencesSheet,
  invalidateSheetRefsInFormula,
  renameSheetInFormula,
} from '../../core/formula';
import type { CellChange, HistoryEntry, Operation } from '../../core/history';
import { MAX_WORKSHEETS, NEW_DOC_COLS, NEW_DOC_ROWS, RsfDocument } from '../../core/rsf-document';
import { computeSortOrder, sortsEqual, type SheetSort } from '../../core/sort';
import type { Worksheet } from '../../core/worksheet';
import { AppState, type Tab } from '../app-state';
import { clampSheetZoom, getSheetZoom, getWrapCells } from '../settings';

/**
 * Row filtering and worksheet lifecycle operations on RSF spreadsheet
 * documents/workbooks — hidden-row computation, filter set/clear, and
 * worksheet add/rename/duplicate/delete/reorder/activate. Extracted from
 * `AppState` as a cohesive slice (see issue #180, following the composition
 * pattern `StructuralOpsState` established in issue #179) — `AppState` still
 * exposes the same public methods, delegating to an instance of this class.
 * `activateSheet` and `adoptActiveSheetView` are also called back into by
 * `AppState` itself, from the undo/redo and sheet-op replay paths that stay
 * there.
 */
export class WorksheetsState {
  constructor(private readonly state: AppState) {}

  /**
   * Hidden-row snapshots per filter object. A filter's hidden set is computed
   * when the filter is applied/edited/restored (documented snapshot
   * semantics: editing cells afterwards does not re-evaluate the filter —
   * re-apply it from the Filter dialog to re-evaluate). Filter objects are
   * immutable, so a WeakMap keyed by them caches undo/redo restores for free
   * and releases the sets with their filters.
   */
  private readonly hiddenRowsCache = new WeakMap<SheetFilter, Set<number>>();

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
    return this.state.pushEntry(tab, entry);
  }

  /**
   * A filter-clearing operation to prepend to a structural entry. Structural
   * row/column insertion and deletion clear an active filter as part of the
   * same atomic entry (documented behavior): the stored range would otherwise
   * silently drift against the moved rows. Undo restores structure *and*
   * filter together.
   */
  filterClearOpsFor(doc: RsfDocument): Operation[] {
    return this.filterClearOps(doc);
  }

  private filterClearOps(doc: RsfDocument): Operation[] {
    return doc.filter !== null
      ? [{ type: 'filter', before: doc.filter, after: null, sheetId: doc.activeSheetId }]
      : [];
  }

  /**
   * Display-order snapshots per sort object (mirrors {@link hiddenRowsCache}):
   * computed once when the sort is applied/edited, seeded by the time-sliced
   * apply command via {@link seedSortOrder} so large sorts never compute
   * twice. Sort objects are immutable, so a WeakMap keyed by them releases the
   * order array with its sort.
   */
  private readonly sortOrderCache = new WeakMap<SheetSort, number[]>();

  /**
   * The active sort's display order for a tab — `order[slot]` is the document
   * row to render/edit at display position `slot` — or null when nothing is
   * sorted. See {@link computeSortOrder} for the mapping rules (identity
   * outside the sort's range, and for rows an active filter hides).
   */
  sortOrder(tab: Tab): number[] | null {
    const doc = tab.doc;
    if (doc.kind !== 'rsf' || doc.sort === null) {
      return null;
    }
    let order = this.sortOrderCache.get(doc.sort);
    if (!order) {
      order = computeSortOrder(doc.sort, doc.rowCount, this.hiddenRows(tab), (r, c) =>
        doc.getDisplayValue(r, c),
      );
      this.sortOrderCache.set(doc.sort, order);
    }
    return order;
  }

  /** Pre-store a sort's display order (computed with slicing/progress). */
  seedSortOrder(sort: SheetSort, order: number[]): void {
    this.sortOrderCache.set(sort, order);
  }

  /**
   * Translate a display slot to the document row whose content belongs
   * there. Identity when the tab has no active sort.
   */
  docRow(tab: Tab, row: number): number {
    return this.sortOrder(tab)?.[row] ?? row;
  }

  /**
   * Inverse of {@link sortOrder}, per sort object (same lifetime as
   * `sortOrderCache`): the display slot a document row occupies.
   */
  private readonly sortSlotCache = new WeakMap<SheetSort, number[]>();

  /**
   * Translate a document row to the display slot its content currently
   * occupies. Identity when the tab has no active sort — the inverse of
   * {@link docRow}, used by keyboard navigation and hit-testing to walk the
   * grid in display order while every mutation still addresses document rows.
   */
  sortSlot(tab: Tab, row: number): number {
    const doc = tab.doc;
    if (doc.kind !== 'rsf' || doc.sort === null) {
      return row;
    }
    const sort = doc.sort;
    let inverse = this.sortSlotCache.get(sort);
    if (!inverse) {
      const order = this.sortOrder(tab) ?? [];
      inverse = new Array(order.length);
      for (let slot = 0; slot < order.length; slot++) {
        inverse[order[slot]] = slot;
      }
      this.sortSlotCache.set(sort, inverse);
    }
    return inverse[row] ?? row;
  }

  /**
   * Set (or clear, with null) the active worksheet's sort. Session-only view
   * state — like the current selection — so this is a direct mutation, not an
   * undoable history entry: it never touches cell values, never marks the
   * document dirty, and is never written to the saved container. Returns
   * false when the tab is not an RSF document or the sort is unchanged.
   */
  setSort(tab: Tab, sort: SheetSort | null): boolean {
    const doc = tab.doc;
    if (doc.kind !== 'rsf' || sortsEqual(doc.activeSheet.sort, sort)) {
      return false;
    }
    doc.activeSheet.sort = sort;
    this.state.emit('doc');
    return true;
  }

  /**
   * Apply (add or replace) a data-validation rule on the active worksheet.
   * Session-only view state, like {@link setSort} — a direct mutation, not an
   * undoable history entry. Any existing rule covering the exact same range
   * is replaced; other rules are left as-is, so several ranges can each carry
   * their own rule at once.
   */
  setValidation(tab: Tab, validation: CellValidation): boolean {
    const doc = tab.doc;
    if (doc.kind !== 'rsf') {
      return false;
    }
    const sheet = doc.activeSheet;
    const next = sheet.validations.filter((v) => !validationRangesEqual(v, validation));
    next.push(validation);
    sheet.validations = next;
    this.state.emit('doc');
    return true;
  }

  /** Clear the data-validation rule covering exactly `range`, if one exists. */
  clearValidation(tab: Tab, range: Pick<CellValidation, 'top' | 'left' | 'bottom' | 'right'>): boolean {
    const doc = tab.doc;
    if (doc.kind !== 'rsf') {
      return false;
    }
    const sheet = doc.activeSheet;
    const next = sheet.validations.filter((v) => !validationRangesEqual(v, range));
    if (next.length === sheet.validations.length) {
      return false;
    }
    sheet.validations = next;
    this.state.emit('doc');
    return true;
  }

  /** The rule covering exactly `range` on the active worksheet, or null. */
  validationForRange(
    tab: Tab,
    range: Pick<CellValidation, 'top' | 'left' | 'bottom' | 'right'>,
  ): CellValidation | null {
    const doc = tab.doc;
    if (doc.kind !== 'rsf') {
      return null;
    }
    return doc.activeSheet.validations.find((v) => validationRangesEqual(v, range)) ?? null;
  }

  /** The rule applying to one cell on the active worksheet, or null. */
  validationAt(tab: Tab, row: number, col: number): CellValidation | null {
    const doc = tab.doc;
    if (doc.kind !== 'rsf') {
      return null;
    }
    return findValidation(doc.activeSheet.validations, row, col);
  }

  /**
   * Apply (add or replace) a conditional-formatting rule for its exact range.
   * Session-only view state, not an undoable history entry and never saved
   * to the container — see {@link Worksheet.conditionalFormats}.
   */
  setConditionalFormat(tab: Tab, format: CellConditionalFormat): boolean {
    const doc = tab.doc;
    if (doc.kind !== 'rsf') {
      return false;
    }
    const sheet = doc.activeSheet;
    const next = sheet.conditionalFormats.filter((cf) => !conditionalFormatRangesEqual(cf, format));
    next.push(format);
    sheet.conditionalFormats = next;
    this.state.emit('doc');
    return true;
  }

  /** Clear the conditional-formatting rule covering exactly `range`, if one exists. */
  clearConditionalFormat(
    tab: Tab,
    range: Pick<CellConditionalFormat, 'top' | 'left' | 'bottom' | 'right'>,
  ): boolean {
    const doc = tab.doc;
    if (doc.kind !== 'rsf') {
      return false;
    }
    const sheet = doc.activeSheet;
    const next = sheet.conditionalFormats.filter((cf) => !conditionalFormatRangesEqual(cf, range));
    if (next.length === sheet.conditionalFormats.length) {
      return false;
    }
    sheet.conditionalFormats = next;
    this.state.emit('doc');
    return true;
  }

  /** The rule covering exactly `range` on the active worksheet, or null. */
  conditionalFormatForRange(
    tab: Tab,
    range: Pick<CellConditionalFormat, 'top' | 'left' | 'bottom' | 'right'>,
  ): CellConditionalFormat | null {
    const doc = tab.doc;
    if (doc.kind !== 'rsf') {
      return null;
    }
    return doc.activeSheet.conditionalFormats.find((cf) => conditionalFormatRangesEqual(cf, range)) ?? null;
  }

  /**
   * Set (add or replace) one cell's comment on the active worksheet.
   * Session-only view state, like {@link setValidation} — a direct mutation,
   * not an undoable history entry, and not persisted in the saved container
   * (see `src/core/cell-comment.ts`).
   */
  setComment(tab: Tab, row: number, col: number, text: string): boolean {
    const doc = tab.doc;
    if (doc.kind !== 'rsf') {
      return false;
    }
    const applied = doc.activeSheet.setComment(row, col, text);
    if (applied) {
      this.state.emit('doc');
    }
    return applied;
  }

  /** Clear one cell's comment on the active worksheet, if it has one. */
  clearComment(tab: Tab, row: number, col: number): boolean {
    const doc = tab.doc;
    if (doc.kind !== 'rsf') {
      return false;
    }
    const applied = doc.activeSheet.setComment(row, col, null);
    if (applied) {
      this.state.emit('doc');
    }
    return applied;
  }

  /** The comment on one cell of the active worksheet, or null. */
  commentAt(tab: Tab, row: number, col: number): string | null {
    const doc = tab.doc;
    if (doc.kind !== 'rsf') {
      return null;
    }
    return doc.activeSheet.getComment(row, col);
  }

  /** The active tab's workbook, or null when it is not an RSF document. */
  activeWorkbook(): RsfDocument | null {
    const tab = this.state.activeTab;
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
    view.wrap = tab.wrapCells;
    doc.activeSheet.displayZoom = tab.zoom;
    doc.activeSheet.displayColWidths = tab.colWidths.slice();
    doc.activeSheet.displayWrap = tab.wrapCells;
  }

  /**
   * Load the (now) active worksheet's remembered view into the tab. Called
   * back into by `AppState.applySheetOp` when undo/redo replays a worksheet
   * add/remove.
   */
  adoptActiveSheetView(tab: Tab, doc: RsfDocument): void {
    const sheet = doc.activeSheet;
    const view = sheet.view;
    tab.selection = view.selection ?? (sheet.rowCount > 0 ? { row: 0, col: 0 } : null);
    tab.anchor = view.anchor;
    tab.selectionKind = view.selectionKind;
    tab.zoom = clampSheetZoom(view.zoom ?? sheet.displayZoom ?? getSheetZoom());
    tab.colWidths = view.colWidths.length > 0 ? view.colWidths.slice() : sheet.displayColWidths.slice();
    tab.wrapCells = view.wrap ?? sheet.displayWrap ?? getWrapCells();
    this.state.clampSelection(tab);
  }

  /**
   * Switch worksheets, preserving each worksheet's own view state. Called
   * back into by `AppState.applyEntry`/`applySheetOp` when undo/redo replays
   * a worksheet switch or add/remove.
   */
  activateSheet(tab: Tab, doc: RsfDocument, sheetId: string): void {
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
    this.state.emit('sheets');
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
    const applied = this.state.pushEntry(tab, {
      label: 'history.addSheet',
      ops: [{ type: 'sheets', op: { action: 'add', sheet, index } }],
    });
    if (!applied) {
      return null;
    }
    this.state.emit('sheets');
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
    const applied = this.state.pushEntry(tab, {
      label: 'history.duplicateSheet',
      ops: [{ type: 'sheets', op: { action: 'add', sheet: copy, index } }],
    });
    if (!applied) {
      return null;
    }
    this.state.emit('sheets');
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
    const applied = this.state.pushEntry(tab, { label: 'history.renameSheet', ops });
    if (applied) {
      this.state.emit('sheets');
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
    const applied = this.state.pushEntry(tab, { label: 'history.deleteSheet', ops });
    if (applied) {
      this.state.emit('sheets');
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
    const applied = this.state.pushEntry(tab, {
      label: 'history.moveSheet',
      ops: [{ type: 'sheets', op: { action: 'move', sheetId, from, to } }],
    });
    if (applied) {
      this.state.emit('sheets');
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
}
