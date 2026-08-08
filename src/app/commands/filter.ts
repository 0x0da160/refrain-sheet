// SPDX-License-Identifier: MIT
import {
  filterDataTop,
  rowMatchesFilter,
  validateFilter,
  MAX_FILTER_ROWS,
  MAX_FILTER_VALUES,
  type SheetFilter,
} from '../../core/filter';
import { cellLabel, columnLabel } from '../../core/formula';
import { forEachIndexSliced } from '../../core/scheduler';
import { AppState, type Tab } from '../app-state';
import { t } from '../i18n';
import type { FilterDialogInput, UiPort } from '../commands';
import { LARGE_OP_CELLS, pct, withBusy } from './shared';

/**
 * Filtering commands for RSF spreadsheet documents: the hidden-row query,
 * the filter dialog flow, applying/clearing a filter, and moving a selection
 * off a row a freshly-applied filter just hid. Extracted from `Commands` as a
 * cohesive slice (see issue #68's extraction pattern, established by
 * `src/app/commands/file-io.ts`) — `Commands` still exposes the same public
 * methods, delegating to an instance of this class. This is the `Commands`-
 * layer dispatch code, distinct from (and a consumer of) the pure filter
 * logic in `src/core/filter.ts`.
 */
export class FilterCommands {
  constructor(
    private readonly state: AppState,
    private readonly ui: UiPort,
  ) {}

  /** The active filter's hidden-row set for a tab (null when unfiltered). */
  hiddenRows(tab: Tab): Set<number> | null {
    return this.state.hiddenRows(tab);
  }

