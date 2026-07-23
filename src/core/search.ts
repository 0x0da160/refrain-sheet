// SPDX-License-Identifier: MIT
import { getCsvEngine } from './csv-engine';

/** The document surface search needs; satisfied by CSV and RSF documents. */
export interface SearchableDocument {
  rowCount: number;
  fieldCount(row: number): number;
  getValue(row: number, col: number): string;
}

export interface SearchQuery {
  text: string;
  matchCase: boolean;
  regex: boolean;
}

/**
 * JavaScript's RegExp engine can backtrack catastrophically, so searches are
 * guarded by a pattern-length limit and a wall-clock budget checked while
 * scanning cells. When the budget is exceeded the search stops and reports
 * partial results instead of freezing the application.
 */
export const MAX_PATTERN_LENGTH = 1024;
export const SEARCH_TIME_BUDGET_MS = 2000;

export type CompiledQuery =
  | { ok: true; kind: 'text'; needle: string; matchCase: boolean; needleBytes: Uint8Array }
  | { ok: true; kind: 'regex'; pattern: RegExp }
  | { ok: false; error: string };

/**
 * Values at least this many characters use the WASM byte-level literal counter
 * (a single boundary crossing pays off); shorter cells stay in JS `indexOf` so
 * the marshalling cost never dominates. Only the case-sensitive literal path
 * qualifies — case folding and regex stay in JS for Unicode correctness.
 */
export const LITERAL_WASM_THRESHOLD = 256;

