// SPDX-License-Identifier: MIT
import { isWorkbook } from '../../core/editor-document';
import type { Tab } from '../state';

/** A table read from a tab for analysis: the header row, then the data rows. */
export interface SourceTable {
  headers: string[];
  rows: string[][];
}

/**
 * Read a source table for an analysis command: the picked worksheet of an RSF
 * workbook (`sourceId` is its id; a stale id falls back to the active sheet),
 * or the whole CSV tab (`sourceId` is ignored). Row 0 is always the header row.
 *
 * Reads at most `maxDataRows` data rows, so a huge sheet is never fully
 * materialized just to answer one question. The caller passes one more than
 * its own cap, to detect and report an excess. A worksheet's used range is
 * read, not its fully allocated grid.
 *
 * Every cell reads as its computed display value, except that the cells of
 * `plainColumn` (when not null) read as plain values (see
 * `RsfDocument.getSheetPlainValue`): a formatted amount is then its number.
 */
export function readSourceTable(
  tab: Tab,
  sourceId: string,
  maxDataRows: number,
  plainColumn: number | null,
): SourceTable {
  const doc = tab.doc;
  if (isWorkbook(doc)) {
    const sheet = doc.sheetById(sourceId) ?? doc.activeSheet;
    // A worksheet's rowCount/columnCount is its fully allocated grid (e.g.
    // 100x26 for a new sheet), not its content — trim to the used range so
    // `SELECT * FROM data` doesn't return a wall of blank rows/columns.
    const { rows: totalRows, cols: columnCount } = sheet.usedExtent();
    const readRow = (r: number): string[] =>
      Array.from({ length: columnCount }, (_, c) =>
        c === plainColumn ? doc.getSheetPlainValue(sheet.id, r, c) : doc.getSheetDisplayValue(sheet.id, r, c),
      );
    const headers = totalRows > 0 ? readRow(0) : [];
    const rows: string[][] = [];
    for (let r = 1; r < totalRows && rows.length < maxDataRows; r++) {
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
  for (let r = 1; r < totalRows && rows.length < maxDataRows; r++) {
    rows.push(readRow(r));
  }
  return { headers, rows };
}
