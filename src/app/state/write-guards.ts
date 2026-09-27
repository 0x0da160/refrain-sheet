// SPDX-License-Identifier: MIT
/**
 * The checks every user-initiated write passes before it touches a document:
 * read-only protection, locked worksheets, dynamic-array spill ranges, an
 * active sort, and data validation. Each `refuse…` method announces why and
 * returns true when the caller must stop. Undo and redo deliberately bypass
 * these: they restore inputs rather than make new ones.
 */
import { isWorkbook } from '../../core/editor-document';
import { cellLabel } from '../../core/formula';
import { checkValidationValue, findValidation } from '../../core/workbook/data-validation';
import { sortDataTop } from '../../core/workbook/sort';
import { t } from '../i18n';
import type { AppState } from './index';
import type { Tab } from './types';

export class WriteGuards {
  constructor(private readonly state: AppState) {}

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
    if (!isWorkbook(doc) || cells.length === 0 || !doc.hasSpills()) {
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
  refuseSpillWrite(tab: Tab, cells: ReadonlyArray<{ row: number; col: number }>): boolean {
    const anchor = this.spillBlocked(tab, cells);
    if (!anchor) {
      return false;
    }
    this.state.announce?.(t('notify.spillProtected', { cell: cellLabel(anchor.row, anchor.col) }));
    return true;
  }

  /**
   * Refuse a write to a read-only-protected tab, announcing why. Checked
   * first in every mutating entry point (`editCell`, `bulkEdit`, `pushEntry`,
   * and — before it even touches the document — `FileIoCommands.ensureRsf`),
   * so a protected tab can be neither edited nor silently converted to RSF.
   * Returns true when the caller must stop; `retry` repeats the refused call
   * after the user unlocks (see `warnBlocked`).
   */
  refuseReadOnlyWrite(tab: Tab, retry: () => void): boolean {
    if (!tab.readOnly) {
      return false;
    }
    this.state.warnBlocked?.(tab, 'book', retry);
    return true;
  }

  /**
   * Refuse a write to a locked worksheet, announcing why. A worksheet's lock
   * (Sheet ▸ Lock Sheet, or its tab context menu) blocks edits to that
   * worksheet only — every other worksheet in the workbook stays editable.
   * Checked in every mutating entry point that can target a single worksheet
   * (`editCell`, `bulkEdit`, and, per operation, `pushEntry`), exactly like
   * {@link refuseReadOnlyWrite}'s whole-tab protection. `sheetId` defaults to
   * the active worksheet, matching how an absent `Operation.sheetId` is
   * documented to apply to it. Returns true when the caller must stop.
   */
  refuseLockedSheetWrite(tab: Tab, retry: () => void, sheetId?: string): boolean {
    const doc = tab.doc;
    if (!isWorkbook(doc)) {
      return false;
    }
    const sheet = doc.sheetById(sheetId ?? doc.activeSheetId);
    if (!sheet?.locked) {
      return false;
    }
    this.state.warnBlocked?.(tab, 'sheet', retry, sheet.id);
    return true;
  }

  /**
   * Refuse a write that would land inside an active sort's range, announcing
   * why. Editing a sorted range is disabled — rather than translated cell by
   * cell — so a sort can never turn "edit what I see" into a silent write to
   * an unrelated document row; clearing the sort (Sheet ▸ Clear Sort) always
   * re-enables editing. Returns true when the caller must stop.
   */
  refuseSortedWrite(tab: Tab, cells: ReadonlyArray<{ row: number; col: number }>): boolean {
    const doc = tab.doc;
    if (!isWorkbook(doc) || doc.sort === null) {
      return false;
    }
    const sort = doc.sort;
    const dataTop = sortDataTop(sort);
    if (!cells.some((cell) => cell.row >= dataTop && cell.row <= sort.bottom)) {
      return false;
    }
    this.state.announce?.(t('notify.sortedRangeReadOnly'));
    return true;
  }

  /**
   * Refuse a write whose new value violates the data-validation rule covering
   * that cell, announcing why. Blank values always pass (clearing a cell is
   * never itself invalid), and only RSF documents carry rules. Returns true
   * when the caller must stop.
   */
  refuseInvalidWrite(
    tab: Tab,
    changes: ReadonlyArray<{ row: number; col: number; after: string | null }>,
  ): boolean {
    const doc = tab.doc;
    if (!isWorkbook(doc) || doc.validations.length === 0) {
      return false;
    }
    for (const change of changes) {
      const rule = findValidation(doc.validations, change.row, change.col);
      if (rule && !checkValidationValue(rule.rule, change.after ?? '')) {
        this.state.announce?.(t('notify.invalidValue', { cell: cellLabel(change.row, change.col) }));
        return true;
      }
    }
    return false;
  }
}
