// SPDX-License-Identifier: MIT
/**
 * Pivot table: a one-off cross-tabulation of one table. Its data rows are
 * grouped by a row field and, optionally, a column field, and one value field
 * is summarized in each group. This module is pure and read-only: the command
 * layer (`src/app/commands/pivot.ts`) reads the source and writes the result
 * into a new sheet, so nothing here touches a document.
 *
 * Rules (documented and tested in `tests/core/pivot.test.ts`):
 * - A group is the text of a field's cell. Blank cells (empty or spaces only)
 *   form one group, labelled `null` and listed last. A row shorter than the
 *   header reads as blank in its missing fields.
 * - Labels sort numbers first, in numeric order, then text in natural order,
 *   so "item 2" comes before "item 10".
 * - Values follow the status bar's numeric rule (`numericCellValue` in
 *   `stats.ts`). A non-blank value that is not a number is left out of sum,
 *   average, minimum, and maximum, and counted in `ignoredValues`.
 * - `count` counts the rows whose value is not blank.
 * - Sums and averages keep 15 significant digits, which removes binary
 *   floating-point noise (0.1 + 0.2 is 0.3) and changes no value typed by hand.
 * - A cell with no rows, or with no numbers to summarize, is `null` (shown
 *   blank), not zero.
 */
import { numericCellValue } from './stats';

/** Most source data rows a pivot table summarizes. The command layer reads one more row to detect an excess. */
export const PIVOT_MAX_SOURCE_ROWS = 200_000;
/** Most distinct row-field values, which is also the most output rows. */
export const PIVOT_MAX_ROW_GROUPS = 1_000;
/** Most distinct column-field values, which is also the most output columns. */
export const PIVOT_MAX_COLUMN_GROUPS = 256;

/** How each group's value field is summarized. */
export const PIVOT_AGGREGATIONS = ['count', 'sum', 'average', 'min', 'max'] as const;
type PivotAggregation = (typeof PIVOT_AGGREGATIONS)[number];

/** The fields to use. Each is a 0-based position in the header row. */
export interface PivotRequest {
  rowField: number;
  /** Null for no column field, which leaves one value column. */
  columnField: number | null;
  valueField: number;
  aggregation: PivotAggregation;
}

/**
 * The summary as numbers. `null` marks a cell with nothing to show, and a
 * `null` label is the blank group.
 */
export interface PivotTable {
  rowLabels: (string | null)[];
  /** Empty when there is no column field. */
  columnLabels: (string | null)[];
  /** `cells[r][c]`. With no column field the only column is `c = 0`. */
  cells: (number | null)[][];
  /** One per row group: its summary across every column. */
  rowTotals: (number | null)[];
  /** One per column group, or a single entry for the whole table with no column field. */
  columnTotals: (number | null)[];
  /** The summary of every source row. */
  grandTotal: number | null;
  /** Non-blank values left out of sum, average, minimum, and maximum. Always 0 for `count`. */
  ignoredValues: number;
}

type PivotErrorCode =
  | 'noColumns'
  | 'noRows'
  | 'fieldOutOfRange'
  | 'sameField'
  | 'tooManyRows'
  | 'tooManyRowGroups'
  | 'tooManyColumnGroups';

/** A rejected request. `params` carries the limit a message quotes, if any. */
export interface PivotError {
  code: PivotErrorCode;
  params: Record<string, number>;
}

export type PivotBuildOutcome = { ok: true; table: PivotTable } | { ok: false; error: PivotError };

/** Blank text (empty or only spaces) is the `null` group; any other text is a group of its own. */
function groupKey(text: string): string | null {
  return text.trim() === '' ? null : text;
}

const collator = new Intl.Collator(undefined, { numeric: true });

/** Numbers first in numeric order, then text in natural order, then the blank group. */
function compareLabels(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const na = numericCellValue(a);
  const nb = numericCellValue(b);
  if (na !== null && nb !== null) return na - nb;
  if (na !== null) return -1;
  if (nb !== null) return 1;
  return collator.compare(a, b);
}

/** Keeps 15 significant digits, the precision a spreadsheet shows numbers with. */
function roundDigits(n: number): number {
  return Number(n.toPrecision(15));
}

/** The number if it is finite; an overflowed sum has nothing to show. */
function finiteOrNull(n: number): number | null {
  return Number.isFinite(n) ? n : null;
}

/** The running summary of one group of rows. */
class Summary {
  private rows = 0;
  private filled = 0;
  private numbers = 0;
  private sum = 0;
  private min = Infinity;
  private max = -Infinity;
  private ignored = 0;

