// SPDX-License-Identifier: MIT
/**
 * The pivot table command layer. It reads the active worksheet of an RSF
 * workbook, or the whole CSV tab, through `readSourceTable`; summarizes it with
 * the pure engine in `src/core/pivot.ts`; and lays the summary out as the rows
 * of a sheet. A new summary goes into a new sheet, and a pivot table sheet is
 * rebuilt in place (see `rewrite`). Putting rows into the workbook is the
 * catalog's job, as it is for SQL results. The source is only ever read.
 */
import { isCsv, isWorkbook } from '../../core/editor-document';
import { numberToText } from '../../core/formula/value';
import {
  buildPivotTable,
  PIVOT_MAX_SOURCE_ROWS,
  pivotLinksEqual,
  summaryDigest,
  type PivotError,
  type PivotLink,
  type PivotRequest,
  type PivotTable,
} from '../../core/pivot';
import type { CellChange, Operation } from '../../core/workbook/history';
import { t } from '../i18n';
import { pivotLinkOn } from '../state/pivot-links';
import type { AppState, Tab } from '../state';
import { readSourceTable } from './source-table';

/** The rows of a summary, ready to write into a sheet, and how many values its totals left out. */
interface PivotSheet {
  rows: string[][];
  ignoredValues: number;
  /** The widest row: the width of the area the summary fills. */
  cols: number;
}

type PivotBuildOutcome = { ok: true; sheet: PivotSheet } | { ok: false; error: PivotError };

/** The table a summary reads: an open tab, and its worksheet (`'csv'` for a CSV tab). */
export interface PivotSource {
  tab: Tab;
  sourceId: string;
}

