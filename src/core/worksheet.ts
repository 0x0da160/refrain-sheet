// SPDX-License-Identifier: MIT
import { cellStylesEqual, type CellStyle } from './cell-style';
import type { CellConditionalFormat } from './conditional-format';
import type { CellValidation } from './data-validation';
import type { SheetFilter } from './filter';
import { isFormula, parseFormula, type ParseResult } from './formula';
import type { SheetSort } from './sort';

/** A parsed formula kept alongside the source it was compiled from. */
export interface CompiledFormula {
  src: string;
  parsed: ParseResult;
}

/**
 * What a worksheet's content *is*. `grid` is every worksheet before this
 * field existed and remains the default. `markdown` holds one Markdown
 * document as its sole content (its raw source lives in cell A1 — see
 * {@link Worksheet.markdown}) and is rendered by a docked source/preview
 * surface in the spreadsheet area instead of the grid (see
 * `src/ui/markdown-sheet.ts`); `json` is the same shape (raw source in cell
 * A1, docked source/preview surface — see `src/ui/json-sheet.ts`) holding one
 * JSON document instead, with a syntax-highlighted preview and an explicit
 * "Format" (pretty-print) action; `yaml` is the same shape again (see
 * `src/ui/yaml-sheet.ts`), reusing the same syntax-highlighted-preview +
 * Format pattern; `text` is the same shape holding unstructured plain text,
 * with no preview panel at all (see `src/ui/text-sheet.ts`) since there is
 * nothing to render beyond the source itself. None of `markdown`/`json`/
 * `yaml`/`text` ever carries formulas, styles, a filter, or a sort, and all
 * four are excluded from CSV export (CSV has no analog for a whole-sheet
 * document).
 */
export type WorksheetKind = 'grid' | 'markdown' | 'json' | 'yaml' | 'text';

/** Where the selection sits and how it was made (see AppState.SelectionKind). */
interface WorksheetPoint {
  row: number;
  col: number;
}

/**
 * Session-only view state remembered per worksheet so switching sheets and
 * coming back restores where you were. It is deliberately *not* part of the
 * saved container: only the presentational settings that RSF documents
 * persist (column widths here; zoom and wrap live on the worksheet itself)
 * are written to the file.
 */
export interface WorksheetView {
  selection: WorksheetPoint | null;
  anchor: WorksheetPoint | null;
  selectionKind: 'cell' | 'row' | 'col';
  /** Live per-column widths (px at 100% zoom) while this worksheet is active. */
  colWidths: number[];
}

/**
 * One worksheet of an RSF workbook: its grid data, formula inputs, row/column
 * structure, filter, and presentational settings. A worksheet owns *data*
 * only — it never evaluates formulas, because evaluation may cross worksheet
 * boundaries (`Sheet1!A1`) and therefore belongs to the workbook, which holds
 * the shared memo and in-progress set (see {@link RsfDocument}).
 *
 * The identifier is stable and internal; the name is the mutable display name
 * users see on the worksheet tab and write in cross-sheet formulas. Renaming a
 * worksheet never changes its identifier, so nothing that refers to a
 * worksheet internally can break.
 */
export class Worksheet {
  /** Stable internal identifier; never shown, never changed by a rename. */
  readonly id: string;
  /** Mutable display name (unique per workbook, case-insensitively). */
  name: string;
  /** What this worksheet's content is (see {@link WorksheetKind}); fixed at creation. */
  readonly kind: WorksheetKind;

  private data: string[][];
  private cols: number;
  /** Local mutation counter, used only to invalidate the formula-count cache. */
  private revision = 0;

  /**
   * The worksheet's filter state, persisted in the container and restored —
   * fully validated — on load. Filtering only ever *hides* rows visually; it
   * never deletes, reorders, or rewrites cell data, and formula evaluation is
   * completely unaffected. Mutated through the history layer.
   */
  filter: SheetFilter | null = null;
  /** True when a loaded filter failed validation and was ignored (warned once). */
  filterDropped = false;

  /**
   * The worksheet's sort state: session-only view state, like the current
   * selection — it is **not** persisted in the RSF container and never
   * reaches the codec. Sorting only ever reorders how rows *display*; it
   * never deletes, reorders, or rewrites cell data, and formula evaluation is
   * completely unaffected. Mutated directly (not through the history layer),
   * and reset whenever the worksheet's row/column structure changes.
   */
  sort: SheetSort | null = null;

