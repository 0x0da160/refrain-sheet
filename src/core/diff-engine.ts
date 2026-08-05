// SPDX-License-Identifier: MIT
/**
 * A hand-written, dependency-free row-diff engine for comparing two tables
 * shaped like `sql-engine.ts`'s `SqlTable` (a header row plus string rows) —
 * see docs/csv-diff-review-proposal.md for the product background and
 * docs/architecture.md "The SQL query engine" for why this, like the SQL
 * engine, carries no new dependency (a WASM RDB was evaluated and rejected
 * there for the same CSP/module-loading/dependency-count reasons).
 *
 * `baseline` and `current` rows are matched by one or more key columns,
 * picked by the caller from either table's header (the two tables need not
 * share identical columns or column order — columns are matched by name,
 * case-insensitively, and a column missing from one side reads as blank on
 * that side). Every row is classified into exactly one diff type:
 *
 *   - `unchanged`   a unique key on both sides, every compared column equal
 *   - `modified`    a unique key on both sides, at least one compared column differs
 *   - `added`       a unique, valid key that exists only in `current`
 *   - `deleted`     a unique, valid key that exists only in `baseline`
 *   - `key_invalid` the row's own key cannot be used to match rows: any key
 *                   part is blank, or the key repeats elsewhere in the same
 *                   table (both cases collapse a composite key's "missing
 *                   part" case, since a missing part reads as a blank part)
 *
 * A row whose key is duplicated within its own table can never be
 * definitively matched to the other side, so every occurrence of that key is
 * reported as its own `key_invalid` row rather than guessed at; the row on
 * the other side (if the same key is unique there) is then reported
 * `added`/`deleted` rather than paired with an ambiguous match.
 *
 * Cell comparison follows the same "blank is the table's null" rule as the
 * SQL engine: an empty string is blank, not equal to any non-blank value.
 * `DiffOptions.normalize` optionally trims whitespace and/or ignores case,
 * applied identically to both sides for the key and every compared column.
 * Values in the output (`before`/`after`) are always the original, untrimmed,
 * original-case text — normalization only affects what counts as equal.
 *
 * Every bound below is enforced before or during evaluation, mirroring
 * `sql-engine.ts`'s documented bounds table in docs/security.md.
 */
import type { SqlTable } from './sql-engine';

// ----- Bounds -----

/** Maximum key columns a caller may pick. */
export const DIFF_MAX_KEY_COLUMNS = 8;
/** Maximum rows considered from either source table (mirrors `SQL_MAX_SOURCE_ROWS`). */
export const DIFF_MAX_SOURCE_ROWS = 200_000;
/** Maximum diff rows ever returned; rendered as a plain, non-virtualized table. */
export const DIFF_MAX_RESULT_ROWS = 5_000;

// ----- Public data model -----

export type DiffRowType = 'unchanged' | 'modified' | 'added' | 'deleted' | 'key_invalid';

/** Why a row's key could not be used to match it against the other table. */
export type DiffInvalidKeyReason = 'blankKey' | 'duplicateKey';

export interface DiffRow {
  type: DiffRowType;
  /** Key column values (display text, combined-schema order), or null for a `key_invalid` row. */
  key: string[] | null;
  /** Baseline row values across every combined column, or null for `added`/current-only `key_invalid` rows. */
  before: string[] | null;
  /** Current row values across every combined column, or null for `deleted`/baseline-only `key_invalid` rows. */
  after: string[] | null;
  /** Combined-schema column indices whose value differs; non-empty only for `modified`. */
  changedColumns: number[];
  /** Set only for `key_invalid` rows. */
  reason?: DiffInvalidKeyReason;
}

export interface DiffCounts {
  unchanged: number;
  modified: number;
  added: number;
  deleted: number;
  keyInvalid: number;
}

export interface DiffResult {
  /** Combined column names, in display order: baseline's columns, then any current-only columns. */
  columns: string[];
  /** Combined-schema indices of the key columns, in the order given. */
  keyColumnIndexes: number[];
  /** Combined-schema indices of the compared columns, in schema order. */
  compareColumnIndexes: number[];
  rows: DiffRow[];
  /** Totals across every classified row, independent of the `rows` cap below. */
  counts: DiffCounts;
  baselineRows: number;
  /** True when the baseline table itself was cut off at {@link DIFF_MAX_SOURCE_ROWS}. */
  baselineTruncated: boolean;
  currentRows: number;
  /** True when the current table itself was cut off at {@link DIFF_MAX_SOURCE_ROWS}. */
  currentTruncated: boolean;
  /** Rows classified in total, before the {@link DIFF_MAX_RESULT_ROWS} cap. */
  matchedRows: number;
  /** True when `rows` is shorter than `matchedRows` because the cap applied. */
  truncated: boolean;
}

