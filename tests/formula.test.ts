// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import {
  adjustFormulaForAxis,
  cellLabel,
  columnIndex,
  columnLabel,
  evaluateAst,
  formatValue,
  isFormula,
  literalToValue,
  MAX_FORMULA_LENGTH,
  parseFormula,
  parseRef,
  shiftFormulaRefs,
  type EvalContext,
  type FormulaValue,
} from '../src/core/formula';

/** Evaluate a formula against a small sheet given as a record of A1-keys. */
function evalIn(cells: Record<string, string>, src: string): FormulaValue {
  const ctx: EvalContext = {
    getCell(row, col) {
      const input = cells[cellLabel(row, col)] ?? '';
      if (isFormula(input)) {
        const parsed = parseFormula(input);
        if (!parsed.ok) {
          return { type: 'error', code: parsed.code };
        }
        return evaluateAst(parsed.ast, ctx);
      }
      return literalToValue(input);
    },
  };
  const parsed = parseFormula(src);
  if (!parsed.ok) {
    return { type: 'error', code: parsed.code };
  }
  return evaluateAst(parsed.ast, ctx);
}

function display(cells: Record<string, string>, src: string): string {
  return formatValue(evalIn(cells, src));
}

/** Evaluate against a sheet with explicit used-grid bounds (for whole-column/row ranges). */
function displayBounded(
  cells: Record<string, string>,
  src: string,
  rowCount: number,
  columnCount: number,
): string {
  const ctx: EvalContext = {
    getCell(row, col) {
      const input = cells[cellLabel(row, col)] ?? '';
      if (isFormula(input)) {
        const parsed = parseFormula(input);
        if (!parsed.ok) {
          return { type: 'error', code: parsed.code };
        }
        return evaluateAst(parsed.ast, ctx);
      }
      return literalToValue(input);
    },
    rowCount,
    columnCount,
  };
  const parsed = parseFormula(src);
  if (!parsed.ok) {
    return parsed.code;
  }
  return formatValue(evaluateAst(parsed.ast, ctx));
}

describe('column/cell notation', () => {
  it('maps column labels both ways including multi-letter boundaries', () => {
    const pairs: Array<[number, string]> = [
      [0, 'A'],
      [25, 'Z'],
      [26, 'AA'],
      [51, 'AZ'],
      [52, 'BA'],
      [701, 'ZZ'],
      [702, 'AAA'],
    ];
    for (const [index, label] of pairs) {
      expect(columnLabel(index)).toBe(label);
      expect(columnIndex(label)).toBe(index);
    }
  });

  it('parses A1-style references', () => {
    expect(parseRef('A1')).toEqual({ row: 0, col: 0 });
    expect(parseRef('B2')).toEqual({ row: 1, col: 1 });
    expect(parseRef('AA10')).toEqual({ row: 9, col: 26 });
    expect(parseRef('a1')).toEqual({ row: 0, col: 0 });
    expect(parseRef('A0')).toBeNull();
    expect(parseRef('1A')).toBeNull();
    expect(parseRef('')).toBeNull();
    expect(parseRef('ABCD1')).toBeNull(); // beyond the 3-letter column limit
  });
});

describe('parsing', () => {
  it('accepts the documented grammar', () => {
    for (const ok of [
      '=1',
      '=1.5',
      '=.5',
      '=1+2*3',
      '=(1+2)*3',
      '=-A1',
      '=+3',
      '=A1+B2',
      '=AA10',
      '=SUM(A1:B10)',
      '=sum(a1:b2)',
      '=IF(A1>3,"big","small")',
      '=IF(A1=1,2)',
      '=MIN(A1,B1,5)',
      '=1<>2',
      '=1<=2',
      '="quo""ted"',
      '=#REF!',
      '=SUM()',
    ]) {
      expect(parseFormula(ok).ok, ok).toBe(true);
    }
  });

  it('rejects invalid formulas with #ERROR!', () => {
    for (const bad of ['=', '=1+', '=(1', '=1)', '=A1:', '=1 2', '="open', '=A1..B2', '=@x', '=IF(1)']) {
      const result = parseFormula(bad);
      expect(result.ok, bad).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('#ERROR!');
      }
    }
  });

  it('reports unsupported functions as #NAME?', () => {
    const result = parseFormula('=VLOOKUP(A1,B1:C9,2)');
    expect(result).toEqual({ ok: false, code: '#NAME?' });
    // A bare name that is not a valid cell reference is also a name error.
    expect(parseFormula('=hello')).toEqual({ ok: false, code: '#NAME?' });
    expect(parseFormula('=A0')).toEqual({ ok: false, code: '#NAME?' });
  });

  it('bounds formula length and nesting depth', () => {
    expect(parseFormula('=' + '1+'.repeat(MAX_FORMULA_LENGTH) + '1').ok).toBe(false);
    expect(parseFormula('=' + '('.repeat(200) + '1' + ')'.repeat(200)).ok).toBe(false);
    expect(parseFormula('=' + '('.repeat(20) + '1' + ')'.repeat(20)).ok).toBe(true);
  });
});

