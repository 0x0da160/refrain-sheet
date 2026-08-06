// SPDX-License-Identifier: MIT
/**
 * Conditional formatting: the pure rule core (structural validation,
 * cell-value/duplicate/color-scale matching, color interpolation). The
 * command-level dialog flow is covered in `conditional-format-command.test.ts`,
 * mirroring the `data-validation.ts` / `data-validation.test.ts` split.
 */
import { describe, expect, it } from 'vitest';
import {
  colorScaleColor,
  colorScaleRange,
  conditionalFormatRangesEqual,
  duplicateKey,
  findDuplicateKeys,
  interpolateHexColor,
  matchesCellValueRule,
  validateConditionalFormat,
  type CellConditionalFormat,
  type CellValueRule,
  type ColorScaleRule,
} from '../src/core/conditional-format';
import type { FormulaValue } from '../src/core/formula-value';

const num = (value: number): FormulaValue => ({ type: 'number', value });
const str = (value: string): FormulaValue => ({ type: 'string', value });
const empty: FormulaValue = { type: 'empty' };
const bool = (value: boolean): FormulaValue => ({ type: 'boolean', value });

describe('conditionalFormatRangesEqual', () => {
  it('compares only the rectangle, not the rule', () => {
    const r1 = { top: 0, left: 0, bottom: 2, right: 2 };
    const r2 = { top: 0, left: 0, bottom: 2, right: 2 };
    const r3 = { top: 0, left: 0, bottom: 3, right: 2 };
    expect(conditionalFormatRangesEqual(r1, r2)).toBe(true);
    expect(conditionalFormatRangesEqual(r1, r3)).toBe(false);
  });
});

describe('matchesCellValueRule', () => {
  const style = { backgroundColor: '#ff0000' };

  it('greaterThan / lessThan / equal compare a number cell against value1', () => {
    const gt: CellValueRule = { kind: 'cellValue', operator: 'greaterThan', value1: '10', style };
    expect(matchesCellValueRule(gt, num(11))).toBe(true);
    expect(matchesCellValueRule(gt, num(10))).toBe(false);

    const lt: CellValueRule = { kind: 'cellValue', operator: 'lessThan', value1: '10', style };
    expect(matchesCellValueRule(lt, num(9))).toBe(true);
    expect(matchesCellValueRule(lt, num(10))).toBe(false);

    const eq: CellValueRule = { kind: 'cellValue', operator: 'equal', value1: '10', style };
    expect(matchesCellValueRule(eq, num(10))).toBe(true);
    expect(matchesCellValueRule(eq, num(10.5))).toBe(false);
  });

  it('between is inclusive and order-independent', () => {
    const rule: CellValueRule = { kind: 'cellValue', operator: 'between', value1: '10', value2: '1', style };
    expect(matchesCellValueRule(rule, num(1))).toBe(true);
    expect(matchesCellValueRule(rule, num(10))).toBe(true);
    expect(matchesCellValueRule(rule, num(5))).toBe(true);
    expect(matchesCellValueRule(rule, num(11))).toBe(false);
  });

  it('textContains is a case-insensitive substring match, and also matches numbers as text', () => {
    const rule: CellValueRule = { kind: 'cellValue', operator: 'textContains', value1: 'oo', style };
    expect(matchesCellValueRule(rule, str('Foobar'))).toBe(true);
    expect(matchesCellValueRule(rule, str('bar'))).toBe(false);
    const digits: CellValueRule = { kind: 'cellValue', operator: 'textContains', value1: '12', style };
    expect(matchesCellValueRule(digits, num(123))).toBe(true);
  });

  it('blank, boolean, and error cells never match a numeric operator', () => {
    const rule: CellValueRule = { kind: 'cellValue', operator: 'greaterThan', value1: '0', style };
    expect(matchesCellValueRule(rule, empty)).toBe(false);
    expect(matchesCellValueRule(rule, bool(true))).toBe(false);
    expect(matchesCellValueRule(rule, { type: 'error', code: '#VALUE!' })).toBe(false);
  });
});

describe('duplicateKey / findDuplicateKeys', () => {
  it('numbers and text never collide even when they print the same', () => {
    expect(duplicateKey(num(1))).not.toBe(duplicateKey(str('1')));
  });

  it('blank cells never participate in duplicate detection', () => {
    expect(duplicateKey(empty)).toBeNull();
    expect(duplicateKey(str(''))).toBeNull();
  });

  it('finds exactly the keys that occur more than once, ignoring blanks', () => {
    const keys = [
      duplicateKey(num(1)),
      duplicateKey(num(2)),
      duplicateKey(num(1)),
      duplicateKey(str('x')),
      duplicateKey(empty),
    ];
    const dup = findDuplicateKeys(keys);
    expect(dup.has(duplicateKey(num(1))!)).toBe(true);
    expect(dup.has(duplicateKey(num(2))!)).toBe(false);
    expect(dup.has(duplicateKey(str('x'))!)).toBe(false);
    expect(dup.size).toBe(1);
  });
});

