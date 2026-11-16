// SPDX-License-Identifier: MIT
/**
 * The typed-column scan behind `COUNTIFS`, `SUMIFS` and friends
 * (`src/core/formula/columnar.ts`) must compute exactly what the cell-by-cell
 * scan computes — the same number to the last bit, the same error, chosen by
 * the same scan order.
 *
 * Two layers, both on random data from a fixed seed:
 *
 * - the kernel (`scanColumns`) against a reference written here from the
 *   documented rules, over columns built by `ColumnStore`;
 * - whole formulas in a workbook (ranges long enough to take the typed path)
 *   against the same formulas evaluated through a context that has no typed
 *   columns, which is the cell-by-cell path every shorter range still takes.
 */
import { describe, expect, it } from 'vitest';
import {
  errorValue,
  evaluateAst,
  parseFormula,
  type EvalContext,
  type FormulaValue,
} from '../../src/core/formula';
import { scanColumns } from '../../src/core/formula/columnar';
import { matchesCriterion, parseCriterion, type Criterion } from '../../src/core/formula/criteria';
import type { ColumnData } from '../../src/core/formula/value';
import { ColumnStore } from '../../src/core/workbook/column-store';
import { RsfDocument } from '../../src/core/workbook/rsf-document';
import type { Worksheet } from '../../src/core/workbook/worksheet';
import { pick, seededRandom as random, showValue as show } from '../workbook-values';

// ----- The kernel -----

const TEXTS = ['東京', '大阪', 'osaka', 'Osaka', 'a*b', 'ab', 'abc', '10', '', ' ', 'TRUE', 'x?z', 'xyz'];
const NUMBERS = [0, -0, 1, 2, 3, 10, -5, 0.1, 0.2, 0.30000000000000004, 1e15, 2.5, 100, 1e-7];
const CRITERIA: readonly FormulaValue[] = [
  ...[
    '',
    '=',
    '<>',
    '東京',
    '=大阪',
    '<>大阪',
    'OSAKA',
    'a*',
    '*b',
    'a~*b',
    'x?z',
    '?',
    '*',
    '<>*',
    '<>a*',
  ].map((value): FormulaValue => ({ type: 'string', value })),
  ...['10', '=10', '<>10', '>2', '>=2', '<2', '<=2', '>0.1', '<=0.30000000000000004', '>=-5', '<0'].map(
    (value): FormulaValue => ({ type: 'string', value }),
  ),
  ...['>abc', '<=osaka', '>=東京', '<a', '=TRUE', 'true', '<>FALSE', '=1', '=0'].map(
    (value): FormulaValue => ({ type: 'string', value }),
  ),
  { type: 'number', value: 10 },
  { type: 'number', value: 0 },
  { type: 'number', value: 0.1 },
  { type: 'boolean', value: true },
  { type: 'boolean', value: false },
  { type: 'empty' },
];

/** One random cell value; `errors` is how often it is an error. */
function randomValue(rand: () => number, errors: number): FormulaValue {
  const roll = rand();
  if (roll < errors) {
    return errorValue(pick(rand, ['#DIV/0!', '#VALUE!', '#N/A', '#CYCLE!'] as const));
  }
  const kind = rand();
  if (kind < 0.4) {
    return { type: 'number', value: pick(rand, NUMBERS) };
  }
  if (kind < 0.75) {
    return { type: 'string', value: pick(rand, TEXTS) };
  }
  if (kind < 0.85) {
    return { type: 'boolean', value: rand() < 0.5 };
  }
  return { type: 'empty' };
}

