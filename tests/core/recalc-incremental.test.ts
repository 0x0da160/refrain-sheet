// SPDX-License-Identifier: MIT
/**
 * A change to one cell's input recomputes only what can read that cell
 * (`RecalcEngine.invalidate`, `recalc-dependents.ts`); everything else keeps
 * its result. A kept result must be exactly what recomputing everything would
 * have produced, so these tests hold a long-lived workbook against a workbook
 * just built from the same inputs, cell for cell, after every step — through
 * filled-down formulas, running totals, `$` references, other worksheets,
 * whole-column ranges, volatile functions, circular references, dynamic
 * arrays, structural edits and bursts of changes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RsfDocument } from '../../src/core/workbook/rsf-document';
import type { Worksheet } from '../../src/core/workbook/worksheet';
import { differences, freshCopy, pick, seededRandom, workbookValues } from '../workbook-values';

/**
 * How often the engine followed a change narrowly, counted at the function
 * that finds the formulas a change reaches — so a test can tell that it
 * exercised that path and not only the recompute-everything fallback.
 */
const narrow = vi.hoisted(() => ({ followed: 0 }));
vi.mock('../../src/core/workbook/recalc-dependents', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/workbook/recalc-dependents')>();
  return {
    ...actual,
    formulaCellsReading: (...args: Parameters<typeof actual.formulaCellsReading>) => {
      const reached = actual.formulaCellsReading(...args);
      if (reached) {
        narrow.followed += 1;
      }
      return reached;
    },
  };
});

const DAY_MS = 86_400_000;
let clock = Date.UTC(2026, 0, 15, 9, 0, 0);

