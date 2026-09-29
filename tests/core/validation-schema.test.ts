// SPDX-License-Identifier: MIT
/**
 * Column schema: the rule kinds and flags beyond a list or a number range
 * (whole numbers, text length, dates, required, to the last row), and the
 * Check Data scan over a worksheet or a whole file.
 */
import { describe, expect, it } from 'vitest';
import {
  findColumnValidation,
  findValidation,
  isIsoDate,
  replacesValidation,
  shiftValidationsForInsert,
  validateValidation,
  validationProblem,
  type CellValidation,
  type ValidationRule,
} from '../../src/core/workbook/data-validation';
import { checkValidations } from '../../src/core/workbook/validation-check';
import { Worksheet } from '../../src/core/workbook/worksheet';

const at = (rule: ValidationRule, extra: Partial<CellValidation> = {}): CellValidation => ({
  top: 0,
  left: 0,
  bottom: 9,
  right: 0,
  rule,
  ...extra,
});

describe('validationProblem', () => {
  it('a blank passes unless the rule is required; whitespace counts as blank', () => {
    const list = at({ kind: 'list', values: ['a'] });
    expect(validationProblem(list, '')).toBeNull();
    expect(validationProblem(list, '  ')).toBeNull();
    expect(validationProblem({ ...list, required: true }, '')).toBe('required');
    expect(validationProblem({ ...list, required: true }, ' ')).toBe('required');
    expect(validationProblem({ ...list, required: true }, 'a')).toBeNull();
    expect(validationProblem(list, 'b')).toBe('notInList');
  });

  it('number: any number with no bound, whole numbers when asked, inclusive bounds', () => {
    const any = at({ kind: 'number', min: null, max: null });
    expect(validationProblem(any, '-3.5')).toBeNull();
    expect(validationProblem(any, 'x')).toBe('notNumber');
    const whole = at({ kind: 'number', min: 1, max: 10, integer: true });
    expect(validationProblem(whole, '10')).toBeNull();
    expect(validationProblem(whole, '2.5')).toBe('notInteger');
    expect(validationProblem(whole, '0')).toBe('tooSmall');
    expect(validationProblem(whole, '11')).toBe('tooLarge');
  });

  it('text length counts characters, not UTF-16 units', () => {
    const rule = at({ kind: 'textLength', min: 2, max: 3 });
    expect(validationProblem(rule, 'a')).toBe('tooShort');
    expect(validationProblem(rule, 'abcd')).toBe('tooLong');
    expect(validationProblem(rule, '日本語')).toBeNull();
    expect(validationProblem(rule, '😀😀')).toBeNull(); // 4 UTF-16 units, 2 characters
  });

  it('date: YYYY-MM-DD only, compared as days', () => {
    const rule = at({ kind: 'date', min: '2026-01-01', max: '2026-12-31' });
    expect(validationProblem(rule, '2026-09-29')).toBeNull();
    expect(validationProblem(rule, '2026/09/29')).toBe('notDate');
    expect(validationProblem(rule, '2026-02-30')).toBe('notDate');
    expect(validationProblem(rule, '2025-12-31')).toBe('tooEarly');
    expect(validationProblem(rule, '2027-01-01')).toBe('tooLate');
    expect(validationProblem(at({ kind: 'date', min: null, max: null }), '2024-02-29')).toBeNull();
  });
});

describe('isIsoDate', () => {
  it('accepts real calendar days only', () => {
    expect(isIsoDate('2024-02-29')).toBe(true);
    expect(isIsoDate('2023-02-29')).toBe(false);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('2026-1-01')).toBe(false);
    expect(isIsoDate('+026-01-01')).toBe(false);
  });
});

describe('validateValidation for the schema kinds', () => {
  it('requires a text-length bound, whole and non-negative', () => {
    const len = (min: number | null, max: number | null) =>
      validateValidation(at({ kind: 'textLength', min, max }), 10, 1);
    expect(len(0, 5)).not.toBeNull();
    expect(len(null, null)).toBeNull();
    expect(len(-1, 5)).toBeNull();
    expect(len(1.5, null)).toBeNull();
    expect(len(5, 2)).toBeNull();
  });

  it('checks date bounds and the flags', () => {
    expect(validateValidation(at({ kind: 'date', min: '2026-01-01', max: null }), 10, 1)).not.toBeNull();
    expect(validateValidation(at({ kind: 'date', min: '2026-12-01', max: '2026-01-01' }), 10, 1)).toBeNull();
    expect(validateValidation(at({ kind: 'date', min: 'soon', max: null }), 10, 1)).toBeNull();
    const flags = { required: false } as unknown as Partial<CellValidation>;
    expect(validateValidation(at({ kind: 'number', min: null, max: null }, flags), 10, 1)).toBeNull();
  });
});