/** The documented scan, written out plainly: the reference `scanColumns` must agree with. */
function referenceScan(
  pairs: ReadonlyArray<{ cells: readonly FormulaValue[]; criterion: Criterion }>,
  values: readonly FormulaValue[] | null,
): { error: FormulaValue } | { error: null; hits: number; total: number; numbers: number } {
  let hits = 0;
  let total = 0;
  let numbers = 0;
  for (let i = 0; i < pairs[0].cells.length; i++) {
    let all = true;
    for (const pair of pairs) {
      const cell = pair.cells[i];
      if (cell.type === 'error') {
        return { error: cell };
      }
      if (!matchesCriterion(cell, pair.criterion)) {
        all = false;
        break;
      }
    }
    if (!all) {
      continue;
    }
    hits += 1;
    const value = values?.[i];
    if (value?.type === 'error') {
      return { error: value };
    }
    if (value?.type === 'number') {
      total += value.value;
      numbers += 1;
    } else if (value?.type === 'boolean') {
      total += value.value ? 1 : 0;
      numbers += 1;
    }
  }
  return { error: null, hits, total, numbers };
}

function showScan(scan: ReturnType<typeof referenceScan>): string {
  return scan.error
    ? show(scan.error)
    : `hits ${scan.hits}, total ${show({ type: 'number', value: scan.total })}, numbers ${scan.numbers}`;
}

/** A column of `cells`, stored from row `offset` on, as the engine's store holds it. */
function typedColumn(
  cells: readonly FormulaValue[],
  offset: number,
): { store: ColumnStore; view: () => ColumnData } {
  const store = new ColumnStore(4);
  const read = (row: number): FormulaValue => cells[row - offset];
  return { store, view: () => store.view(offset, offset + cells.length - 1, read) };
}

function criterionOf(value: FormulaValue): Criterion {
  const parsed = parseCriterion(value);
  if (!parsed.ok) {
    throw new Error('unreachable: every criterion here parses');
  }
  return parsed.criterion;
}

describe('scanColumns agrees with the cell-by-cell scan', () => {
  it('for every criterion against every kind of cell, one column at a time', () => {
    const rand = random(1);
    const cells: FormulaValue[] = [];
    for (const value of NUMBERS) cells.push({ type: 'number', value });
    for (const value of TEXTS) cells.push({ type: 'string', value });
    cells.push({ type: 'boolean', value: true }, { type: 'boolean', value: false }, { type: 'empty' });
    while (cells.length < 100) cells.push(randomValue(rand, 0));
    const column = typedColumn(cells, 3);
    for (const value of CRITERIA) {
      const criterion = criterionOf(value);
      const got = scanColumns([{ column: column.view(), criterion }], column.view());
      expect(showScan(got), show(value)).toBe(showScan(referenceScan([{ cells, criterion }], cells)));
    }
  });

  it('on random columns, with and without errors, and with the masks reused', () => {
    const rand = random(20251115);
    for (let trial = 0; trial < 300; trial++) {
      const rows = 1 + Math.floor(rand() * 200);
      // Half the trials have no error anywhere (the bit-mask path); the others
      // put errors in the criteria ranges, the summed range, or both.
      const criteriaErrors = rand() < 0.5 ? 0 : rand() * 0.05;
      const valueErrors = rand() < 0.5 ? 0 : rand() * 0.05;
      const pairCount = 1 + Math.floor(rand() * 3);
      const data = Array.from({ length: pairCount }, () =>
        Array.from({ length: rows }, () => randomValue(rand, criteriaErrors)),
      );
      const summed = rand() < 0.2 ? null : Array.from({ length: rows }, () => randomValue(rand, valueErrors));
      const columns = data.map((cells) => typedColumn(cells, Math.floor(rand() * 70)));
      const valueColumn = summed ? typedColumn(summed, Math.floor(rand() * 70)) : null;
      // Several formulas over the same columns: the second and later ones find
      // the masks the first one left with the column.
      for (let formula = 0; formula < 4; formula++) {
        const criteria = data.map(() => criterionOf(pick(rand, CRITERIA)));
        const got = scanColumns(
          columns.map((column, k) => ({ column: column.view(), criterion: criteria[k] })),
          valueColumn ? valueColumn.view() : null,
        );
        const want = referenceScan(
          data.map((cells, k) => ({ cells, criterion: criteria[k] })),
          summed,
        );
        expect(showScan(got), `trial ${trial}, formula ${formula}`).toBe(showScan(want));
      }
    }
  });

  it('sees a changed row after the store is told about it', () => {
    const rand = random(7);
    const cells = Array.from({ length: 500 }, () => randomValue(rand, 0));
    const column = typedColumn(cells, 0);
    const criterion = criterionOf({ type: 'string', value: '東京' });
    const before = scanColumns([{ column: column.view(), criterion }], null);
    expect(showScan(before)).toBe(showScan(referenceScan([{ cells, criterion }], null)));
    for (let edit = 0; edit < 40; edit++) {
      const row = Math.floor(rand() * cells.length);
      cells[row] = rand() < 0.5 ? { type: 'string', value: '東京' } : randomValue(rand, 0.02);
      column.store.invalidate(row, row);
      const got = scanColumns([{ column: column.view(), criterion }], column.view());
      expect(showScan(got), `edit ${edit}`).toBe(showScan(referenceScan([{ cells, criterion }], cells)));
    }
  });
});