  /**
   * Sheet > Filter & Sort > Filter… (also the column-header filter buttons
   * and the context menu): open the filter dialog for `targetCol` (default:
   * the active cell's column) and apply the result as one atomic, undoable
   * operation.
   *
   * RSF-only: on a plain CSV document a localized message explains that
   * filtering requires the explicit conversion to RSF, and nothing changes.
   * The filter range is the existing filter's range when one is active;
   * otherwise the selected rectangle (when more than one cell is selected)
   * or the detected contiguous data block around the active cell, with the
   * first row treated as a header by default — the dialog shows this
   * assumption and lets the user change it before applying. Value
   * enumeration and hidden-row evaluation run in time slices with honest
   * progress for large ranges; cancellation (dialog, document change while
   * yielding) never applies a partial filter.
   */
  async filterDialog(tab: Tab, targetCol?: number): Promise<boolean> {
    if (!tab.selection) {
      return false;
    }
    if (tab.doc.kind !== 'rsf') {
      await this.ui.showMessage(t('dialog.filter.title'), t('dialog.filter.csvOnly'));
      return false;
    }
    const doc = tab.doc;
    const existing = doc.filter;

    // The filtered rectangle. An active filter fixes it (clear all filters
    // to choose a new range); otherwise it derives from the selection.
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
        // Detect the contiguous block of data rows around the active cell
        // (bounded), spanning every sheet column.
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
        while (top > 0 && bottom - top < MAX_FILTER_ROWS - 1 && rowHasData(top - 1)) {
          top -= 1;
        }
        while (bottom < doc.rowCount - 1 && bottom - top < MAX_FILTER_ROWS - 1 && rowHasData(bottom + 1)) {
          bottom += 1;
        }
        left = 0;
        right = doc.columnCount - 1;
        if (!rowHasData(top)) {
          await this.ui.showMessage(t('dialog.filter.title'), t('dialog.filter.noData'));
          return false;
        }
      }
      // Enforce the documented range bound up front so a within-bounds
      // filter always persists and restores identically.
      bottom = Math.min(bottom, top + MAX_FILTER_ROWS - 1);
    }
    const col = Math.max(left, Math.min(right, targetCol ?? tab.selection.col));

    // Bounded distinct displayed values of the column's data rows (sliced
    // with progress for large ranges; aborts without changes if the document
    // is replaced while yielding).
    const dataTop = headerRow ? Math.min(top + 1, bottom) : top;
    const scanRows = bottom - dataTop + 1;
    const distinct = new Set<string>();
    let valuesTruncated = false;
    const collectRow = (i: number): void => {
      const value = doc.getDisplayValue(dataTop + i, col);
      if (distinct.has(value)) {
        return;
      }
      if (distinct.size >= MAX_FILTER_VALUES) {
        valuesTruncated = true; // the list stays bounded; the dialog says so
        return;
      }
      distinct.add(value);
    };
    if (scanRows > LARGE_OP_CELLS) {
      const label = t('loading.filterValues');
      const completed = await withBusy(this.ui, label, () =>
        forEachIndexSliced(scanRows, collectRow, {
          onProgress: (done, total) => this.ui.setBusy(`${label} (${pct(done, total)}%)`, pct(done, total)),
          shouldStop: () => tab.doc !== doc,
        }),
      );
      if (!completed || tab.doc !== doc) {
        return false;
      }
    } else {
      for (let i = 0; i < scanRows; i++) {
        collectRow(i);
      }
    }
    const values = [...distinct].sort();

    const input: FilterDialogInput = {
      col,
      colLetter: columnLabel(col),
      header: headerRow ? doc.getDisplayValue(top, col) : '',
      rangeLabel: `${cellLabel(top, left)}:${cellLabel(bottom, right)}`,
      headerRow,
      hasActiveFilter: existing !== null,
      existing: existing?.columns.find((c) => c.col === col) ?? null,
      otherColumns: existing ? existing.columns.filter((c) => c.col !== col).length : 0,
      values,
      valuesTruncated,
    };
    const result = await this.ui.chooseFilter(input);
    if (!result || tab.doc !== doc) {
      return false; // cancelled (or replaced document): nothing changes
    }
    if (result.action === 'clearAll') {
      return this.clearAllFilters(tab);
    }

    // Build the new filter state from the dialog result.
    const keptColumns = (existing?.columns ?? []).filter((c) => c.col !== col);
    const newHeaderRow = result.action === 'apply' ? result.headerRow : headerRow;
    const newColumn = result.action === 'apply' ? result.column : null;
    const columns = [...keptColumns, ...(newColumn ? [newColumn] : [])].sort((a, b) => a.col - b.col);
    if (columns.length === 0) {
      // No criteria left anywhere: the filter as a whole is cleared.
      return this.clearAllFilters(tab);
    }
    const filter = validateFilter(
      { top, left, bottom, right, headerRow: newHeaderRow, columns },
      doc.rowCount,
      doc.columnCount,
    );
    if (!filter) {
      // Out-of-bounds criteria (should be prevented by the dialog's own
      // bounds) are refused rather than partially applied.
      await this.ui.showMessage(t('dialog.filter.title'), t('dialog.filter.invalid'));
      return false;
    }
    return this.applyFilter(tab, filter);
  }

  /**
   * Evaluate `filter` (time-sliced with progress for large ranges) and apply
   * it as one atomic, undoable history entry. Aborts — changing nothing — if
   * the document is replaced while yielding.
   */
  private async applyFilter(tab: Tab, filter: SheetFilter): Promise<boolean> {
    const doc = tab.doc;
    if (doc.kind !== 'rsf') {
      return false;
    }
    const dataTop = filterDataTop(filter);
    const rows = filter.bottom - dataTop + 1;
    const hidden = new Set<number>();
    const evaluateRow = (i: number): void => {
      const row = dataTop + i;
      if (!rowMatchesFilter(filter, row, (r, c) => doc.getDisplayValue(r, c))) {
        hidden.add(row);
      }
    };
    if (rows > LARGE_OP_CELLS) {
      const label = t('loading.filtering');
      const completed = await withBusy(this.ui, label, () =>
        forEachIndexSliced(rows, evaluateRow, {
          onProgress: (done, total) => this.ui.setBusy(`${label} (${pct(done, total)}%)`, pct(done, total)),
          shouldStop: () => tab.doc !== doc,
        }),
      );
      if (!completed || tab.doc !== doc) {
        return false;
      }
    } else {
      for (let i = 0; i < rows; i++) {
        evaluateRow(i);
      }
    }
    // Seed the snapshot before the atomic apply so the grid never recomputes.
    this.state.seedHiddenRows(filter, hidden);
    const applied = this.state.setFilter(tab, filter);
    if (applied) {
      this.moveSelectionOffHiddenRow(tab);
      this.ui.notify(t('notify.filtered', { shown: rows - hidden.size, total: rows }), 'info');
    }
    return applied;
  }

  /** Sheet > Filter & Sort > Clear All Filters: every row becomes visible again (undoable). */
  clearAllFilters(tab: Tab): boolean {
    const applied = this.state.setFilter(tab, null);
    if (applied) {
      this.ui.notify(t('notify.filterCleared'), 'info');
    }
    return applied;
  }

  /**
   * After a filter (re)application, move a selection whose active cell ended
   * up on a hidden row to the nearest visible row, so keyboard navigation
   * and editing always continue from something the user can see.
   */
  private moveSelectionOffHiddenRow(tab: Tab): void {
    const sel = tab.selection;
    const hidden = this.state.hiddenRows(tab);
    if (!sel || !hidden || !hidden.has(sel.row)) {
      return;
    }
    let row = sel.row;
    while (row < tab.doc.rowCount && hidden.has(row)) {
      row += 1;
    }
    if (row >= tab.doc.rowCount) {
      row = sel.row;
      while (row >= 0 && hidden.has(row)) {
        row -= 1;
      }
    }
    if (row >= 0 && row < tab.doc.rowCount) {
      this.state.setSelection(tab, { row, col: sel.col }, null);
    }
  }
}
