// SPDX-License-Identifier: MIT
/**
 * Cell edits, prebuilt history entries, CSV reverts, and undo/redo: the one
 * path through which document content changes. Every user-visible mutation
 * becomes exactly one `HistoryEntry` (knowledge/architecture/invariants.md,
 * "Atomic history"), guarded by {@link WriteGuards} before anything is
 * applied, and a committed line break turns wrapping on inside the same entry.
 */
import { isCsv, isWorkbook } from '../../core/editor-document';
import { filtersEqual } from '../../core/workbook/filter';
import { validationListsEqual } from '../../core/workbook/data-validation';
import type { CellChange, HistoryEntry, Operation, SheetOperation } from '../../core/workbook/history';
import type { RsfDocument } from '../../core/workbook/rsf-document';
import type { AppState } from './index';
import type { StructuralOpsState } from './structural-ops';
import type { Tab } from './types';
import type { WorksheetsState } from './worksheets';
import { deleteColWidths, insertColWidths } from './col-widths';
import type { WriteGuards } from './write-guards';

export class EditingState {
  constructor(
    private readonly state: AppState,
    private readonly guards: WriteGuards,
    private readonly structuralOps: StructuralOpsState,
    private readonly worksheetsState: WorksheetsState,
  ) {}

  /** Set one cell's value as a single undoable operation. */
  editCell(tab: Tab, row: number, col: number, value: string, label = 'history.editCell'): boolean {
    const retry = (): void => void this.editCell(tab, row, col, value, label);
    if (this.guards.refuseReadOnlyWrite(tab, retry) || this.guards.refuseLockedSheetWrite(tab, retry)) {
      return false;
    }
    if (isCsv(tab.doc)) {
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
      this.state.emit('doc');
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
      this.guards.refuseSpillWrite(tab, [{ row, col }]) ||
      this.guards.refuseSortedWrite(tab, [{ row, col }]) ||
      this.guards.refuseInvalidWrite(tab, [{ row, col, after: value }])
    ) {
      return false;
    }
    const sheetId = tab.doc.activeSheetId;
    const changes = [{ row, col, before, after: value }];
    this.applyChange(tab, changes[0], 'after', sheetId);
    const ops: Operation[] = [{ type: 'cells', changes, sheetId }];
    this.structuralOps.appendAutoWrap(tab, changes, ops, sheetId);
    tab.history.push({ label, ops, sheetId });
    this.state.emit('doc');
    return true;
  }

  /** Apply several cell changes as one atomic, singly-undoable operation. */
  bulkEdit(tab: Tab, changes: CellChange[], label: string): boolean {
    const effective = changes.filter((c) => c.before !== c.after);
    if (effective.length === 0) {
      return false;
    }
    const retry = (): void => void this.bulkEdit(tab, changes, label);
    if (
      this.guards.refuseReadOnlyWrite(tab, retry) ||
      this.guards.refuseLockedSheetWrite(tab, retry) ||
      this.guards.refuseSpillWrite(tab, effective) ||
      this.guards.refuseSortedWrite(tab, effective) ||
      this.guards.refuseInvalidWrite(tab, effective)
    ) {
      return false;
    }
    const sheetId = isWorkbook(tab.doc) ? tab.doc.activeSheetId : undefined;
    for (const change of effective) {
      this.applyChange(tab, change, 'after', sheetId);
    }
    const ops: Operation[] = [{ type: 'cells', changes: effective, ...(sheetId ? { sheetId } : {}) }];
    this.structuralOps.appendAutoWrap(tab, effective, ops, sheetId);
    tab.history.push({ label, ops, ...(sheetId ? { sheetId } : {}) });
    this.state.emit('doc');
    return true;
  }

