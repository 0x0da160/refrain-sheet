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
import type { RsfDocument } from '../../core/rsf-document';
import { forEachIndexSliced } from '../../core/scheduler';
import type { AppState, Tab } from '../app-state';
import { t } from '../i18n';
import type {
  ColumnMenuInput,
  ConvertReason,
  FilterDialogInput,
  FilterDialogResult,
  UiPort,
} from '../commands';
import { compareSortValues, validateSort } from '../../core/sort';
import { applyWhileOpen, LARGE_OP_CELLS, pct, withBusy } from './shared';
import type { SortCommands } from './sort';

/** An inclusive rectangle of document cells. */
interface CellRange {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

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
    private readonly ensureRsf: (tab: Tab, reason: ConvertReason) => Promise<RsfDocument | null>,
    private readonly sort: SortCommands,
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
   * RSF-only: on a plain CSV document the explicit-conversion dialog explains
   * that filtering requires converting to RSF and offers to do so right
   * there (`ensureRsf`, same pattern as paste/fill); declining leaves the
   * document unchanged. The filter range is the existing filter's range when one is active;
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
    const doc = await this.ensureRsf(tab, 'filter');
    if (!doc) {
      return false;
    }
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
      headerRow = true;
      const range = await this.defaultRange(tab, doc);
      if (!range) {
        return false;
      }
      ({ top, left, bottom, right } = range);
    }
    const col = Math.max(left, Math.min(right, targetCol ?? tab.selection.col));

    const dataTop = headerRow ? Math.min(top + 1, bottom) : top;
    const scanned = await this.distinctValues(tab, doc, col, dataTop, bottom, null);
    if (!scanned) {
      return false;
    }
    const { values, valuesTruncated } = scanned;

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
    const sheet = doc.activeSheet;
    return applyWhileOpen<FilterDialogResult>(
      (onApply) => this.ui.chooseFilter(input, onApply),
      async (result) => {
        if (tab.doc !== doc || this.state.activeTab !== tab || doc.activeSheet !== sheet) {
          return false; // replaced document, or the user switched away: nothing changes
        }
        if (result.action === 'clearAll') {
          return this.clearAllFilters(tab);
        }
        // Built from the filter as it is now, not as it was when the panel
        // opened: the panel stays open, so an earlier Apply (or Clear All
        // Filters) may have changed it since.
        const current = doc.filter;
        const range = current ?? { top, left, bottom, right };
        if (col < range.left || col > range.right) {
          return false;
        }
        const keptColumns = (current?.columns ?? []).filter((c) => c.col !== col);
        const newHeaderRow = result.action === 'apply' ? result.headerRow : (current?.headerRow ?? headerRow);
        const newColumn = result.action === 'apply' ? result.column : null;
        // No criteria left anywhere keeps the range (and its filter buttons)
        // with every row shown; Clear All Filters removes the range itself.
        const columns = [...keptColumns, ...(newColumn ? [newColumn] : [])].sort((a, b) => a.col - b.col);
        const filter = validateFilter(
          {
            top: range.top,
            left: range.left,
            bottom: range.bottom,
            right: range.right,
            headerRow: newHeaderRow,
            columns,
          },
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
      },
    );
  }

  /**
   * Sheet > Filter & Sort > Filter Buttons on Header Row: turn the header
   * row's filter buttons on or off (one undoable step either way).
   *
   * Turning on creates a filter with no criteria over the selected rectangle
   * (when more than one cell is selected) or the detected data block around
   * the active cell, its first row treated as the header, trimmed on the
   * right to the last non-blank header cell. Every row stays visible; each
   * header cell of the range gets a button that opens the column menu
   * ({@link columnMenu}). Turning off removes the filter, showing every row.
   * RSF-only, with the same explicit CSV conversion offer as Filter….
   */
  async toggleHeaderFilter(tab: Tab): Promise<boolean> {
    if (tab.doc.kind === 'rsf' && tab.doc.filter !== null) {
      return this.clearAllFilters(tab);
    }
    if (!tab.selection) {
      return false;
    }
    const doc = await this.ensureRsf(tab, 'filter');
    if (!doc) {
      return false;
    }
    const range = await this.defaultRange(tab, doc);
    if (!range) {
      return false;
    }
    let right = range.right;
    while (right > range.left && doc.getDisplayValue(range.top, right) === '') {
      right -= 1;
    }
    const filter = validateFilter(
      { ...range, right, headerRow: true, columns: [] },
      doc.rowCount,
      doc.columnCount,
    );
    if (!filter) {
      return false;
    }
    this.state.seedHiddenRows(filter, new Set());
    const applied = this.state.setFilter(tab, filter);
    if (applied) {
      this.ui.notify(
        t('notify.headerFilterOn', {
          range: `${cellLabel(filter.top, filter.left)}:${cellLabel(filter.bottom, right)}`,
        }),
        'info',
      );
    }
    return applied;
  }

  /**
   * A header cell's filter button (or Alt+Down on it): open the column menu
   * for `col` beside `anchor` and apply what it resolves to — a one-column
   * sort of the filter's data rows, a new allowed-values list for the column
   * (undoable, like every filter change), clearing the column's criteria, or
   * handing over to the full Filter panel for conditions.
   *
   * The value checklist lists the distinct values of the rows the *other*
   * columns' criteria leave visible, so narrowing one column after another
   * only ever offers values that can still appear. Comparison conditions the
   * column already has (set in the Filter panel) are kept as they are.
   */
  async columnMenu(tab: Tab, col: number, anchor: ColumnMenuInput['anchor']): Promise<boolean> {
    const doc = tab.doc;
    if (doc.kind !== 'rsf' || doc.filter === null) {
      return false;
    }
    const filter = doc.filter;
    if (col < filter.left || col > filter.right) {
      return false;
    }
    const dataTop = filterDataTop(filter);
    const others = filter.columns.filter((c) => c.col !== col);
    const scanned = await this.distinctValues(
      tab,
      doc,
      col,
      dataTop,
      filter.bottom,
      others.length > 0 ? { ...filter, columns: others } : null,
    );
    if (!scanned) {
      return false;
    }
    const existing = filter.columns.find((c) => c.col === col) ?? null;
    const sort = doc.sort;
    const sortedHere =
      sort !== null &&
      sort.keys.length === 1 &&
      sort.keys[0].col === col &&
      sort.top === filter.top &&
      sort.bottom === filter.bottom
        ? sort.keys[0].ascending
          ? 'asc'
          : 'desc'
        : null;
    const input: ColumnMenuInput = {
      col,
      colLetter: columnLabel(col),
      header: filter.headerRow ? doc.getDisplayValue(filter.top, col) : '',
      anchor,
      values: scanned.values,
      valuesTruncated: scanned.valuesTruncated,
      selected: existing?.values ?? null,
      hasConditions: (existing?.conditions.length ?? 0) > 0,
      hasColumnFilter: existing !== null,
      sorted: sortedHere,
    };
    const sheet = doc.activeSheet;
    const result = await this.ui.chooseColumnMenu(input);
    if (!result || tab.doc !== doc || this.state.activeTab !== tab || doc.activeSheet !== sheet) {
      return false; // dismissed, replaced document, or the user switched away
    }
    const current = doc.filter;
    if (!current || col < current.left || col > current.right) {
      return false; // the filter was removed or changed while the menu was open
    }
    switch (result.action) {
      case 'more':
        return this.filterDialog(tab, col);
      case 'clearSort':
        return this.sort.clearSort(tab);
      case 'sort': {
        const next = validateSort(
          {
            top: current.top,
            left: current.left,
            bottom: current.bottom,
            right: current.right,
            headerRow: current.headerRow,
            keys: [{ col, ascending: result.ascending }],
          },
          doc.rowCount,
          doc.columnCount,
        );
        if (!next) {
          return false;
        }
        // A different sort range cannot simply be replaced in place (an
        // active sort's range is fixed), so the old sort is released first.
        this.state.setSort(tab, null);
        return this.sort.applySort(tab, next);
      }
      case 'clearColumn':
      case 'apply': {
        const kept = current.columns.filter((c) => c.col !== col);
        const before = current.columns.find((c) => c.col === col) ?? null;
        const values = result.action === 'apply' ? result.values : null;
        const conditions = result.action === 'apply' ? (before?.conditions ?? []) : [];
        const columns =
          conditions.length > 0 || values !== null
            ? [...kept, { col, join: before?.join ?? 'and', conditions, values }]
            : kept;
        const next = validateFilter(
          { ...current, columns: columns.sort((a, b) => a.col - b.col) },
          doc.rowCount,
          doc.columnCount,
        );
        if (!next) {
          await this.ui.showMessage(t('dialog.filter.title'), t('dialog.filter.invalid'));
          return false;
        }
        return this.applyFilter(tab, next);
      }
    }
  }

  /**
   * The range a new filter covers: the selected rectangle when more than one
   * cell is selected, otherwise the contiguous block of data rows around the
   * active cell (bounded by {@link MAX_FILTER_ROWS}), spanning every sheet
   * column. Null (after telling the user) when there is no data there.
   */
  private async defaultRange(tab: Tab, doc: RsfDocument): Promise<CellRange | null> {
    const active = tab.selection;
    if (!active) {
      return null;
    }
    let top: number;
    let left: number;
    let bottom: number;
    let right: number;
    const sel = this.state.selectedRange(tab);
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
      top = active.row;
      bottom = active.row;
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
        return null;
      }
    }
    // Enforce the documented range bound up front so a within-bounds
    // filter always persists and restores identically.
    bottom = Math.min(bottom, top + MAX_FILTER_ROWS - 1);
    return { top, left, bottom, right };
  }

  /**
   * Bounded distinct displayed values of column `col` over rows
   * `dataTop..bottom` — only the rows that satisfy `within` when given
   * (sliced with progress for large ranges) — in ascending sort order, so
   * numbers list numerically. Null when the document is
   * replaced while yielding.
   */
  private async distinctValues(
    tab: Tab,
    doc: RsfDocument,
    col: number,
    dataTop: number,
    bottom: number,
    within: SheetFilter | null,
  ): Promise<{ values: string[]; valuesTruncated: boolean } | null> {
    const scanRows = bottom - dataTop + 1;
    const distinct = new Set<string>();
    let valuesTruncated = false;
    const get = (r: number, c: number): string => doc.getDisplayValue(r, c);
    const collectRow = (i: number): void => {
      if (within && !rowMatchesFilter(within, dataTop + i, get)) {
        return;
      }
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
        return null;
      }
    } else {
      for (let i = 0; i < scanRows; i++) {
        collectRow(i);
      }
    }
    return { values: [...distinct].sort(compareSortValues), valuesTruncated };
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
      await this.resort(tab);
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
   * Recompute an active sort after the filter changed, so rows the new filter
   * shows take their sorted place too (a sort only orders the rows visible
   * when it was computed). Quiet: the sort itself did not change.
   */
  private async resort(tab: Tab): Promise<void> {
    const doc = tab.doc;
    if (doc.kind !== 'rsf' || doc.sort === null) {
      return;
    }
    const sort = { ...doc.sort, keys: doc.sort.keys.map((k) => ({ ...k })) };
    this.state.setSort(tab, null);
    await this.sort.applySort(tab, sort, false);
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
