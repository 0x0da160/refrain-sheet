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
import { decodeRsf, encodeRsf, type RsfData, type RsfDecodeError } from './rsf-codec';
import { APP_NAME, APP_VERSION } from '../app/version';
import type { LosslessDocument } from './lossless-document';

/**
 * Refrain Sheet Format (`.rsf`): a documented, versioned, binary container for
 * spreadsheet documents. CSV cannot store formulas, worksheet metadata, or
 * structural editing intent without breaking the original-file preservation
 * guarantee, so spreadsheet documents are saved as `.rsf` instead.
 *
 * The container is a compact binary format (magic bytes, header, CRC-32
 * checksum, compressed body) defined in `rsf-codec.ts` and documented in
 * `docs/rsf-format.md`. It holds pure data — no executable code, macros,
 * external references, or network URLs — and parsing is strict (magic,
 * version, checksum, shape, and bounds are validated) and never executes
 * anything. Legacy `.rcsv` files are read transparently (see `rsf-codec.ts`)
 * and re-saved as `.rsf`.
 */
export const RSF_EXTENSION = '.rsf';
/** Legacy extension read as an import; migrated documents are saved as `.rsf`. */
export const RSF_LEGACY_EXTENSION = '.rcsv';

/**
 * Default dimensions of a blank spreadsheet created by File > New: a small
 * but usable grid (documented in the README). The virtualized grid keeps this
 * cheap, and rows/columns can be inserted or deleted afterwards.
 */
export const NEW_DOC_ROWS = 100;
export const NEW_DOC_COLS = 26;

/** Failure reasons when loading a `.rsf` (or legacy `.rcsv`) container (see `rsf-codec.ts`). */
export type RsfParseError = RsfDecodeError;

export type RsfLoadResult = { ok: true; doc: RsfDocument } | { ok: false; error: RsfParseError };

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
export class RsfDocument {
  readonly kind = 'rsf' as const;
  name: string;
  /** Delimiter used as the default for CSV export. */
  delimiter: DelimiterId;

  private data: string[][];
  private cols: number;
  private revision = 0;
  private savedRevision = 0;
  /**
   * Compression method for the next `.rsf` save (an `RSF_COMPRESSION_*` id),
   * or `undefined` to use the active codec's default (Zstandard). Set from the
   * container on load so a normal save preserves the file's method, and by the
   * Save dialog when the user picks a different one.
   */
  private compressionMethod: number | undefined;
  private readonly formulaCache = new Map<string, CompiledFormula>();
  private memo = new Map<string, FormulaValue>();
  private readonly inProgress = new Set<string>();
  /**
   * Per-row count of formula cells, kept in parallel with `data`. Built
   * lazily on first use (so opening a document costs nothing extra) and then
   * maintained incrementally by every mutator, it lets
   * {@link countFormulaCells} and {@link listFormulaCells} skip formula-free
   * rows entirely — on typical sheets (few or no formulas) this turns the
   * whole-sheet scans that run on every structural edit and status-bar render
   * into O(rows) walks. Consistency with the data is covered by a
   * property-based test.
   */
  private formulaPerRow: number[] | null = null;

  private constructor(name: string, delimiter: DelimiterId, data: string[][], columnCount: number) {
    this.name = name;
    this.delimiter = delimiter;
    this.data = data;
    this.cols = columnCount;
  }

  /** Create an RSF document from the current values of a CSV document (explicit conversion). */
  static fromLossless(doc: LosslessDocument, name: string): RsfDocument {
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
    return new RsfDocument(name, doc.delimiter, data, columnCount);
  }

  /**
   * Create an RSF document from prebuilt row-major values. Used by the
   * time-sliced CSV→RSF conversion, which collects the rows incrementally
   * (with progress) instead of one long synchronous loop; the result is
   * identical to {@link fromLossless}. Each row is padded to `columnCount`.
   */
  static fromValues(
    name: string,
    delimiter: DelimiterId,
    rows: string[][],
    columnCount: number,
  ): RsfDocument {
    const cols = Math.max(1, columnCount);
    const data = rows.map((row) => {
      if (row.length === cols) {
        return row;
      }
      const out = new Array<string>(cols).fill('');
      for (let c = 0; c < Math.min(row.length, cols); c++) {
        out[c] = row[c];
      }
      return out;
    });
    if (data.length === 0) {
      data.push(new Array<string>(cols).fill(''));
    }
    return new RsfDocument(name, delimiter, data, cols);
  }

  static empty(name: string, rows = 1, cols = 1): RsfDocument {
    const data: string[][] = [];
    for (let r = 0; r < Math.max(1, rows); r++) {
      data.push(new Array<string>(Math.max(1, cols)).fill(''));
    }
    return new RsfDocument(name, ',', data, Math.max(1, cols));
  }

  /**
   * A blank spreadsheet for File > New. Identical to {@link empty} but marked
   * unsaved from creation (there is no file on disk yet), so the tab shows a
   * dirty indicator and closing it prompts to save.
   */
  static blank(name: string, rows = NEW_DOC_ROWS, cols = NEW_DOC_COLS): RsfDocument {
    const doc = RsfDocument.empty(name, rows, cols);
    doc.markUnsaved();
    return doc;
  }

