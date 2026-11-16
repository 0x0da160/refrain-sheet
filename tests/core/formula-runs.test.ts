// SPDX-License-Identifier: MIT
/**
 * Formula templates and runs: a column of filled-down formulas shares one
 * parsed formula, evaluated with a row shift.
 *
 * - A template rewritten for another row is exactly the text a fill-down
 *   writes there, and evaluating the shared tree with a shift gives exactly
 *   what parsing that text gives.
 * - The run index, edited cell by cell, always describes the worksheet's
 *   formula cells: every formula cell is in one run whose template, written
 *   for that row, is the cell's own text.
 */
import { describe, expect, it } from 'vitest';
import {
  evaluateAst,
  evaluateAstArray,
  isFormula,
  parseFormula,
  type EvalContext,
  type FormulaValue,
} from '../../src/core/formula';
import { MAX_REF_ROW } from '../../src/core/formula/refs';
import { compileTemplate, templateSource } from '../../src/core/formula/template';
import { FormulaRunIndex, type FormulaSource } from '../../src/core/workbook/formula-runs';
import { pick, seededRandom, showValue } from '../workbook-values';

describe('templateSource', () => {
  const shifted = (src: string, shift: number): string => templateSource(compileTemplate(src), shift);

  it('moves relative rows and leaves everything else as written', () => {
    const cases: Array<[string, string]> = [
      ['=E2*F2', '=E5*F5'],
      ['=$A$1+B$2+$C3+D4', '=$A$1+B$2+$C6+D7'],
      ['=SUM(A$1:A7)', '=SUM(A$1:A10)'],
      ['=SUM(A7:A$1)', '=SUM(A10:A$1)'],
      ['=SUM(B2:D10)/COUNT(B2:D10)', '=SUM(B5:D13)/COUNT(B5:D13)'],
      ['=SUM(2:2)+SUM($3:$3)+SUM($4:9)', '=SUM(5:5)+SUM($3:$3)+SUM($4:12)'],
      ['=SUM(A:A)+B2', '=SUM(A:A)+B5'],
      ["=Data!A2+'My Sheet'!$B$2+'It''s 2'!C2", "=Data!A5+'My Sheet'!$B$2+'It''s 2'!C5"],
      ['="A2"&A2&"B3:B4"', '="A2"&A5&"B3:B4"'],
      ['=A2*2+10', '=A5*2+10'],
      ['=ROUND(A2,2)&TEXT(B2,"0.00")', '=ROUND(A5,2)&TEXT(B5,"0.00")'],
      ['=  a2 + B2 ', '=  a5 + B5 '],
      [
        '=IF(A2>1,VLOOKUP(B2,Master!$A$1:$C$9,3,FALSE),"")',
        '=IF(A5>1,VLOOKUP(B5,Master!$A$1:$C$9,3,FALSE),"")',
      ],
      ['=TODAY()', '=TODAY()'],
      ['=1+2', '=1+2'],
    ];
    for (const [src, want] of cases) {
      expect(shifted(src, 0), src).toBe(src);
      expect(shifted(src, 3), src).toBe(want);
    }
  });

  it('keeps a formula that does not parse as it is', () => {
    for (const src of ['=(', '=A2+', '=SUM(A2', '=A2 B2']) {
      const template = compileTemplate(src);
      expect(template.parsed.ok, src).toBe(false);
      expect(templateSource(template, 0)).toBe(src);
    }
  });

  it('allows shifts only as far as the last valid row', () => {
    const template = compileTemplate('=A5+B2');
    const last = templateSource(template, template.maxShift);
    expect(last).toBe('=A9999999+B9999996');
    const parsed = parseFormula(last);
    expect(parsed.ok && parsed.ast).toMatchObject({ left: { kind: 'ref', row: 9_999_998 } });
    expect(9_999_998).toBeLessThanOrEqual(MAX_REF_ROW);
    // One row further the text no longer names a cell, so it must not be
    // taken for a copy of the formula above it.
    const beyond = templateSource(template, template.maxShift + 1);
    expect(beyond).toBe('=A10000000+B9999997');
    expect(parseFormula(beyond).ok).toBe(false);
    expect(compileTemplate('=1+2').maxShift).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('records what the formula reads and whether it is volatile', () => {
    const template = compileTemplate("=SUM(A$1:B7)+'Other'!C3+SUM(D:E)+SUM(4:5)+NOW()");
    expect(template.volatile).toBe(true);
    expect(template.precedents).toEqual([
      { sheet: undefined, left: 0, right: 1, rows: { a: 0, absA: true, b: 6, absB: false } },
      { sheet: 'Other', left: 2, right: 2, rows: { a: 2, absA: false, b: 2, absB: false } },
      { sheet: undefined, left: 3, right: 4, rows: null },
      { sheet: undefined, left: 0, right: Infinity, rows: { a: 3, absA: false, b: 4, absB: false } },
    ]);
    expect(compileTemplate('=IF(A1>0,TODAY(),0)').volatile).toBe(true);
    expect(compileTemplate('=A1+1').volatile).toBe(false);
  });
});

describe('evaluating a template with a row shift', () => {
  /** A worksheet of pseudo-random values, the same for every read of a cell. */
  const cell = (sheet: string, row: number, col: number): FormulaValue => {
    const n = (row * 31 + col * 17 + sheet.length * 7) % 11;
    if (n === 0) return { type: 'empty' };
    if (n === 1) return { type: 'string', value: `t${row % 3}` };
    if (n === 2) return { type: 'boolean', value: row % 2 === 0 };
    if (n === 3) return { type: 'error', code: '#DIV/0!' };
    return { type: 'number', value: ((row * 7 + col * 3) % 23) / 4 };
  };
  const ctx: EvalContext = {
    getCell: (row, col) => cell('', row, col),
    rowCount: 40,
    columnCount: 8,
    getSheetCell: (name, row, col) =>
      name === 'Other' ? cell(name, row, col) : { type: 'error', code: '#REF!' },
    getSheetBounds: (name) => (name === 'Other' ? { rowCount: 30, columnCount: 6 } : null),
    nowMs: Date.UTC(2026, 0, 15),
  };

  it('gives exactly what parsing the shifted text gives', () => {
    const formulas = [
      '=A2+B2',
      '=A2*$B$3-C$4',
      '=SUM(A2:C4)',
      '=SUM(A$1:A2)',
      '=SUM($B2:D$9)',
      '=AVERAGE(B:B)+A2',
      '=SUM(2:2)',
      '=SUM($3:5)',
      '=IF(A2>2,B2,C2)',
      '=IFERROR(A2/B2,"none")',
      '=COUNTIF(A2:A9,">1")+COUNTIFS(B$1:B$20,">0",C$1:C$20,"<5")',
      '=SUMIF(A:A,">1",B:B)',
      '=Other!A2+Other!$B$2',
      '=SUM(Other!A2:B5)',
      '=Missing!A2',
      '=A2&"-"&B2',
      '=VLOOKUP(A2,$A$1:$C$30,2,FALSE)',
      '=INDEX(A2:C6,2,2)',
      '=MAX(A2:A6)-MIN(A2:A6)',
      '=-A2+(B2)',
      '=A2=B2',
      '=SORT(A2:A6)',
      '=A2:A4>1',
      '=SEQUENCE(2)+A2',
    ];
    for (const src of formulas) {
      const template = compileTemplate(src);
      expect(template.parsed.ok, src).toBe(true);
      if (!template.parsed.ok) continue;
      for (const shift of [0, 1, 2, 7, 25, 38, 60]) {
        const text = templateSource(template, shift);
        const direct = parseFormula(text);
        expect(direct.ok, text).toBe(true);
        if (!direct.ok) continue;
        expect(showValue(evaluateAst(template.parsed.ast, ctx, shift)), text).toBe(
          showValue(evaluateAst(direct.ast, ctx)),
        );
        const shared = evaluateAstArray(template.parsed.ast, ctx, shift);
        const own = evaluateAstArray(direct.ast, ctx);
        expect(
          shared.grid?.cells.map((row) => row.map(showValue)),
          text,
        ).toEqual(own.grid?.cells.map((row) => row.map(showValue)));
        expect(showValue(shared.value), text).toBe(showValue(own.value));
      }
    }
  });
});

// ----- The run index -----

class Grid implements FormulaSource {
  readonly cells: string[][];
  constructor(
    readonly rowCount: number,
    readonly columnCount: number,
  ) {
    this.cells = Array.from({ length: rowCount }, () => new Array<string>(columnCount).fill(''));
  }
  getValue(row: number, col: number): string {
    return this.cells[row][col];
  }
  formulaRowCounts(): number[] {
    return this.cells.map((row) => row.filter(isFormula).length);
  }
}

/** Every formula cell is in exactly one run that reproduces its text; no other cell is in a run. */
function expectIndexDescribes(index: FormulaRunIndex, grid: Grid, when: string): void {
  const problems: string[] = [];
  const runs = index.runs();
  for (let col = 0; col < grid.columnCount; col++) {
    const column = runs[col] ?? [];
    for (let i = 0; i < column.length; i++) {
      const run = column[i];
      if (run.col !== col || run.start > run.end || run.baseRow > run.start) {
        problems.push(`column ${col}: malformed run ${run.start}..${run.end} (base ${run.baseRow})`);
      }
      if (i > 0 && column[i - 1].end >= run.start) {
        problems.push(`column ${col}: runs overlap or are out of order at row ${run.start}`);
      }
    }
    for (let row = 0; row < grid.rowCount; row++) {
      const src = grid.cells[row][col];
      const run = index.runAt(row, col);
      if (!isFormula(src)) {
        if (run) problems.push(`r${row}c${col} holds no formula but is in a run`);
        continue;
      }
      if (!run) {
        problems.push(`r${row}c${col} = ${src} is in no run`);
      } else if (
        row < run.start ||
        row > run.end ||
        templateSource(run.template, row - run.baseRow) !== src
      ) {
        problems.push(`r${row}c${col} = ${src} is in a run that writes something else there`);
      }
    }
  }
  expect(problems.slice(0, 5), when).toEqual([]);
}

describe('FormulaRunIndex', () => {
  it('groups filled-down formulas and nothing else', () => {
    const grid = new Grid(12, 3);
    for (let row = 1; row < 10; row++) {
      grid.cells[row][0] = `=B${row + 1}*2`;
    }
    grid.cells[5][0] = '=B6*3'; // looks alike, is not a copy
    grid.cells[2][2] = '=SUM(B$1:B3)';
    grid.cells[3][2] = '=SUM(B$1:B4)';
    grid.cells[4][2] = '=SUM(B$1:B6)'; // skips a row: not the next copy
    grid.cells[7][2] = '=$B$1';
    grid.cells[8][2] = '=$B$1'; // no relative row: the same text is the copy
    const index = new FormulaRunIndex(grid);
    expectIndexDescribes(index, grid, 'as built');
    const spans = index.runs().map((column) => column.map((run) => [run.start, run.end]));
    expect(spans).toEqual([
      [
        [1, 4],
        [5, 5],
        [6, 9],
      ],
      [],
      [
        [2, 3],
        [4, 4],
        [7, 8],
      ],
    ]);
    // One parsed formula for the whole run.
    expect(index.runAt(1, 0)?.template).toBe(index.runAt(4, 0)?.template);
    expect(index.runAt(0, 0)).toBeNull();
    expect(index.runAt(5, 1)).toBeNull();
  });

  it('rejoins a run when the cell cut out of it gets its formula back', () => {
    const grid = new Grid(10, 1);
    for (let row = 0; row < 10; row++) {
      grid.cells[row][0] = `=A${row + 1}+1`;
    }
    const index = new FormulaRunIndex(grid);
    expect(index.runs()[0]).toHaveLength(1);
    const write = (row: number, input: string): void => {
      const was = isFormula(grid.cells[row][0]);
      grid.cells[row][0] = input;
      index.cellChanged(row, 0, input, was, isFormula(input));
    };
    write(4, '99');
    expect(index.runs()[0].map((run) => [run.start, run.end])).toEqual([
      [0, 3],
      [5, 9],
    ]);
    write(4, '=A5+1');
    expect(index.runs()[0].map((run) => [run.start, run.end])).toEqual([[0, 9]]);
    expectIndexDescribes(index, grid, 'after the cell is restored');
  });

  it('stays true to the worksheet through random edits', () => {
    const rand = seededRandom(404);
    for (let trial = 0; trial < 6; trial++) {
      const grid = new Grid(40, 4);
      const index = new FormulaRunIndex(grid);
      index.runs(); // built once; from here on it is edited cell by cell
      const formulaFor = [
        (r: number) => `=A${r}+1`,
        (r: number) => `=SUM(B$1:B${r})`,
        (r: number) => `=C${r}*D${r + 1}`,
        () => '=$A$1',
        () => '=(',
      ];
      for (let step = 0; step < 400; step++) {
        const col = Math.floor(rand() * grid.columnCount);
        const row = Math.floor(rand() * grid.rowCount);
        const roll = rand();
        const count = roll < 0.3 ? 1 + Math.floor(rand() * 6) : 1;
        const formula = pick(rand, formulaFor);
        for (let r = row; r < Math.min(grid.rowCount, row + count); r++) {
          const input = roll < 0.6 ? formula(r + 1) : roll < 0.8 ? '' : 'text';
          const was = isFormula(grid.cells[r][col]);
          if (grid.cells[r][col] !== input) {
            grid.cells[r][col] = input;
            index.cellChanged(r, col, input, was, isFormula(input));
          }
        }
        if (step % 7 === 0) {
          expectIndexDescribes(index, grid, `trial ${trial}, step ${step}`);
        }
      }
      expectIndexDescribes(index, grid, `trial ${trial}, at the end`);
      // The runs a column is cut into may differ from a fresh build's, but both describe the same cells.
      expectIndexDescribes(new FormulaRunIndex(grid), grid, `trial ${trial}, rebuilt`);
    }
  });

  it('lists the runs that cover a span of rows', () => {
    const grid = new Grid(30, 1);
    for (const row of [2, 3, 4, 10, 11, 20]) {
      grid.cells[row][0] = `=A${row + 1}`;
    }
    grid.cells[11][0] = '=A1';
    const index = new FormulaRunIndex(grid);
    const spans = (top: number, bottom: number): number[][] =>
      index.runsBetween(0, top, bottom).map((run) => [run.start, run.end]);
    expect(spans(0, 29)).toEqual([
      [2, 4],
      [10, 10],
      [11, 11],
      [20, 20],
    ]);
    expect(spans(4, 10)).toEqual([
      [2, 4],
      [10, 10],
    ]);
    expect(spans(5, 9)).toEqual([]);
    expect(spans(21, 29)).toEqual([]);
    expect(index.runsBetween(3, 0, 29)).toEqual([]);
  });
});