describe('evaluation', () => {
  it('applies arithmetic with standard precedence and parentheses', () => {
    expect(display({}, '=1+2*3')).toBe('7');
    expect(display({}, '=(1+2)*3')).toBe('9');
    expect(display({}, '=2*3-4/2')).toBe('4');
    expect(display({}, '=-(1+2)')).toBe('-3');
    expect(display({}, '=10/4')).toBe('2.5');
  });

  it('resolves cell references, coercing numeric strings and empties', () => {
    const cells = { A1: '4', B2: ' 2.5 ', C1: '', D1: 'text' };
    expect(display(cells, '=A1+B2')).toBe('6.5');
    expect(display(cells, '=A1+C1')).toBe('4'); // empty counts as 0
    expect(display(cells, '=A1+D1')).toBe('#VALUE!');
    expect(display(cells, '=Z99')).toBe(''); // out-of-sheet reference behaves as an empty cell
    expect(display(cells, '=Z99+1')).toBe('1'); // ...which coerces to 0 in arithmetic
  });

  it('divides by zero into #DIV/0!', () => {
    expect(display({}, '=1/0')).toBe('#DIV/0!');
    expect(display({ A1: '0' }, '=5/A1')).toBe('#DIV/0!');
  });

  it('propagates errors through operators and functions', () => {
    const cells = { A1: '=1/0' };
    expect(display(cells, '=A1+1')).toBe('#DIV/0!');
    expect(display(cells, '=SUM(A1:A1)')).toBe('#DIV/0!');
    expect(display({}, '=#REF!+1')).toBe('#REF!');
  });

  it('computes SUM, AVERAGE, MIN, MAX, COUNT over ranges and scalars', () => {
    const cells = { A1: '1', A2: '2', A3: '3', B1: 'x', B2: '', B3: '4' };
    expect(display(cells, '=SUM(A1:A3)')).toBe('6');
    expect(display(cells, '=SUM(A1:B3)')).toBe('10'); // strings/empties skipped
    expect(display(cells, '=SUM(A1:A2,B3,5)')).toBe('12');
    expect(display(cells, '=AVERAGE(A1:A3)')).toBe('2');
    expect(display(cells, '=AVERAGE(B1:B2)')).toBe('#DIV/0!'); // nothing numeric
    expect(display(cells, '=MIN(A1:A3)')).toBe('1');
    expect(display(cells, '=MAX(A1:B3)')).toBe('4');
    expect(display(cells, '=COUNT(A1:B3)')).toBe('4');
    expect(display(cells, '=COUNT(A1:A3,B1)')).toBe('3'); // scalar string not counted
    expect(display(cells, '=SUM(A3:A1)')).toBe('6'); // reversed range normalizes
  });

  it('evaluates IF with comparisons and numeric conditions', () => {
    const cells = { A1: '5' };
    expect(display(cells, '=IF(A1>3,"big","small")')).toBe('big');
    expect(display(cells, '=IF(A1<3,"big","small")')).toBe('small');
    expect(display(cells, '=IF(A1-5,1,2)')).toBe('2'); // 0 is false
    expect(display(cells, '=IF(A1=5,1)')).toBe('1');
    expect(display(cells, '=IF(A1<>5,1)')).toBe('FALSE'); // missing else
    expect(display(cells, '=IF("nope",1,2)')).toBe('#VALUE!');
  });

  it('compares strings and mixed types with documented semantics', () => {
    expect(display({}, '="a"<"b"')).toBe('TRUE');
    expect(display({}, '="a"="a"')).toBe('TRUE');
    expect(display({ A1: 'x' }, '=A1=1')).toBe('FALSE');
    expect(display({ A1: 'x' }, '=A1<>1')).toBe('TRUE');
    expect(display({ A1: 'x' }, '=A1>1')).toBe('#VALUE!');
    expect(display({ A1: '' }, '=A1=""')).toBe('TRUE');
  });

  it('rejects a bare range in scalar context', () => {
    expect(display({}, '=A1:B2')).toBe('#VALUE!');
    expect(display({}, '=A1:B2+1')).toBe('#VALUE!');
  });
});

