// SPDX-License-Identifier: MIT
import type { CellRange } from '../../core/clipboard';
import { cellLabel, columnLabel, parseRef } from '../../core/formula';
import type { CellChange, Operation } from '../../core/history';
import { moveTarget, planRangeMove, validateMove, type RangeMovePlan } from '../../core/range-move';
import type { RsfDocument } from '../../core/rsf-document';
import { forEachIndexSliced, yieldToBrowser } from '../../core/scheduler';
import { replaceAllInValue, type CompiledQuery, type SearchScope } from '../../core/search';
import { AppState, type Tab } from '../app-state';
import { t } from '../i18n';
import type { UiPort } from '../commands';
import { LARGE_OP_CELLS, pct, withBusy } from './shared';

/** What a Replace All actually did, for the find bar's status line. */
export interface ReplaceAllReport {
  /** Total replacements made (a cell can contain several). */
  count: number;
  /** Number of cells changed. */
  cells: number;
  /** Number of worksheets changed (always 0 or 1 for a single-sheet scope). */
  sheets: number;
  /** Cells that matched during the scan but no longer did when applied. */
  skipped: number;
  /** False when a workbook-wide replace was declined at the confirmation. */
  confirmed: boolean;
}

/**
 * Moving a selected range (RSF worksheets only) and Find/Replace All (single
 * sheet and workbook-wide). Extracted from `Commands` as a cohesive slice
 * (see issue #68's extraction pattern, established by
 * `src/app/commands/file-io.ts`) — `Commands` still exposes the same public
 * methods, delegating to an instance of this class. This is the `Commands`-
 * layer dispatch code, distinct from (and a consumer of) the pure planning
 * logic in `src/core/range-move.ts` and `src/core/search.ts`.
 */
export class RangeOpsCommands {
  constructor(
    private readonly state: AppState,
    private readonly ui: UiPort,
  ) {}

  /** Clear every cell in the selected range as one undoable operation.
   *  Rows hidden by an active filter are never modified (documented). */
  clearRange(tab: Tab): boolean {
    const range = this.state.selectedRange(tab);
    if (!range) {
      return false;
    }
    const doc = tab.doc;
    const hidden = this.state.hiddenRows(tab);
    const changes: CellChange[] = [];
    for (let r = range.top; r <= range.bottom; r++) {
      if (hidden?.has(r)) {
        continue;
      }
      const cols = Math.min(range.right + 1, doc.fieldCount(r));
      for (let c = range.left; c < cols; c++) {
        const current = doc.getValue(r, c);
        if (current === '') {
          continue;
        }
        if (doc.kind === 'csv') {
          const before = doc.isEdited(r, c) ? current : null;
          const after = doc.getOriginalValue(r, c) === '' ? null : '';
          changes.push({ row: r, col: c, before, after });
        } else {
          changes.push({ row: r, col: c, before: current, after: '' });
        }
      }
    }
    return this.state.bulkEdit(tab, changes, 'history.clearRange');
  }

  // ----- Moving a selected range (RSF worksheets only) -----

  /**
   * "Move Selected Cells…": the keyboard-equivalent of dragging the selection.
   * Asks for a destination in A1 notation, validating it live against the
   * worksheet bounds, then runs exactly the same move the drag gesture does —
   * including the overwrite confirmation — so nothing about the feature depends
   * on a pointer.
   */
  async promptAndMoveRange(tab: Tab): Promise<boolean> {
    const range = this.state.selectedRange(tab);
    if (!range) {
      return false;
    }
    if (tab.doc.kind !== 'rsf') {
      // Structural editing a byte-preserving CSV cannot represent.
      await this.ui.showMessage(t('dialog.moveRange.title'), t('move.csvOnly'));
      return false;
    }
    const doc = tab.doc;
    const height = range.bottom - range.top + 1;
    const width = range.right - range.left + 1;
    const validate = (text: string): string | null => {
      const at = parseRef(text.trim());
      if (!at) {
        return t('move.error.invalid');
      }
      if (at.row + height > doc.rowCount || at.col + width > doc.columnCount) {
        return t('move.error.outOfBounds', {
          rows: doc.rowCount,
          cols: columnLabel(doc.columnCount - 1),
        });
      }
      if (at.row === range.top && at.col === range.left) {
        return t('move.error.sameplace');
      }
      return null;
    };
    const answer = await this.ui.promptMoveTarget(
      rangeText(range),
      cellLabel(range.top, range.left),
      validate,
    );
    if (answer === null) {
      return false;
    }
    const at = parseRef(answer.trim());
    if (!at || validate(answer) !== null || tab.doc !== doc) {
      return false;
    }
    return this.moveRange(tab, range, at.row - range.top, at.col - range.left);
  }

