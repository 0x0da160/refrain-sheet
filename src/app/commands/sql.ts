// SPDX-License-Identifier: MIT
import {
  initSqlEngine,
  runSqlQuery,
  SqlQueryError,
  SQL_MAX_SOURCE_ROWS,
  type SqlQueryResult,
  type SqlTable,
} from '../../core/sql-engine';
import type { Tab } from '../app-state';

/** One selectable SQL data source: a worksheet of the active RSF workbook, or the whole CSV tab. */
export interface SqlSource {
  id: string;
  name: string;
}

export type SqlRunOutcome = { ok: true; result: SqlQueryResult } | { ok: false; error: SqlQueryError };

/**
 * Local, read-only SQL analysis over one worksheet/CSV table at a time. See
 * `src/core/sql-engine.ts` for the engine and its documented scope: no
 * mutation, no persistence, no cross-file joins — this command layer only
 * adapts a `Tab`'s document into the plain `SqlTable` shape the engine reads.
 */
export class SqlCommands {
  /** Data sources selectable for a tab: one per worksheet for an RSF workbook, or the tab itself for a plain CSV. */
  listSources(tab: Tab): SqlSource[] {
    if (tab.doc.kind === 'rsf') {
      return tab.doc.sheets.map((sheet) => ({ id: sheet.id, name: sheet.name }));
    }
    return [{ id: 'csv', name: tab.name }];
  }

  /**
   * Read a data source's computed display values into a `SqlTable`: row 0 is
   * always the header row. Reads at most `SQL_MAX_SOURCE_ROWS + 1` data rows
   * — enough for the engine to detect and report truncation — so a huge
   * sheet is never fully materialized just to run one query.
   */
  readTable(tab: Tab, sourceId: string): SqlTable {
    const doc = tab.doc;
    const cap = SQL_MAX_SOURCE_ROWS + 1;
    if (doc.kind === 'rsf') {
      const sheet = doc.sheetById(sourceId) ?? doc.activeSheet;
      // A worksheet's rowCount/columnCount is its fully allocated grid (e.g.
      // 100x26 for a new sheet), not its content — trim to the used range so
      // `SELECT * FROM data` doesn't return a wall of blank rows/columns.
      const { rows: totalRows, cols: columnCount } = sheet.usedExtent();
      const readRow = (r: number): string[] =>
        Array.from({ length: columnCount }, (_, c) => doc.getSheetDisplayValue(sheet.id, r, c));
      const headers = totalRows > 0 ? readRow(0) : [];
      const rows: string[][] = [];
      for (let r = 1; r < totalRows && rows.length < cap; r++) {
        rows.push(readRow(r));
      }
      return { headers, rows };
    }
    const columnCount = doc.columnCount;
    const totalRows = doc.rowCount;
    const readRow = (r: number): string[] => {
      const fields = doc.fieldCount(r);
      return Array.from({ length: columnCount }, (_, c) => (c < fields ? doc.getDisplayValue(r, c) : ''));
    };
    const headers = totalRows > 0 ? readRow(0) : [];
    const rows: string[][] = [];
    for (let r = 1; r < totalRows && rows.length < cap; r++) {
      rows.push(readRow(r));
    }
    return { headers, rows };
  }

  /**
   * Column names for a source, for the query editor's input suggestions.
   * Purely a UX aid — {@link runQuery} still validates real column names
   * against the engine's own header-deduplication rules when the query runs.
   */
  listColumns(tab: Tab, sourceId: string): string[] {
    const headers = this.readTable(tab, sourceId).headers;
    return Array.from(new Set(headers.map((h) => h.trim()).filter((h) => h !== '')));
  }

  /**
   * Read the picked source and run the query against the embedded SQLite
   * engine, catching a rejected/failed query rather than throwing. Awaits
   * {@link initSqlEngine} first (normally already resolved — it starts in
   * the background at startup, see `src/main.ts`); a failure to initialize
   * surfaces through the same outcome shape as a rejected query.
   */
  async runQuery(tab: Tab, sourceId: string, query: string): Promise<SqlRunOutcome> {
    try {
      await initSqlEngine();
      const table = this.readTable(tab, sourceId);
      return { ok: true, result: runSqlQuery(query, table) };
    } catch (e) {
      if (e instanceof SqlQueryError) {
        return { ok: false, error: e };
      }
      const message = e instanceof Error ? e.message : String(e);
      return { ok: false, error: new SqlQueryError('engineUnavailable', message, { message }) };
    }
  }
}
