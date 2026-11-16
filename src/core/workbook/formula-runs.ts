// SPDX-License-Identifier: MIT
/**
 * A worksheet's formula cells, grouped into **runs**: consecutive cells of one
 * column whose formulas are the same formula written for successive rows
 * (`=E2*F2`, `=E3*F3`, …). A run keeps one parsed {@link FormulaTemplate} for
 * all its cells, so a million filled-down formulas cost one parse and one
 * syntax tree instead of a million, and the recalculation engine can reason
 * about them as one block (which rows read a changed cell is arithmetic on the
 * run, not a walk over its cells).
 *
 * Membership is decided by text alone: a cell joins the run above it only
 * when its input equals the run's template written for that row. Formulas
 * that are not copies of their neighbour simply form runs of one cell, which
 * is what every formula cell was before runs existed.
 *
 * The index is derived state. The worksheet reports every change to it
 * ({@link cellChanged}, {@link reset}); nothing here is persisted.
 */
import { isFormula, parseFormula, type ParseResult } from '../formula';
import { canSpill } from '../formula/spill';
import { compileTemplate, type FormulaTemplate, templateSource } from '../formula/template';

/** A template plus what only the workbook layer can say about it. */
interface RunTemplate extends FormulaTemplate {
  /** True when the formula could return an array (see `canSpill`). */
  readonly canSpill: boolean;
}

export interface FormulaRun {
  readonly col: number;
  /** First and last row of the run, inclusive. */
  start: number;
  end: number;
  /** The row the template is written for; the cell at `row` evaluates it shifted by `row - baseRow`. */
  readonly baseRow: number;
  readonly template: RunTemplate;
}

/** What the index reads from its worksheet. */
export interface FormulaSource {
  readonly rowCount: number;
  readonly columnCount: number;
  getValue(row: number, col: number): string;
  /** The number of formula cells in each row (rows with none are skipped). */
  formulaRowCounts(): readonly number[];
}

/**
 * Single-cell edits applied in place before the index is rebuilt from
 * scratch. Each one may split a run, so an unbounded series would fragment
 * the index; a rebuild is one pass over the worksheet's formula cells.
 */
const MAX_EDITS_BEFORE_REBUILD = 64;

function makeRun(col: number, row: number, src: string): FormulaRun {
  const template = compileTemplate(src);
  return {
    col,
    start: row,
    end: row,
    baseRow: row,
    template: { ...template, canSpill: template.parsed.ok && canSpill(template.parsed.ast) },
  };
}

/** True when `src`, at `row`, is the run's formula written for that row. */
function continues(run: FormulaRun, row: number, src: string): boolean {
  const shift = row - run.baseRow;
  return shift >= 0 && shift <= run.template.maxShift && templateSource(run.template, shift) === src;
}

export class FormulaRunIndex {
  /** Per column, its runs in row order; null until first needed and after {@link reset}. */
  private columns: FormulaRun[][] | null = null;
  /** Per column, where the last lookup found its run (lookups mostly walk down a column). */
  private last: number[] = [];
  private edits = 0;
  /**
   * Parsed formulas of cells no run covers — a formula in a worksheet whose
   * rows are not indexed as formula rows. Keyed by cell, checked against the
   * source, exactly as every formula cell was cached before runs existed.
   */
  private readonly strays = new Map<string, { src: string; parsed: ParseResult }>();

  constructor(private readonly source: FormulaSource) {}

  /** Every run, per column in row order. */
  runs(): readonly (readonly FormulaRun[])[] {
    return (this.columns ??= this.build());
  }

  /** The run covering a formula cell, or null when no run does. */
  runAt(row: number, col: number): FormulaRun | null {
    const runs = (this.columns ??= this.build())[col];
    if (!runs || runs.length === 0) {
      return null;
    }
    let i = this.last[col] ?? 0;
    if (i >= runs.length || row < runs[i].start || row > runs[i].end) {
      i = this.position(runs, row);
      if (i >= runs.length || row < runs[i].start) {
        return null;
      }
      this.last[col] = i;
    }
    return runs[i];
  }