  /**
   * Move the selected rectangle by (deltaRow, deltaCol) as one atomic,
   * singly-undoable operation.
   *
   * The whole change — the moved values, the vacated cells, and every formula
   * reference rewrite the move implies across the *entire workbook* — is
   * planned from current values before anything is written, so the document is
   * never partially moved. A destination holding data is never replaced without
   * an explicit confirmation that states the range and how many cells it would
   * replace. Large moves plan in cooperative time slices behind honest progress
   * and abandon the plan (touching nothing) if the document, worksheet, or
   * selection moves underneath them.
   */
  async moveRange(tab: Tab, source: CellRange, deltaRow: number, deltaCol: number): Promise<boolean> {
    const doc = tab.doc;
    if (doc.kind !== 'rsf') {
      this.ui.notify(t('move.csvOnly'), 'warn');
      return false;
    }
    const sheet = doc.activeSheet;
    const sheetId = sheet.id;
    const target = moveTarget(source, deltaRow, deltaCol);
    const rejection = validateMove(sheet, target);
    if (rejection === 'no-op') {
      return false;
    }
    if (rejection === 'out-of-bounds') {
      this.ui.notify(t('move.outOfBounds'), 'warn');
      return false;
    }
    const cells = (source.bottom - source.top + 1) * (source.right - source.left + 1);
    const buildPlan = (): RangeMovePlan | null =>
      tab.doc !== doc || doc.activeSheetId !== sheetId
        ? null
        : planRangeMove(sheet, source, deltaRow, deltaCol, doc.sheets);
    // Small moves plan synchronously (imperceptible); large ones plan behind
    // the busy indicator so the main thread yields a paint first.
    const plan =
      cells >= LARGE_OP_CELLS
        ? await withBusy(this.ui, t('loading.movingRange'), async () => {
            await yieldToBrowser();
            return buildPlan();
          })
        : buildPlan();
    if (!plan || tab.doc !== doc || doc.activeSheetId !== sheetId) {
      return false;
    }
    if (plan.overwriteCount > 0) {
      const ok = await this.ui.confirmRangeMoveOverwrite({
        target: rangeText(plan.target),
        overwriteCount: plan.overwriteCount,
        movedCells: plan.movedCells,
      });
      // The dialog yielded: re-verify before mutating anything.
      if (!ok || tab.doc !== doc || doc.activeSheetId !== sheetId) {
        return false;
      }
    }
    const ops: Operation[] = [
      ...this.state.filterClearOpsFor(doc),
      { type: 'cells', changes: plan.changes, sheetId },
    ];
    for (const [otherId, changes] of plan.otherSheetChanges) {
      ops.push({ type: 'cells', changes, sheetId: otherId });
    }
    const applied = this.state.pushEntry(tab, { label: 'history.moveRange', sheetId, ops });
    if (applied) {
      this.state.setSelection(
        tab,
        { row: plan.target.top, col: plan.target.left },
        { row: plan.target.bottom, col: plan.target.right },
      );
      this.ui.notify(t('notify.rangeMoved', { range: rangeText(plan.target) }), 'info');
    }
    return applied;
  }