describe('column rules', () => {
  const column = at({ kind: 'list', values: ['x'] }, { top: 1, bottom: 4, toEnd: true });

  it('cover every row below the header, even past the recorded last row', () => {
    expect(findValidation([column], 0, 0)).toBeNull();
    expect(findValidation([column], 1, 0)).toBe(column);
    expect(findValidation([column], 500, 0)).toBe(column);
    expect(findValidation([{ ...column, toEnd: undefined }], 500, 0)).toBeNull();
  });

  it('grow when rows are added right below them', () => {
    expect(shiftValidationsForInsert([column], 'row', 5, 2)[0]).toMatchObject({ top: 1, bottom: 6 });
    const range = { ...column, toEnd: undefined };
    expect(shiftValidationsForInsert([range], 'row', 5, 2)[0]).toMatchObject({ top: 1, bottom: 4 });
  });

  it('are found for the same columns, and replace a rule on those columns', () => {
    expect(findColumnValidation([column], 0, 0)).toBe(column);
    expect(findColumnValidation([column], 0, 1)).toBeNull();
    const next = at({ kind: 'number', min: null, max: null }, { top: 0, bottom: 4, toEnd: true });
    expect(replacesValidation(next, column)).toBe(true);
    expect(replacesValidation(next, { ...column, left: 1, right: 1 })).toBe(false);
  });
});

describe('checkValidations', () => {
  function sheet(id: string, rows: string[][], rules: CellValidation[]): Worksheet {
    const s = Worksheet.fromValues(id, `Sheet ${id}`, rows, rows[0].length);
    s.validations = rules;
    return s;
  }

  it('lists each broken cell in reading order, stopping at the last row with data', () => {
    const s = sheet(
      'a',
      [
        ['Qty', 'Code'],
        ['3', 'AB'],
        ['x', ''],
        ['', 'ABCD'],
        ['', ''],
        ['', ''],
      ],
      [
        at({ kind: 'number', min: 0, max: null, integer: true }, { top: 1, bottom: 5, toEnd: true }),
        at(
          { kind: 'textLength', min: null, max: 3 },
          { top: 1, bottom: 5, left: 1, right: 1, required: true },
        ),
      ],
    );
    const { issues, truncated } = checkValidations([s]);
    expect(truncated).toBe(false);
    expect(issues.map((i) => [i.row, i.col, i.problem])).toEqual([
      [2, 0, 'notNumber'],
      [2, 1, 'required'],
      [3, 1, 'tooLong'],
    ]);
    expect(issues[0]).toMatchObject({ sheetId: 'a', sheetName: 'Sheet a', value: 'x' });
  });

  it('still reports a required column that is entirely blank', () => {
    const s = sheet(
      'a',
      [
        ['1', ''],
        ['2', ''],
      ],
      [at({ kind: 'list', values: ['y'] }, { left: 1, right: 1, bottom: 1, required: true })],
    );
    expect(checkValidations([s]).issues.map((i) => [i.row, i.col])).toEqual([
      [0, 1],
      [1, 1],
    ]);
  });

  it('shares one limit across worksheets and says when it stopped', () => {
    const rule = at({ kind: 'list', values: ['ok'] }, { bottom: 2 });
    const first = sheet('a', [['no'], ['no'], ['ok']], [rule]);
    const second = sheet('b', [['no'], ['no'], ['no']], [rule]);
    expect(checkValidations([first, second], 10).issues).toHaveLength(5);
    const cut = checkValidations([first, second], 3);
    expect(cut.truncated).toBe(true);
    expect(cut.issues.map((i) => i.sheetId)).toEqual(['a', 'a', 'b']);
    expect(checkValidations([sheet('c', [['no']], [])]).issues).toEqual([]);
  });
});