export interface DiffNormalizeOptions {
  /** Trim leading/trailing whitespace before comparing. */
  trim: boolean;
  /** Ignore case before comparing. */
  caseInsensitive: boolean;
}

export interface DiffOptions {
  /** Column names (case-insensitive) that together identify a row. */
  keyColumns: string[];
  /** Column names to compare; defaults to every non-key combined column. */
  compareColumns?: string[];
  normalize?: Partial<DiffNormalizeOptions>;
}

export type DiffErrorCode =
  'noKeyColumns' | 'tooManyKeyColumns' | 'unknownKeyColumn' | 'unknownCompareColumn';

/** A rejected diff configuration — see `diff.error.*` in the locale files. */
export class DiffError extends Error {
  readonly code: DiffErrorCode;
  readonly params: Record<string, string | number>;

  constructor(code: DiffErrorCode, message: string, params: Record<string, string | number> = {}) {
    super(message);
    this.name = 'DiffError';
    this.code = code;
    this.params = params;
  }
}

// ----- Schema handling (mirrors sql-engine.ts's header deduplication) -----

/** Deduplicated, trimmed column names for one table, in header order. */
function buildTableSchema(headers: string[]): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  headers.forEach((raw, i) => {
    const trimmed = raw.trim();
    const key = trimmed.toUpperCase();
    if (trimmed !== '' && !seen.has(key)) {
      names.push(trimmed);
      seen.add(key);
    } else {
      let fallback = `col${i + 1}`;
      let fk = fallback.toUpperCase();
      let n = i + 1;
      while (seen.has(fk)) {
        n++;
        fallback = `col${n}`;
        fk = fallback.toUpperCase();
      }
      names.push(fallback);
      seen.add(fk);
    }
  });
  return names;
}

/** Baseline's column names, then any current-only column names appended in their own order. */
function mergeSchemas(baselineNames: string[], currentNames: string[]): string[] {
  const seen = new Set(baselineNames.map((n) => n.toUpperCase()));
  const merged = baselineNames.slice();
  for (const name of currentNames) {
    const key = name.toUpperCase();
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(name);
    }
  }
  return merged;
}

/** For each combined column, the matching local index in `names`, or -1 when absent. */
function mapToCombined(names: string[], combined: string[]): number[] {
  const byUpper = new Map(names.map((n, i) => [n.toUpperCase(), i]));
  return combined.map((name) => byUpper.get(name.toUpperCase()) ?? -1);
}

function resolveColumnIndex(combined: string[], name: string, code: DiffErrorCode): number {
  const key = name.trim().toUpperCase();
  const idx = combined.findIndex((n) => n.toUpperCase() === key);
  if (idx < 0) {
    throw new DiffError(code, `unknown column "${name}"`, { name });
  }
  return idx;
}

function normalizeValue(v: string, opts: DiffNormalizeOptions): string {
  let out = v;
  if (opts.trim) out = out.trim();
  if (opts.caseInsensitive) out = out.toUpperCase();
  return out;
}

// ----- Per-side row classification -----

interface SideEntry {
  /** Combined-schema-wide values, original text. */
  wide: string[];
  /** JSON-encoded normalized key parts, used for matching and duplicate detection. */
  keyId: string;
  blankKey: boolean;
}

function classifySide(
  rows: string[][],
  columnMap: number[],
  keyColumnIndexes: number[],
  combined: string[],
  normOpts: DiffNormalizeOptions,
): { entries: SideEntry[]; byKey: Map<string, SideEntry[]> } {
  const entries: SideEntry[] = [];
  const byKey = new Map<string, SideEntry[]>();
  for (const row of rows) {
    const wide = combined.map((_, i) => {
      const localIdx = columnMap[i];
      return localIdx >= 0 ? (row[localIdx] ?? '') : '';
    });
    const keyParts = keyColumnIndexes.map((idx) => normalizeValue(wide[idx], normOpts));
    const blankKey = keyParts.some((p) => p === '');
    const entry: SideEntry = { wide, keyId: JSON.stringify(keyParts), blankKey };
    entries.push(entry);
    if (!blankKey) {
      const list = byKey.get(entry.keyId);
      if (list) list.push(entry);
      else byKey.set(entry.keyId, [entry]);
    }
  }
  return { entries, byKey };
}

// ----- Public entry point -----