describe('color scale', () => {
  it('interpolateHexColor blends linearly and clamps t to [0, 1]', () => {
    expect(interpolateHexColor('#000000', '#ffffff', 0)).toBe('#000000');
    expect(interpolateHexColor('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(interpolateHexColor('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(interpolateHexColor('#000000', '#ffffff', 2)).toBe('#ffffff');
    expect(interpolateHexColor('#000000', '#ffffff', -1)).toBe('#000000');
  });

  it('colorScaleRange is the [min, max] of the values, or null when empty', () => {
    expect(colorScaleRange([3, 1, 2])).toEqual({ min: 1, max: 3 });
    expect(colorScaleRange([])).toBeNull();
  });

  it('colorScaleColor maps a value proportionally between minColor and maxColor', () => {
    const rule: ColorScaleRule = { kind: 'colorScale', minColor: '#000000', maxColor: '#ffffff' };
    expect(colorScaleColor(rule, 0, { min: 0, max: 10 })).toBe('#000000');
    expect(colorScaleColor(rule, 10, { min: 0, max: 10 })).toBe('#ffffff');
    expect(colorScaleColor(rule, 5, { min: 0, max: 10 })).toBe('#808080');
  });

  it('a degenerate (min === max) range paints every cell minColor', () => {
    const rule: ColorScaleRule = { kind: 'colorScale', minColor: '#112233', maxColor: '#ffffff' };
    expect(colorScaleColor(rule, 7, { min: 7, max: 7 })).toBe('#112233');
  });
});

describe('validateConditionalFormat', () => {
  const base = { top: 0, left: 0, bottom: 1, right: 1 };
  const style = { backgroundColor: '#ff0000' };

  it('accepts an in-bounds cellValue, duplicate, and colorScale rule', () => {
    const cellValue: CellConditionalFormat = {
      ...base,
      rule: { kind: 'cellValue', operator: 'greaterThan', value1: '10', style },
    };
    expect(validateConditionalFormat(cellValue, 4, 4)).not.toBeNull();

    const duplicate: CellConditionalFormat = { ...base, rule: { kind: 'duplicate', style } };
    expect(validateConditionalFormat(duplicate, 4, 4)).not.toBeNull();

    const scale: CellConditionalFormat = {
      ...base,
      rule: { kind: 'colorScale', minColor: '#000000', maxColor: '#ffffff' },
    };
    expect(validateConditionalFormat(scale, 4, 4)).not.toBeNull();
  });

  it('rejects out-of-range coordinates and top > bottom / left > right', () => {
    const rule = { kind: 'duplicate' as const, style };
    expect(validateConditionalFormat({ ...base, rule, bottom: 99 }, 4, 4)).toBeNull();
    expect(validateConditionalFormat({ ...base, rule, right: 99 }, 4, 4)).toBeNull();
    expect(validateConditionalFormat({ ...base, rule, top: 3, bottom: 1 }, 4, 4)).toBeNull();
  });

  it('rejects a cellValue rule with a non-numeric operand, a missing between bound, or blank textContains text', () => {
    expect(
      validateConditionalFormat(
        { ...base, rule: { kind: 'cellValue', operator: 'greaterThan', value1: 'abc', style } },
        4,
        4,
      ),
    ).toBeNull();
    expect(
      validateConditionalFormat(
        { ...base, rule: { kind: 'cellValue', operator: 'between', value1: '1', value2: 'abc', style } },
        4,
        4,
      ),
    ).toBeNull();
    expect(
      validateConditionalFormat(
        { ...base, rule: { kind: 'cellValue', operator: 'textContains', value1: '  ', style } },
        4,
        4,
      ),
    ).toBeNull();
  });

  it('rejects a rule whose style carries neither color, or an invalid hex color', () => {
    expect(
      validateConditionalFormat({ ...base, rule: { kind: 'duplicate', style: {} } }, 4, 4),
    ).toBeNull();
    expect(
      validateConditionalFormat(
        { ...base, rule: { kind: 'duplicate', style: { backgroundColor: 'red' } } },
        4,
        4,
      ),
    ).toBeNull();
  });

  it('rejects a colorScale rule with an invalid hex color', () => {
    expect(
      validateConditionalFormat(
        { ...base, rule: { kind: 'colorScale', minColor: 'black', maxColor: '#ffffff' } },
        4,
        4,
      ),
    ).toBeNull();
  });
});
