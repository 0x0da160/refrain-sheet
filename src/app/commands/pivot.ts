// SPDX-License-Identifier: MIT
/**
 * The pivot table command layer. It reads the active worksheet of an RSF
 * workbook, or the whole CSV tab, through `readSourceTable`; summarizes it with
 * the pure engine in `src/core/pivot.ts`; and lays the summary out as the rows
 * of a new sheet. Putting those rows into the workbook is the catalog's job,
 * as it is for SQL results. The source is only ever read.
 */
import { isWorkbook } from '../../core/editor-document';
import { numberToText } from '../../core/formula/value';
import {
  buildPivotTable,
  PIVOT_MAX_SOURCE_ROWS,
  type PivotError,
  type PivotRequest,
  type PivotTable,
} from '../../core/pivot';
import { t } from '../i18n';
import type { Tab } from '../state';
import { readSourceTable } from './source-table';

/** The rows of a summary, ready to write into a sheet, and how many values its totals left out. */
interface PivotSheet {
  rows: string[][];
  ignoredValues: number;
}

type PivotBuildOutcome = { ok: true; sheet: PivotSheet } | { ok: false; error: PivotError };

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

/** The pivot table commands: the field names the panel offers, and the summary of the active table. */
export class PivotCommands {
  /**
   * The table a summary reads now: the active worksheet of a workbook, or the
   * whole CSV tab. The panel takes it once, when it opens, so its field names
   * and its summary always describe the same table.
   */
  sourceOf(tab: Tab): string {
    return isWorkbook(tab.doc) ? tab.doc.activeSheetId : 'csv';
  }

  /** The field names of a table for the panel's pickers; a blank header reads as its column letter. */
  listColumns(tab: Tab, sourceId: string): string[] {
    const { headers } = readSourceTable(tab, sourceId, 0, null);
    return headers.map((header, index) => fieldName(header, index));
  }

  /**
   * Summarize the active table by `request`. The table is read with the value
   * field as plain numbers (a formatted amount is its number), and at most one
   * row past the engine's cap, so an oversized sheet is reported rather than
   * summarized from a cut-off read.
   */
  build(tab: Tab, sourceId: string, request: PivotRequest): PivotBuildOutcome {
    const { headers, rows } = readSourceTable(tab, sourceId, PIVOT_MAX_SOURCE_ROWS + 1, request.valueField);
    const outcome = buildPivotTable(headers, rows, request);
    if (!outcome.ok) {
      return outcome;
    }
    return {
      ok: true,
      sheet: {
        rows: layoutSheet(headers, outcome.table, request),
        ignoredValues: outcome.table.ignoredValues,
      },
    };
  }
}
