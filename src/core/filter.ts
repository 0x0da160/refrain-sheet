// SPDX-License-Identifier: MIT
/**
 * Deterministic spreadsheet filtering for RSF documents.
 *
 * A {@link SheetFilter} describes one filtered rectangular range: which rows
 * are *data* rows (below the optional header row), and per-column criteria.
 * Rows whose data fails the criteria are hidden **visually only** — their
 * values, identity, formulas, references, heights, and history behavior are
 * untouched, and formula evaluation always uses the normal sheet model (no
 * filter-aware functions exist in the formula specification).
 *
 * Combination semantics (documented, localized in the filter dialog):
 * - Conditions inside one column combine with the column's own AND/OR choice.
 * - A column's selected-values list (when limited) is an additional condition
 *   the row must also satisfy (AND with the column's conditions).
 * - Criteria across different columns always combine with AND.
 *
 * The hidden-row set is a snapshot taken when the filter is applied, edited,
 * or restored (open/undo/redo) — editing a cell afterwards does not
 * automatically re-evaluate the filter (re-open the filter dialog and Apply
 * to re-evaluate). This matches conventional spreadsheets and keeps every
 * keystroke O(1).
 *
 * Everything here is pure and DOM-free; predicates never use regular
 * expressions, `eval`, or any dynamic code — only plain string/number
 * comparisons on the displayed values.
 */

// ----- Bounds (shared by the UI and the RSF codec) ---------------------------
// Persisted filter metadata is validated against these on load; the UI
// enforces them on creation so a filter within bounds always round-trips.

/** Maximum data rows a filter range may cover (keeps evaluation bounded). */
export const MAX_FILTER_ROWS = 1_000_000;
/** Maximum columns that may carry criteria in one filter. */
export const MAX_FILTER_COLUMNS = 64;
/** Maximum comparison conditions per column. */
export const MAX_FILTER_CONDITIONS = 4;
/** Maximum entries in a column's selected-values list. */
export const MAX_FILTER_VALUES = 1000;
/** Maximum length (UTF-16 code units) of any filter comparison string/value. */
export const MAX_FILTER_STRING = 1024;

/** Text comparison operators (case-sensitive, exact string semantics). */
export const FILTER_TEXT_OPS = [
  'contains',
  'notContains',
  'equals',
  'notEquals',
  'beginsWith',
  'endsWith',
  'blank',
  'notBlank',
] as const;
export type FilterTextOp = (typeof FILTER_TEXT_OPS)[number];

/** Numeric comparison operators (displayed value must parse as a number). */
export const FILTER_NUMBER_OPS = [
  'numEquals',
  'numNotEquals',
  'numGreater',
  'numGreaterEq',
  'numLess',
  'numLessEq',
  'numBetween',
] as const;
export type FilterNumberOp = (typeof FILTER_NUMBER_OPS)[number];

/** One comparison condition on a column's displayed values. */
export type FilterCondition =
  | { kind: 'text'; op: FilterTextOp; value: string }
  | { kind: 'number'; op: FilterNumberOp; value: number; value2?: number };

/** Criteria for one column of the filtered range. */
export interface ColumnFilter {
  /** Absolute document column index. */
  col: number;
  /** How this column's `conditions` combine with each other. */
  join: 'and' | 'or';
  /** Comparison conditions (0..{@link MAX_FILTER_CONDITIONS}). */
  conditions: FilterCondition[];
  /**
   * Exact displayed values the row may have in this column, or null when all
   * values are allowed. Combined with `conditions` via AND. Bounded by
   * {@link MAX_FILTER_VALUES}.
   */
  values: string[] | null;
}

/** The whole filter state of a sheet (one filtered range at a time). */
export interface SheetFilter {
  /** Filtered rectangle (inclusive document coordinates). */
  top: number;
  left: number;
  bottom: number;
  right: number;
  /** Treat the range's first row as a header (never hidden, never evaluated). */
  headerRow: boolean;
  /** Per-column criteria. Columns without an entry accept every value. */
  columns: ColumnFilter[];
}

/** First data row of a filter (the row below the header when one is set). */
export function filterDataTop(filter: SheetFilter): number {
  return filter.headerRow ? filter.top + 1 : filter.top;
}

