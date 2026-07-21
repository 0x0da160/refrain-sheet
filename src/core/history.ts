// SPDX-License-Identifier: MIT
import type { SheetFilter } from './filter';

/**
 * One cell change inside a history operation. For CSV documents `null`
 * means "no edit" (the cell shows its original value); for RSF documents
 * values are always strings (the cell input).
 */
export interface CellChange {
  row: number;
  col: number;
  before: string | null;
  after: string | null;
}

/**
 * One atomic sub-operation of a history entry. Structural operations
 * (row/column insertion and deletion) and filter-state changes exist only for
 * RSF spreadsheet documents; `data` carries the affected row/column contents
 * so deletion is undoable. Column data is column-major. A `filter` operation
 * swaps the document's whole filter state (never cell values), so applying and
 * clearing filters undo/redo exactly like any other document operation.
 */
export type Operation =
  | { type: 'cells'; changes: CellChange[] }
  | { type: 'rows'; action: 'insert' | 'delete'; index: number; count: number; data: string[][] }
  | { type: 'cols'; action: 'insert' | 'delete'; index: number; count: number; data: string[][] }
  | { type: 'filter'; before: SheetFilter | null; after: SheetFilter | null };

export interface HistoryEntry {
  /** i18n key describing the operation (for menus / tooltips). */
  label: string;
  /** Applied in order on redo, inverted in reverse order on undo. */
  ops: Operation[];
}

/** Convenience constructor for the common single-op cell-change entry. */
export function cellsEntry(label: string, changes: CellChange[]): HistoryEntry {
  return { label, ops: [{ type: 'cells', changes }] };
}

function isEmpty(entry: HistoryEntry): boolean {
  return entry.ops.every((op) => {
    if (op.type === 'cells') {
      return op.changes.length === 0;
    }
    if (op.type === 'filter') {
      return op.before === op.after;
    }
    return op.count === 0;
  });
}

/**
 * Undo/redo stacks over document operations. Multi-cell operations such as
 * Replace All, range paste, or a row deletion with its formula-reference
 * rewrites are pushed as a single entry, so one Undo undoes the whole
 * operation atomically.
 */
export class History {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];

  push(entry: HistoryEntry): void {
    if (isEmpty(entry)) {
      return;
    }
    this.undoStack.push(entry);
    this.redoStack = [];
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): HistoryEntry | null {
    const entry = this.undoStack.pop();
    if (!entry) {
      return null;
    }
    this.redoStack.push(entry);
    return entry;
  }

  redo(): HistoryEntry | null {
    const entry = this.redoStack.pop();
    if (!entry) {
      return null;
    }
    this.undoStack.push(entry);
    return entry;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