describe('whole-column and whole-row ranges', () => {
  it('parses whole-column and whole-row ranges', () => {
    for (const src of ['=SUM(A:A)', '=SUM(A:C)', '=SUM(1:1)', '=SUM(2:10)', '=AVERAGE(B:B)']) {
      expect(parseFormula(src).ok).toBe(true);
    }
    // Mixed cell/whole references are invalid.
    expect(parseFormula('=SUM(A1:A)').ok).toBe(false);
    expect(parseFormula('=SUM(A:A1)').ok).toBe(false);
    expect(parseFormula('=SUM(1:A)').ok).toBe(false);
  });

  it('sums a whole column bounded to the used grid', () => {
    // 4 rows x 2 cols. Column A holds 1,2,3 then empty; B holds text/number.
    const cells = { A1: '1', A2: '2', A3: '3', B1: 'x', B2: '10' };
    expect(displayBounded(cells, '=SUM(A:A)', 4, 2)).toBe('6');
    expect(displayBounded(cells, '=SUM(A:B)', 4, 2)).toBe('16');
    expect(displayBounded(cells, '=COUNT(A:A)', 4, 2)).toBe('3');
    expect(displayBounded(cells, '=AVERAGE(A:A)', 4, 2)).toBe('2');
    expect(displayBounded(cells, '=MAX(A:B)', 4, 2)).toBe('10');
  });

  it('sums a whole row bounded to the used grid', () => {
    const cells = { A1: '1', B1: '2', C1: '3', A2: '100' };
    expect(displayBounded(cells, '=SUM(1:1)', 2, 3)).toBe('6');
    expect(displayBounded(cells, '=SUM(1:2)', 2, 3)).toBe('106');
    expect(displayBounded(cells, '=COUNT(1:1)', 2, 3)).toBe('3');
  });

  it('clamps to the used grid rather than an unbounded sheet', () => {
    const cells = { A1: '5', A2: '5' };
    // Only 2 used rows: a whole-column sum sees exactly those.
    expect(displayBounded(cells, '=SUM(A:A)', 2, 1)).toBe('10');
    // A column beyond the used grid is empty (SUM = 0).
    expect(displayBounded(cells, '=SUM(D:D)', 2, 1)).toBe('0');
    // No used grid at all resolves to empty.
    expect(displayBounded(cells, '=SUM(A:A)', 0, 0)).toBe('0');
  });

  it('treats a bare whole-range in scalar context as #VALUE!', () => {
    expect(displayBounded({ A1: '1' }, '=A:A', 1, 1)).toBe('#VALUE!');
    expect(displayBounded({ A1: '1' }, '=1:1+1', 1, 1)).toBe('#VALUE!');
  });

  it('adjusts whole-column ranges on column insert/delete', () => {
    expect(adjustFormulaForAxis('=SUM(A:A)', 'col', 'insert', 0, 1)).toBe('=SUM(B:B)');
    expect(adjustFormulaForAxis('=SUM(A:C)', 'col', 'delete', 1, 1)).toBe('=SUM(A:B)');
    expect(adjustFormulaForAxis('=SUM(B:B)', 'col', 'delete', 1, 1)).toBe('=SUM(#REF!)');
    // A row operation leaves whole-column ranges untouched.
    expect(adjustFormulaForAxis('=SUM(A:A)', 'row', 'insert', 0, 3)).toBe('=SUM(A:A)');
  });

  it('adjusts whole-row ranges on row insert/delete', () => {
    expect(adjustFormulaForAxis('=SUM(1:1)', 'row', 'insert', 0, 1)).toBe('=SUM(2:2)');
    expect(adjustFormulaForAxis('=SUM(1:3)', 'row', 'delete', 1, 1)).toBe('=SUM(1:2)');
    expect(adjustFormulaForAxis('=SUM(2:2)', 'row', 'delete', 1, 1)).toBe('=SUM(#REF!)');
    // A column operation leaves whole-row ranges untouched.
    expect(adjustFormulaForAxis('=SUM(1:1)', 'col', 'insert', 0, 3)).toBe('=SUM(1:1)');
  });

  it('shifts whole ranges on copy/paste deltas', () => {
    expect(shiftFormulaRefs('=SUM(A:A)', 0, 1)).toBe('=SUM(B:B)');
    expect(shiftFormulaRefs('=SUM(1:1)', 2, 0)).toBe('=SUM(3:3)');
    expect(shiftFormulaRefs('=SUM(A:A)', 0, -1)).toBe('=SUM(#REF!)');
  });
});