  /**
   * Replace every match in the active tab as one atomic, singly-undoable
   * operation. The read-only scan for matching cells runs in time slices
   * behind a progress-reporting loading indicator, so a huge document never
   * blocks input or appears frozen. The mutation itself is then built from
   * the *current* cell values and applied synchronously in one `bulkEdit`, so
   * there is never a partially-replaced document — not even if the tab
   * changed while the scan was yielding (the scan aborts instead).
   */
  async replaceAll(
    query: CompiledQuery,
    replacement: string,
    scope: SearchScope = 'sheet',
  ): Promise<ReplaceAllReport> {
    const tab = this.state.activeTab;
    if (!tab || !query.ok) {
      return { count: 0, cells: 0, sheets: 0, skipped: 0, confirmed: true };
    }
    if (scope === 'workbook' && tab.doc.kind === 'rsf') {
      return this.replaceAllInWorkbook(tab, tab.doc, query, replacement);
    }
    const doc = tab.doc;
    const label = t('loading.replacing');
    return withBusy(this.ui, label, async () => {
      // Phase 1 (sliced, read-only): find the cells containing matches.
      const hits: Array<{ row: number; col: number }> = [];
      const completed = await forEachIndexSliced(
        doc.rowCount,
        (r) => {
          const fieldCount = doc.fieldCount(r);
          for (let c = 0; c < fieldCount; c++) {
            if (replaceAllInValue(doc.getValue(r, c), query, replacement).count > 0) {
              hits.push({ row: r, col: c });
            }
          }
        },
        {
          onProgress: (done, total) => this.ui.setBusy(`${label} (${pct(done, total)}%)`),
          // The document was replaced or the tab closed while yielding: abort
          // without touching anything.
          shouldStop: () => tab.doc !== doc,
        },
      );
      if (!completed || tab.doc !== doc) {
        return { count: 0, cells: 0, sheets: 0, skipped: 0, confirmed: true };
      }
      // Phase 2 (synchronous, atomic): rebuild each change from the current
      // value and apply them as one undoable entry.
      const changes: CellChange[] = [];
      let count = 0;
      for (const { row, col } of hits) {
        const current = doc.getValue(row, col);
        const replaced = replaceAllInValue(current, query, replacement);
        if (replaced.count === 0) {
          continue;
        }
        if (doc.kind === 'csv') {
          const before = doc.isEdited(row, col) ? current : null;
          const after = replaced.value === doc.getOriginalValue(row, col) ? null : replaced.value;
          changes.push({ row, col, before, after });
        } else {
          changes.push({ row, col, before: current, after: replaced.value });
        }
        count += replaced.count;
      }
      const applied = this.state.bulkEdit(tab, changes, 'history.replaceAll');
      return {
        count: applied ? count : 0,
        cells: applied ? changes.length : 0,
        sheets: applied && changes.length > 0 ? 1 : 0,
        skipped: hits.length - changes.length,
        confirmed: true,
      };
    });
  }