/** Spreadsheet column letters: 0 is A, 25 is Z, 26 is AA. */
function columnLetters(index: number): string {
  let n = index + 1;
  let letters = '';
  while (n > 0) {
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/** A field's name: its header, or its column letter when the header is blank. */
function fieldName(header: string, index: number): string {
  return header.trim() === '' ? columnLetters(index) : header;
}

/**
 * The sheet rows of a summary: a title row naming what is summarized ("Sum of
 * Amount"), a header row with the row field's name and the column labels (or
 * the value field's name), one row per row group, and a total row. A cell
 * with nothing to show is blank.
 */
function layoutSheet(headers: string[], table: PivotTable, request: PivotRequest): string[][] {
  const label = (value: string | null): string => value ?? t('pivot.blank');
  const cell = (value: number | null): string => (value === null ? '' : numberToText(value));
  const total = t('pivot.total');
  const rowName = fieldName(headers[request.rowField] ?? '', request.rowField);
  const valueName = fieldName(headers[request.valueField] ?? '', request.valueField);
  const title = t('pivot.valueHeader', {
    aggregation: t(`pivot.aggregation.${request.aggregation}`),
    field: valueName,
  });
  if (request.columnField === null) {
    return [
      [title],
      [rowName, valueName],
      ...table.rowLabels.map((rowLabel, r) => [label(rowLabel), cell(table.cells[r][0])]),
      [total, cell(table.grandTotal)],
    ];
  }
  return [
    [title],
    [rowName, ...table.columnLabels.map(label), total],
    ...table.rowLabels.map((rowLabel, r) => [
      label(rowLabel),
      ...table.cells[r].map(cell),
      cell(table.rowTotals[r]),
    ]),
    [total, ...table.columnTotals.map(cell), cell(table.grandTotal)],
  ];
}

/** The pivot table commands: what the panel reads, and the summaries it builds. */
export class PivotCommands {
  /** The table a summary of `tab` reads by default: its active worksheet, or the whole CSV tab. */
  sourceOf(tab: Tab): string {
    return isWorkbook(tab.doc) ? tab.doc.activeSheetId : 'csv';
  }

  /**
   * What the panel opens on. On a pivot table sheet that is the table the sheet
   * reads, with the sheet and the link it was made with, so the panel reopens
   * with those settings. Anywhere else it is the active table, with no sheet.
   */
  panelOf(
    state: AppState,
    tab: Tab,
  ): { source: PivotSource; pivot: { sheetId: string; link: PivotLink } | null } {
    const sheetId = isWorkbook(tab.doc) ? tab.doc.activeSheetId : null;
    const link = sheetId === null ? null : pivotLinkOn(tab, sheetId);
    const source = link ? this.linkedSource(state, link) : null;
    if (sheetId !== null && link && source) {
      return { source, pivot: { sheetId, link } };
    }
    return { source: { tab, sourceId: this.sourceOf(tab) }, pivot: null };
  }

  /** The table a link reads, if that table is still open and still has its worksheet. */
  linkedSource(state: AppState, link: PivotLink): PivotSource | null {
    const tab = state.tabs.find((candidate) => candidate.id === link.sourceTabId);
    const source = tab ? { tab, sourceId: link.sourceId } : null;
    return source && this.isOpen(state, source) ? source : null;
  }

  /** The field names of a table for the panel's pickers; a blank header reads as its column letter. */
  listColumns(source: PivotSource): string[] {
    const { headers } = readSourceTable(source.tab, source.sourceId, 0, null);
    return headers.map((header, index) => fieldName(header, index));
  }

  /**
   * Summarize `source` by `request`. The table is read with the value field as
   * plain numbers (a formatted amount is its number), and at most one row past
   * the engine's cap, so an oversized sheet is reported rather than summarized
   * from a cut-off read. A source that is no longer open is reported, not read.
   */
  build(state: AppState, source: PivotSource, request: PivotRequest): PivotBuildOutcome {
    if (!this.isOpen(state, source)) {
      return { ok: false, error: { code: 'sourceMissing', params: {} } };
    }
    const { headers, rows } = readSourceTable(
      source.tab,
      source.sourceId,
      PIVOT_MAX_SOURCE_ROWS + 1,
      request.valueField,
    );
    const outcome = buildPivotTable(headers, rows, request);
    if (!outcome.ok) {
      return outcome;
    }
    const lines = layoutSheet(headers, outcome.table, request);
    return {
      ok: true,
      sheet: {
        rows: lines,
        ignoredValues: outcome.table.ignoredValues,
        cols: lines.reduce((widest, line) => Math.max(widest, line.length), 0),
      },
    };
  }

  /** The link a summary of `source` by `request` is made with, sized to the summary. */
  linkFor(source: PivotSource, request: PivotRequest, sheet: PivotSheet): PivotLink {
    return {
      sourceTabId: source.tab.id,
      sourceId: source.sourceId,
      request: { ...request },
      rows: sheet.rows.length,
      cols: sheet.cols,
      digest: summaryDigest(sheet.rows.length, sheet.cols, (row, col) => sheet.rows[row][col] ?? ''),
    };
  }

  /**
   * Rebuild a pivot table sheet in place, as one undoable step. The sheet grows
   * first, with blank rows and columns at its end, if the summary needs more
   * room. Then the cells of the previous summary are cleared, the new one is
   * written, and the sheet's link becomes `link`. Cells outside both summaries
   * are not touched. Returns 'unchanged' when nothing would differ, and
   * 'refused' when the write is not allowed (a read-only file, a locked sheet,
   * or a sheet that is gone). 'changed' when the previous summary is no longer
   * the one the link fingerprints (it was moved or edited), so nothing is written.
   */
  rewrite(
    state: AppState,
    tab: Tab,
    sheetId: string,
    previous: PivotLink,
    sheet: PivotSheet,
    link: PivotLink,
  ): 'applied' | 'unchanged' | 'refused' | 'changed' {
    const doc = tab.doc;
    const target = isWorkbook(doc) && state.tabs.includes(tab) ? doc.sheetById(sheetId) : null;
    if (!target) {
      return 'refused';
    }
    // The old summary is cleared below, so it must still be the one the link describes.
    if (summaryDigest(previous.rows, previous.cols, (r, c) => target.getValue(r, c)) !== previous.digest) {
      return 'changed';
    }
    const ops: Operation[] = [];
    const extraRows = sheet.rows.length - target.rowCount;
    if (extraRows > 0) {
      ops.push({
        type: 'rows',
        action: 'insert',
        index: target.rowCount,
        count: extraRows,
        data: [],
        sheetId,
      });
    }
    const extraCols = link.cols - target.columnCount;
    if (extraCols > 0) {
      ops.push({
        type: 'cols',
        action: 'insert',
        index: target.columnCount,
        count: extraCols,
        data: [],
        sheetId,
      });
    }
    const changes: CellChange[] = [];
    for (let r = 0; r < Math.max(previous.rows, sheet.rows.length); r++) {
      for (let c = 0; c < Math.max(previous.cols, link.cols); c++) {
        const inNew = r < sheet.rows.length && c < link.cols;
        if (!inNew && !(r < previous.rows && c < previous.cols)) {
          continue;
        }
        const after = inNew ? (sheet.rows[r][c] ?? '') : '';
        const before = target.getValue(r, c);
        if (before !== after) {
          changes.push({ row: r, col: c, before, after });
        }
      }
    }
    if (changes.length > 0) {
      ops.push({ type: 'cells', changes, sheetId });
    }
    if (ops.length === 0 && pivotLinksEqual(previous, link)) {
      return 'unchanged';
    }
    ops.push({ type: 'pivot', sheetId, before: previous, after: link });
    return state.pushEntry(tab, { label: 'history.updatePivotTable', ops, sheetId }) ? 'applied' : 'refused';
  }

  /** Whether a source is still open: its tab is in the app, with its worksheet, or its CSV document. */
  private isOpen(state: AppState, { tab, sourceId }: PivotSource): boolean {
    if (!state.tabs.includes(tab)) {
      return false;
    }
    if (sourceId === 'csv') {
      return isCsv(tab.doc);
    }
    return isWorkbook(tab.doc) && tab.doc.sheetById(sourceId) !== null;
  }
}
