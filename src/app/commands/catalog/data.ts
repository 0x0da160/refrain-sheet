// SPDX-License-Identifier: MIT
/** Data commands (`data.*`): SQL query, two-tab compare, validation, comments. */
import type { DiffResult } from '../../../core/diff-engine';
import { DEFAULT_CSV_EXPORT_OPTIONS, encodeCsvExport } from '../../../core/interchange/csv-export';
import { saveBytesAs } from '../../file-access';
import { t } from '../../i18n';
import type { Tab } from '../../state';
import { hasSelection, withTab, type CommandContext, type CommandSpec } from './types';

/**
 * Data > Run SQL Query…: open the local, read-only SQL query panel. See
 * `src/core/sql-engine.ts` for the query engine and its documented scope.
 */
function showSqlQuery({ ui, parts }: CommandContext, tab: Tab): Promise<void> {
  return ui.showSqlQuery({
    sources: parts.sql.listSources(tab),
    runQuery: (sourceId, query) => parts.sql.runQuery(tab, sourceId, query),
    columns: (sourceId) => parts.sql.listColumns(tab, sourceId),
  });
}

/**
 * Data > Compare / Diff…: open the local, read-only two-tab compare panel.
 * See `src/core/diff-engine.ts` for the engine and its documented scope.
 */
function showDiff(ctx: CommandContext, tab: Tab): Promise<void> {
  const { state, parts } = ctx;
  return ctx.ui.showDiff({
    currentTabName: tab.name,
    currentColumns: parts.diff.listColumns(tab),
    tabs: parts.diff.listComparableTabs(state, tab),
    columnsForTab: (tabId) => {
      const other = state.tabs.find((candidate) => candidate.id === tabId);
      return other ? parts.diff.listColumns(other) : [];
    },
    runDiff: (baselineTabId, options) => {
      // The dialog is modal, so the tab list cannot change while it is open.
      const baselineTab = state.tabs.find((candidate) => candidate.id === baselineTabId)!;
      return parts.diff.runDiff(baselineTab, tab, options);
    },
    exportCsv: (result) => exportDiffCsv(ctx, tab, result),
  });
}

/** Export the shown diff rows as a plain UTF-8 CSV download (never the source documents). */
async function exportDiffCsv(ctx: CommandContext, tab: Tab, result: DiffResult): Promise<boolean> {
  const rows = ctx.parts.diff.buildDiffCsvRows(result);
  const encoded = encodeCsvExport(rows, ',', DEFAULT_CSV_EXPORT_OPTIONS);
  if (!encoded.ok) {
    return false; // unreachable for UTF-8, kept for type-safety with encodeCsvExport's signature
  }
  const name = `${tab.name.replace(/\.(rsf|rcsv|csv)$/i, '')}-diff.csv`;
  try {
    await saveBytesAs(ctx.dom, name, encoded.bytes, 'csv');
    return true;
  } catch (err) {
    // A cancelled save picker (AbortError) is a silent no-op, matching every
    // other save/export flow's contract; anything else is reported.
    if (err instanceof DOMException && err.name === 'AbortError') {
      return false;
    }
    ctx.ui.notify(
      t('notify.saveFailed', { name, error: err instanceof Error ? err.message : String(err) }),
      'error',
    );
    return false;
  }
}

export const DATA_COMMANDS = {
  'data.runSqlQuery': withTab(showSqlQuery),
  // A second open tab is required to pick a baseline against.
  'data.compareDiff': withTab(showDiff, (ctx) => ctx.state.tabs.length >= 2),
  // Validation and comments stay clickable on a CSV tab: running one explains
  // that it needs an RSF spreadsheet document and offers to convert.
  'data.validation': {
    enabled: hasSelection,
    run: ({ tab, commands }) => tab && commands.validationDialog(tab),
  },
  'data.comment': { enabled: hasSelection, run: ({ tab, commands }) => tab && commands.commentDialog(tab) },
} satisfies Record<string, CommandSpec>;