  /** Push and apply a prebuilt multi-op entry atomically. */
  pushEntry(tab: Tab, entry: HistoryEntry): boolean {
    const nonEmpty = entry.ops.some((op) => {
      if (op.type === 'cells' || op.type === 'styles' || op.type === 'comments') {
        return op.changes.length > 0;
      }
      if (op.type === 'filter') {
        return !filtersEqual(op.before, op.after);
      }
      if (op.type === 'wrap') {
        return op.before !== op.after;
      }
      if (op.type === 'validations') {
        return !validationListsEqual(op.before, op.after);
      }
      if (op.type === 'sheets' || op.type === 'csvStructure') {
        return true;
      }
      return op.count > 0;
    });
    if (!nonEmpty) {
      return false;
    }
    const retry = (): void => void this.pushEntry(tab, entry);
    if (this.guards.refuseReadOnlyWrite(tab, retry)) {
      return false;
    }
    // A worksheet's lock blocks its own cell/structural/filter/wrap changes,
    // checked per operation (`op.sheetId`, defaulting to the active
    // worksheet) so an entry that also touches other, unlocked worksheets —
    // e.g. renaming a worksheet rewrites formulas across the whole workbook —
    // is not refused wholesale. `sheets` (worksheet lifecycle: add/remove/
    // rename/move) and `csvStructure` act on the workbook or a plain CSV
    // document rather than one worksheet's content, so they are exempt.
    for (const op of entry.ops) {
      if (op.type === 'sheets' || op.type === 'csvStructure') {
        continue;
      }
      if (this.guards.refuseLockedSheetWrite(tab, retry, op.sheetId)) {
        return false;
      }
    }
    // Structural operations (row/column insert and delete) move a spill's
    // anchor rather than writing into it, so only the cell writes are checked.
    for (const op of entry.ops) {
      if (
        op.type === 'cells' &&
        (this.guards.refuseSpillWrite(tab, op.changes) ||
          this.guards.refuseSortedWrite(tab, op.changes) ||
          this.guards.refuseInvalidWrite(tab, op.changes))
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
    this.state.clampSelection(tab);
    this.state.emit('doc');
    return true;
  }

  revertCell(tab: Tab, row: number, col: number): boolean {
    if (!isCsv(tab.doc) || !tab.doc.isEdited(row, col)) {
      return false;
    }
    return this.editCell(tab, row, col, tab.doc.getOriginalValue(row, col), 'history.revertCell');
  }

  revertAll(tab: Tab): boolean {
    if (!isCsv(tab.doc)) {
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
    this.state.clampSelection(tab);
    this.state.emit('doc');
    return entry;
  }

  redo(tab: Tab): HistoryEntry | null {
    const entry = tab.history.redo();
    if (!entry) {
      return null;
    }
    this.applyEntry(tab, entry, 'after');
    this.state.clampSelection(tab);
    this.state.emit('doc');
    return entry;
  }

  private applyEntry(tab: Tab, entry: HistoryEntry, direction: 'before' | 'after'): void {
    const ops = direction === 'after' ? entry.ops : [...entry.ops].reverse();
    for (const op of ops) {
      this.applyOp(tab, op, direction);
    }
    // Undo/redo must show the change where it happened rather than silently
    // altering a worksheet the user is not looking at.
    const doc = tab.doc;
    if (entry.sheetId !== undefined && isWorkbook(doc) && doc.sheetById(entry.sheetId)) {
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
      if (!isWorkbook(tab.doc)) {
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
    if (op.type === 'comments') {
      if (!isWorkbook(tab.doc)) {
        return;
      }
      const changes = direction === 'after' ? op.changes : [...op.changes].reverse();
      for (const change of changes) {
        tab.doc.setCommentOn(
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
    if (op.type === 'csvStructure') {
      tab.doc = direction === 'after' ? op.after : op.before;
      if (op.colWidths) {
        tab.colWidths = (direction === 'after' ? op.colWidths.after : op.colWidths.before).slice();
      }
      return;
    }
    const doc = tab.doc;
    if (!isWorkbook(doc)) {
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
    if (op.type === 'validations') {
      doc.setValidationsOn(op.sheetId, direction === 'after' ? op.after : op.before);
      return;
    }
    this.applyAxisOp(tab, doc, op, direction);
  }

  /** Apply (or invert) a whole-row or whole-column insert/delete. */
  private applyAxisOp(
    tab: Tab,
    doc: RsfDocument,
    op: Extract<Operation, { type: 'rows' | 'cols' }>,
    direction: 'before' | 'after',
  ): void {
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
      this.shiftColWidths(tab, doc, op, effective);
    }
  }

  /**
   * Move column widths with a column insert or delete, so a real insert
   * keeps every existing column at its own width and the new columns start
   * at the default. Undoing a delete restores the deleted columns' widths
   * (as does an insert that carries widths, e.g. the far half of a move).
   * The active worksheet's live widths are on the tab; any other worksheet
   * keeps them in its remembered view and persisted display settings.
   */
  private shiftColWidths(
    tab: Tab,
    doc: RsfDocument,
    op: Extract<Operation, { type: 'cols' }>,
    effective: 'insert' | 'delete',
  ): void {
    const shift = (widths: number[]): number[] =>
      effective === 'insert'
        ? insertColWidths(widths, op.index, op.count, op.widths)
        : deleteColWidths(widths, op.index, op.count);
    const sheet = op.sheetId === undefined ? doc.activeSheet : doc.sheetById(op.sheetId);
    if (!sheet) {
      return;
    }
    if (sheet === doc.activeSheet) {
      tab.colWidths = shift(tab.colWidths);
      return;
    }
    if (sheet.view.colWidths.length > 0) {
      sheet.view.colWidths = shift(sheet.view.colWidths);
    }
    sheet.displayColWidths = shift(sheet.displayColWidths);
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
      case 'tabColor':
        doc.setTabColor(op.sheetId, forward ? op.after : op.before);
        return;
      case 'organize':
        doc.applyOrganization(forward ? op.after : op.before);
        return;
    }
  }

  private applyChange(tab: Tab, change: CellChange, direction: 'before' | 'after', sheetId?: string): void {
    const value = direction === 'before' ? change.before : change.after;
    if (isCsv(tab.doc)) {
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
