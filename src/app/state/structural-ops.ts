// SPDX-License-Identifier: MIT
import { adjustFormulaForAxis, isFormula, sheetNameKey, shiftFormulaRefs } from '../../core/formula';
import type { CellChange, HistoryEntry, Operation } from '../../core/history';
import { RsfDocument, RSF_EXTENSION } from '../../core/rsf-document';
import {
  AppState,
  defaultSheetName,
  STICKY_KEY,
  type EditorDocument,
  type Selection,
  type Tab,
} from '../app-state';
import { getLocale, t } from '../i18n';
import { clampSheetZoom, setSheetZoom, setWrapCellsPreference } from '../settings';
import { safeStorageSet } from '../storage';

/**
 * Structural operations on RSF spreadsheet documents — row/column insert and
 * delete, pasted-range insertion, RSF conversion, save-baseline tracking, and
 * the view-only wrap/zoom/sticky-first-row settings. Extracted from
 * `AppState` as a cohesive slice (see issue #179, following the composition
 * pattern `FileIoCommands` established for `Commands` in issue #68) —
 * `AppState` still exposes the same public methods, delegating to an
 * instance of this class. A few of these methods (`applyWrap`,
 * `appendAutoWrap`) are also called back into by `AppState` itself, from the
 * cell-edit and undo/redo paths that stay there.
 */