  /**
   * Data-validation rules restricting which values cells accept (a fixed
   * list, or a numeric range) — session-only view state, like `sort`: it is
   * **not** persisted in the RSF container and never reaches the codec.
   * Applying, editing, or clearing a rule never touches cell data, and
   * dropped (not shifted) whenever the worksheet's row/column structure
   * changes underneath it, exactly like a sort's stored range.
   */
  validations: CellValidation[] = [];

  /**
   * Conditional-formatting rules that color a cell's background/text from its
   * computed value (a comparison, duplicate highlighting, or a color scale) —
   * session-only view state, like `validations`: it is **not** persisted in
   * the RSF container and never reaches the codec. Applying, editing, or
   * clearing a rule never touches cell data, and dropped (not shifted)
   * whenever the worksheet's row/column structure changes underneath it,
   * exactly like a validation rule's stored range.
   */
  conditionalFormats: CellConditionalFormat[] = [];

  /**
   * Persisted display settings for this worksheet (zoom percent, overridden
   * column widths, sparse, px at 100% zoom). Purely presentational: they never
   * affect cell data, evaluation, or export.
   */
  displayZoom: number | undefined;
  displayColWidths: number[] = [];
  /**
   * Whether long cells wrap onto several visual lines on this worksheet.
   * `undefined` means "not stored" (the application-level preference applies).
   * Enabled automatically when a committed cell value contains a line break —
   * multi-line content is unreadable clipped to one line. Presentational only:
   * it never changes cell data, evaluation, export, or the dirty state.
   */
  displayWrap: boolean | undefined;

  /**
   * Whether this worksheet is locked against editing (Sheet ▸ Lock Sheet, or
   * its tab context menu). A plain, non-cryptographic protection flag — no
   * password — that blocks this worksheet's own cell edits and structural
   * changes (see `AppState`'s `refuseLockedSheetWrite`); every other
   * worksheet in the workbook stays editable. Persisted in the RSF container
   * (body version 13+, see `src/core/rsf-codec.ts`).
   */
  locked = false;

  /** Session-only view state, restored when this worksheet becomes active. */
  readonly view: WorksheetView = {
    selection: null,
    anchor: null,
    selectionKind: 'cell',
    colWidths: [],
  };

  /**
   * Sparse cell-level visual formatting (bold/italic/underline, colors,
   * borders — see {@link CellStyle}), keyed row-major so row insert/delete
   * (the common structural edit) only needs to touch the outer map. Purely
   * presentational: it never affects a cell's value, formula evaluation, sort
   * or filter, or CSV export.
   */
  private styles: Map<number, Map<number, CellStyle>> = new Map();

  /**
   * Sparse cell-level annotations (see {@link ../cell-comment}), keyed
   * row-major like `styles`. Persisted in the RSF container (body version
   * 11+, see `src/core/rsf-codec.ts`) and reindexed on row/column
   * insert/delete the same way `styles` is, so a comment keeps following the
   * cell it was attached to.
   */
  private comments: Map<number, Map<number, string>> = new Map();

  private readonly formulaCache = new Map<string, CompiledFormula>();
  /**
   * Per-row count of formula cells, kept in parallel with `data`. Built lazily
   * and maintained by every mutator so formula enumeration skips formula-free
   * rows entirely.
   */
  private formulaPerRow: number[] | null = null;
  private formulaCountCache: { revision: number; count: number } | null = null;

  constructor(id: string, name: string, data: string[][], columnCount: number, kind: WorksheetKind = 'grid') {
    this.id = id;
    this.name = name;
    this.data = data;
    this.cols = Math.max(1, columnCount);
    this.kind = kind;
  }

  /** An empty worksheet of the given size (at least 1x1). */
  static empty(id: string, name: string, rows = 1, cols = 1, kind: WorksheetKind = 'grid'): Worksheet {
    const columnCount = Math.max(1, cols);
    const data: string[][] = [];
    for (let r = 0; r < Math.max(1, rows); r++) {
      data.push(new Array<string>(columnCount).fill(''));
    }
    return new Worksheet(id, name, data, columnCount, kind);
  }

