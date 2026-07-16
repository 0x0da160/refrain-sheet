// SPDX-License-Identifier: MIT
import { History, type CellChange, type HistoryEntry } from '../core/history';
import type { LosslessDocument } from '../core/lossless-document';

export interface Selection {
  row: number;
  col: number;
}

export interface Tab {
  id: string;
  name: string;
  doc: LosslessDocument;
  history: History;
  handle: FileSystemFileHandle | null;
  selection: Selection | null;
}

export type StateEventType = 'tabs' | 'active' | 'doc' | 'selection' | 'view';

let nextTabId = 1;

/**
 * Application state: open tabs, the active tab, selections, and the
 * undo/redo integration. All mutations go through this class so every UI
 * surface (menus, toolbar, shortcuts, drag-and-drop) observes the same state.
 */
export class AppState {
  tabs: Tab[] = [];
  activeTabId: string | null = null;
  wrapCells = false;

  private listeners = new Set<(event: StateEventType) => void>();

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

  addTab(name: string, doc: LosslessDocument, handle: FileSystemFileHandle | null): Tab {
    const tab: Tab = {
      id: `tab-${nextTabId++}`,
      name,
      doc,
      history: new History(),
      handle,
      selection: doc.rowCount > 0 ? { row: 0, col: 0 } : null,
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
   * detectable through browser file APIs (see README).
   */
  findTabForFile(name: string, bytes: Uint8Array): Tab | null {
    for (const tab of this.tabs) {
      if (tab.name !== name || tab.doc.bytes.length !== bytes.length) {
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

  setSelection(tab: Tab, selection: Selection | null): void {
    tab.selection = selection;
    this.emit('selection');
  }

  /** Set one cell's value as a single undoable operation. */
  editCell(tab: Tab, row: number, col: number, value: string, label = 'history.editCell'): boolean {
    const field = tab.doc.getField(row, col);
    if (!field) {
      return false;
    }
    const before = tab.doc.isEdited(row, col) ? tab.doc.getValue(row, col) : null;
    const after = value === field.value ? null : value;
    if (before === after) {
      return false;
    }
    tab.history.push({ label, changes: [{ row, col, before, after }] });
    this.applyChange(tab, { row, col, before, after }, 'after');
    this.emit('doc');
    return true;
  }

  /** Apply several cell changes as one atomic, singly-undoable operation. */
  bulkEdit(tab: Tab, changes: CellChange[], label: string): boolean {
    const effective = changes.filter((c) => c.before !== c.after);
    if (effective.length === 0) {
      return false;
    }
    tab.history.push({ label, changes: effective });
    for (const change of effective) {
      this.applyChange(tab, change, 'after');
    }
    this.emit('doc');
    return true;
  }

  revertCell(tab: Tab, row: number, col: number): boolean {
    if (!tab.doc.isEdited(row, col)) {
      return false;
    }
    return this.editCell(tab, row, col, tab.doc.getOriginalValue(row, col), 'history.revertCell');
  }

  revertAll(tab: Tab): boolean {
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
    for (const change of entry.changes) {
      this.applyChange(tab, change, 'before');
    }
    this.emit('doc');
    return entry;
  }

  redo(tab: Tab): HistoryEntry | null {
    const entry = tab.history.redo();
    if (!entry) {
      return null;
    }
    for (const change of entry.changes) {
      this.applyChange(tab, change, 'after');
    }
    this.emit('doc');
    return entry;
  }

  /**
   * After a successful save, the saved byte sequence becomes the new
   * baseline document and the history is cleared.
   */
  setBaseline(tab: Tab, doc: LosslessDocument): void {
    tab.doc = doc;
    tab.history.clear();
    if (tab.selection && tab.selection.row >= doc.rowCount) {
      tab.selection = doc.rowCount > 0 ? { row: 0, col: 0 } : null;
    }
    this.emit('doc');
  }

  setWrapCells(wrap: boolean): void {
    this.wrapCells = wrap;
    this.emit('view');
  }

  private applyChange(tab: Tab, change: CellChange, direction: 'before' | 'after'): void {
    const value = direction === 'before' ? change.before : change.after;
    if (value === null) {
      tab.doc.revert(change.row, change.col);
    } else {
      tab.doc.setValue(change.row, change.col, value);
    }
  }
}
