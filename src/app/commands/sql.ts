// SPDX-License-Identifier: MIT
import {
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
      const columnCount = sheet.columnCount;
      const totalRows = sheet.rowCount;
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

  /** Read the picked source and run the query, catching a rejected/failed query rather than throwing. */
  runQuery(tab: Tab, sourceId: string, query: string): SqlRunOutcome {
    try {
      const table = this.readTable(tab, sourceId);
      return { ok: true, result: runSqlQuery(query, table) };
    } catch (e) {
      if (e instanceof SqlQueryError) {
        return { ok: false, error: e };
      }
      throw e;
    }
  }
}