  /**
   * A worksheet holding one Markdown document as its sole content (see
   * {@link WorksheetKind}). Always exactly 1x1: the whole document lives as
   * plain text in cell A1, so editing it is an ordinary `setCell(0, 0, …)`
   * mutation — the same atomic, undoable history entry a grid cell edit uses
   * — and reading it back is {@link markdownText}.
   */
  static markdown(id: string, name: string, text: string): Worksheet {
    return new Worksheet(id, name, [[text]], 1, 'markdown');
  }

  /** The document's Markdown source (cell A1). Meaningful only when `kind === 'markdown'`. */
  get markdownText(): string {
    return this.getValue(0, 0);
  }

  /**
   * A worksheet holding one JSON document as its sole content (see
   * {@link WorksheetKind}). Always exactly 1x1, the same shape and
   * atomic/undoable edit path as {@link markdown}; reading it back is
   * {@link jsonText}.
   */
  static json(id: string, name: string, text: string): Worksheet {
    return new Worksheet(id, name, [[text]], 1, 'json');
  }

  /** The document's JSON source (cell A1). Meaningful only when `kind === 'json'`. */
  get jsonText(): string {
    return this.getValue(0, 0);
  }

  /**
   * A worksheet holding one YAML document as its sole content (see
   * {@link WorksheetKind}). Always exactly 1x1, the same shape and
   * atomic/undoable edit path as {@link markdown}/{@link json}; reading it
   * back is {@link yamlText}.
   */
  static yaml(id: string, name: string, text: string): Worksheet {
    return new Worksheet(id, name, [[text]], 1, 'yaml');
  }

  /** The document's YAML source (cell A1). Meaningful only when `kind === 'yaml'`. */
  get yamlText(): string {
    return this.getValue(0, 0);
  }

  /**
   * A worksheet holding one plain-text document as its sole content (see
   * {@link WorksheetKind}). Always exactly 1x1, the same shape and
   * atomic/undoable edit path as {@link markdown}/{@link json}/{@link yaml};
   * reading it back is {@link plainText}.
   */
  static text(id: string, name: string, text: string): Worksheet {
    return new Worksheet(id, name, [[text]], 1, 'text');
  }

  /** The document's plain-text content (cell A1). Meaningful only when `kind === 'text'`. */
  get plainText(): string {
    return this.getValue(0, 0);
  }

  /** A worksheet from prebuilt row-major values, padding each row to `columnCount`. */
  static fromValues(id: string, name: string, rows: string[][], columnCount: number): Worksheet {
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
    return new Worksheet(id, name, data, cols);
  }

  // ----- Shape and values -----

  get rowCount(): number {
    return this.data.length;
  }

  get columnCount(): number {
    return this.cols;
  }

  fieldCount(row: number): number {
    return row >= 0 && row < this.data.length ? this.cols : 0;
  }

  /** The raw input of a cell (the formula expression for formula cells). */
  getValue(row: number, col: number): string {
    return this.data[row]?.[col] ?? '';
  }

  /** True when the cell holds coordinates inside this worksheet's grid. */
  contains(row: number, col: number): boolean {
    return row >= 0 && row < this.data.length && col >= 0 && col < this.cols;
  }

  /** A markdown/json worksheet's cell A1 is its document text, never a formula, no matter what it starts with. */
  isFormulaCell(row: number, col: number): boolean {
    return this.kind === 'grid' && isFormula(this.getValue(row, col));
  }

  /**
   * The parsed form of a formula cell, compiled on first use and reused until
   * the cell's input changes. The workbook evaluates the returned AST.
   */
  compiled(row: number, col: number, input: string): CompiledFormula {
    const key = `${row},${col}`;
    let entry = this.formulaCache.get(key);
    if (!entry || entry.src !== input) {
      entry = { src: input, parsed: parseFormula(input) };
      this.formulaCache.set(key, entry);
    }
    return entry;
  }

  // ----- Formula index -----

