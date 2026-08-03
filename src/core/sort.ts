// SPDX-License-Identifier: MIT
/**
 * Deterministic, view-only column sorting for RSF documents.
 *
 * A {@link SheetSort} describes one sorted rectangular range: which rows are
 * *data* rows (below the optional header row), and one or more compound sort
 * keys (column + direction). Unlike a conventional spreadsheet sort, applying
 * a {@link SheetSort} never reorders, deletes, or rewrites cell data —
 * {@link computeSortOrder} only computes a *display order* (a row → row
 * mapping the UI reads from), exactly mirroring how {@link ../filter} only
 * computes a hidden-row set. Cell identity, formulas, references, and history
 * behavior are all untouched; nothing about the document itself changes when
 * a sort is applied, edited, or cleared.
 *
 * Sort combines with an active filter the same way a conventional sort would
 * combine with a filtered view: only rows the filter leaves visible take part
 * in the reordering. Rows the filter hides stay exactly where they are
 * (harmless, since a hidden row renders at zero height regardless of what
 * document row a neighboring slot displays).
 *
 * Sort state is session-only — it is intentionally **not** persisted in the
 * RSF container (it never reaches `rsf-codec.ts`), so it carries none of the
 * versioned binary-format risk a saved feature would. It behaves like the
 * document's live selection: remembered per worksheet while the tab is open,
 * reset when the worksheet's structure changes underneath it.
 *
 * Everything here is pure and DOM-free; comparisons never use regular
 * expressions, `eval`, or any dynamic code — only plain string/number
 * comparisons on the displayed values, matching `filter.ts`'s conventions.
 */

/** Maximum data rows a sort range may cover (keeps evaluation bounded). */
export const MAX_SHEET_SORT_ROWS = 1_000_000;
/** Maximum columns that may carry criteria in one filter's sort range. */
export const MAX_SHEET_SORT_COLUMNS = 64;
/** Maximum compound sort keys in one sort. */
export const MAX_SHEET_SORT_KEYS = 8;

/** One compound sort key: a column and its direction. */
export interface SortKey {
  /** Absolute document column index. */
  col: number;
  ascending: boolean;
}

/** The whole sort state of a sheet (one sorted range at a time). */
export interface SheetSort {
  /** Sorted rectangle (inclusive document coordinates). */
  top: number;
  left: number;
  bottom: number;
  right: number;
  /** Treat the range's first row as a header (never reordered). */
  headerRow: boolean;
  /** Compound sort keys, evaluated in order (1..{@link MAX_SHEET_SORT_KEYS}). */
  keys: SortKey[];
}

/** First data row of a sort (the row below the header when one is set). */
export function sortDataTop(sort: SheetSort): number {
  return sort.headerRow ? sort.top + 1 : sort.top;
}

/**
 * Parse a displayed value as a finite number, or null. Mirrors
 * `filterNumericValue` so "numeric" means the same thing everywhere.
 */
function sortNumericValue(display: string): number | null {
  const trimmed = display.trim();
  if (trimmed === '') {
    return null;
  }
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/**
 * Compare two displayed cell values for one sort key's ascending order.
 * Numbers compare numerically; anything else compares by code-point order
 * (deterministic, locale-independent — no `Intl.Collator`). Blank values
 * always sort after every non-blank value, in both directions, matching
 * conventional spreadsheet sort behavior.
 */
export function compareSortValues(a: string, b: string): number {
  const aBlank = a.trim() === '';
  const bBlank = b.trim() === '';
  if (aBlank || bBlank) {
    if (aBlank && bBlank) {
      return 0;
    }
    return aBlank ? 1 : -1;
  }
  const an = sortNumericValue(a);
  const bn = sortNumericValue(b);
  if (an !== null && bn !== null) {
    return an === bn ? 0 : an < bn ? -1 : 1;
  }
  return a === b ? 0 : a < b ? -1 : 1;
}

/**
 * Compute the display order of a sort: a `docRow[]` array of length
 * `rowCount` where `order[slot]` is the document row whose content should be
 * displayed (and edited) at display position `slot`. Rows outside the sort's
 * data range, and rows hidden by an active filter, map to themselves
 * (identity) — only the range's *visible* data rows are reordered among their
 * own slots, keeping every hidden row's position (irrelevant, since it always
 * renders at zero height) and every out-of-range row exactly where it was.
 * `get` returns the *displayed* value of an absolute cell.
 */
export function computeSortOrder(
  sort: SheetSort,
  rowCount: number,
  hidden: ReadonlySet<number> | null,
  get: (row: number, col: number) => string,
): number[] {
  const order = new Array<number>(rowCount);
  for (let i = 0; i < rowCount; i++) {
    order[i] = i;
  }
  const dataTop = sortDataTop(sort);
  const bottom = Math.min(sort.bottom, rowCount - 1);
  if (sort.keys.length === 0 || dataTop > bottom) {
    return order;
  }
  const visible: number[] = [];
  for (let r = dataTop; r <= bottom; r++) {
    if (!hidden?.has(r)) {
      visible.push(r);
    }
  }
  const decorated = visible.map((r, i) => ({ r, i }));
  decorated.sort((x, y) => {
    for (const key of sort.keys) {
      const cmp = compareSortValues(get(x.r, key.col), get(y.r, key.col));
      if (cmp !== 0) {
        return key.ascending ? cmp : -cmp;
      }
    }
    return x.i - y.i; // stable: ties keep their original relative order
  });
  for (let i = 0; i < visible.length; i++) {
    order[visible[i]] = decorated[i].r;
  }
  return order;
}

/**
 * Structural validation of a (possibly untrusted) sort against the sheet
 * dimensions and the documented bounds. Returns the sort when fully valid, or
 * null when anything is out of bounds.
 */
export function validateSort(sort: SheetSort, rowCount: number, columnCount: number): SheetSort | null {
  const intish = (n: number): boolean => Number.isInteger(n) && n >= 0;
  if (!intish(sort.top) || !intish(sort.left) || !intish(sort.bottom) || !intish(sort.right)) {
    return null;
  }
  if (sort.top > sort.bottom || sort.left > sort.right) {
    return null;
  }
  if (sort.bottom >= rowCount || sort.right >= columnCount) {
    return null;
  }
  if (sort.bottom - sort.top + 1 > MAX_SHEET_SORT_ROWS) {
    return null;
  }
  if (sort.right - sort.left + 1 > MAX_SHEET_SORT_COLUMNS) {
    return null;
  }
  if (typeof sort.headerRow !== 'boolean') {
    return null;
  }
  if (!Array.isArray(sort.keys) || sort.keys.length === 0 || sort.keys.length > MAX_SHEET_SORT_KEYS) {
    return null;
  }
  const seen = new Set<number>();
  for (const key of sort.keys) {
    if (!intish(key.col) || key.col < sort.left || key.col > sort.right) {
      return null;
    }
    if (seen.has(key.col)) {
      return null;
    }
    seen.add(key.col);
    if (typeof key.ascending !== 'boolean') {
      return null;
    }
  }
  return sort;
}

/** Deep structural equality of two sort states (null-safe). */
export function sortsEqual(a: SheetSort | null, b: SheetSort | null): boolean {
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
    a.keys.length !== b.keys.length
  ) {
    return false;
  }
  for (let i = 0; i < a.keys.length; i++) {
    if (a.keys[i].col !== b.keys[i].col || a.keys[i].ascending !== b.keys[i].ascending) {
      return false;
    }
  }
  return true;
}
