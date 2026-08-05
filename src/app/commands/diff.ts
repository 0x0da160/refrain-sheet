// SPDX-License-Identifier: MIT
import { computeDiff, DiffError, type DiffOptions, type DiffResult } from '../../core/diff-engine';
import type { Tab } from '../app-state';
import { AppState } from '../app-state';
import { SqlCommands } from './sql';

/** One other open tab the active tab could be compared against. */
export interface DiffTabOption {
  id: string;
  name: string;
}

export type DiffRunOutcome = { ok: true; result: DiffResult } | { ok: false; error: DiffError };

/**
 * Local, read-only two-tab compare: pick a baseline tab and a current tab
 * (both already open), pick key column(s), and classify every row as
 * added/modified/deleted/unchanged/key_invalid. See `src/core/diff-engine.ts`
 * for the engine and docs/csv-diff-review-proposal.md for the product scope
 * this first slice deliberately stays within (no rule engine, templates,
 * approvals, or audit export yet).
 *
 * Each tab's *active worksheet* (or its whole CSV) is read via
 * `SqlCommands.readTable` — the same adapter the SQL query panel uses —
 * rather than exposing a separate per-tab worksheet picker in this first
 * slice.
 */
export class DiffCommands {
  private readonly sql = new SqlCommands();

  /** Every other open tab, as candidates for the "compare against" picker. */
  listComparableTabs(state: AppState, activeTab: Tab): DiffTabOption[] {
    return state.tabs.filter((tab) => tab.id !== activeTab.id).map((tab) => ({ id: tab.id, name: tab.name }));
  }

  /** Column names for a tab's active worksheet/CSV, for the key/compare pickers. */
  listColumns(tab: Tab): string[] {
    return this.sql.listColumns(tab, this.defaultSourceId(tab));
  }

  /** Read both tabs and run the diff, catching a rejected configuration rather than throwing. */
  runDiff(baselineTab: Tab, currentTab: Tab, options: DiffOptions): DiffRunOutcome {
    try {
      const baseline = this.sql.readTable(baselineTab, this.defaultSourceId(baselineTab));
      const current = this.sql.readTable(currentTab, this.defaultSourceId(currentTab));
      return { ok: true, result: computeDiff(baseline, current, options) };
    } catch (e) {
      if (e instanceof DiffError) {
        return { ok: false, error: e };
      }
      throw e;
    }
  }

  /** A header row plus one row per shown diff row, ready for `encodeCsvExport`. */
  buildDiffCsvRows(result: DiffResult): string[][] {
    const blankRow = result.columns.map(() => '');
    const header = [
      'diff_type',
      ...result.columns.map((c) => `before:${c}`),
      ...result.columns.map((c) => `after:${c}`),
    ];
    const rows = result.rows.map((row) => [
      row.type,
      ...(row.before ?? blankRow),
      ...(row.after ?? blankRow),
    ]);
    return [header, ...rows];
  }

  private defaultSourceId(tab: Tab): string {
    return tab.doc.kind === 'rsf' ? tab.doc.activeSheetId : 'csv';
  }
}