  /** The runs of one column that cover any of rows `top..bottom`, in row order. */
  runsBetween(col: number, top: number, bottom: number): FormulaRun[] {
    const runs = (this.columns ??= this.build())[col] ?? [];
    const out: FormulaRun[] = [];
    for (let i = this.position(runs, top); i < runs.length && runs[i].start <= bottom; i++) {
      out.push(runs[i]);
    }
    return out;
  }

  /** True once a formula cell outside every run has been evaluated (see {@link stray}). */
  get hasStrays(): boolean {
    return this.strays.size > 0;
  }

  /** The parsed formula of a cell that {@link runAt} does not cover. */
  stray(row: number, col: number, input: string): ParseResult {
    const key = `${row},${col}`;
    let entry = this.strays.get(key);
    if (!entry || entry.src !== input) {
      entry = { src: input, parsed: parseFormula(input) };
      this.strays.set(key, entry);
    }
    return entry.parsed;
  }

  /** One cell's input changed, to `input`; `was`/`now` say whether it held, and holds, a formula. */
  cellChanged(row: number, col: number, input: string, was: boolean, now: boolean): void {
    if (!this.columns || (!was && !now)) {
      return;
    }
    this.edits += 1;
    if (this.edits > MAX_EDITS_BEFORE_REBUILD) {
      this.reset();
      return;
    }
    const runs = (this.columns[col] ??= []);
    if (was) {
      this.remove(runs, row);
    }
    if (now) {
      this.insert(runs, col, row, input);
    }
  }

  /** Forget everything: rows or columns moved, so no run is where it was. */
  reset(): void {
    this.columns = null;
    this.last = [];
    this.edits = 0;
    this.strays.clear();
  }

  /** The index of the first run that ends at or after `row`. */
  private position(runs: readonly FormulaRun[], row: number): number {
    let low = 0;
    let high = runs.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (runs[mid].end < row) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    return low;
  }

  private remove(runs: FormulaRun[], row: number): void {
    const i = this.position(runs, row);
    const run = runs[i];
    if (!run || row < run.start) {
      return;
    }
    if (run.start === run.end) {
      runs.splice(i, 1);
    } else if (row === run.start) {
      run.start += 1;
    } else if (row === run.end) {
      run.end -= 1;
    } else {
      runs.splice(i + 1, 0, { ...run, start: row + 1 });
      run.end = row - 1;
    }
  }

  private insert(runs: FormulaRun[], col: number, row: number, src: string): void {
    const i = this.position(runs, row);
    const above = runs[i - 1];
    if (above && above.end === row - 1 && continues(above, row, src)) {
      above.end = row;
      // Rejoin the two halves of a run this cell was once cut out of.
      const below = runs[i];
      if (
        below &&
        below.start === row + 1 &&
        below.template === above.template &&
        below.baseRow === above.baseRow
      ) {
        above.end = below.end;
        runs.splice(i, 1);
      }
      return;
    }
    runs.splice(i, 0, makeRun(col, row, src));
  }

  private build(): FormulaRun[][] {
    const { rowCount, columnCount } = this.source;
    const columns: FormulaRun[][] = Array.from({ length: columnCount }, () => []);
    const counts = this.source.formulaRowCounts();
    for (let row = 0; row < rowCount; row++) {
      if (counts[row] === 0) {
        continue;
      }
      for (let col = 0; col < columnCount; col++) {
        const src = this.source.getValue(row, col);
        if (!isFormula(src)) {
          continue;
        }
        const runs = columns[col];
        const open = runs[runs.length - 1];
        if (open && open.end === row - 1 && continues(open, row, src)) {
          open.end = row;
        } else {
          runs.push(makeRun(col, row, src));
        }
      }
    }
    return columns;
  }
}