// ----- Whole formulas in a workbook -----

const DATA_ROWS = 1400;

/** One random cell input for the data sheet (`errors`: how often an error formula). */
function randomInput(rand: () => number, errors: number): string {
  if (rand() < errors) {
    return pick(rand, ['=1/0', '="a"+1', '=NOSUCH()', '=MATCH("none",A1:A3,0)']);
  }
  const kind = rand();
  if (kind < 0.4) {
    return pick(rand, ['0', '1', '2', '3', '10', '-5', '0.1', '0.2', '2.5', '100', '1e15']);
  }
  if (kind < 0.7) {
    return pick(rand, [
      '東京',
      '大阪',
      'osaka',
      'Osaka',
      'a*b',
      'ab',
      'abc',
      'xyz',
      '2025-04-01',
      '2025-09-30',
    ]);
  }
  if (kind < 0.8) {
    return pick(rand, ['=TRUE', '=FALSE', '=1=1', '=""', '="10"', '="東"&"京"', '=1+0.2']);
  }
  return '';
}

const FORMULA_CRITERIA = [
  '"東京"',
  '"<>大阪"',
  '"OSAKA"',
  '"a*"',
  '"a~*b"',
  '"?????"',
  '""',
  '"<>"',
  '"="',
  '10',
  '"=10"',
  '"<>10"',
  '">2"',
  '">=2"',
  '"<2.5"',
  '"<=0.2"',
  '">=2025-04-01"',
  '"<=2025-09-30"',
  '">abc"',
  'TRUE',
  '"<>FALSE"',
  'Calc!H1',
  'Calc!H2',
  '">"&Calc!H3',
  'Calc!H4',
];

/** A range of `length` rows in column `col` of the data sheet, starting at a random row. */
function rangeText(rand: () => number, col: string, length: number): string {
  if (length === DATA_ROWS && rand() < 0.3) {
    return `Data!${col}:${col}`;
  }
  const top = 1 + Math.floor(rand() * (DATA_ROWS - length + 1));
  return `Data!${col}${top}:${col}${top + length - 1}`;
}

function randomFormula(rand: () => number): string {
  const cols = ['A', 'B', 'C', 'D', 'E'];
  // Ranges of one formula share a length but not their rows or columns.
  const length = rand() < 0.3 ? DATA_ROWS : 1024 + Math.floor(rand() * (DATA_ROWS - 1024));
  const range = (): string => rangeText(rand, pick(rand, cols), length);
  const criterion = (): string => pick(rand, FORMULA_CRITERIA);
  const pairs = (count: number): string =>
    Array.from({ length: count }, () => `${range()},${criterion()}`).join(',');
  switch (Math.floor(rand() * 6)) {
    case 0:
      return `=COUNTIF(${range()},${criterion()})`;
    case 1:
      return `=COUNTIFS(${pairs(1 + Math.floor(rand() * 3))})`;
    case 2:
      return rand() < 0.5
        ? `=SUMIF(${range()},${criterion()})`
        : `=SUMIF(${range()},${criterion()},${range()})`;
    case 3:
      return `=AVERAGEIF(${range()},${criterion()},${range()})`;
    case 4:
      return `=SUMIFS(${range()},${pairs(1 + Math.floor(rand() * 3))})`;
    default:
      return `=AVERAGEIFS(${range()},${pairs(1 + Math.floor(rand() * 2))})`;
  }
}

