// SPDX-License-Identifier: MIT
/**
 * Data > Run SQL Query…'s query builder: turns choices made on screen (which
 * columns, which rows, how to group and total them, how to sort, how many)
 * into one read-only `SELECT … FROM data` query for the SQL engine
 * (`sql-engine.ts`), which still checks and runs it like a typed query.
 *
 * Every column name is double-quoted and every typed value is a quoted SQL
 * string literal (or a plain number when it is one), so nothing typed into
 * the builder can change the shape of the query. A column the source no
 * longer has is dropped rather than queried.
 */

/** How one condition compares a column with the typed value. */
export type SqlFilterOperator =
  'eq' | 'ne' | 'gt' | 'ge' | 'lt' | 'le' | 'contains' | 'startsWith' | 'endsWith' | 'blank' | 'notBlank';

export const SQL_FILTER_OPERATORS: readonly SqlFilterOperator[] = [
  'eq',
  'ne',
  'gt',
  'ge',
  'lt',
  'le',
  'contains',
  'startsWith',
  'endsWith',
  'blank',
  'notBlank',
];

/** The operators that take no value. */
export function sqlOperatorTakesValue(op: SqlFilterOperator): boolean {
  return op !== 'blank' && op !== 'notBlank';
}

export type SqlAggregate = 'count' | 'sum' | 'avg' | 'min' | 'max';

export const SQL_AGGREGATES: readonly SqlAggregate[] = ['count', 'sum', 'avg', 'min', 'max'];

interface SqlFilter {
  column: string;
  op: SqlFilterOperator;
  value: string;
}

interface SqlTotal {
  fn: SqlAggregate;
  /** The column to total; null counts rows (only with `count`). */
  column: string | null;
}

export interface SqlBuilderSpec {
  /** Columns to show, in order; empty shows every column. Ignored when grouping or totalling. */
  columns: string[];
  filters: SqlFilter[];
  /** Keep a row when every condition matches (`all`) or any one does (`any`). */
  match: 'all' | 'any';
  /** Columns to group rows by. */
  groupBy: string[];
  /** Totals per group (or over all rows when nothing is grouped). */
  totals: SqlTotal[];
  /** Sort by an output column (a shown column, a grouped column, or a total's name). */
  sort: { column: string; descending: boolean } | null;
  /** Show at most this many rows; null shows all. */
  limit: number | null;
}

export const EMPTY_SQL_BUILDER_SPEC: SqlBuilderSpec = {
  columns: [],
  filters: [],
  match: 'all',
  groupBy: [],
  totals: [],
  sort: null,
  limit: null,
};

/** The largest row limit the builder writes (the engine caps shown rows lower anyway). */
export const SQL_BUILDER_MAX_LIMIT = 1_000_000;

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function quoteText(text: string): string {
  return `'${text.replace(/'/g, "''")}'`;
}

/** A typed value as SQL: a plain number when it is one exactly as typed, otherwise text. */
function literal(value: string): string {
  const trimmed = value.trim();
  if (trimmed !== '' && Number.isFinite(Number(trimmed)) && String(Number(trimmed)) === trimmed) {
    return trimmed;
  }
  return quoteText(value);
}

const COMPARISONS: Partial<Record<SqlFilterOperator, string>> = {
  eq: '=',
  ne: '<>',
  gt: '>',
  ge: '>=',
  lt: '<',
  le: '<=',
};

function condition(filter: SqlFilter): string {
  const col = quoteIdent(filter.column);
  const text = quoteText(filter.value);
  switch (filter.op) {
    case 'blank':
      return `(${col} IS NULL OR ${col} = '')`;
    case 'notBlank':
      return `(${col} IS NOT NULL AND ${col} <> '')`;
    // instr/substr rather than LIKE, so % and _ in the value are plain text.
    case 'contains':
      return `instr(${col}, ${text}) > 0`;
    case 'startsWith':
      return `substr(${col}, 1, length(${text})) = ${text}`;
    case 'endsWith':
      return `substr(${col}, -length(${text})) = ${text}`;
    default:
      return `${col} ${COMPARISONS[filter.op]} ${literal(filter.value)}`;
  }
}

/** The output column name of a total, e.g. `SUM(amount)` or `COUNT(*)`. */
function sqlTotalName(total: SqlTotal): string {
  return `${total.fn.toUpperCase()}(${total.column ?? '*'})`;
}

function totalExpression(total: SqlTotal): string {
  const arg = total.column === null ? '*' : quoteIdent(total.column);
  return `${total.fn.toUpperCase()}(${arg}) AS ${quoteIdent(sqlTotalName(total))}`;
}

/**
 * The output columns a spec produces, in order (what Sort can pick from).
 * `available` is every column of the source.
 */
export function sqlBuilderOutputColumns(spec: SqlBuilderSpec, available: readonly string[]): string[] {
  const clean = cleanSpec(spec, available);
  if (clean.groupBy.length > 0 || clean.totals.length > 0) {
    return [...clean.groupBy, ...clean.totals.map(sqlTotalName)];
  }
  return clean.columns.length > 0 ? clean.columns : [...available];
}

/** The spec without anything that names a column `available` lacks. */
function cleanSpec(spec: SqlBuilderSpec, available: readonly string[]): SqlBuilderSpec {
  const has = new Set(available);
  const known = (column: string): boolean => has.has(column);
  return {
    ...spec,
    columns: spec.columns.filter(known),
    filters: spec.filters.filter((f) => known(f.column)),
    groupBy: spec.groupBy.filter(known),
    totals: spec.totals.filter((total) =>
      total.column === null ? total.fn === 'count' : known(total.column),
    ),
  };
}

/** The query for `spec` over a source whose columns are `available` (the engine's names). */
export function buildSqlQuery(spec: SqlBuilderSpec, available: readonly string[]): string {
  const clean = cleanSpec(spec, available);
  const grouped = clean.groupBy.length > 0 || clean.totals.length > 0;
  const select = grouped
    ? [...clean.groupBy.map(quoteIdent), ...clean.totals.map(totalExpression)].join(', ')
    : clean.columns.length > 0
      ? clean.columns.map(quoteIdent).join(', ')
      : '*';
  const lines = [`SELECT ${select}`, 'FROM data'];
  if (clean.filters.length > 0) {
    const joiner = clean.match === 'any' ? ' OR ' : ' AND ';
    lines.push(`WHERE ${clean.filters.map(condition).join(joiner)}`);
  }
  if (clean.groupBy.length > 0) {
    lines.push(`GROUP BY ${clean.groupBy.map(quoteIdent).join(', ')}`);
  }
  if (clean.sort && sqlBuilderOutputColumns(clean, available).includes(clean.sort.column)) {
    lines.push(`ORDER BY ${quoteIdent(clean.sort.column)}${clean.sort.descending ? ' DESC' : ''}`);
  }
  if (clean.limit !== null && Number.isInteger(clean.limit) && clean.limit > 0) {
    lines.push(`LIMIT ${Math.min(clean.limit, SQL_BUILDER_MAX_LIMIT)}`);
  }
  return lines.join('\n');
}