/**
 * Parse a displayed value as a finite number for numeric conditions, or null.
 * Mirrors the selection-statistics rule (`Number()` on the trimmed text) so
 * "numeric" means the same thing everywhere.
 */
export function filterNumericValue(display: string): number | null {
  const trimmed = display.trim();
  if (trimmed === '') {
    return null;
  }
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/** Evaluate one condition against a displayed cell value. */
export function matchCondition(cond: FilterCondition, display: string): boolean {
  if (cond.kind === 'text') {
    switch (cond.op) {
      case 'contains':
        return display.includes(cond.value);
      case 'notContains':
        return !display.includes(cond.value);
      case 'equals':
        return display === cond.value;
      case 'notEquals':
        return display !== cond.value;
      case 'beginsWith':
        return display.startsWith(cond.value);
      case 'endsWith':
        return display.endsWith(cond.value);
      case 'blank':
        return display.trim() === '';
      case 'notBlank':
        return display.trim() !== '';
    }
  }
  const n = filterNumericValue(display);
  if (n === null) {
    // Non-numeric cells never satisfy a numeric comparison (including the
    // negated ones — "not equal to 5" still means "is a number other than 5").
    return false;
  }
  switch (cond.op) {
    case 'numEquals':
      return n === cond.value;
    case 'numNotEquals':
      return n !== cond.value;
    case 'numGreater':
      return n > cond.value;
    case 'numGreaterEq':
      return n >= cond.value;
    case 'numLess':
      return n < cond.value;
    case 'numLessEq':
      return n <= cond.value;
    case 'numBetween': {
      const lo = Math.min(cond.value, cond.value2 ?? cond.value);
      const hi = Math.max(cond.value, cond.value2 ?? cond.value);
      return n >= lo && n <= hi;
    }
  }
}

/** Evaluate one column's criteria against a displayed cell value. */
export function matchColumn(column: ColumnFilter, display: string): boolean {
  if (column.conditions.length > 0) {
    if (column.join === 'or') {
      if (!column.conditions.some((c) => matchCondition(c, display))) {
        return false;
      }
    } else if (!column.conditions.every((c) => matchCondition(c, display))) {
      return false;
    }
  }
  if (column.values !== null && !column.values.includes(display)) {
    return false;
  }
  return true;
}

/**
 * True when a data row satisfies every column's criteria (columns combine
 * with AND). `get` returns the *displayed* value of an absolute cell.
 */
export function rowMatchesFilter(
  filter: SheetFilter,
  row: number,
  get: (row: number, col: number) => string,
): boolean {
  for (const column of filter.columns) {
    if (!matchColumn(column, get(row, column.col))) {
      return false;
    }
  }
  return true;
}

/**
 * Compute the hidden data rows of a filter over one row (used by the sliced
 * application scan and the synchronous restore path): returns true when the
 * row must be hidden. Header rows and rows outside the range are never hidden.
 */
export function rowHiddenByFilter(
  filter: SheetFilter,
  row: number,
  get: (row: number, col: number) => string,
): boolean {
  if (row < filterDataTop(filter) || row > filter.bottom) {
    return false;
  }
  return !rowMatchesFilter(filter, row, get);
}

/**
 * Compute the complete hidden-row set of a filter synchronously. Bounded by
 * the filter range (itself bounded by {@link MAX_FILTER_ROWS}); the command
 * layer uses a time-sliced equivalent with progress for large ranges.
 */
export function computeHiddenRows(
  filter: SheetFilter,
  get: (row: number, col: number) => string,
): Set<number> {
  const hidden = new Set<number>();
  for (let r = filterDataTop(filter); r <= filter.bottom; r++) {
    if (!rowMatchesFilter(filter, r, get)) {
      hidden.add(r);
    }
  }
  return hidden;
}

/**
 * Structural validation of a (possibly untrusted) filter against the sheet
 * dimensions and the documented bounds. Returns the filter when fully valid,
 * or null when anything is out of bounds — persisted filter metadata that
 * fails this is ignored (with a localized warning) rather than corrupting or
 * rejecting the document.
 */
export function validateFilter(
  filter: SheetFilter,
  rowCount: number,
  columnCount: number,
): SheetFilter | null {
  const intish = (n: number): boolean => Number.isInteger(n) && n >= 0;
  if (!intish(filter.top) || !intish(filter.left) || !intish(filter.bottom) || !intish(filter.right)) {
    return null;
  }
  if (filter.top > filter.bottom || filter.left > filter.right) {
    return null;
  }
  if (filter.bottom >= rowCount || filter.right >= columnCount) {
    return null;
  }
  if (filter.bottom - filter.top + 1 > MAX_FILTER_ROWS) {
    return null;
  }
  if (typeof filter.headerRow !== 'boolean') {
    return null;
  }
  if (!Array.isArray(filter.columns) || filter.columns.length > MAX_FILTER_COLUMNS) {
    return null;
  }
  const seen = new Set<number>();
  for (const column of filter.columns) {
    if (!intish(column.col) || column.col < filter.left || column.col > filter.right) {
      return null;
    }
    if (seen.has(column.col)) {
      return null;
    }
    seen.add(column.col);
    if (column.join !== 'and' && column.join !== 'or') {
      return null;
    }
    if (!Array.isArray(column.conditions) || column.conditions.length > MAX_FILTER_CONDITIONS) {
      return null;
    }
    for (const cond of column.conditions) {
      if (cond.kind === 'text') {
        if (!(FILTER_TEXT_OPS as readonly string[]).includes(cond.op)) {
          return null;
        }
        if (typeof cond.value !== 'string' || cond.value.length > MAX_FILTER_STRING) {
          return null;
        }
      } else if (cond.kind === 'number') {
        if (!(FILTER_NUMBER_OPS as readonly string[]).includes(cond.op)) {
          return null;
        }
        if (!Number.isFinite(cond.value)) {
          return null;
        }
        if (cond.op === 'numBetween' && cond.value2 !== undefined && !Number.isFinite(cond.value2)) {
          return null;
        }
      } else {
        return null;
      }
    }
    if (column.values !== null) {
      if (!Array.isArray(column.values) || column.values.length > MAX_FILTER_VALUES) {
        return null;
      }
      for (const v of column.values) {
        if (typeof v !== 'string' || v.length > MAX_FILTER_STRING) {
          return null;
        }
      }
    }
    // A column entry with no criteria at all is meaningless; drop the filter
    // shape as invalid rather than carrying dead entries around.
    if (column.conditions.length === 0 && column.values === null) {
      return null;
    }
  }
  return filter;
}

/** Deep structural equality of two filter states (null-safe). */
export function filtersEqual(a: SheetFilter | null, b: SheetFilter | null): boolean {
  if (a === b) {
    return true;
  }
  if (a === null || b === null) {
    return false;
  }
  if (
    a.top !== b.top ||
    a.left !== b.left ||
    a.bottom !== b.bottom ||
    a.right !== b.right ||
    a.headerRow !== b.headerRow ||
    a.columns.length !== b.columns.length
  ) {
    return false;
  }
  for (let i = 0; i < a.columns.length; i++) {
    const ca = a.columns[i];
    const cb = b.columns[i];
    if (ca.col !== cb.col || ca.join !== cb.join || ca.conditions.length !== cb.conditions.length) {
      return false;
    }
    for (let j = 0; j < ca.conditions.length; j++) {
      const xa = ca.conditions[j];
      const xb = cb.conditions[j];
      if (xa.kind !== xb.kind || xa.op !== xb.op) {
        return false;
      }
      if (xa.kind === 'text' && xb.kind === 'text' && xa.value !== xb.value) {
        return false;
      }
      if (
        xa.kind === 'number' &&
        xb.kind === 'number' &&
        (xa.value !== xb.value || xa.value2 !== xb.value2)
      ) {
        return false;
      }
    }
    if ((ca.values === null) !== (cb.values === null)) {
      return false;
    }
    if (ca.values !== null && cb.values !== null) {
      if (ca.values.length !== cb.values.length) {
        return false;
      }
      for (let j = 0; j < ca.values.length; j++) {
        if (ca.values[j] !== cb.values[j]) {
          return false;
        }
      }
    }
  }
  return true;
}