export function computeDiff(baseline: SqlTable, current: SqlTable, options: DiffOptions): DiffResult {
  if (options.keyColumns.length === 0) {
    throw new DiffError('noKeyColumns', 'at least one key column is required');
  }
  if (options.keyColumns.length > DIFF_MAX_KEY_COLUMNS) {
    throw new DiffError('tooManyKeyColumns', `at most ${DIFF_MAX_KEY_COLUMNS} key columns are allowed`, {
      max: DIFF_MAX_KEY_COLUMNS,
    });
  }

  const columns = mergeSchemas(buildTableSchema(baseline.headers), buildTableSchema(current.headers));
  const baselineMap = mapToCombined(buildTableSchema(baseline.headers), columns);
  const currentMap = mapToCombined(buildTableSchema(current.headers), columns);

  const keyColumnIndexes = options.keyColumns.map((name) =>
    resolveColumnIndex(columns, name, 'unknownKeyColumn'),
  );
  const keySet = new Set(keyColumnIndexes);
  const compareColumnIndexes =
    options.compareColumns && options.compareColumns.length > 0
      ? options.compareColumns.map((name) => resolveColumnIndex(columns, name, 'unknownCompareColumn'))
      : columns.map((_, i) => i).filter((i) => !keySet.has(i));

  const normOpts: DiffNormalizeOptions = {
    trim: options.normalize?.trim ?? false,
    caseInsensitive: options.normalize?.caseInsensitive ?? false,
  };

  const baselineTruncated = baseline.rows.length > DIFF_MAX_SOURCE_ROWS;
  const baselineRows = baselineTruncated ? baseline.rows.slice(0, DIFF_MAX_SOURCE_ROWS) : baseline.rows;
  const currentTruncated = current.rows.length > DIFF_MAX_SOURCE_ROWS;
  const currentRows = currentTruncated ? current.rows.slice(0, DIFF_MAX_SOURCE_ROWS) : current.rows;

  const baselineSide = classifySide(baselineRows, baselineMap, keyColumnIndexes, columns, normOpts);
  const currentSide = classifySide(currentRows, currentMap, keyColumnIndexes, columns, normOpts);

  const counts: DiffCounts = { unchanged: 0, modified: 0, added: 0, deleted: 0, keyInvalid: 0 };
  const rows: DiffRow[] = [];
  const matchedKeys = new Set<string>();

  const keyValues = (wide: string[]): string[] => keyColumnIndexes.map((idx) => wide[idx]);

  for (const entry of baselineSide.entries) {
    const ownGroup = baselineSide.byKey.get(entry.keyId);
    if (entry.blankKey || !ownGroup || ownGroup.length > 1) {
      rows.push({
        type: 'key_invalid',
        key: null,
        before: entry.wide,
        after: null,
        changedColumns: [],
        reason: entry.blankKey ? 'blankKey' : 'duplicateKey',
      });
      counts.keyInvalid++;
      continue;
    }
    const currentGroup = currentSide.byKey.get(entry.keyId);
    if (currentGroup && currentGroup.length === 1) {
      const other = currentGroup[0];
      const changedColumns = compareColumnIndexes.filter(
        (idx) => normalizeValue(entry.wide[idx], normOpts) !== normalizeValue(other.wide[idx], normOpts),
      );
      matchedKeys.add(entry.keyId);
      rows.push({
        type: changedColumns.length > 0 ? 'modified' : 'unchanged',
        key: keyValues(entry.wide),
        before: entry.wide,
        after: other.wide,
        changedColumns,
      });
      if (changedColumns.length > 0) {
        counts.modified++;
      } else {
        counts.unchanged++;
      }
    } else {
      rows.push({
        type: 'deleted',
        key: keyValues(entry.wide),
        before: entry.wide,
        after: null,
        changedColumns: [],
      });
      counts.deleted++;
    }
  }

  for (const entry of currentSide.entries) {
    const ownGroup = currentSide.byKey.get(entry.keyId);
    if (entry.blankKey || !ownGroup || ownGroup.length > 1) {
      rows.push({
        type: 'key_invalid',
        key: null,
        before: null,
        after: entry.wide,
        changedColumns: [],
        reason: entry.blankKey ? 'blankKey' : 'duplicateKey',
      });
      counts.keyInvalid++;
      continue;
    }
    if (!matchedKeys.has(entry.keyId)) {
      rows.push({
        type: 'added',
        key: keyValues(entry.wide),
        before: null,
        after: entry.wide,
        changedColumns: [],
      });
      counts.added++;
    }
  }

  const matchedRows = rows.length;
  const changed = rows.filter((r) => r.type !== 'unchanged');
  const unchangedRows = rows.filter((r) => r.type === 'unchanged');
  const limited = changed.slice(0, DIFF_MAX_RESULT_ROWS);
  if (limited.length < DIFF_MAX_RESULT_ROWS) {
    limited.push(...unchangedRows.slice(0, DIFF_MAX_RESULT_ROWS - limited.length));
  }

  return {
    columns,
    keyColumnIndexes,
    compareColumnIndexes,
    rows: limited,
    counts,
    baselineRows: baselineRows.length,
    baselineTruncated,
    currentRows: currentRows.length,
    currentTruncated,
    matchedRows,
    truncated: limited.length < matchedRows,
  };
}