  add(text: string): void {
    this.rows += 1;
    if (groupKey(text) === null) return;
    this.filled += 1;
    const n = numericCellValue(text);
    if (n === null) {
      this.ignored += 1;
      return;
    }
    this.numbers += 1;
    this.sum += n;
    this.min = Math.min(this.min, n);
    this.max = Math.max(this.max, n);
  }

  get ignoredCount(): number {
    return this.ignored;
  }

  result(aggregation: PivotAggregation): number | null {
    if (aggregation === 'count') return this.rows === 0 ? null : this.filled;
    if (this.numbers === 0) return null;
    switch (aggregation) {
      case 'sum':
        return finiteOrNull(roundDigits(this.sum));
      case 'average':
        return finiteOrNull(roundDigits(this.sum / this.numbers));
      case 'min':
        return this.min;
      case 'max':
        return this.max;
    }
  }
}

/**
 * Summarize `rows` (the header row is not among them) by the fields `request`
 * names. Pure: the same input always gives the same table.
 */
export function buildPivotTable(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
  request: PivotRequest,
): PivotBuildOutcome {
  const fail = (code: PivotErrorCode, params: Record<string, number> = {}): PivotBuildOutcome => ({
    ok: false,
    error: { code, params },
  });
  if (headers.length === 0) return fail('noColumns');
  if (rows.length === 0) return fail('noRows');
  if (rows.length > PIVOT_MAX_SOURCE_ROWS) return fail('tooManyRows', { max: PIVOT_MAX_SOURCE_ROWS });

  const isField = (index: number): boolean => Number.isInteger(index) && index >= 0 && index < headers.length;
  const { rowField, columnField, valueField, aggregation } = request;
  if (!isField(rowField) || !isField(valueField) || (columnField !== null && !isField(columnField))) {
    return fail('fieldOutOfRange');
  }
  if (columnField === rowField) return fail('sameField');

  const text = (row: readonly string[], field: number): string => row[field] ?? '';

  // Pass 1: the distinct groups, each capped so a large or hostile sheet
  // cannot make the output unbounded.
  const rowKeys = new Set<string | null>();
  const columnKeys = new Set<string | null>();
  for (const row of rows) {
    rowKeys.add(groupKey(text(row, rowField)));
    if (rowKeys.size > PIVOT_MAX_ROW_GROUPS) return fail('tooManyRowGroups', { max: PIVOT_MAX_ROW_GROUPS });
    if (columnField !== null) {
      columnKeys.add(groupKey(text(row, columnField)));
      if (columnKeys.size > PIVOT_MAX_COLUMN_GROUPS) {
        return fail('tooManyColumnGroups', { max: PIVOT_MAX_COLUMN_GROUPS });
      }
    }
  }
  const rowLabels = [...rowKeys].sort(compareLabels);
  const columnLabels = columnField === null ? [] : [...columnKeys].sort(compareLabels);
  const rowIndex = new Map<string | null, number>();
  rowLabels.forEach((label, index) => rowIndex.set(label, index));
  const columnIndex = new Map<string | null, number>();
  columnLabels.forEach((label, index) => columnIndex.set(label, index));

  // Pass 2: add every row to its row group, its column group, its cell, and
  // the grand total. Each key was collected in pass 1, so the lookups hit.
  const width = columnField === null ? 1 : columnLabels.length;
  const rowSummaries = rowLabels.map(() => new Summary());
  const columnSummaries = Array.from({ length: width }, () => new Summary());
  const cellSummaries = new Map<number, Summary>();
  const grand = new Summary();
  for (const row of rows) {
    const r = rowIndex.get(groupKey(text(row, rowField))) ?? 0;
    const c = columnField === null ? 0 : (columnIndex.get(groupKey(text(row, columnField))) ?? 0);
    const value = text(row, valueField);
    rowSummaries[r].add(value);
    columnSummaries[c].add(value);
    grand.add(value);
    const slot = r * width + c;
    let cell = cellSummaries.get(slot);
    if (!cell) {
      cell = new Summary();
      cellSummaries.set(slot, cell);
    }
    cell.add(value);
  }

  return {
    ok: true,
    table: {
      rowLabels,
      columnLabels,
      cells: rowLabels.map((_, r) =>
        Array.from(
          { length: width },
          (_, c) => cellSummaries.get(r * width + c)?.result(aggregation) ?? null,
        ),
      ),
      rowTotals: rowSummaries.map((summary) => summary.result(aggregation)),
      columnTotals: columnSummaries.map((summary) => summary.result(aggregation)),
      grandTotal: grand.result(aggregation),
      ignoredValues: aggregation === 'count' ? 0 : grand.ignoredCount,
    },
  };
}