  private countRowFormulas(row: string[]): number {
    // A markdown/json worksheet's cell A1 is document text, never a formula
    // (see isFormulaCell) — never tokenize its (potentially large) content as one.
    if (this.kind !== 'grid') {
      return 0;
    }
    let n = 0;
    for (let c = 0; c < row.length; c++) {
      if (isFormula(row[c])) n += 1;
    }
    return n;
  }

  private ensureFormulaIndex(): number[] {
    this.formulaPerRow ??= this.data.map((row) => this.countRowFormulas(row));
    return this.formulaPerRow;
  }

  /** Count of formula cells (cached per local revision). */
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

  /** Iterate all formula cells as [row, col, source]. Skips formula-free rows. */
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

  // ----- Cell styles -----

  /** The style of one cell, or `null` when it carries none. */
  getStyle(row: number, col: number): CellStyle | null {
    return this.styles.get(row)?.get(col) ?? null;
  }

  /** Set (or clear, with `null`) one cell's style. Returns true when it changed. */
  setStyle(row: number, col: number, style: CellStyle | null): boolean {
    if (!this.contains(row, col)) {
      return false;
    }
    const current = this.getStyle(row, col);
    if (cellStylesEqual(current, style)) {
      return false;
    }
    if (style === null) {
      const rowStyles = this.styles.get(row);
      rowStyles?.delete(col);
      if (rowStyles && rowStyles.size === 0) {
        this.styles.delete(row);
      }
    } else {
      let rowStyles = this.styles.get(row);
      if (!rowStyles) {
        rowStyles = new Map();
        this.styles.set(row, rowStyles);
      }
      rowStyles.set(col, style);
    }
    return true;
  }

  /** Every styled cell as [row, col, style] triples (sparse). */
  collectStyles(): Array<[number, number, CellStyle]> {
    const out: Array<[number, number, CellStyle]> = [];
    for (const [row, rowStyles] of this.styles) {
      for (const [col, style] of rowStyles) {
        out.push([row, col, style]);
      }
    }
    return out;
  }

  get styledCellCount(): number {
    let n = 0;
    for (const rowStyles of this.styles.values()) {
      n += rowStyles.size;
    }
    return n;
  }

  /**
   * Reindex every styled cell's row after a row insert/delete, so styles
   * follow the data they were applied to. Rows removed by a delete lose their
   * styles along with their values (undoing the delete restores cell values
   * via the history entry's row data, but not their styles — the same
   * trade-off already accepted for the sheet filter and sort, which are also
   * dropped rather than threaded through structural-edit undo).
   */
  private shiftStyleRows(mapRow: (row: number) => number | null): void {
    if (this.styles.size === 0) {
      return;
    }
    const next: Map<number, Map<number, CellStyle>> = new Map();
    for (const [row, rowStyles] of this.styles) {
      const mapped = mapRow(row);
      if (mapped !== null) {
        next.set(mapped, rowStyles);
      }
    }
    this.styles = next;
  }

  /** Reindex every styled cell's column after a column insert/delete. */
  private shiftStyleCols(mapCol: (col: number) => number | null): void {
    if (this.styles.size === 0) {
      return;
    }
    const next: Map<number, Map<number, CellStyle>> = new Map();
    for (const [row, rowStyles] of this.styles) {
      const nextRow: Map<number, CellStyle> = new Map();
      for (const [col, style] of rowStyles) {
        const mapped = mapCol(col);
        if (mapped !== null) {
          nextRow.set(mapped, style);
        }
      }
      if (nextRow.size > 0) {
        next.set(row, nextRow);
      }
    }
    this.styles = next;
  }

  // ----- Cell comments (see cell-comment.ts) -----

  /** The comment on one cell, or `null` when it carries none. */
  getComment(row: number, col: number): string | null {
    return this.comments.get(row)?.get(col) ?? null;
  }

  /** Set (or clear, with `null`) one cell's comment. Returns true when it changed. */
  setComment(row: number, col: number, text: string | null): boolean {
    if (!this.contains(row, col)) {
      return false;
    }
    const current = this.getComment(row, col);
    if (current === text) {
      return false;
    }
    if (text === null) {
      const rowComments = this.comments.get(row);
      rowComments?.delete(col);
      if (rowComments && rowComments.size === 0) {
        this.comments.delete(row);
      }
    } else {
      let rowComments = this.comments.get(row);
      if (!rowComments) {
        rowComments = new Map();
        this.comments.set(row, rowComments);
      }
      rowComments.set(col, text);
    }
    return true;
  }

