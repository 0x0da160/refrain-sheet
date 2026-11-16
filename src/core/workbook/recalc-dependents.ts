// SPDX-License-Identifier: MIT
/**
 * Which formula cells a change can reach.
 *
 * Every reference in a formula is written out — there is no function that
 * builds a reference from a value — so what a formula reads is known from its
 * text alone. For a run of filled-down formulas (see `formula-runs.ts`) the
 * question "which of its rows read this cell?" is arithmetic on the run's
 * template: a relative row moves with the formula, a `$` row does not. That
 * lets a change be followed through a million formulas by looking at the
 * workbook's runs, not at its cells.
 *
 * The answer is deliberately coarse where precision would cost more than it
 * saves: the rows of a run reached by one change are widened to the smallest
 * interval containing them, and a run that keeps growing (a running total
 * reading its own column) is taken to its end in the direction it grows. Too
 * wide is always safe — it only recomputes more — and the caller falls back
 * to recomputing everything when the search exceeds its budget.
 */
import type { Precedent } from '../formula/template';
import type { FormulaRun } from './formula-runs';
import type { Worksheet } from './worksheet';

/** A rectangle of cells on one worksheet (inclusive bounds). */
export interface CellRect {
  sheet: Worksheet;
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * How far the template may be shifted and still read a row in `top..bottom`:
 * an inclusive interval of shifts, or null when it never does.
 */
function shiftsReading(
  rows: NonNullable<Precedent['rows']>,
  top: number,
  bottom: number,
): [number, number] | null {
  const { a, absA, b, absB } = rows;
  const low = Math.min(a, b);
  const high = Math.max(a, b);
  if (absA && absB) {
    return low <= bottom && high >= top ? [-Infinity, Infinity] : null;
  }
  if (!absA && !absB) {
    // Rows low+s .. high+s must overlap top..bottom.
    return [top - high, bottom - low];
  }
  // One end fixed, the other moving: the rows between them are read.
  const fixed = absA ? a : b;
  const moving = absA ? b : a;
  if (fixed >= top && fixed <= bottom) {
    return [-Infinity, Infinity];
  }
  return fixed < top ? [top - moving, Infinity] : [-Infinity, bottom - moving];
}

/**
 * The rows of `run` (on `home`) whose formula reads a cell of `rect`, widened
 * to one interval; null when none does.
 */
function rowsReading(
  run: FormulaRun,
  targets: ReadonlyArray<Worksheet | null>,
  rect: CellRect,
): [number, number] | null {
  const precedents = run.template.precedents;
  let first = Infinity;
  let last = -Infinity;
  for (let i = 0; i < precedents.length; i++) {
    const p = precedents[i];
    if (targets[i] !== rect.sheet || p.left > rect.right || p.right < rect.left) {
      continue;
    }
    let low = run.start;
    let high = run.end;
    if (p.rows) {
      const shifts = shiftsReading(p.rows, rect.top, rect.bottom);
      if (!shifts) {
        continue;
      }
      low = Math.max(low, run.baseRow + shifts[0]);
      high = Math.min(high, run.baseRow + shifts[1]);
      if (low > high) {
        continue;
      }
    }
    first = Math.min(first, low);
    last = Math.max(last, high);
  }
  return first <= last ? [first, last] : null;
}

/**
 * How often a run's reached rows may widen row by row. A run still growing
 * after that is extended to its first or last row at once, whichever way it
 * grows: a running total changed at one row is stale from there to its end,
 * and stepping there one row per pass would cost a pass per row.
 */
const MAX_WIDENINGS = 2;

/**
 * Every formula cell that can read, directly or through other formulas, a
 * cell of `changed` — as rectangles, one per run reached. Returns null when
 * the search would cost more than `budget` run checks; the caller must then
 * treat every formula as reached.
 */
export function formulaCellsReading(
  changed: readonly CellRect[],
  sheets: readonly Worksheet[],
  sheetByName: (name: string) => Worksheet | null,
  budget: number,
): CellRect[] | null {
  const runs: Array<{ sheet: Worksheet; run: FormulaRun; targets: Array<Worksheet | null> }> = [];
  for (const sheet of sheets) {
    for (const column of sheet.formulas.runs()) {
      for (const run of column) {
        if (run.template.precedents.length > 0) {
          const targets = run.template.precedents.map((p) =>
            p.sheet === undefined ? sheet : sheetByName(p.sheet),
          );
          runs.push({ sheet, run, targets });
        }
      }
    }
  }
  const reached = new Map<FormulaRun, { rect: CellRect; widenings: number }>();
  const queue: CellRect[] = changed.slice();
  let checks = 0;
  for (let rect = queue.pop(); rect; rect = queue.pop()) {
    checks += runs.length;
    if (checks > budget) {
      return null;
    }
    for (const { sheet, run, targets } of runs) {
      const rows = rowsReading(run, targets, rect);
      if (!rows) {
        continue;
      }
      const known = reached.get(run);
      if (!known) {
        const first: CellRect = { sheet, top: rows[0], bottom: rows[1], left: run.col, right: run.col };
        reached.set(run, { rect: first, widenings: 0 });
        queue.push({ ...first });
        continue;
      }
      if (rows[0] >= known.rect.top && rows[1] <= known.rect.bottom) {
        continue;
      }
      known.widenings += 1;
      const toTheEnd = known.widenings > MAX_WIDENINGS;
      if (rows[0] < known.rect.top) {
        known.rect.top = toTheEnd ? run.start : rows[0];
      }
      if (rows[1] > known.rect.bottom) {
        known.rect.bottom = toTheEnd ? run.end : rows[1];
      }
      queue.push({ ...known.rect });
    }
  }
  return Array.from(reached.values(), (entry) => entry.rect);
}
