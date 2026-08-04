// SPDX-License-Identifier: MIT
/**
 * Data validation: an optional rule attached to a rectangular range that
 * restricts which values a cell in that range accepts — a fixed list of
 * choices (the spreadsheet-standard "dropdown"), or a numeric range.
 *
 * Mirrors `sort.ts`'s session-only-view-state model: a worksheet's rules
 * (`Worksheet.validations`) live only in memory, are never persisted in the
 * RSF container (they never reach `rsf-codec.ts`), and are simply dropped —
 * rather than shifted — whenever the worksheet's row/column structure
 * changes underneath them, exactly like a sort's stored range. Unlike a
 * sort, a worksheet may carry several rules at once (one per range); when
 * ranges overlap, the most recently applied rule wins for the overlapping
 * cells, like later paint on top of earlier paint.
 *
 * A blank value always passes every rule, matching every mainstream
 * spreadsheet: clearing a cell is never itself an invalid edit.
 *
 * Everything here is pure and DOM-free; list membership and numeric parsing
 * never use regular expressions, `eval`, or any dynamic code.
 */

/** Maximum rules a single worksheet may carry at once. */
export const MAX_VALIDATION_RULES = 64;
/** Maximum distinct list values one `list` rule may carry. */
export const MAX_VALIDATION_LIST_VALUES = 500;

/** Restrict a cell to one of a fixed set of values (the "dropdown" case). */
export interface ListValidationRule {
  kind: 'list';
  values: string[];
}

/** Restrict a cell to a numeric value within an optional [min, max] range. */
export interface NumberValidationRule {
  kind: 'number';
  min: number | null;
  max: number | null;
}

export type ValidationRule = ListValidationRule | NumberValidationRule;

/** One rule applied to a rectangular range (inclusive document coordinates). */
export interface CellValidation {
  top: number;
  left: number;
  bottom: number;
  right: number;
  rule: ValidationRule;
}

/** True when two ranges cover exactly the same rectangle. */
export function validationRangesEqual(
  a: Pick<CellValidation, 'top' | 'left' | 'bottom' | 'right'>,
  b: Pick<CellValidation, 'top' | 'left' | 'bottom' | 'right'>,
): boolean {
  return a.top === b.top && a.left === b.left && a.bottom === b.bottom && a.right === b.right;
}

/**
 * Structural validation of a (possibly untrusted) rule against the sheet
 * dimensions and the documented bounds. Returns the rule when fully valid,
 * or null when anything is out of bounds or malformed.
 */
export function validateValidation(
  candidate: CellValidation,
  rowCount: number,
  columnCount: number,
): CellValidation | null {
  const intish = (n: number): boolean => Number.isInteger(n) && n >= 0;
  const { top, left, bottom, right, rule } = candidate;
  if (!intish(top) || !intish(left) || !intish(bottom) || !intish(right)) {
    return null;
  }
  if (top > bottom || left > right) {
    return null;
  }
  if (bottom >= rowCount || right >= columnCount) {
    return null;
  }
  if (rule.kind === 'list') {
    if (
      !Array.isArray(rule.values) ||
      rule.values.length === 0 ||
      rule.values.length > MAX_VALIDATION_LIST_VALUES
    ) {
      return null;
    }
    if (rule.values.some((v) => typeof v !== 'string' || v === '')) {
      return null;
    }
  } else if (rule.kind === 'number') {
    if (rule.min !== null && !Number.isFinite(rule.min)) {
      return null;
    }
    if (rule.max !== null && !Number.isFinite(rule.max)) {
      return null;
    }
    if (rule.min === null && rule.max === null) {
      return null;
    }
    if (rule.min !== null && rule.max !== null && rule.min > rule.max) {
      return null;
    }
  } else {
    return null;
  }
  return candidate;
}

/**
 * The rule that applies to one cell, or null when none does. When several
 * rules cover the same cell, the last one in `rules` (the most recently
 * applied) wins.
 */
export function findValidation(
  rules: readonly CellValidation[],
  row: number,
  col: number,
): CellValidation | null {
  for (let i = rules.length - 1; i >= 0; i--) {
    const v = rules[i];
    if (row >= v.top && row <= v.bottom && col >= v.left && col <= v.right) {
      return v;
    }
  }
  return null;
}

/** Whether `value` satisfies `rule`. A blank value always passes. */
export function checkValidationValue(rule: ValidationRule, value: string): boolean {
  if (value.trim() === '') {
    return true;
  }
  if (rule.kind === 'list') {
    return rule.values.includes(value);
  }
  const n = Number(value.trim());
  if (!Number.isFinite(n)) {
    return false;
  }
  if (rule.min !== null && n < rule.min) {
    return false;
  }
  if (rule.max !== null && n > rule.max) {
    return false;
  }
  return true;
}
