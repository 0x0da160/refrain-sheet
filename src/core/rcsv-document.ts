// SPDX-License-Identifier: MIT
import type { DelimiterId } from './byte-csv-parser';
import {
  evaluateAst,
  errorValue,
  formatValue,
  isFormula,
  literalToValue,
  parseFormula,
  type FormulaValue,
  type ParseResult,
} from './formula';
import type { LosslessDocument } from './lossless-document';

/**
 * The `.rcsv` file format: a documented, versioned, UTF-8 JSON container for
 * spreadsheet documents. CSV cannot store formulas, worksheet metadata, or
 * structural editing intent without breaking the original-file preservation
 * guarantee, so spreadsheet documents are saved as `.rcsv` instead.
 *
 * Format (version 1):
 *
 * ```json
 * {
 *   "format": "refrain-rcsv",
 *   "version": 1,
 *   "sheet": {
 *     "name": "Sheet1",
 *     "rowCount": 3,
 *     "columnCount": 2,
 *     "cells": [[0, 0, "value"], [1, 0, "=SUM(A1:A1)"]]
 *   },
 *   "settings": { "delimiter": "," }
 * }
 * ```
 *
 * - `cells` lists non-empty cells as `[row, column, input]` triples; an
 *   input beginning with `=` is a formula expression, anything else is a
 *   literal value.
 * - `settings` stores only what the application needs (the CSV delimiter
 *   used for export defaults).
 * - The format holds pure data: no executable code, no macros, no external
 *   references, and no network URLs. Parsing is strict (shape, types, and
 *   bounds are validated) and never executes anything.
 */
export const RCSV_FORMAT = 'refrain-rcsv';
export const RCSV_VERSION = 1;
export const RCSV_EXTENSION = '.rcsv';

export const MAX_RCSV_ROWS = 2_000_000;
export const MAX_RCSV_COLS = 16_384;
export const MAX_RCSV_CELLS = 20_000_000;
export const MAX_RCSV_CELL_LENGTH = 1_000_000;

export type RcsvParseError =
  'not-json' | 'not-utf8' | 'bad-format' | 'bad-version' | 'bad-shape' | 'too-large';

export type RcsvLoadResult = { ok: true; doc: RcsvDocument } | { ok: false; error: RcsvParseError };

interface CompiledFormula {
  src: string;
  parsed: ParseResult;
}

/**
 * A spreadsheet document. Unlike LosslessDocument there is no byte-level
 * baseline: the cell inputs are the document. Cells whose input starts with
 * `=` are formulas; their computed values are evaluated lazily with
 * memoization and full invalidation on any mutation, with circular
 * references detected during evaluation.
 */
export class RcsvDocument {
  readonly kind = 'rcsv' as const;
  name: string;
  /** Delimiter used as the default for CSV export. */
  delimiter: DelimiterId;

  private data: string[][];
  private cols: number;
  private revision = 0;
  private savedRevision = 0;
  private readonly formulaCache = new Map<string, CompiledFormula>();
  private memo = new Map<string, FormulaValue>();
  private readonly inProgress = new Set<string>();

  private constructor(name: string, delimiter: DelimiterId, data: string[][], columnCount: number) {
    this.name = name;
    this.delimiter = delimiter;
    this.data = data;
    this.cols = columnCount;
  }

  /** Create an RCSV document from the current values of a CSV document (explicit conversion). */
  static fromLossless(doc: LosslessDocument, name: string): RcsvDocument {
    const columnCount = Math.max(1, doc.columnCount);
    const data: string[][] = [];
    for (let r = 0; r < doc.rowCount; r++) {
      const row = new Array<string>(columnCount).fill('');
      const fieldCount = doc.fieldCount(r);
      for (let c = 0; c < fieldCount; c++) {
        row[c] = doc.getValue(r, c);
      }
      data.push(row);
    }
    if (data.length === 0) {
      data.push(new Array<string>(columnCount).fill(''));
    }
    return new RcsvDocument(name, doc.delimiter, data, columnCount);
  }

  static empty(name: string, rows = 1, cols = 1): RcsvDocument {
    const data: string[][] = [];
    for (let r = 0; r < Math.max(1, rows); r++) {
      data.push(new Array<string>(Math.max(1, cols)).fill(''));
    }
    return new RcsvDocument(name, ',', data, Math.max(1, cols));
  }