  /**
   * Replace every match across **every worksheet** of a workbook.
   *
   * Nothing is mutated until the user confirms an explicit summary of what the
   * operation would do (how many worksheets, cells, and replacements), because
   * a workbook-wide replace can reach content that is not on screen. The scan
   * is time-sliced with honest per-worksheet and overall progress; it aborts
   * without touching anything if the document changes underneath it. The
   * mutation is then rebuilt from the *current* values and applied as one
   * workbook-level history entry, so a single Undo restores every worksheet —
   * there is no state in which only part of the workbook has been replaced.
   */
  private async replaceAllInWorkbook(
    tab: Tab,
    doc: RsfDocument,
    query: CompiledQuery,
    replacement: string,
  ): Promise<ReplaceAllReport> {
    const empty: ReplaceAllReport = { count: 0, cells: 0, sheets: 0, skipped: 0, confirmed: true };
    if (!query.ok) {
      return empty;
    }
    const label = t('loading.replacingWorkbook');
    // Snapshot the worksheet identities the scan runs against: a rename,
    // reorder, or deletion afterwards must not silently retarget the replace.
    const sheetIds = doc.sheets.map((sheet) => sheet.id);
    const hits = await withBusy(this.ui, label, async () => {
      const found: Array<{ sheetId: string; row: number; col: number }> = [];
      const total = doc.totalRows;
      const completed = await forEachIndexSliced(
        total,
        (flat) => {
          const at = doc.locateFlatRow(flat);
          if (!at) {
            return;
          }
          const fieldCount = at.sheet.fieldCount(at.row);
          for (let c = 0; c < fieldCount; c++) {
            if (replaceAllInValue(at.sheet.getValue(at.row, c), query, replacement).count > 0) {
              found.push({ sheetId: at.sheet.id, row: at.row, col: c });
            }
          }
        },
        {
          onProgress: (done, count) =>
            this.ui.setBusy(
              `${label} (${pct(done, count)}%) — ${t('find.scopeProgress', {
                sheet: doc.locateFlatRow(Math.min(done, count - 1))?.sheet.name ?? '',
              })}`,
            ),
          shouldStop: () => tab.doc !== doc || !sheetsUnchanged(doc, sheetIds),
        },
      );
      return completed && tab.doc === doc && sheetsUnchanged(doc, sheetIds) ? found : null;
    });
    if (!hits) {
      return empty;
    }
    if (hits.length === 0) {
      return empty;
    }
    const affected = new Set(hits.map((h) => h.sheetId));
    let previewCount = 0;
    for (const hit of hits) {
      const sheet = doc.sheetById(hit.sheetId);
      previewCount += sheet
        ? replaceAllInValue(sheet.getValue(hit.row, hit.col), query, replacement).count
        : 0;
    }
    const confirmed = await this.ui.confirmReplaceAllWorkbook({
      sheets: affected.size,
      cells: hits.length,
      matches: previewCount,
      totalSheets: doc.sheetCount,
    });
    if (!confirmed) {
      return { ...empty, confirmed: false };
    }
    // The confirmation dialog yielded to the event loop: re-verify before
    // mutating, so a document/worksheet change during it cannot be replaced
    // into blindly.
    if (tab.doc !== doc || !sheetsUnchanged(doc, sheetIds)) {
      return empty;
    }
    const perSheet = new Map<string, CellChange[]>();
    let count = 0;
    let skipped = 0;
    for (const hit of hits) {
      const sheet = doc.sheetById(hit.sheetId);
      if (!sheet || !sheet.contains(hit.row, hit.col)) {
        skipped += 1;
        continue;
      }
      const current = sheet.getValue(hit.row, hit.col);
      const replaced = replaceAllInValue(current, query, replacement);
      if (replaced.count === 0) {
        skipped += 1;
        continue;
      }
      const list = perSheet.get(hit.sheetId) ?? [];
      list.push({ row: hit.row, col: hit.col, before: current, after: replaced.value });
      perSheet.set(hit.sheetId, list);
      count += replaced.count;
    }
    const ops: Operation[] = [...perSheet.entries()].map(([sheetId, changes]) => ({
      type: 'cells',
      changes,
      sheetId,
    }));
    const cells = ops.reduce((n, op) => n + (op.type === 'cells' ? op.changes.length : 0), 0);
    const applied = this.state.pushEntry(tab, {
      label: 'history.replaceAllWorkbook',
      ops,
      sheetId: doc.activeSheetId,
    });
    return {
      count: applied ? count : 0,
      cells: applied ? cells : 0,
      sheets: applied ? perSheet.size : 0,
      skipped,
      confirmed: true,
    };
  }
}

/** A rectangle in A1 notation ("C4" for a single cell, otherwise "C4:E9"). */
function rangeText(range: CellRange): string {
  const from = cellLabel(range.top, range.left);
  return range.top === range.bottom && range.left === range.right
    ? from
    : `${from}:${cellLabel(range.bottom, range.right)}`;
}

/** True while the workbook still holds exactly the worksheets a scan started from. */
function sheetsUnchanged(doc: RsfDocument, ids: readonly string[]): boolean {
  const current = doc.sheets;
  if (current.length !== ids.length) {
    return false;
  }
  for (let i = 0; i < ids.length; i++) {
    if (current[i].id !== ids[i]) {
      return false;
    }
  }
  return true;
}