/** A context that reads the workbook's cells but offers no typed columns. */
function cellByCell(doc: RsfDocument, sheet: Worksheet): EvalContext {
  return {
    getCell: (row, col) => doc.evaluateInSheet(sheet, row, col),
    rowCount: sheet.rowCount,
    columnCount: sheet.columnCount,
    getSheetCell: (name, row, col) => {
      const target = doc.sheetByName(name);
      return target ? doc.evaluateInSheet(target, row, col) : errorValue('#REF!');
    },
    getSheetBounds: (name) => {
      const target = doc.sheetByName(name);
      return target ? { rowCount: target.rowCount, columnCount: target.columnCount } : null;
    },
  };
}

function expectAgreement(doc: RsfDocument, calc: Worksheet, formulas: readonly string[], when: string): void {
  const reference = cellByCell(doc, calc);
  const differing: string[] = [];
  formulas.forEach((src, row) => {
    const parsed = parseFormula(src);
    if (!parsed.ok) {
      throw new Error(`the test wrote a formula that does not parse: ${src}`);
    }
    const want = show(evaluateAst(parsed.ast, reference));
    const got = show(doc.evaluateInSheet(calc, row, 0));
    if (got !== want) {
      differing.push(`${src}: typed columns ${got}, cell by cell ${want}`);
    }
  });
  expect(differing, when).toEqual([]);
}

/**
 * The cell-by-cell reference reads every row of every range for every formula
 * in every round, which takes a few seconds in all and several times that
 * under coverage.
 */
const LONG_TEST_MS = 60_000;

