// SPDX-License-Identifier: MIT
import { computeSortOrder, validateSort, MAX_SHEET_SORT_ROWS, type SheetSort } from '../../core/sort';
import { cellLabel, columnLabel } from '../../core/formula';
import type { RsfDocument } from '../../core/rsf-document';
import type { AppState, Tab } from '../app-state';
import { t } from '../i18n';
import type { ConvertReason, SortDialogInput, SortDialogResult, UiPort } from '../commands';
import { applyWhileOpen, LARGE_OP_CELLS, withBusyIfLarge } from './shared';

/**
 * Sorting commands for RSF spreadsheet documents: the sort dialog flow and
 * applying/clearing a sort. Extracted from `Commands` as a cohesive slice,
 * mirroring `FilterCommands` (`src/app/commands/filter.ts`) — `Commands`
 * still exposes the same public methods, delegating to an instance of this
 * class. This is the `Commands`-layer dispatch code, distinct from (and a
 * consumer of) the pure sort logic in `src/core/sort.ts`.
 *
 * Unlike filtering, a sort is session-only view state (see `Worksheet.sort`):
 * applying or clearing it is a direct state change, not a `HistoryEntry` — it
 * is never undoable and never marks the document dirty, exactly like the
 * live selection. Editing a cell inside the sorted range is refused by
 * `AppState` (`refuseSortedWrite`) while the sort is active; clearing the
 * sort always restores editing.
 */
export class SortCommands {
  constructor(
    private readonly state: AppState,
    private readonly ui: UiPort,
    private readonly ensureRsf: (tab: Tab, reason: ConvertReason) => Promise<RsfDocument | null>,
  ) {}

  /** The active tab's sort display order, or null when unsorted. */
  sortOrder(tab: Tab): number[] | null {
    return this.state.sortOrder(tab);
  }

  /**
   * Sheet > Filter & Sort > Sort… : open the sort dialog and apply the
   * result as one (non-undoable) view-state change.
   *
   * RSF-only: on a plain CSV document the explicit-conversion dialog explains
   * that sorting requires converting to RSF and offers to do so right there
   * (`ensureRsf`, same pattern as paste/fill); declining leaves the document
   * unchanged. The sort range is the existing sort's range when one is active;
   * otherwise the selected rectangle (when more than one cell is selected)
   * or the detected contiguous data block around the active cell — the same
   * range-detection rule `FilterCommands.filterDialog` uses — with the first
   * row treated as a header by default.
   */
  async sortDialog(tab: Tab): Promise<boolean> {
    if (!tab.selection) {
      return false;
    }
    const doc = await this.ensureRsf(tab, 'sort');
    if (!doc) {
      return false;
    }
    const existing = doc.sort;

    let top: number;
    let left: number;
    let bottom: number;
    let right: number;
    let headerRow: boolean;
    if (existing) {
      ({ top, left, bottom, right, headerRow } = existing);
    } else {
      const sel = this.state.selectedRange(tab);
      headerRow = true;
      if (sel && (sel.bottom > sel.top || sel.right > sel.left)) {
        ({ top, left, bottom, right } = sel);
      } else {
        const rowHasData = (r: number): boolean => {
          for (let c = 0; c < doc.columnCount; c++) {
            if (doc.getValue(r, c) !== '') {
              return true;
            }
          }
          return false;
        };
        top = tab.selection.row;
        bottom = tab.selection.row;
        while (top > 0 && bottom - top < MAX_SHEET_SORT_ROWS - 1 && rowHasData(top - 1)) {
          top -= 1;
        }
        while (
          bottom < doc.rowCount - 1 &&
          bottom - top < MAX_SHEET_SORT_ROWS - 1 &&
          rowHasData(bottom + 1)
        ) {
          bottom += 1;
        }
        left = 0;
        right = doc.columnCount - 1;
        if (!rowHasData(top)) {
          await this.ui.showMessage(t('dialog.sort.title'), t('dialog.sort.noData'));
          return false;
        }
      }
      bottom = Math.min(bottom, top + MAX_SHEET_SORT_ROWS - 1);
    }

    const columns = [];
    for (let c = left; c <= right; c++) {
      columns.push({ col: c, letter: columnLabel(c), header: headerRow ? doc.getDisplayValue(top, c) : '' });
    }

    const input: SortDialogInput = {
      rangeLabel: `${cellLabel(top, left)}:${cellLabel(bottom, right)}`,
      headerRow,
      columns,
      existingKeys: existing?.keys ?? [],
      hasActiveSort: existing !== null,
    };
    const sheet = doc.activeSheet;
    return applyWhileOpen<SortDialogResult>(
      (onApply) => this.ui.chooseSort(input, onApply),
      async (result) => {
        if (tab.doc !== doc || this.state.activeTab !== tab || doc.activeSheet !== sheet) {
          return false; // replaced document, or the user switched away: nothing changes
        }
        if (result.action === 'clear') {
          return this.clearSort(tab);
        }
        // The range as it is now: an earlier Apply from this still-open panel
        // may have fixed it, or Clear Sort released it.
        const range = doc.sort ?? { top, left, bottom, right };
        const sort = validateSort(
          {
            top: range.top,
            left: range.left,
            bottom: range.bottom,
            right: range.right,
            headerRow: result.headerRow,
            keys: result.keys,
          },
          doc.rowCount,
          doc.columnCount,
        );
        if (!sort) {
          await this.ui.showMessage(t('dialog.sort.title'), t('dialog.sort.invalid'));
          return false;
        }
        return this.applySort(tab, sort);
      },
    );
  }

  /**
   * Compute `sort`'s display order (behind an indeterminate busy indicator
   * for large ranges — the sort comparator interleaves reads unpredictably,
   * so no honest percentage is available) and apply it. Aborts — changing
   * nothing — if the document is replaced while the busy indicator is shown.
   */
  async applySort(tab: Tab, sort: SheetSort, announce = true): Promise<boolean> {
    const doc = tab.doc;
    if (doc.kind !== 'rsf') {
      return false;
    }
    const rows = sort.bottom - sort.top + 1;
    const order = await withBusyIfLarge(rows > LARGE_OP_CELLS, this.ui, t('loading.sorting'), () =>
      computeSortOrder(sort, doc.rowCount, this.state.hiddenRows(tab), (r, c) => doc.getDisplayValue(r, c)),
    );
    if (tab.doc !== doc) {
      return false;
    }
    this.state.seedSortOrder(sort, order);
    const applied = this.state.setSort(tab, sort);
    if (applied && announce) {
      this.ui.notify(t('notify.sorted', { keys: sort.keys.length }), 'info');
    }
    return applied;
  }

  /** Sheet > Filter & Sort > Clear Sort: rows return to document order (not undoable). */
  clearSort(tab: Tab): boolean {
    const applied = this.state.setSort(tab, null);
    if (applied) {
      this.ui.notify(t('notify.sortCleared'), 'info');
    }
    return applied;
  }
}
