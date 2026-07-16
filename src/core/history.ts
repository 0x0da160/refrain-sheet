// SPDX-License-Identifier: MIT

/**
 * One cell change inside a history entry. `null` means "no edit" (the cell
 * shows its original value).
 */
export interface CellChange {
  row: number;
  col: number;
  before: string | null;
  after: string | null;
}

export interface HistoryEntry {
  /** i18n key describing the operation (for menus / tooltips). */
  label: string;
  changes: CellChange[];
}

/**
 * Undo/redo stacks over cell-edit operations. Multi-cell operations such as
 * Replace All or Revert All are pushed as a single entry, so one Undo undoes
 * the whole operation atomically.
 */
export class History {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];

  push(entry: HistoryEntry): void {
    if (entry.changes.length === 0) {
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