  /** Parse and strictly validate binary `.rsf` (or legacy `.rcsv`) bytes. Never executes anything. */
  static fromBytes(bytes: Uint8Array, name: string): RsfLoadResult {
    const decoded = decodeRsf(bytes);
    if (!decoded.ok) {
      return { ok: false, error: decoded.error };
    }
    const { rowCount, columnCount, cells, delimiter } = decoded.data;
    const data: string[][] = [];
    for (let r = 0; r < rowCount; r++) {
      data.push(new Array<string>(columnCount).fill(''));
    }
    for (const [r, c, input] of cells) {
      data[r][c] = input;
    }
    const doc = new RsfDocument(name, delimiter, data, columnCount);
    // Preserve the file's compression method so a normal save reuses it.
    doc.compressionMethod = decoded.data.compression;
    return { ok: true, doc };
  }

  /** The compression method the next save will write (`undefined` → codec default). */
  get compression(): number | undefined {
    return this.compressionMethod;
  }

  /**
   * Choose the compression method for the next save (from the RSF Save
   * dialog). Rewriting the container with a different method changes no logical
   * content, so this does not mark the document dirty on its own.
   */
  setCompression(method: number): void {
    this.compressionMethod = method;
  }

  /** Serialize to the versioned binary `.rsf` container format. */
  toBytes(): Uint8Array {
    const cells: Array<[number, number, string]> = [];
    for (let r = 0; r < this.data.length; r++) {
      this.collectRowCells(r, cells);
    }
    return this.toBytesFromCells(cells);
  }

  /**
   * Append row `r`'s non-empty cells to `cells`. Splitting the collection per
   * row lets the save path run it in cooperative time slices (with progress)
   * for large sheets; {@link toBytesFromCells} then finishes the container.
   */
  collectRowCells(r: number, cells: Array<[number, number, string]>): void {
    const row = this.data[r];
    if (!row) {
      return;
    }
    for (let c = 0; c < this.cols; c++) {
      if (row[c] !== '') {
        cells.push([r, c, row[c]]);
      }
    }
  }

  /** Encode a prepared sparse cell list into the `.rsf` container (compresses). */
  toBytesFromCells(cells: Array<[number, number, string]>): Uint8Array {
    const payload: RsfData = {
      name: 'Sheet1',
      delimiter: this.delimiter,
      rowCount: this.data.length,
      columnCount: this.cols,
      cells,
      // Record the creating/updating application (single source of truth).
      appName: APP_NAME,
      appVersion: APP_VERSION,
    };
    return encodeRsf(payload, this.compressionMethod);
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

  /** Formula cells in one row (rows always hold exactly `cols` entries). */
  private countRowFormulas(row: string[]): number {
    let n = 0;
    for (let c = 0; c < row.length; c++) {
      if (isFormula(row[c])) n += 1;
    }
    return n;
  }

  /** Build the per-row formula index on first use (mutators maintain it after). */
  private ensureFormulaIndex(): number[] {
    this.formulaPerRow ??= this.data.map((row) => this.countRowFormulas(row));
    return this.formulaPerRow;
  }

  /** Count of formula cells (cached per revision; the status bar calls this often). */
  countFormulaCells(): number {
    if (this.formulaCountCache?.revision === this.revision) {
      return this.formulaCountCache.count;
    }
    let count = 0;
    for (const n of this.ensureFormulaIndex()) {
      count += n;
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

  /**
   * Mark the document as never-saved, so {@link isDirty} is true until the
   * first successful save. Used for File > New and for a fresh in-memory
   * CSV→RSF conversion, neither of which yet exists on disk.
   */
  markUnsaved(): void {
    // A sentinel that no real revision equals keeps the document dirty.
    this.savedRevision = -1;
  }

  /** RSF documents have no byte-level baseline; nothing is "edited vs original". */
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
    if (this.formulaPerRow) {
      const delta = (isFormula(input) ? 1 : 0) - (isFormula(this.data[row][col]) ? 1 : 0);
      if (delta !== 0) {
        this.formulaPerRow[row] += delta;
      }
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
    this.formulaPerRow?.splice(at, 0, ...prepared.map((row) => this.countRowFormulas(row)));
    this.touch();
  }

  /** Remove rows and return their data (for undo). */
  deleteRows(index: number, count: number): string[][] {
    const removed = this.data.splice(index, count);
    this.formulaPerRow?.splice(index, count);
    if (this.data.length === 0) {
      this.data.push(new Array<string>(this.cols).fill(''));
      this.formulaPerRow?.push(0);
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
      if (this.formulaPerRow) {
        this.formulaPerRow[r] += this.countRowFormulas(inserts);
      }
    }
    this.cols += count;
    this.touch();
  }

  /** Remove columns and return their data as column-major arrays (for undo). */
  deleteCols(index: number, count: number): string[][] {
    const removed: string[][] = Array.from({ length: count }, () => []);
    for (let r = 0; r < this.data.length; r++) {
      const cut = this.data[r].splice(index, count);
      if (this.formulaPerRow) {
        this.formulaPerRow[r] -= this.countRowFormulas(cut);
      }
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
      this.formulaPerRow?.push(0);
      changed = true;
    }
    if (changed) {
      this.touch();
    }
  }

  /** Iterate all formula cells as [row, col, source]. Skips formula-free rows via the index. */
  listFormulaCells(): Array<{ row: number; col: number; src: string }> {
    const index = this.ensureFormulaIndex();
    const out: Array<{ row: number; col: number; src: string }> = [];
    for (let r = 0; r < this.data.length; r++) {
      if (index[r] === 0) {
        continue;
      }
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
