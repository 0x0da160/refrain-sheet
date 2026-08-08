// SPDX-License-Identifier: MIT
import { isValidSheetName, MAX_SHEET_NAME_LENGTH } from '../../core/formula';
import { MAX_WORKSHEETS, RsfDocument } from '../../core/rsf-document';
import { forEachIndexSliced } from '../../core/scheduler';
import type { Worksheet } from '../../core/worksheet';
import { AppState, type Tab } from '../app-state';
import { t } from '../i18n';
import type { CommandId, ConvertReason, UiPort } from '../commands';
import { LARGE_OP_CELLS, pct, withBusy } from './shared';

/**
 * Worksheet lifecycle within an RSF workbook — add, rename, duplicate,
 * delete, reorder, and cycle worksheets, plus the row/column structural
 * commands driven by the selected range. Extracted from `Commands` as a
 * cohesive slice (see issue #129, following the composition pattern
 * `FileIoCommands` established for issue #68) — `Commands` still exposes
 * the same public/private methods, delegating to an instance of this class.
 */
export class WorksheetCommands {
  constructor(
    private readonly state: AppState,
    private readonly ui: UiPort,
    private readonly ensureRsf: (tab: Tab, reason: ConvertReason) => Promise<RsfDocument | null>,
  ) {}

  /**
   * Validate a proposed worksheet name against the documented policy —
   * non-empty after trimming, within {@link MAX_SHEET_NAME_LENGTH}, free of
   * characters the formula and file syntax reserve, and unique
   * case-insensitively — returning an already-localized message or null.
   */
  validateSheetName(doc: RsfDocument, name: string, exceptId?: string): string | null {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      return t('sheet.error.empty');
    }
    if (trimmed.length > MAX_SHEET_NAME_LENGTH) {
      return t('sheet.error.tooLong', { max: MAX_SHEET_NAME_LENGTH });
    }
    if (!isValidSheetName(trimmed)) {
      return t('sheet.error.chars');
    }
    if (!doc.isSheetNameAvailable(trimmed, exceptId)) {
      return t('sheet.error.duplicate', { name: trimmed });
    }
    return null;
  }

  /** True when the workbook can still take another worksheet (warns when not). */
  canAddWorksheet(doc: RsfDocument): boolean {
    if (doc.sheetCount < MAX_WORKSHEETS) {
      return true;
    }
    this.ui.notify(t('notify.sheetLimit', { max: MAX_WORKSHEETS }), 'warn');
    return false;
  }

  /** Add a new empty worksheet after the active one and activate it. */
  async addWorksheet(tab: Tab): Promise<void> {
    const doc = tab.doc;
    if (doc.kind !== 'rsf' || !this.canAddWorksheet(doc)) {
      return;
    }
    const suggested = doc.uniqueSheetName(t('sheet.defaultName', { n: doc.sheetCount + 1 }));
    const name = await this.ui.promptSheetName('add', suggested, (candidate) =>
      this.validateSheetName(doc, candidate),
    );
    if (name === null || tab.doc !== doc) {
      return;
    }
    const sheet = this.state.addSheet(tab, name.trim());
    if (sheet) {
      this.ui.notify(t('notify.sheetAdded', { name: sheet.name }), 'info');
    }
  }

  /** Rename the active worksheet, updating cross-sheet formulas workbook-wide. */
  async renameWorksheet(tab: Tab): Promise<void> {
    const doc = tab.doc;
    if (doc.kind !== 'rsf') {
      return;
    }
    const sheet = doc.activeSheet;
    const before = sheet.name;
    const name = await this.ui.promptSheetName('rename', before, (candidate) =>
      this.validateSheetName(doc, candidate, sheet.id),
    );
    if (name === null || tab.doc !== doc) {
      return;
    }
    if (this.state.renameSheet(tab, sheet.id, name.trim())) {
      this.ui.notify(t('notify.sheetRenamed', { before, after: name.trim() }), 'info');
    }
  }

  /**
   * Duplicate the active worksheet. Large worksheets are copied in cooperative
   * time slices behind a percentage progress label; the copy is built to the
   * side and only inserted once it is complete, so cancelling (or a tab
   * change) leaves the workbook exactly as it was.
   */
  async duplicateWorksheet(tab: Tab): Promise<void> {
    const doc = tab.doc;
    if (doc.kind !== 'rsf' || !this.canAddWorksheet(doc)) {
      return;
    }
    const source = doc.activeSheet;
    const suggested = doc.uniqueSheetName(t('sheet.copyName', { name: source.name }));
    const name = await this.ui.promptSheetName('duplicate', suggested, (candidate) =>
      this.validateSheetName(doc, candidate),
    );
    if (name === null || tab.doc !== doc) {
      return;
    }
    const finalName = name.trim();
    let prebuilt: Worksheet | undefined;
    if (source.rowCount * source.columnCount > LARGE_OP_CELLS) {
      const label = t('loading.duplicatingSheet', { name: source.name });
      const built = await withBusy(this.ui, label, async () => {
        const shell = doc.duplicateWorksheetShell(source.id, finalName);
        if (!shell) {
          return null;
        }
        const completed = await forEachIndexSliced(source.rowCount, (r) => source.copyRowInto(r, shell), {
          onProgress: (done, total) => this.ui.setBusy(`${label} (${pct(done, total)}%)`, pct(done, total)),
          shouldStop: () => tab.doc !== doc,
        });
        // An abandoned copy is simply discarded: nothing was inserted.
        return completed && tab.doc === doc ? shell : null;
      });
      if (!built) {
        return;
      }
      prebuilt = built;
    }
    const copy = this.state.duplicateSheet(tab, source.id, finalName, prebuilt);
    if (copy) {
      this.ui.notify(t('notify.sheetDuplicated', { name: copy.name }), 'info');
    }
  }

  /**
   * Delete the active worksheet. A workbook always keeps at least one
   * worksheet. Deletion is confirmed whenever the worksheet holds meaningful
   * content — cell data, a filter, or non-default display settings — or when
   * formulas elsewhere reference it, and the confirmation states how many
   * formulas will become #REF!.
   */
  async deleteWorksheet(tab: Tab): Promise<void> {
    const doc = tab.doc;
    if (doc.kind !== 'rsf') {
      return;
    }
    if (doc.sheetCount <= 1) {
      this.ui.notify(t('notify.cannotDeleteLastSheet'), 'warn');
      return;
    }
    const sheet = doc.activeSheet;
    const references = this.state.countReferencesToSheet(doc, sheet.id);
    const meaningful =
      sheet.hasAnyContent() ||
      sheet.filter !== null ||
      sheet.displayZoom !== undefined ||
      sheet.displayColWidths.some((w) => w > 0) ||
      references > 0;
    if (meaningful) {
      const ok = await this.ui.confirmDeleteSheet(sheet.name, references);
      if (!ok || tab.doc !== doc) {
        return;
      }
    }
    if (this.state.deleteSheet(tab, sheet.id)) {
      this.ui.notify(t('notify.sheetDeleted', { name: sheet.name }), 'info');
    }
  }

  /** Move the active worksheet within the workbook's worksheet order. */
  moveActiveWorksheet(tab: Tab, id: CommandId): void {
    const doc = tab.doc;
    if (doc.kind !== 'rsf') {
      return;
    }
    const from = doc.sheetIndex(doc.activeSheetId);
    const last = doc.sheetCount - 1;
    const to =
      id === 'worksheet.moveLeft'
        ? from - 1
        : id === 'worksheet.moveRight'
          ? from + 1
          : id === 'worksheet.moveFirst'
            ? 0
            : last;
    if (this.state.moveSheet(tab, doc.activeSheetId, to)) {
      this.ui.notify(
        t('notify.sheetMoved', {
          name: doc.activeSheet.name,
          pos: doc.sheetIndex(doc.activeSheetId) + 1,
          total: doc.sheetCount,
        }),
        'info',
      );
    }
  }

  /** Activate the next/previous worksheet, wrapping around. */
  cycleWorksheet(tab: Tab, offset: number): void {
    const doc = tab.doc;
    if (doc.kind !== 'rsf' || doc.sheetCount < 2) {
      return;
    }
    const index = doc.sheetIndex(doc.activeSheetId);
    const next = doc.sheets[(index + offset + doc.sheetCount) % doc.sheetCount];
    this.state.setActiveSheet(tab, next.id);
  }

  /** Row/column structural commands, driven by the selected range. */
  async runSheetOp(tab: Tab, id: CommandId): Promise<void> {
    const range = this.state.selectedRange(tab);
    if (!range) {
      return;
    }
    const doc = await this.ensureRsf(tab, 'structure');
    if (!doc) {
      return;
    }
    const clampedRange = this.state.selectedRange(tab) ?? range;
    const rows = clampedRange.bottom - clampedRange.top + 1;
    const cols = clampedRange.right - clampedRange.left + 1;
    // Structural row/column changes clear an active filter atomically (its
    // stored range would otherwise drift against the moved rows — documented
    // behavior; Undo restores structure and filter together). The user is
    // told when that happened. An active sort is dropped the same way (see
    // `Worksheet.insertRows` etc.) but, being session-only view state, is not
    // restored by undo.
    const hadFilter = doc.filter !== null;
    const hadSort = doc.sort !== null;
    const done = (applied: boolean): void => {
      if (applied && hadFilter && doc.filter === null) {
        this.ui.notify(t('notify.filterClearedByStructure'), 'info');
      }
      if (applied && hadSort && doc.sort === null) {
        this.ui.notify(t('notify.sortClearedByStructure'), 'info');
      }
    };
    switch (id) {
      case 'sheet.insertRowAbove':
        done(this.state.insertRows(tab, clampedRange.top, rows));
        return;
      case 'sheet.insertRowBelow':
        done(this.state.insertRows(tab, clampedRange.bottom + 1, rows));
        return;
      case 'sheet.deleteRows': {
        if (rows >= doc.rowCount) {
          this.ui.notify(t('notify.cannotDeleteAll'), 'warn');
          return;
        }
        if (this.state.hasContent(tab, 'row', clampedRange.top, rows)) {
          const ok = await this.ui.confirm(
            t('dialog.deleteRows.title'),
            t('dialog.deleteRows.message', { n: rows }),
            t('dialog.delete.ok'),
            t('dialog.delete.cancel'),
          );
          if (!ok) {
            return;
          }
        }
        done(this.state.deleteRows(tab, clampedRange.top, rows));
        return;
      }
      case 'sheet.insertColLeft':
        done(this.state.insertCols(tab, clampedRange.left, cols));
        return;
      case 'sheet.insertColRight':
        done(this.state.insertCols(tab, clampedRange.right + 1, cols));
        return;
      case 'sheet.deleteCols': {
        if (cols >= doc.columnCount) {
          this.ui.notify(t('notify.cannotDeleteAll'), 'warn');
          return;
        }
        if (this.state.hasContent(tab, 'col', clampedRange.left, cols)) {
          const ok = await this.ui.confirm(
            t('dialog.deleteCols.title'),
            t('dialog.deleteCols.message', { n: cols }),
            t('dialog.delete.ok'),
            t('dialog.delete.cancel'),
          );
          if (!ok) {
            return;
          }
        }
        done(this.state.deleteCols(tab, clampedRange.left, cols));
        return;
      }
    }
  }
}