export function compileQuery(query: SearchQuery): CompiledQuery {
  if (query.text.length === 0) {
    return { ok: false, error: 'empty' };
  }
  if (query.text.length > MAX_PATTERN_LENGTH) {
    return { ok: false, error: `pattern longer than ${MAX_PATTERN_LENGTH} characters` };
  }
  if (!query.regex) {
    return {
      ok: true,
      kind: 'text',
      needle: query.text,
      matchCase: query.matchCase,
      needleBytes: new TextEncoder().encode(query.text),
    };
  }
  try {
    return { ok: true, kind: 'regex', pattern: new RegExp(query.text, query.matchCase ? 'g' : 'gi') };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Count matches of a compiled query inside one cell value. */
export function countMatchesInValue(value: string, query: CompiledQuery): number {
  if (!query.ok) {
    return 0;
  }
  if (query.kind === 'text') {
    // Long case-sensitive cells: byte-level count in WASM (parity-exact with
    // the JS indexOf loop, since substring occurrence counts are the same in
    // UTF-8 bytes and UTF-16 code units).
    if (query.matchCase && value.length >= LITERAL_WASM_THRESHOLD) {
      return getCsvEngine().countLiteral(new TextEncoder().encode(value), query.needleBytes);
    }
    const haystack = query.matchCase ? value : value.toLowerCase();
    const needle = query.matchCase ? query.needle : query.needle.toLowerCase();
    let count = 0;
    let from = 0;
    for (;;) {
      const idx = haystack.indexOf(needle, from);
      if (idx < 0) break;
      count += 1;
      from = idx + needle.length;
    }
    return count;
  }
  const pattern = query.pattern;
  pattern.lastIndex = 0;
  let count = 0;
  for (;;) {
    const m = pattern.exec(value);
    if (!m) break;
    count += 1;
    if (m[0].length === 0) {
      pattern.lastIndex += 1;
      if (pattern.lastIndex > value.length) break;
    }
  }
  return count;
}

export interface CellMatch {
  row: number;
  col: number;
  count: number;
}

export interface SearchResult {
  cells: CellMatch[];
  matchCount: number;
  cellCount: number;
  aborted: boolean;
}

/** Search the current (edited or original) values of every cell. */
export function searchDocument(
  doc: SearchableDocument,
  query: CompiledQuery,
  timeBudgetMs: number = SEARCH_TIME_BUDGET_MS,
): SearchResult {
  const cells: CellMatch[] = [];
  let matchCount = 0;
  let aborted = false;
  if (!query.ok) {
    return { cells, matchCount: 0, cellCount: 0, aborted: false };
  }
  const started = Date.now();
  let sinceCheck = 0;
  outer: for (let r = 0; r < doc.rowCount; r++) {
    const fieldCount = doc.fieldCount(r);
    for (let c = 0; c < fieldCount; c++) {
      const count = countMatchesInValue(doc.getValue(r, c), query);
      if (count > 0) {
        cells.push({ row: r, col: c, count });
        matchCount += count;
      }
      sinceCheck += 1;
      if (sinceCheck >= 256) {
        sinceCheck = 0;
        if (Date.now() - started > timeBudgetMs) {
          aborted = true;
          break outer;
        }
      }
    }
  }
  return { cells, matchCount, cellCount: cells.length, aborted };
}

// ---------------------------------------------------------------------------
// Workbook-wide search
// ---------------------------------------------------------------------------

/** Search scope: the active worksheet only, or every worksheet in order. */
export type SearchScope = 'sheet' | 'workbook';

/** One worksheet as far as searching is concerned. */
export interface SearchableSheet extends SearchableDocument {
  /** Stable worksheet identifier — never an index or a name. */
  id: string;
  /** Current display name (only for reporting; navigation uses `id`). */
  name: string;
}

export interface SheetCellMatch extends CellMatch {
  sheetId: string;
  sheetName: string;
}

export interface WorkbookSearchResult {
  /** Matching cells in workbook order, then row-major within each worksheet. */
  cells: SheetCellMatch[];
  matchCount: number;
  cellCount: number;
  /** Number of worksheets containing at least one match. */
  sheetCount: number;
  aborted: boolean;
}

/**
 * Search every worksheet of a workbook, in workbook order.
 *
 * Like {@link searchDocument} this reads each cell's **input** — the formula
 * expression for a formula cell, never its calculated result — so a
 * replacement can only ever rewrite something the user actually typed. The
 * same wall-clock budget applies across the whole workbook, and a match always
 * carries the worksheet's stable id, so navigating to it later cannot land on
 * the wrong sheet after a rename or a reorder.
 */
export function searchWorkbook(
  sheets: readonly SearchableSheet[],
  query: CompiledQuery,
  timeBudgetMs: number = SEARCH_TIME_BUDGET_MS,
): WorkbookSearchResult {
  const cells: SheetCellMatch[] = [];
  let matchCount = 0;
  let aborted = false;
  const sheetIds = new Set<string>();
  if (!query.ok) {
    return { cells, matchCount: 0, cellCount: 0, sheetCount: 0, aborted: false };
  }
  const started = Date.now();
  let sinceCheck = 0;
  outer: for (const sheet of sheets) {
    for (let r = 0; r < sheet.rowCount; r++) {
      const fieldCount = sheet.fieldCount(r);
      for (let c = 0; c < fieldCount; c++) {
        const count = countMatchesInValue(sheet.getValue(r, c), query);
        if (count > 0) {
          cells.push({ row: r, col: c, count, sheetId: sheet.id, sheetName: sheet.name });
          matchCount += count;
          sheetIds.add(sheet.id);
        }
        sinceCheck += 1;
        if (sinceCheck >= 256) {
          sinceCheck = 0;
          if (Date.now() - started > timeBudgetMs) {
            aborted = true;
            break outer;
          }
        }
      }
    }
  }
  return { cells, matchCount, cellCount: cells.length, sheetCount: sheetIds.size, aborted };
}

/**
 * Expand a replacement template against a regex match.
 * Supports `$$` (literal `$`), `$&` (whole match), `$1`–`$9`, and `${name}`.
 * References to groups that do not exist are kept literally.
 */
export function expandTemplate(template: string, match: RegExpExecArray): string {
  let out = '';
  for (let i = 0; i < template.length; i++) {
    const ch = template[i];
    if (ch !== '$' || i + 1 >= template.length) {
      out += ch;
      continue;
    }
    const next = template[i + 1];
    if (next === '$') {
      out += '$';
      i += 1;
    } else if (next === '&') {
      out += match[0];
      i += 1;
    } else if (next >= '1' && next <= '9') {
      const n = next.charCodeAt(0) - 0x30;
      if (n < match.length) {
        out += match[n] ?? '';
        i += 1;
      } else {
        out += ch;
      }
    } else if (next === '{') {
      const close = template.indexOf('}', i + 2);
      const name = close > i + 2 ? template.slice(i + 2, close) : null;
      if (name && match.groups && Object.prototype.hasOwnProperty.call(match.groups, name)) {
        out += match.groups[name] ?? '';
        i = close;
      } else {
        out += ch;
      }
    } else {
      out += ch;
    }
  }
  return out;
}

export interface ReplaceValueResult {
  value: string;
  count: number;
}

/** Replace every match inside one cell value. */
export function replaceAllInValue(
  value: string,
  query: CompiledQuery,
  replacement: string,
): ReplaceValueResult {
  if (!query.ok) {
    return { value, count: 0 };
  }
  if (query.kind === 'text') {
    const haystack = query.matchCase ? value : value.toLowerCase();
    const needle = query.matchCase ? query.needle : query.needle.toLowerCase();
    let out = '';
    let from = 0;
    let count = 0;
    for (;;) {
      const idx = haystack.indexOf(needle, from);
      if (idx < 0) break;
      out += value.slice(from, idx) + replacement;
      from = idx + needle.length;
      count += 1;
    }
    out += value.slice(from);
    return { value: out, count };
  }
  const pattern = query.pattern;
  pattern.lastIndex = 0;
  let out = '';
  let last = 0;
  let count = 0;
  for (;;) {
    const m = pattern.exec(value);
    if (!m) break;
    out += value.slice(last, m.index) + expandTemplate(replacement, m);
    last = m.index + m[0].length;
    count += 1;
    if (m[0].length === 0) {
      pattern.lastIndex += 1;
      if (pattern.lastIndex > value.length) break;
    }
  }
  out += value.slice(last);
  return { value: out, count };
}