beforeEach(() => {
  // `TODAY()` and `NOW()` read the clock: both workbooks must read the same one.
  vi.useFakeTimers();
  clock = Date.UTC(2026, 0, 15, 9, 0, 0);
  vi.setSystemTime(clock);
  narrow.followed = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

/** Fail, naming the differing cells and the latest steps, unless `doc` equals a fresh copy of itself. */
function expectSameAsFresh(doc: RsfDocument, log: readonly string[]): void {
  const got = workbookValues(doc);
  const want = workbookValues(freshCopy(doc));
  const differing = differences(got, want);
  if (differing.length > 0) {
    expect({ differing, latestSteps: log.slice(-12) }).toEqual({ differing: [], latestSteps: [] });
  }
}

// ----- A workbook shaped like real work: a long detail sheet and a summary -----

const DETAIL_ROWS = 1100;
const CATEGORIES = ['x', 'y', 'z', 'w'];

/** The filled-down formulas of the detail sheet, as written for 1-based row `r`. */
const DETAIL_FORMULAS: ReadonlyArray<(r: number) => string> = [
  (r) => `=B${r}*C${r}`,
  (r) => (r === 1 ? '=D1' : `=E${r - 1}+D${r}`),
  (r) => `=VLOOKUP(A${r},Master!$A$1:$B$4,2,FALSE)`,
];

function salesWorkbook(rand: () => number): {
  doc: RsfDocument;
  data: Worksheet;
  master: Worksheet;
  calc: Worksheet;
} {
  const doc = RsfDocument.empty('book.rsf', DETAIL_ROWS, 7, 'Data');
  const data = doc.sheets[0];
  for (let row = 0; row < DETAIL_ROWS; row++) {
    doc.setCellOn(data.id, row, 0, pick(rand, CATEGORIES));
    doc.setCellOn(data.id, row, 1, String(1 + Math.floor(rand() * 9)));
    doc.setCellOn(data.id, row, 2, pick(rand, ['100', '250', '0.1', '19.99']));
    DETAIL_FORMULAS.forEach((formula, i) => doc.setCellOn(data.id, row, 3 + i, formula(row + 1)));
    doc.setCellOn(data.id, row, 6, `note ${row}`);
  }
  const master = doc.createWorksheet('Master', 4, 2);
  doc.insertSheetAt(1, master);
  CATEGORIES.forEach((category, row) => {
    doc.setCellOn(master.id, row, 0, category);
    doc.setCellOn(master.id, row, 1, String((row + 1) * 10));
  });
  const calc = doc.createWorksheet('Calc', 12, 6);
  doc.insertSheetAt(2, calc);
  for (let row = 0; row < 8; row++) {
    const r = row + 1;
    doc.setCellOn(calc.id, row, 0, CATEGORIES[row % CATEGORIES.length]);
    doc.setCellOn(calc.id, row, 1, `=SUMIFS(Data!D:D,Data!A:A,A${r})`);
    doc.setCellOn(calc.id, row, 2, `=COUNTIFS(Data!A$1:A$1100,A${r},Data!B$1:B$1100,">"&$F$1)`);
    doc.setCellOn(calc.id, row, 3, `=SUM(B$1:B${r})`);
  }
  [
    '=TODAY()',
    '=E1+1',
    '=Data!E1100',
    '=AVERAGEIFS(Data!F1:F1100,Data!A1:A1100,"<>"&A1)',
    '=SUM(Data!D1:D1100)',
    '=MAX(Data!E:E)',
    '=COUNTIF(Data!F:F,">15")',
    '=SUMIF(Data!A:A,"x",Data!E:E)',
  ].forEach((formula, row) => doc.setCellOn(calc.id, row, 4, formula));
  doc.setCellOn(calc.id, 0, 5, '3');
  return { doc, data, master, calc };
}

/**
 * Each step here builds a second workbook and evaluates both in full, which
 * takes a few seconds in all and several times that under coverage.
 */
const LONG_TEST_MS = 60_000;

describe('a long detail sheet with a summary, edited step by step', () => {
  for (const seed of [101, 102]) {
    it(
      `matches a freshly built workbook after every step (seed ${seed})`,
      () => {
        const rand = seededRandom(seed);
        const { doc, data, master, calc } = salesWorkbook(rand);
        const log: string[] = [];
        const set = (sheet: Worksheet, row: number, col: number, input: string): void => {
          log.push(`${sheet.name} r${row + 1}c${col + 1} = ${JSON.stringify(input)}`);
          doc.setCellOn(sheet.id, row, col, input);
        };
        const anyRow = (): number => Math.floor(rand() * data.rowCount);
        // A circular reference or a dynamic array makes every later change
        // recompute everything, so each is taken out again on the next step —
        // the workbook is mostly one whose changes are followed narrowly.
        let repair: (() => void) | null = null;
        const edit = (): void => {
          if (repair) {
            repair();
            repair = null;
            return;
          }
          const roll = rand();
          if (roll < 0.5) {
            const col = pick(rand, [0, 1, 2, 6]);
            const input =
              col === 0
                ? pick(rand, [...CATEGORIES, '', 'other'])
                : col === 6
                  ? `note ${Math.floor(rand() * 9)}`
                  : pick(rand, ['1', '2', '7', '0.1', '250', '', 'n/a', '=1/0']);
            set(data, anyRow(), col, input);
          } else if (roll < 0.6) {
            if (rand() < 0.3) {
              set(calc, 0, 5, pick(rand, ['1', '3', '5', '']));
            } else {
              set(calc, Math.floor(rand() * 8), 0, pick(rand, [...CATEGORIES, 'other']));
            }
          } else if (roll < 0.7) {
            // Break a run of filled-down formulas with a value or a different formula.
            const row = anyRow();
            set(
              data,
              row,
              3 + Math.floor(rand() * 3),
              pick(rand, ['5', '', `=B${row + 1}+C${row + 1}`, '=G1']),
            );
          } else if (roll < 0.8) {
            // Put a cell's filled-down formula back, rejoining its run.
            const row = anyRow();
            const i = Math.floor(rand() * 3);
            set(data, row, 3 + i, DETAIL_FORMULAS[i](row + 1));
          } else if (roll < 0.84) {
            set(master, Math.floor(rand() * 4), 1, pick(rand, ['10', '15', '20', '']));
          } else if (roll < 0.87) {
            // A running total that reads the row below it: a circular reference.
            const row = Math.floor(rand() * (data.rowCount - 1));
            set(data, row, 4, `=E${row + 2}+D${row + 1}`);
            repair = () => set(data, row, 4, DETAIL_FORMULAS[1](row + 1));
          } else if (roll < 0.9) {
            const c = Math.floor(rand() * 2);
            set(calc, 9, c, pick(rand, ['=SEQUENCE(2)', '=SORT(A1:A4)']));
            repair = () => set(calc, 9, c, '');
          } else if (roll < 0.93) {
            // Rows are added and removed at the end, where no formula is left
            // reading a row that moved (the command layer rewrites those; this
            // test drives the workbook directly).
            if (data.rowCount > DETAIL_ROWS) {
              log.push('delete the last Data row');
              doc.deleteRowsOn(data.id, data.rowCount - 1, 1);
            } else {
              log.push('append a Data row');
              const r = data.rowCount + 1;
              doc.insertRowsOn(data.id, data.rowCount, [
                ['x', '2', '100', ...DETAIL_FORMULAS.map((formula) => formula(r)), 'new'],
              ]);
            }
          } else if (roll < 0.95) {
            log.push('recalculate');
            doc.recalculate();
          } else if (roll < 0.97) {
            // More changes at once than the engine follows one by one.
            log.push('2100 edits');
            for (let i = 0; i < 2100; i++) {
              doc.setCellOn(data.id, anyRow(), 1, String(1 + Math.floor(rand() * 9)));
            }
          } else {
            clock += DAY_MS;
            vi.setSystemTime(clock);
            // A value this cell cannot already hold: only a real change advances the clock.
            set(data, anyRow(), 6, `on day ${clock / DAY_MS}`);
          }
        };

        expectSameAsFresh(doc, log);
        const steps = 110;
        for (let step = 0; step < steps; step++) {
          const edits = rand() < 0.7 ? 1 : 1 + Math.floor(rand() * 4);
          for (let i = 0; i < edits; i++) {
            edit();
          }
          if (rand() < 0.3) {
            // Read a few cells, change something else, and only then read everything.
            for (let i = 0; i < 3; i++) {
              const sheet = pick(rand, [data, calc]);
              doc.evaluateInSheet(
                sheet,
                Math.floor(rand() * sheet.rowCount),
                Math.floor(rand() * sheet.columnCount),
              );
            }
            log.push('(read a few cells)');
            edit();
          }
          expectSameAsFresh(doc, log);
        }
        // Most steps here are plain value edits, which must not fall back.
        expect(narrow.followed).toBeGreaterThan(steps / 3);
      },
      LONG_TEST_MS,
    );
  }
});

// ----- Small worksheets dense with every kind of reference -----

const SMALL_ROWS = 10;
const COLS = 'ABCDE';
const SMALL_SHEETS = ['S1', 'S2', 'My Sheet'];
const PREFIXES = ['S1!', 'S2!', "'My Sheet'!"];

function smallWorkbook(): RsfDocument {
  const doc = RsfDocument.empty('book.rsf', SMALL_ROWS, COLS.length, SMALL_SHEETS[0]);
  for (const name of SMALL_SHEETS.slice(1)) {
    doc.insertSheetAt(doc.sheets.length, doc.createWorksheet(name, SMALL_ROWS, COLS.length));
  }
  return doc;
}

/** Random references for a formula in one cell: which cells it may name. */
interface Refs {
  /** A worksheet prefix (`''` for the formula's own worksheet). */
  prefix(): string;
  /** A column the formula may read on the worksheet `prefix` names. */
  col(prefix: string): string;
  /** Whether whole-row ranges and dynamic arrays may be written. */
  readonly anything: boolean;
}

const rowNumber = (rand: () => number): number => 1 + Math.floor(rand() * SMALL_ROWS);

/** References to anywhere: circular references and dynamic arrays will happen. */
function anyRefs(rand: () => number): Refs {
  return {
    prefix: () => (rand() < 0.7 ? '' : pick(rand, [...PREFIXES, 'Gone!'])),
    col: () => COLS[Math.floor(rand() * COLS.length)],
    anything: true,
  };
}

/**
 * References that cannot close a cycle: columns to the left on the same
 * worksheet, or any column of an earlier worksheet. Null for the one corner
 * with nothing to read.
 */
function acyclicRefs(rand: () => number, sheetIndex: number, column: number): Refs | null {
  const own = COLS.slice(0, column);
  const earlier = PREFIXES.slice(0, sheetIndex);
  if (own === '' && earlier.length === 0) {
    return null;
  }
  return {
    prefix: () => (own !== '' && (earlier.length === 0 || rand() < 0.6) ? '' : pick(rand, earlier)),
    col: (prefix) => {
      const cols = prefix === '' ? own : COLS;
      return cols[Math.floor(rand() * cols.length)];
    },
    anything: false,
  };
}

/** One cell reference, with any mix of `$` markers. */
function ref(rand: () => number, refs: Refs): string {
  const prefix = refs.prefix();
  return `${prefix}${rand() < 0.2 ? '$' : ''}${refs.col(prefix)}${rand() < 0.25 ? '$' : ''}${rowNumber(rand)}`;
}

function range(rand: () => number, refs: Refs): string {
  const prefix = refs.prefix();
  const roll = rand();
  if (roll < 0.15) {
    const c = refs.col(prefix);
    return `${prefix}${c}:${c}`;
  }
  if (roll < 0.25 && refs.anything) {
    const r = rowNumber(rand);
    return `${prefix}${r}:${r}`;
  }
  return `${prefix}${refs.col(prefix)}${rowNumber(rand)}:${refs.col(prefix)}${rand() < 0.3 ? '$' : ''}${rowNumber(rand)}`;
}

function singleFormula(rand: () => number, refs: Refs): string {
  const r = (): string => ref(rand, refs);
  const g = (): string => range(rand, refs);
  switch (Math.floor(rand() * 14)) {
    case 0:
      return `=${r()}+${r()}`;
    case 1:
      return `=${r()}*2`;
    case 2:
      return `=SUM(${g()})`;
    case 3:
      return `=IF(${r()}>2,${r()},${r()})`;
    case 4:
      return `=IFERROR(${r()}/${r()},0)`;
    case 5:
      return `=COUNTIF(${g()},">1")`;
    case 6:
      return `=SUMIF(${g()},${r()})`;
    case 7:
      return `=${r()}&"a"`;
    case 8:
      return `=MAX(${g()},${r()})`;
    case 9:
      return `=INDEX(${g()},1,1)`;
    case 10:
      return pick(rand, ['=TODAY()', '=NOW()', `=NOW()+${r()}`]);
    case 11:
      return refs.anything
        ? pick(rand, ['=SEQUENCE(2)', `=SORT(${g()})`, `=UNIQUE(${g()})`, `=${g()}>1`])
        : `=VLOOKUP(${r()},${g()},1,FALSE)`;
    case 12:
      return pick(rand, ['=(', '=NOSUCH(1)', '=1/0', '=A1+']);
    default:
      return `=COUNTA(${g()})+${r()}`;
  }
}

/** A formula to fill down a column: the same text for each row, its relative rows moving along. */
function fillFormula(rand: () => number, refs: Refs): (r: number) => string {
  const sheet = refs.prefix();
  const a = refs.col(sheet);
  const b = refs.col(sheet);
  const up = Math.floor(rand() * 3);
  const fixed = rowNumber(rand);
  switch (Math.floor(rand() * 6)) {
    case 0:
      return (r) => `=${sheet}${a}${r - up}+${sheet}${b}${r}`;
    case 1:
      return (r) => `=SUM(${sheet}${a}$1:${a}${r})`;
    case 2:
      return (r) => `=SUM(${sheet}${a}${r}:${b}${r + 1})`;
    case 3:
      return (r) => `=IF(${sheet}${b}${r}>2,${sheet}${b}${r},${sheet}$${a}$${fixed})`;
    case 4:
      return (r) => `=COUNTIF(${sheet}${a}:${a},${sheet}${b}${r})`;
    default:
      return (r) => `=${sheet}${b}${r}&"-"&${sheet}${a}$${fixed}`;
  }
}

describe('small worksheets dense with references, edited at random', () => {
  const cases: Array<[string, boolean, number, number]> = [
    ['references to anywhere', false, 1006, 0.1],
    ['references to anywhere', false, 1009, 0.1],
    ['references that cannot form a cycle', true, 3, 0.8],
    ['references that cannot form a cycle', true, 4, 0.8],
  ];
  for (const [name, acyclic, seed, narrowShare] of cases) {
    it(`matches a freshly built workbook after every step: ${name} (seed ${seed})`, () => {
      const rand = seededRandom(seed);
      const doc = smallWorkbook();
      const log: string[] = [];
      const anySheet = (): Worksheet => pick(rand, doc.sheets);
      const set = (sheet: Worksheet, row: number, c: number, input: string): void => {
        if (row < sheet.rowCount && c < sheet.columnCount) {
          log.push(`${sheet.name} r${row + 1}c${c + 1} = ${JSON.stringify(input)}`);
          doc.setCellOn(sheet.id, row, c, input);
        }
      };
      const literal = (): string => pick(rand, ['1', '2', '3', '0.5', '10', '-1', 'x', 'y', '']);
      const edit = (): void => {
        const sheet = anySheet();
        const row = Math.floor(rand() * SMALL_ROWS);
        const c = Math.floor(rand() * COLS.length);
        const refs = acyclic ? acyclicRefs(rand, doc.sheets.indexOf(sheet), c) : anyRefs(rand);
        const roll = rand();
        if (roll < 0.5 || !refs) {
          set(sheet, row, c, literal());
        } else if (roll < 0.72) {
          set(sheet, row, c, singleFormula(rand, refs));
        } else if (roll < 0.84) {
          const formula = fillFormula(rand, refs);
          const top = 3 + Math.floor(rand() * 3);
          const count = 2 + Math.floor(rand() * 4);
          for (let r = top; r < top + count; r++) {
            set(sheet, r - 1, c, formula(r));
          }
        } else if (roll < 0.9) {
          for (let r = row; r < Math.min(SMALL_ROWS, row + 3); r++) {
            set(sheet, r, c, '');
          }
        } else if (roll < 0.92) {
          log.push('recalculate');
          doc.recalculate();
        } else if (roll < 0.94) {
          // At the end of the worksheet, where no formula is left reading a
          // row that moved (the command layer rewrites those).
          if (sheet.rowCount > SMALL_ROWS) {
            log.push(`delete the last row of ${sheet.name}`);
            doc.deleteRowsOn(sheet.id, sheet.rowCount - 1, 1);
          } else {
            log.push(`append a row to ${sheet.name}`);
            doc.insertRowsOn(sheet.id, sheet.rowCount, [['1', '=A1+1', '', 'x', '2']]);
          }
        } else if (roll < 0.95) {
          const second = doc.sheets[1];
          const to = second.name === 'S2' ? 'S2 renamed' : 'S2';
          log.push(`rename ${second.name} to ${to}`);
          doc.renameSheet(second.id, to);
        } else {
          clock += DAY_MS;
          vi.setSystemTime(clock);
          // A value this cell cannot already hold: only a real change advances the clock.
          set(sheet, row, c, `on day ${clock / DAY_MS}`);
        }
      };

      const steps = 600;
      for (let step = 0; step < steps; step++) {
        const edits = 1 + Math.floor(rand() * 3);
        for (let i = 0; i < edits; i++) {
          edit();
        }
        if (rand() < 0.25) {
          const sheet = anySheet();
          doc.evaluateInSheet(
            sheet,
            Math.floor(rand() * sheet.rowCount),
            Math.floor(rand() * sheet.columnCount),
          );
          log.push('(read one cell)');
          edit();
        }
        // Every so often start over, so the workbook is not always one that
        // long since met a dynamic array or a circular reference.
        if (step % 40 === 39) {
          for (const sheet of doc.sheets) {
            for (let r = 0; r < sheet.rowCount; r++) {
              for (let c = 0; c < sheet.columnCount; c++) {
                doc.setCellOn(sheet.id, r, c, '');
              }
            }
          }
          log.push('(cleared every cell)');
        }
        expectSameAsFresh(doc, log);
      }
      // The comparison must have exercised narrow invalidation, not only the fallback.
      expect(narrow.followed).toBeGreaterThan(steps * narrowShare);
    });
  }
});

// ----- The rules, one at a time -----

/** A 12×4 worksheet from A1-style cell inputs. */
function sheetOf(cells: Record<string, string>): RsfDocument {
  const doc = RsfDocument.empty('book.rsf', 12, 4);
  for (const [a1, input] of Object.entries(cells)) {
    doc.setCell(Number(a1.slice(1)) - 1, a1.charCodeAt(0) - 65, input);
  }
  return doc;
}

const valueAt = (doc: RsfDocument, a1: string) =>
  doc.evaluateCell(Number(a1.slice(1)) - 1, a1.charCodeAt(0) - 65);
const write = (doc: RsfDocument, a1: string, input: string): void =>
  doc.setCell(Number(a1.slice(1)) - 1, a1.charCodeAt(0) - 65, input);

describe('what one cell change recomputes', () => {
  it('keeps a result that cannot read the changed cell and recomputes one that can', () => {
    const doc = sheetOf({ A1: '1', A2: '2', B1: '=A1*10', B2: '=A2*10', C1: '=SUM(B1:B2)', D1: '=A2+1' });
    const b1 = valueAt(doc, 'B1');
    const b2 = valueAt(doc, 'B2');
    const c1 = valueAt(doc, 'C1');
    const d1 = valueAt(doc, 'D1');
    write(doc, 'A1', '5');
    // The very same result objects: these were not evaluated again.
    expect(valueAt(doc, 'B2')).toBe(b2);
    expect(valueAt(doc, 'D1')).toBe(d1);
    expect(valueAt(doc, 'B1')).not.toBe(b1);
    expect(valueAt(doc, 'B1')).toEqual({ type: 'number', value: 50 });
    expect(valueAt(doc, 'C1')).not.toBe(c1);
    expect(valueAt(doc, 'C1')).toEqual({ type: 'number', value: 70 });
    expect(narrow.followed).toBe(1);
  });

  it('follows a change down a running total', () => {
    const cells: Record<string, string> = { A1: '1', B1: '=A1' };
    for (let r = 2; r <= 12; r++) {
      cells[`A${r}`] = '1';
      cells[`B${r}`] = `=B${r - 1}+A${r}`;
    }
    const doc = sheetOf(cells);
    expect(valueAt(doc, 'B12')).toEqual({ type: 'number', value: 12 });
    const above = valueAt(doc, 'B3');
    write(doc, 'A4', '100');
    expect(valueAt(doc, 'B3')).toBe(above); // rows above the change are not evaluated again
    expect(valueAt(doc, 'B4')).toEqual({ type: 'number', value: 103 });
    expect(valueAt(doc, 'B12')).toEqual({ type: 'number', value: 111 });
  });

  it('follows a change into a formula that is itself changed in the same burst', () => {
    const doc = sheetOf({ A1: '1', A2: '2', B1: '=A1', C1: '=B1+1' });
    expect(valueAt(doc, 'C1')).toEqual({ type: 'number', value: 2 });
    write(doc, 'A2', '7');
    write(doc, 'B1', '=A2');
    write(doc, 'A1', '9');
    expect(valueAt(doc, 'C1')).toEqual({ type: 'number', value: 8 });
    expect(valueAt(doc, 'B1')).toEqual({ type: 'number', value: 7 });
  });

  it('advances volatile formulas, and what reads them, on any change', () => {
    const doc = sheetOf({ A1: '=NOW()', B1: '=A1+1', C1: '=D1*2', D1: '4' });
    const now = valueAt(doc, 'A1');
    const later = valueAt(doc, 'B1');
    const unrelated = valueAt(doc, 'C1');
    clock += DAY_MS;
    vi.setSystemTime(clock);
    expect(valueAt(doc, 'A1')).toBe(now); // an idle workbook does not move on its own
    write(doc, 'D2', 'anything');
    expect(valueAt(doc, 'C1')).toBe(unrelated);
    const after = valueAt(doc, 'A1');
    expect(after).not.toEqual(now);
    expect(valueAt(doc, 'B1')).not.toEqual(later);
    expect(workbookValues(doc)).toEqual(workbookValues(freshCopy(doc)));
  });

  it('reads the clock at the change, not at the next evaluation', () => {
    const doc = sheetOf({ A1: '=NOW()' });
    valueAt(doc, 'A1');
    clock += DAY_MS;
    vi.setSystemTime(clock);
    write(doc, 'B1', 'x');
    const atChange = valueAt(freshCopy(doc), 'A1');
    clock += DAY_MS;
    vi.setSystemTime(clock);
    expect(valueAt(doc, 'A1')).toEqual(atChange);
  });

  it('recomputes everything once a circular reference has been met', () => {
    const doc = sheetOf({ A1: '1', B1: '=A1+1', C1: '=D1', D1: '=C1' });
    expect(valueAt(doc, 'C1')).toEqual({ type: 'error', code: '#CYCLE!' });
    const b1 = valueAt(doc, 'B1');
    write(doc, 'A2', 'unrelated');
    expect(valueAt(doc, 'B1')).not.toBe(b1);
    expect(valueAt(doc, 'B1')).toEqual(b1);
    expect(valueAt(doc, 'C1')).toEqual({ type: 'error', code: '#CYCLE!' });
    // Taking the cycle out is itself a change made while one was known.
    write(doc, 'D1', '3');
    expect(valueAt(doc, 'C1')).toEqual({ type: 'number', value: 3 });
    expect(narrow.followed).toBe(0);
    // With the cycle gone, changes are followed narrowly again.
    const kept = valueAt(doc, 'B1');
    write(doc, 'A2', 'again');
    expect(valueAt(doc, 'B1')).toBe(kept);
    expect(narrow.followed).toBe(1);
  });

  it('recomputes everything while the workbook holds a dynamic array', () => {
    const doc = sheetOf({ A1: '3', A2: '1', A3: '2', C1: '=SORT(A1:A3)', D1: '=A1+1' });
    expect(valueAt(doc, 'C3')).toEqual({ type: 'number', value: 3 });
    write(doc, 'A1', '0');
    expect([valueAt(doc, 'C1'), valueAt(doc, 'C2'), valueAt(doc, 'C3')]).toEqual([
      { type: 'number', value: 0 },
      { type: 'number', value: 1 },
      { type: 'number', value: 2 },
    ]);
    expect(narrow.followed).toBe(0);
    // A dynamic array written into a workbook that had none is seen at once.
    const plain = sheetOf({ A1: '1', B1: '=A1+1' });
    expect(valueAt(plain, 'B1')).toEqual({ type: 'number', value: 2 });
    write(plain, 'C1', '=SEQUENCE(3)');
    expect(valueAt(plain, 'C3')).toEqual({ type: 'number', value: 3 });
    write(plain, 'C1', '');
    expect(valueAt(plain, 'C3')).toEqual({ type: 'empty' });
  });

  it('sees a formula edited inside a run of filled-down formulas, and its restoration', () => {
    const cells: Record<string, string> = {};
    for (let r = 1; r <= 12; r++) {
      cells[`A${r}`] = String(r);
      cells[`B${r}`] = `=A${r}*2`;
    }
    cells.C1 = '=SUM(B1:B12)';
    const doc = sheetOf(cells);
    expect(valueAt(doc, 'C1')).toEqual({ type: 'number', value: 156 });
    write(doc, 'B6', '=A6*100');
    expect(valueAt(doc, 'B6')).toEqual({ type: 'number', value: 600 });
    expect(valueAt(doc, 'B7')).toEqual({ type: 'number', value: 14 });
    expect(valueAt(doc, 'C1')).toEqual({ type: 'number', value: 744 });
    write(doc, 'A7', '70');
    expect(valueAt(doc, 'B7')).toEqual({ type: 'number', value: 140 });
    write(doc, 'B6', '=A6*2');
    write(doc, 'A6', '60');
    expect(valueAt(doc, 'B6')).toEqual({ type: 'number', value: 120 });
    expect(valueAt(doc, 'C1')).toEqual({ type: 'number', value: 390 });
    expect(workbookValues(doc)).toEqual(workbookValues(freshCopy(doc)));
  });

  it('follows changes after rows were inserted and deleted', () => {
    const doc = sheetOf({
      A1: '1',
      A2: '2',
      A3: '3',
      B1: '=A1*2',
      B2: '=A2*2',
      B3: '=A3*2',
      C1: '=SUM(B:B)',
    });
    expect(valueAt(doc, 'C1')).toEqual({ type: 'number', value: 12 });
    doc.insertRows(1, [['10', '=A2*2', '', '']]);
    expect(valueAt(doc, 'C1')).toEqual(valueAt(freshCopy(doc), 'C1'));
    write(doc, 'A2', '20');
    expect(workbookValues(doc)).toEqual(workbookValues(freshCopy(doc)));
    doc.deleteRows(0, 1);
    write(doc, 'A1', '30');
    expect(workbookValues(doc)).toEqual(workbookValues(freshCopy(doc)));
  });
});