  get commentedCellCount(): number {
    let n = 0;
    for (const rowComments of this.comments.values()) {
      n += rowComments.size;
    }
    return n;
  }

  /** Every commented cell as [row, col, text] triples (sparse). */
  collectComments(): Array<[number, number, string]> {
    const out: Array<[number, number, string]> = [];
    for (const [row, rowComments] of this.comments) {
      for (const [col, text] of rowComments) {
        out.push([row, col, text]);
      }
    }
    return out;
  }

  /** Reindex every commented cell's row after a row insert/delete. */
  private shiftCommentRows(mapRow: (row: number) => number | null): void {
    if (this.comments.size === 0) {
      return;
    }
    const next: Map<number, Map<number, string>> = new Map();
    for (const [row, rowComments] of this.comments) {
      const mapped = mapRow(row);
      if (mapped !== null) {
        next.set(mapped, rowComments);
      }
    }
    this.comments = next;
  }

  /** Reindex every commented cell's column after a column insert/delete. */
  private shiftCommentCols(mapCol: (col: number) => number | null): void {
    if (this.comments.size === 0) {
      return;
    }
    const next: Map<number, Map<number, string>> = new Map();
    for (const [row, rowComments] of this.comments) {
      const nextRow: Map<number, string> = new Map();
      for (const [col, text] of rowComments) {
        const mapped = mapCol(col);
        if (mapped !== null) {
          nextRow.set(mapped, text);
        }
      }
      if (nextRow.size > 0) {
        next.set(row, nextRow);
      }
    }
    this.comments = next;
  }