export class StructuralOpsState {
  constructor(private readonly state: AppState) {}

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
        ...this.state.filterClearOpsFor(doc),
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
    return this.state.pushEntry(tab, entry);
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
        ...this.state.filterClearOpsFor(doc),
        { type: 'rows', action: 'delete', index, count, data, sheetId },
        { type: 'cells', changes: rewrites.active, sheetId },
        ...rewrites.others,
      ],
    };
    return this.state.pushEntry(tab, entry);
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
        ...this.state.filterClearOpsFor(doc),
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
    return this.state.pushEntry(tab, entry);
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
        ...this.state.filterClearOpsFor(doc),
        { type: 'cols', action: 'delete', index, count, data, sheetId },
        { type: 'cells', changes: rewrites.active, sheetId },
        ...rewrites.others,
      ],
    };
    return this.state.pushEntry(tab, entry);
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
    const ops: Operation[] = [...this.state.filterClearOpsFor(doc)];
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
    const applied = this.state.pushEntry(tab, { label: 'history.insertCells', sheetId, ops });
    if (applied) {
      this.state.setSelection(
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
    const doc = prebuilt ?? RsfDocument.fromLossless(tab.doc, name, defaultSheetName(), getLocale());
    doc.name = name;
    tab.doc = doc;
    tab.name = name;
    tab.handle = null;
    tab.history.clear();
    tab.rsfSaveExplained = false;
    this.state.clampSelection(tab);
    this.state.emit('tabs');
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
    const doc = prebuilt ?? RsfDocument.fromLossless(tab.doc, name, defaultSheetName(), getLocale());
    doc.name = name;
    doc.markUnsaved();
    this.state.addTab(name, doc, null);
    return doc;
  }

  /**
   * After a successful save, the saved byte sequence becomes the new
   * baseline document and the history is cleared.
   */
  setBaseline(tab: Tab, doc: EditorDocument): void {
    tab.doc = doc;
    tab.history.clear();
    this.state.clampSelection(tab);
    this.state.emit('doc');
  }

  /** Mark an RSF tab saved (its in-memory document is the baseline). */
  markTabSaved(tab: Tab): void {
    if (tab.doc.kind === 'rsf') {
      tab.doc.markSaved();
      tab.history.clear();
      this.state.emit('doc');
    }
  }

  /**
   * Turn wrapping on/off for the active tab. Purely visual: it never changes
   * document content, CSV bytes, or the dirty state. The choice also becomes
   * the application-level preference (used by documents that store none), and
   * an RSF worksheet remembers it for persistence with the next save.
   */
  setWrapCells(wrap: boolean): void {
    setWrapCellsPreference(wrap);
    const tab = this.state.activeTab;
    if (!tab) {
      this.state.emit('view');
      return;
    }
    this.applyWrap(tab, wrap);
    this.state.emit('view');
  }

  /**
   * Set a tab's (and its active worksheet's) wrap state without emitting.
   * Also called back into by `AppState.applyOp` when undo/redo replays a
   * recorded `wrap` operation.
   */
  applyWrap(tab: Tab, wrap: boolean, sheetId?: string): void {
    if (tab.doc.kind === 'rsf') {
      tab.doc.setDisplayWrapOn(sheetId, wrap);
      // Only the *active* worksheet's state is what the grid renders.
      if (sheetId === undefined || sheetId === tab.doc.activeSheetId) {
        tab.wrapCells = wrap;
      }
      return;
    }
    tab.wrapCells = wrap;
  }

  /**
   * Number of formula cells whose evaluated value an edit will inspect when
   * deciding whether wrapping must be turned on. Literal (non-formula) values
   * are free to check — the committed text *is* what is displayed — so this
   * bound only applies to formulas, whose result must actually be computed.
   * Beyond it the automatic enable is simply not triggered; wrapping remains
   * available from the View menu.
   */
  private static readonly AUTO_WRAP_FORMULA_SCAN_LIMIT = 20_000;

  /**
   * The `wrap` operation an edit implies, or null when nothing should change.
   *
   * The decision is made on the **displayed** value, never on formula source:
   * `="a\nb"` is a formula whose *result* contains a line break (wrap on),
   * while `=CONCAT(A1,"\n")` written as source text with an escape sequence is
   * not a line break at all. Literal values are checked directly; formula
   * cells are evaluated (bounded by
   * {@link StructuralOpsState.AUTO_WRAP_FORMULA_SCAN_LIMIT}).
   *
   * Call *after* the cell changes have been applied, so the values inspected
   * are the committed ones.
   */
  private autoWrapOp(
    tab: Tab,
    changes: readonly CellChange[],
    sheetId?: string,
  ): Extract<Operation, { type: 'wrap' }> | null {
    if (tab.wrapCells || changes.length === 0) {
      return null; // already wrapping: nothing to turn on
    }
    const doc = tab.doc;
    let formulasScanned = 0;
    let found = false;
    for (const change of changes) {
      const after = change.after;
      if (after === null) {
        continue; // a revert to the original CSV value cannot introduce one
      }
      if (!isFormula(after)) {
        if (after.includes('\n')) {
          found = true;
          break;
        }
        continue;
      }
      if (formulasScanned >= StructuralOpsState.AUTO_WRAP_FORMULA_SCAN_LIMIT) {
        continue;
      }
      formulasScanned += 1;
      const shown =
        doc.kind === 'rsf' && sheetId !== undefined
          ? doc.getSheetDisplayValue(sheetId, change.row, change.col)
          : doc.getDisplayValue(change.row, change.col);
      if (shown.includes('\n')) {
        found = true;
        break;
      }
    }
    if (!found) {
      return null;
    }
    return { type: 'wrap', before: false, after: true, ...(sheetId === undefined ? {} : { sheetId }) };
  }

  /**
   * Apply and record the automatic wrap enable implied by `changes`, appending
   * it to `ops` so the edit and the display change undo together as one
   * operation. Announces the change politely — it is never a dialog. Called
   * back into by `AppState.editCell`/`bulkEdit`/`pushEntry`, which stay on
   * `AppState` because they also drive plain cell edits, not just structural
   * ones.
   */
  appendAutoWrap(tab: Tab, changes: readonly CellChange[], ops: Operation[], sheetId?: string): void {
    const op = this.autoWrapOp(tab, changes, sheetId);
    if (!op) {
      return;
    }
    ops.push(op);
    this.applyWrap(tab, op.after, op.sheetId);
    this.state.announce?.(t('notify.wrapEnabled'));
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
      this.state.emit('view');
    }
  }

  setStickyFirstRow(sticky: boolean): void {
    this.state.stickyFirstRow = sticky;
    safeStorageSet(STICKY_KEY, sticky ? '1' : '0');
    this.state.emit('view');
  }

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
}