  /** Parse and strictly validate `.rcsv` bytes. Never executes anything. */
  static fromBytes(bytes: Uint8Array, name: string): RcsvLoadResult {
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return { ok: false, error: 'not-utf8' };
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: false, error: 'not-json' };
    }
    if (typeof json !== 'object' || json === null || Array.isArray(json)) {
      return { ok: false, error: 'bad-shape' };
    }
    const root = json as Record<string, unknown>;
    if (root.format !== RCSV_FORMAT) {
      return { ok: false, error: 'bad-format' };
    }
    if (root.version !== RCSV_VERSION) {
      return { ok: false, error: 'bad-version' };
    }
    const sheet = root.sheet;
    if (typeof sheet !== 'object' || sheet === null || Array.isArray(sheet)) {
      return { ok: false, error: 'bad-shape' };
    }
    const s = sheet as Record<string, unknown>;
    const rowCount = s.rowCount;
    const columnCount = s.columnCount;
    if (
      typeof rowCount !== 'number' ||
      typeof columnCount !== 'number' ||
      !Number.isInteger(rowCount) ||
      !Number.isInteger(columnCount) ||
      rowCount < 1 ||
      columnCount < 1
    ) {
      return { ok: false, error: 'bad-shape' };
    }
    if (rowCount > MAX_RCSV_ROWS || columnCount > MAX_RCSV_COLS || rowCount * columnCount > MAX_RCSV_CELLS) {
      return { ok: false, error: 'too-large' };
    }
    const cells = s.cells;
    if (!Array.isArray(cells) || cells.length > rowCount * columnCount) {
      return { ok: false, error: 'bad-shape' };
    }
    const data: string[][] = [];
    for (let r = 0; r < rowCount; r++) {
      data.push(new Array<string>(columnCount).fill(''));
    }
    for (const entry of cells) {
      if (!Array.isArray(entry) || entry.length !== 3) {
        return { ok: false, error: 'bad-shape' };
      }
      const [r, c, input] = entry as unknown[];
      if (
        typeof r !== 'number' ||
        typeof c !== 'number' ||
        !Number.isInteger(r) ||
        !Number.isInteger(c) ||
        r < 0 ||
        r >= rowCount ||
        c < 0 ||
        c >= columnCount ||
        typeof input !== 'string' ||
        input.length > MAX_RCSV_CELL_LENGTH
      ) {
        return { ok: false, error: 'bad-shape' };
      }
      data[r][c] = input;
    }
    let delimiter: DelimiterId = ',';
    const settings = root.settings;
    if (settings !== undefined) {
      if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) {
        return { ok: false, error: 'bad-shape' };
      }
      const d = (settings as Record<string, unknown>).delimiter;
      if (d !== undefined) {
        if (d !== ',' && d !== ';' && d !== '\t') {
          return { ok: false, error: 'bad-shape' };
        }
        delimiter = d;
      }
    }
    const sheetName = typeof s.name === 'string' && s.name.length <= 255 ? s.name : 'Sheet1';
    const doc = new RcsvDocument(name, delimiter, data, columnCount);
    void sheetName;
    return { ok: true, doc };
  }

  /** Serialize to the versioned UTF-8 JSON `.rcsv` format. */
  toBytes(): Uint8Array {
    const cells: Array<[number, number, string]> = [];
    for (let r = 0; r < this.data.length; r++) {
      const row = this.data[r];
      for (let c = 0; c < this.cols; c++) {
        if (row[c] !== '') {
          cells.push([r, c, row[c]]);
        }
      }
    }
    const json = {
      format: RCSV_FORMAT,
      version: RCSV_VERSION,
      sheet: {
        name: 'Sheet1',
        rowCount: this.data.length,
        columnCount: this.cols,
        cells,
      },
      settings: { delimiter: this.delimiter },
    };
    return new TextEncoder().encode(JSON.stringify(json));
  }

  // ----- Common document surface (shared with LosslessDocument) -----

  get rowCount(): number {
    return this.data.length;
  }

  get columnCount(): number {
    return this.cols;
  }

  fieldCount(row: number): number {
    return row >= 0 && row < this.data.length ? this.cols : 0;
  }

  /** The raw input of a cell (formula expression for formula cells). */
  getValue(row: number, col: number): string {
    return this.data[row]?.[col] ?? '';
  }

  /** The computed display value (formula results, error codes, or the literal). */
  getDisplayValue(row: number, col: number): string {
    return formatValue(this.evaluateCell(row, col));
  }

  /** True when the cell input is a formula expression. */
  isFormulaCell(row: number, col: number): boolean {
    return isFormula(this.getValue(row, col));
  }

  private formulaCountCache: { revision: number; count: number } | null = null;

  /** Count of formula cells (cached per revision; the status bar calls this often). */
  countFormulaCells(): number {
    if (this.formulaCountCache?.revision === this.revision) {
      return this.formulaCountCache.count;
    }
    let count = 0;
    for (const row of this.data) {
      for (let c = 0; c < this.cols; c++) {
        if (isFormula(row[c])) count += 1;
      }
    }
    this.formulaCountCache = { revision: this.revision, count };
    return count;
  }

  get isDirty(): boolean {
    return this.revision !== this.savedRevision;
  }

  markSaved(): void {
    this.savedRevision = this.revision;
  }

  /** RCSV documents have no byte-level baseline; nothing is "edited vs original". */
  isEdited(_row: number, _col: number): boolean {
    return false;
  }

  // ----- Mutators (called through the atomic operation layer) -----

  setCell(row: number, col: number, input: string): void {
    if (row < 0 || row >= this.data.length || col < 0 || col >= this.cols) {
      return;
    }
    if (this.data[row][col] === input) {
      return;
    }
    this.data[row][col] = input;
    this.touch();
  }

  insertRows(index: number, rows: string[][]): void {
    const at = Math.max(0, Math.min(this.data.length, index));
    const prepared = rows.map((row) => {
      const out = new Array<string>(this.cols).fill('');
      for (let c = 0; c < Math.min(row.length, this.cols); c++) {
        out[c] = row[c];
      }
      return out;
    });
    this.data.splice(at, 0, ...prepared);
    this.touch();
  }

  /** Remove rows and return their data (for undo). */
  deleteRows(index: number, count: number): string[][] {
    const removed = this.data.splice(index, count);
    if (this.data.length === 0) {
      this.data.push(new Array<string>(this.cols).fill(''));
    }
    this.touch();
    return removed;
  }

  insertCols(index: number, colsData: string[][]): void {
    const count = colsData.length;
    const at = Math.max(0, Math.min(this.cols, index));
    for (let r = 0; r < this.data.length; r++) {
      const inserts = colsData.map((col) => col[r] ?? '');
      this.data[r].splice(at, 0, ...inserts);
    }
    this.cols += count;
    this.touch();
  }

  /** Remove columns and return their data as column-major arrays (for undo). */
  deleteCols(index: number, count: number): string[][] {
    const removed: string[][] = Array.from({ length: count }, () => []);
    for (let r = 0; r < this.data.length; r++) {
      const cut = this.data[r].splice(index, count);
      for (let c = 0; c < count; c++) {
        removed[c].push(cut[c] ?? '');
      }
    }
    this.cols -= count;
    if (this.cols === 0) {
      this.cols = 1;
      for (const row of this.data) {
        row.push('');
      }
    }
    this.touch();
    return removed;
  }

  /** Grow the sheet to at least the given size (used by paste expansion). */
  ensureSize(rows: number, cols: number): void {
    let changed = false;
    if (cols > this.cols) {
      for (const row of this.data) {
        while (row.length < cols) {
          row.push('');
        }
      }
      this.cols = cols;
      changed = true;
    }
    while (this.data.length < rows) {
      this.data.push(new Array<string>(this.cols).fill(''));
      changed = true;
    }
    if (changed) {
      this.touch();
    }
  }

  /** Iterate all formula cells as [row, col, source]. */
  listFormulaCells(): Array<{ row: number; col: number; src: string }> {
    const out: Array<{ row: number; col: number; src: string }> = [];
    for (let r = 0; r < this.data.length; r++) {
      const row = this.data[r];
      for (let c = 0; c < this.cols; c++) {
        if (isFormula(row[c])) {
          out.push({ row: r, col: c, src: row[c] });
        }
      }
    }
    return out;
  }

  // ----- Evaluation -----

  /**
   * Evaluate a cell to its formula value. Formula results are memoized until
   * the next mutation; circular references resolve to #CYCLE! instead of
   * recursing forever.
   */
  evaluateCell(row: number, col: number): FormulaValue {
    if (row < 0 || row >= this.data.length || col < 0 || col >= this.cols) {
      // References outside the sheet behave like empty cells.
      return { type: 'empty' };
    }
    const input = this.data[row][col];
    if (!isFormula(input)) {
      return literalToValue(input);
    }
    const key = `${row},${col}`;
    const cached = this.memo.get(key);
    if (cached) {
      return cached;
    }
    if (this.inProgress.has(key)) {
      return errorValue('#CYCLE!');
    }
    let compiled = this.formulaCache.get(key);
    if (!compiled || compiled.src !== input) {
      compiled = { src: input, parsed: parseFormula(input) };
      this.formulaCache.set(key, compiled);
    }
    let result: FormulaValue;
    if (!compiled.parsed.ok) {
      result = errorValue(compiled.parsed.code);
    } else {
      this.inProgress.add(key);
      try {
        result = evaluateAst(compiled.parsed.ast, {
          getCell: (r, c) => this.evaluateCell(r, c),
          rowCount: this.data.length,
          columnCount: this.cols,
        });
      } finally {
        this.inProgress.delete(key);
      }
    }
    this.memo.set(key, result);
    return result;
  }

  /**
   * Export the computed values as CSV text (lossy: formulas become their
   * calculated values; spreadsheet metadata and the original byte layout are
   * not preserved). Fields are quoted only when needed; LF terminators.
   */
  exportCsv(delimiter: DelimiterId = this.delimiter): string {
    const lines: string[] = [];
    for (let r = 0; r < this.data.length; r++) {
      const parts: string[] = [];
      for (let c = 0; c < this.cols; c++) {
        let text = this.getDisplayValue(r, c);
        if (text.includes(delimiter) || text.includes('"') || text.includes('\r') || text.includes('\n')) {
          text = `"${text.replace(/"/g, '""')}"`;
        }
        parts.push(text);
      }
      lines.push(parts.join(delimiter));
    }
    return lines.join('\n') + '\n';
  }

  private touch(): void {
    this.revision += 1;
    this.memo = new Map();
  }
}