  /** True when any cell in the worksheet holds a value (used for delete confirmation). */
  hasAnyContent(): boolean {
    for (const row of this.data) {
      for (let c = 0; c < this.cols; c++) {
        if (row[c] !== '') {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * One past the last row/column holding a non-empty raw value anywhere in
   * the worksheet — `{ rows: 0, cols: 0 }` for a worksheet with no content at
   * all. Distinct from {@link rowCount}/{@link columnCount}, which report the
   * fully allocated grid (e.g. a new worksheet is 100x26 regardless of how
   * much of it has ever been written to). Used to trim reads — SQL queries,
   * the diff tool — to real content instead of blank padding. Checked against
   * the raw input rather than the computed display value, so it never needs a
   * formula evaluation pass just to find the boundary.
   */
  usedExtent(): { rows: number; cols: number } {
    let maxRow = -1;
    let maxCol = -1;
    for (let r = 0; r < this.data.length; r++) {
      const row = this.data[r];
      for (let c = 0; c < this.cols; c++) {
        if (row[c] !== '') {
          if (r > maxRow) maxRow = r;
          if (c > maxCol) maxCol = c;
        }
      }
    }
    return { rows: maxRow + 1, cols: maxCol + 1 };
  }

  // ----- Mutators (driven by the workbook, which invalidates evaluation) -----

  /** Returns true when the write actually changed the cell. */
  setCell(row: number, col: number, input: string): boolean {
    if (!this.contains(row, col) || this.data[row][col] === input) {
      return false;
    }
    if (this.formulaPerRow) {
      const delta = (isFormula(input) ? 1 : 0) - (isFormula(this.data[row][col]) ? 1 : 0);
      if (delta !== 0) {
        this.formulaPerRow[row] += delta;
      }
    }
    this.data[row][col] = input;
    this.revision += 1;
    return true;
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
    this.shiftStyleRows((row) => (row >= at ? row + prepared.length : row));
    this.shiftCommentRows((row) => (row >= at ? row + prepared.length : row));
    this.revision += 1;
    // The sort's stored range would otherwise silently drift against the
    // shifted rows; since sort is session-only view state (not undo-tracked),
    // it is simply dropped rather than bundled into the structural entry.
    this.sort = null;
    this.validations = [];
    this.conditionalFormats = [];
  }

  /** Remove rows and return their data (for undo; their cell styles are not preserved). */
  deleteRows(index: number, count: number): string[][] {
    const removed = this.data.splice(index, count);
    this.formulaPerRow?.splice(index, count);
    if (this.data.length === 0) {
      this.data.push(new Array<string>(this.cols).fill(''));
      this.formulaPerRow?.push(0);
    }
    this.shiftStyleRows((row) => (row < index ? row : row < index + count ? null : row - count));
    this.shiftCommentRows((row) => (row < index ? row : row < index + count ? null : row - count));
    this.revision += 1;
    this.sort = null;
    this.validations = [];
    this.conditionalFormats = [];
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
    this.shiftStyleCols((col) => (col >= at ? col + count : col));
    this.shiftCommentCols((col) => (col >= at ? col + count : col));
    this.cols += count;
    this.revision += 1;
    this.sort = null;
    this.validations = [];
    this.conditionalFormats = [];
  }

  /** Remove columns and return their data as column-major arrays (for undo; their cell styles are not preserved). */
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
    this.shiftStyleCols((col) => (col < index ? col : col < index + count ? null : col - count));
    this.shiftCommentCols((col) => (col < index ? col : col < index + count ? null : col - count));
    this.cols -= count;
    if (this.cols === 0) {
      this.cols = 1;
      for (const row of this.data) {
        row.push('');
      }
    }
    this.revision += 1;
    this.sort = null;
    this.validations = [];
    this.conditionalFormats = [];
    return removed;
  }

  /** Grow the worksheet to at least the given size (used by paste expansion). */
  ensureSize(rows: number, cols: number): boolean {
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
      this.revision += 1;
    }
    return changed;
  }

  // ----- Serialization support -----

  /** Append row `r`'s non-empty cells to `cells` (sparse container encoding). */
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

  /** Every non-empty cell of the worksheet as [row, col, input] triples. */
  collectCells(): Array<[number, number, string]> {
    const cells: Array<[number, number, string]> = [];
    for (let r = 0; r < this.data.length; r++) {
      this.collectRowCells(r, cells);
    }
    return cells;
  }

  /**
   * A deep copy under a new identifier and name. Cell inputs are copied
   * verbatim — including formulas, whose worksheet-qualified references keep
   * pointing at the worksheets they named (the documented duplication policy;
   * see knowledge/formats/rsf/index.md) — along with the filter, display settings, lock
   * state, and every cell's style.
   */
  clone(id: string, name: string): Worksheet {
    const copy = new Worksheet(
      id,
      name,
      this.data.map((row) => row.slice()),
      this.cols,
      this.kind,
    );
    copy.filter = this.filter;
    copy.displayZoom = this.displayZoom;
    copy.displayColWidths = this.displayColWidths.slice();
    copy.displayWrap = this.displayWrap;
    copy.locked = this.locked;
    copy.styles = new Map([...this.styles].map(([row, rowStyles]) => [row, new Map(rowStyles)]));
    copy.comments = new Map([...this.comments].map(([row, rowComments]) => [row, new Map(rowComments)]));
    return copy;
  }

  /**
   * An empty worksheet with this one's shape, filter, and display settings —
   * the target of a *sliced* duplication, whose rows are then filled in by
   * {@link copyRowInto}. Building the copy separately is what makes a large
   * duplication cancellable: an abandoned copy is simply never inserted, so
   * the workbook is left exactly as it was.
   */
  cloneShell(id: string, name: string): Worksheet {
    const copy = Worksheet.empty(id, name, this.data.length, this.cols, this.kind);
    copy.filter = this.filter;
    copy.displayZoom = this.displayZoom;
    copy.displayColWidths = this.displayColWidths.slice();
    copy.displayWrap = this.displayWrap;
    copy.locked = this.locked;
    return copy;
  }

  /** Copy one row (including its cells' styles) into a shell produced by {@link cloneShell}. */
  copyRowInto(row: number, target: Worksheet): void {
    const source = this.data[row];
    if (source) {
      target.data[row] = source.slice();
    }
    const rowStyles = this.styles.get(row);
    if (rowStyles && rowStyles.size > 0) {
      target.styles.set(row, new Map(rowStyles));
    }
    const rowComments = this.comments.get(row);
    if (rowComments && rowComments.size > 0) {
      target.comments.set(row, new Map(rowComments));
    }
  }
}