describe('criteria functions over long columns agree with the cell-by-cell path', () => {
  // How often each data column holds an error. With errors, columns A, B and D
  // stay clean, C has a handful and E many — so one formula can mix a column
  // the bit masks cover with one that needs the position-by-position scan.
  const cases: Array<[string, readonly number[]]> = [
    ['without errors', [0, 0, 0, 0, 0]],
    ['with scattered errors', [0, 0, 0.002, 0, 0.02]],
  ];
  for (const [name, errorRates] of cases) {
    const errors = Math.max(...errorRates);
    it(
      `on random data ${name}, before and after edits`,
      () => {
        const rand = random(errors === 0 ? 11 : 12);
        const doc = RsfDocument.empty('book.rsf', DATA_ROWS, 5, 'Data');
        const data = doc.sheets[0];
        for (let row = 0; row < DATA_ROWS; row++) {
          for (let col = 0; col < 5; col++) {
            doc.setCellOn(data.id, row, col, randomInput(rand, errorRates[col]));
          }
        }
        const formulas = Array.from({ length: 120 }, () => randomFormula(rand));
        const calc = doc.createWorksheet('Calc', formulas.length, 8);
        doc.insertSheetAt(1, calc);
        formulas.forEach((src, row) => doc.setCellOn(calc.id, row, 0, src));
        ['東京', '10', '2', ''].forEach((value, row) => doc.setCellOn(calc.id, row, 7, value));

        expectAgreement(doc, calc, formulas, 'as loaded');
        // Some results must be real tallies, or the comparison proves nothing.
        const numbers = formulas.filter((_, row) => {
          const value = doc.evaluateInSheet(calc, row, 0);
          return value.type === 'number' && value.value !== 0;
        });
        expect(numbers.length).toBeGreaterThan(errors === 0 ? 40 : 10);
        if (errors > 0) {
          expect(formulas.length - numbers.length).toBeGreaterThan(10);
        }

        for (let round = 0; round < 25; round++) {
          const edits = 1 + Math.floor(rand() * 4);
          for (let i = 0; i < edits; i++) {
            if (rand() < 0.2) {
              doc.setCellOn(
                calc.id,
                Math.floor(rand() * 4),
                7,
                pick(rand, ['東京', '大阪', '10', '2', '0.2', '']),
              );
            } else {
              const row = Math.floor(rand() * DATA_ROWS);
              doc.setCellOn(data.id, row, Math.floor(rand() * 5), randomInput(rand, errors));
            }
          }
          expectAgreement(doc, calc, formulas, `after round ${round}`);
        }
      },
      LONG_TEST_MS,
    );
  }

  it('adds in row order, so a sum has the same last bit either way', () => {
    const doc = RsfDocument.empty('book.rsf', 1200, 2, 'Data');
    const data = doc.sheets[0];
    // 0.1 added 1200 times is not 120 exactly, and the error depends on the order.
    for (let row = 0; row < 1200; row++) {
      doc.setCellOn(data.id, row, 0, row % 3 === 0 ? 'x' : 'y');
      doc.setCellOn(data.id, row, 1, row % 7 === 0 ? '1e15' : '0.1');
    }
    const calc = doc.createWorksheet('Calc', 2, 1);
    doc.insertSheetAt(1, calc);
    const formulas = ['=SUMIFS(Data!B1:B1200,Data!A1:A1200,"x")', '=AVERAGEIF(Data!A:A,"y",Data!B:B)'];
    formulas.forEach((src, row) => doc.setCellOn(calc.id, row, 0, src));
    expectAgreement(doc, calc, formulas, 'floating-point sums');
    let expected = 0;
    for (let row = 0; row < 1200; row += 3) {
      expected += row % 7 === 0 ? 1e15 : 0.1;
    }
    expect(doc.evaluateInSheet(calc, 0, 0)).toEqual({ type: 'number', value: expected });
  });

  it('reports the error the cell-by-cell scan meets first', () => {
    const doc = RsfDocument.empty('book.rsf', 1100, 3, 'Data');
    const data = doc.sheets[0];
    for (let row = 0; row < 1100; row++) {
      doc.setCellOn(data.id, row, 0, row < 600 ? 'x' : 'y');
      doc.setCellOn(data.id, row, 1, '1');
      doc.setCellOn(data.id, row, 2, '5');
    }
    doc.setCellOn(data.id, 700, 1, '=1/0'); // criteria range B, at a row column A rejects for "x"
    doc.setCellOn(data.id, 300, 2, '=NOSUCH()'); // summed range C, at a row that matches
    doc.setCellOn(data.id, 900, 2, '="a"+1'); // summed range C, at a row "x" never reaches
    const calc = doc.createWorksheet('Calc', 5, 1);
    doc.insertSheetAt(1, calc);
    const formulas = [
      // A fails at row 701 before B's error is looked at: B's error is never met.
      '=COUNTIFS(Data!A1:A1100,"x",Data!B1:B1100,1)',
      // B is tested first here, so its error is the result.
      '=COUNTIFS(Data!B1:B1100,1,Data!A1:A1100,"x")',
      // The summed range's error at a matching row is the result …
      '=SUMIFS(Data!C1:C1100,Data!A1:A1100,"x")',
      // … and at a row no criterion lets through it is not.
      '=SUMIFS(Data!C1:C1100,Data!A1:A1100,"y",Data!C1:C1100,5)',
      '=SUMIF(Data!A1:A1100,"x",Data!B1:B1100)',
    ];
    formulas.forEach((src, row) => doc.setCellOn(calc.id, row, 0, src));
    expectAgreement(doc, calc, formulas, 'error precedence');
    expect(formulas.map((_, row) => show(doc.evaluateInSheet(calc, row, 0)))).toEqual([
      'number 600',
      'error #DIV/0!',
      'error #NAME?',
      'error #VALUE!',
      'number 600',
    ]);
  });
});