describe('reference rewriting', () => {
  it('shifts relative references on copy/paste deltas', () => {
    expect(shiftFormulaRefs('=A1+B2', 1, 1)).toBe('=B2+C3');
    expect(shiftFormulaRefs('=SUM(A1:B2)*2', 2, 0)).toBe('=SUM(A3:B4)*2');
    expect(shiftFormulaRefs('=A1', -1, 0)).toBe('=#REF!');
    expect(shiftFormulaRefs('=A1', 0, -1)).toBe('=#REF!');
    // Strings and function names are untouched.
    expect(shiftFormulaRefs('=IF(A1=1,"A1",SUM(B1:B2))', 1, 0)).toBe('=IF(A2=1,"A1",SUM(B2:B3))');
    // Unparseable formulas are left alone.
    expect(shiftFormulaRefs('=("broken', 1, 1)).toBe('=("broken');
  });

  it('adjusts references for row insertion', () => {
    expect(adjustFormulaForAxis('=A1+A5', 'row', 'insert', 1, 2)).toBe('=A1+A7');
    expect(adjustFormulaForAxis('=SUM(A1:A3)', 'row', 'insert', 1, 1)).toBe('=SUM(A1:A4)');
    expect(adjustFormulaForAxis('=SUM(A2:A3)', 'row', 'insert', 0, 1)).toBe('=SUM(A3:A4)');
    expect(adjustFormulaForAxis('=A1', 'row', 'insert', 5, 3)).toBe('=A1');
  });

  it('adjusts references for row deletion with #REF! and range clamping', () => {
    expect(adjustFormulaForAxis('=A5', 'row', 'delete', 1, 2)).toBe('=A3');
    expect(adjustFormulaForAxis('=A2', 'row', 'delete', 1, 1)).toBe('=#REF!');
    expect(adjustFormulaForAxis('=SUM(A1:A10)', 'row', 'delete', 1, 2)).toBe('=SUM(A1:A8)');
    expect(adjustFormulaForAxis('=SUM(A2:A3)', 'row', 'delete', 1, 2)).toBe('=SUM(#REF!)');
    expect(adjustFormulaForAxis('=SUM(A2:A5)', 'row', 'delete', 0, 2)).toBe('=SUM(A1:A3)');
    expect(adjustFormulaForAxis('=A2+SUM(A2:B2)', 'row', 'delete', 1, 1)).toBe('=#REF!+SUM(#REF!)');
  });

  it('adjusts references for column operations', () => {
    expect(adjustFormulaForAxis('=B1+C1', 'col', 'insert', 1, 1)).toBe('=C1+D1');
    expect(adjustFormulaForAxis('=B1', 'col', 'delete', 1, 1)).toBe('=#REF!');
    expect(adjustFormulaForAxis('=SUM(A1:C1)', 'col', 'delete', 1, 1)).toBe('=SUM(A1:B1)');
    expect(adjustFormulaForAxis('=SUM(Z1:AA2)', 'col', 'insert', 0, 1)).toBe('=SUM(AA1:AB2)');
  });
});

describe('literal coercion and formatting', () => {
  it('coerces literals like a spreadsheet', () => {
    expect(literalToValue('42')).toEqual({ type: 'number', value: 42 });
    expect(literalToValue(' 3.5 ')).toEqual({ type: 'number', value: 3.5 });
    expect(literalToValue('')).toEqual({ type: 'empty' });
    expect(literalToValue('abc')).toEqual({ type: 'string', value: 'abc' });
    expect(literalToValue('1e3')).toEqual({ type: 'number', value: 1000 });
  });

  it('formats values for display', () => {
    expect(formatValue({ type: 'number', value: 2.5 })).toBe('2.5');
    expect(formatValue({ type: 'boolean', value: true })).toBe('TRUE');
    expect(formatValue({ type: 'empty' })).toBe('');
    expect(formatValue({ type: 'error', code: '#CYCLE!' })).toBe('#CYCLE!');
  });
});
