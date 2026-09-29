// SPDX-License-Identifier: MIT
/** Data commands (`data.*`): SQL query, two-tab compare, validation, comments. */
import type { DiffResult } from '../../../core/diff-engine';
import { isWorkbook } from '../../../core/editor-document';
import type { SqlQueryResult } from '../../../core/sql-engine';
import { RsfDocument, RSF_EXTENSION } from '../../../core/workbook/rsf-document';
import { DEFAULT_CSV_EXPORT_OPTIONS, encodeCsvExport } from '../../../core/interchange/csv-export';
import { saveBytesAs } from '../../file-access';
import { getLocale, t } from '../../i18n';
import type { Tab } from '../../state';
import { hasCellSelection, withTab, type CommandContext, type CommandSpec } from './types';

/**
 * Data > Run SQL Query…: open the local, read-only SQL query panel. See
 * `src/core/sql-engine.ts` for the query engine and its documented scope.
 */
function showSqlQuery(ctx: CommandContext, tab: Tab): Promise<void> {
  const { ui, parts } = ctx;
  return ui.showSqlQuery({
    sources: parts.sql.listSources(tab),
    runQuery: (sourceId, query) => parts.sql.runQuery(tab, sourceId, query),
    columns: (sourceId) => parts.sql.listColumns(tab, sourceId),
    writeResult: (result) => writeSqlResult(ctx, tab, result),
  });
}

/**
 * The SQL panel's Put Results in New Sheet: the result's header row and
 * rows go into a new worksheet after the active one (one undoable step), or,
 * for a CSV tab, into a new unsaved spreadsheet tab. The source is never
 * changed. Returns the new sheet's name, or null when it could not be added.
 */
function writeSqlResult(ctx: CommandContext, tab: Tab, result: SqlQueryResult): string | null {
  const rows = [result.columns, ...result.rows.map((row) => row.map(String))];
  const doc = tab.doc;
  if (isWorkbook(doc)) {
    const name = doc.uniqueSheetName(t('sql.resultSheetName'));
    return ctx.state.addSheetFromValues(tab, name, rows)?.name ?? null;
  }
  const base = tab.name.replace(/\.(rsf|rcsv|csv|tsv|txt)$/i, '');
  const fileName = `${base}-${t('sql.resultSheetName')}${RSF_EXTENSION}`;
  const sheetName = t('sql.resultSheetName');
  const width = Math.max(1, result.columns.length);
  const book = RsfDocument.fromValues(fileName, ',', rows, width, sheetName, getLocale());
  book.markUnsaved();
  ctx.state.addTab(fileName, book, null);
  return sheetName;
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
    enabled: hasCellSelection,
    run: ({ tab, commands }) => tab && commands.validationDialog(tab),
  },
  // Opens only, like View > Comments Panel; on a CSV tab the panel explains
  // that rules need an RSF spreadsheet.
  'data.checkValidation': {
    run: (ctx) => {
      ctx.commands.panelActions?.openValidationCheck();
    },
  },
  'data.comment': {
    enabled: hasCellSelection,
    run: ({ tab, commands }) => tab && commands.commentDialog(tab),
  },
} satisfies Record<string, CommandSpec>;
