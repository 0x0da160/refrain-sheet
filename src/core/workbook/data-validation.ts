// SPDX-License-Identifier: MIT
/**
 * Data validation: an optional rule attached to a rectangular range that
 * restricts which values a cell in that range accepts — a fixed list of
 * choices (the spreadsheet-standard "dropdown"), a number (optionally whole,
 * optionally in a range), a text length, or a `YYYY-MM-DD` date. A rule can
 * also make its cells required, and a column rule (`toEnd`) covers its
 * columns down to the last row, which is how a column schema is written.
 *
 * A worksheet's rules (`Worksheet.validations`) are saved in the RSF
 * container (the worksheet's `validations` key) and follow row and column
 * insertion and deletion the way a formula's range does: an insert inside a
 * rule's range grows it, a delete shrinks it, and a rule whose cells are all
 * deleted goes away. A worksheet may carry several rules at once (one per
 * range); when ranges overlap, the most recently applied rule wins for the
 * overlapping cells, like later paint on top of earlier paint.
 *
 * A blank value passes every rule unless the rule is `required`, matching
 * every mainstream spreadsheet's default.
 *
 * Everything here is pure and DOM-free; list membership and numeric parsing
 * never use regular expressions, `eval`, or any dynamic code.
 */

/** Maximum rules a single worksheet may carry at once. */
export const MAX_VALIDATION_RULES = 64;
/** Maximum distinct list values one `list` rule may carry. */
export const MAX_VALIDATION_LIST_VALUES = 500;
/** Maximum characters in one list value (the same bound as a comment). */
export const MAX_VALIDATION_VALUE_LENGTH = 2000;

/** Restrict a cell to one of a fixed set of values (the "dropdown" case). */
interface ListValidationRule {
  kind: 'list';
  values: string[];
}

/**
 * Restrict a cell to a number within an optional [min, max] range, and
 * optionally to whole numbers. With no bound it only asks for a number.
 */
interface NumberValidationRule {
  kind: 'number';
  min: number | null;
  max: number | null;
  integer?: boolean;
}

/** Restrict a cell's text to between `min` and `max` characters (at least one set). */
interface TextLengthValidationRule {
  kind: 'textLength';
  min: number | null;
  max: number | null;
}

/**
 * Restrict a cell to a date written `YYYY-MM-DD` (how Ctrl+; enters one),
 * within an optional [min, max] range, also `YYYY-MM-DD`.
 */
interface DateValidationRule {
  kind: 'date';
  min: string | null;
  max: string | null;
}

export type ValidationRule =
  ListValidationRule | NumberValidationRule | TextLengthValidationRule | DateValidationRule;

/** One rule applied to a rectangular range (inclusive document coordinates). */
export interface CellValidation {
  top: number;
  left: number;
  bottom: number;
  right: number;
  rule: ValidationRule;
  /** A blank cell fails the rule (otherwise a blank always passes). */
  required?: boolean;
  /**
   * A column rule: the range runs from `top` to the last row, so rows added
   * below the current end are covered too (`bottom` is the last row when the
   * rule was applied, and grows with inserts).
   */
  toEnd?: boolean;
}

/** Why a value fails its rule (see {@link validationProblem}). */
export type ValidationProblem =
  | 'required'
  | 'notInList'
  | 'notNumber'
  | 'notInteger'
  | 'tooSmall'
  | 'tooLarge'
  | 'tooShort'
  | 'tooLong'
  | 'notDate'
  | 'tooEarly'
  | 'tooLate';

/** The longest text-length bound a rule may set (the longest cell text). */
export const MAX_VALIDATION_TEXT_LENGTH = 1_000_000;

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
    if (
      rule.values.some((v) => typeof v !== 'string' || v === '' || v.length > MAX_VALIDATION_VALUE_LENGTH)
    ) {
      return null;
    }
  } else if (rule.kind === 'number') {
    if (!boundsOk(rule.min, rule.max, (n) => Number.isFinite(n))) {
      return null;
    }
    if (rule.integer !== undefined && rule.integer !== true) {
      return null;
    }
  } else if (rule.kind === 'textLength') {
    const length = (n: number): boolean => intish(n) && n <= MAX_VALIDATION_TEXT_LENGTH;
    if (!boundsOk(rule.min, rule.max, length) || (rule.min === null && rule.max === null)) {
      return null;
    }
  } else if (rule.kind === 'date') {
    if (!boundsOk(rule.min, rule.max, isIsoDate)) {
      return null;
    }
  } else {
    return null;
  }
  if (candidate.required !== undefined && candidate.required !== true) {
    return null;
  }
  if (candidate.toEnd !== undefined && candidate.toEnd !== true) {
    return null;
  }
  return candidate;
}

/** Each bound is null or passes `ok`, and min is not above max. */
function boundsOk<T extends number | string>(min: T | null, max: T | null, ok: (v: T) => boolean): boolean {
  if ((min !== null && !ok(min)) || (max !== null && !ok(max))) {
    return false;
  }
  return min === null || max === null || min <= max;
}

/** A real calendar date written `YYYY-MM-DD`. */
export function isIsoDate(text: string): boolean {
  if (typeof text !== 'string' || text.length !== 10 || text[4] !== '-' || text[7] !== '-') {
    return false;
  }
  const [y, m, d] = [text.slice(0, 4), text.slice(5, 7), text.slice(8, 10)].map((part) =>
    /^[0-9]+$/.test(part) ? Number(part) : NaN,
  );
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d) || m < 1 || m > 12 || d < 1) {
    return false;
  }
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
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
    if (row >= v.top && (v.toEnd === true || row <= v.bottom) && col >= v.left && col <= v.right) {
      return v;
    }
  }
  return null;
}

/** The column rule (`toEnd`) covering exactly columns `left`–`right`, or null. */
export function findColumnValidation(
  rules: readonly CellValidation[],
  left: number,
  right: number,
): CellValidation | null {
  return rules.find((v) => v.toEnd === true && v.left === left && v.right === right) ?? null;
}

/** Whether applying `next` replaces `rule`: the same range, or a column rule on the same columns. */
export function replacesValidation(next: CellValidation, rule: CellValidation): boolean {
  return next.toEnd === true
    ? findColumnValidation([rule], next.left, next.right) !== null
    : rule.toEnd !== true && validationRangesEqual(next, rule);
}

/** Whether `value` satisfies `rule`. A blank value always passes. */
export function checkValidationValue(rule: ValidationRule, value: string): boolean {
  return validationProblem({ rule }, value) === null;
}

/**
 * Why `value` fails `validation`, or null when it passes. A blank value
 * passes unless the rule is `required`. The value is the cell's input as
 * typed (a formula is checked as its text, the same as when it is entered).
 */
export function validationProblem(
  validation: Pick<CellValidation, 'rule' | 'required'>,
  value: string,
): ValidationProblem | null {
  const { rule } = validation;
  const trimmed = value.trim();
  if (trimmed === '') {
    return validation.required === true ? 'required' : null;
  }
  switch (rule.kind) {
    case 'list':
      return rule.values.includes(value) ? null : 'notInList';
    case 'number': {
      const n = Number(trimmed);
      if (!Number.isFinite(n)) {
        return 'notNumber';
      }
      if (rule.integer === true && !Number.isInteger(n)) {
        return 'notInteger';
      }
      return rule.min !== null && n < rule.min
        ? 'tooSmall'
        : rule.max !== null && n > rule.max
          ? 'tooLarge'
          : null;
    }
    case 'textLength': {
      const length = [...value].length;
      return rule.min !== null && length < rule.min
        ? 'tooShort'
        : rule.max !== null && length > rule.max
          ? 'tooLong'
          : null;
    }
    case 'date':
      if (!isIsoDate(trimmed)) {
        return 'notDate';
      }
      return rule.min !== null && trimmed < rule.min
        ? 'tooEarly'
        : rule.max !== null && trimmed > rule.max
          ? 'tooLate'
          : null;
  }
}

/** Whether two rule lists are the same, rule for rule. */
export function validationListsEqual(a: readonly CellValidation[], b: readonly CellValidation[]): boolean {
  return a.length === b.length && a.every((v, i) => JSON.stringify(v) === JSON.stringify(b[i]));
}

/** The rules after `count` rows or columns were inserted at `index` on `axis`. */
export function shiftValidationsForInsert(
  rules: readonly CellValidation[],
  axis: 'row' | 'col',
  index: number,
  count: number,
): CellValidation[] {
  return rules.map((v) => {
    const [start, end] = axis === 'row' ? [v.top, v.bottom] : [v.left, v.right];
    // At or before the start moves the whole range; inside it grows the
    // range, and so does adding rows at the end of a column rule.
    const from = start >= index ? start + count : start;
    const grows = end >= index || (axis === 'row' && v.toEnd === true && index === end + 1);
    const to = grows ? end + count : end;
    return withSpan(v, axis, from, to);
  });
}

/**
 * The rules after `count` rows or columns starting at `index` were deleted
 * on `axis`. A range shrinks by the deleted part; one left with no cells is
 * dropped.
 */
export function shiftValidationsForDelete(
  rules: readonly CellValidation[],
  axis: 'row' | 'col',
  index: number,
  count: number,
): CellValidation[] {
  const out: CellValidation[] = [];
  const last = index + count; // one past the deleted span
  for (const v of rules) {
    const [start, end] = axis === 'row' ? [v.top, v.bottom] : [v.left, v.right];
    const from = start < index ? start : start < last ? index : start - count;
    const to = end < index ? end : end < last ? index - 1 : end - count;
    if (from <= to) {
      out.push(withSpan(v, axis, from, to));
    }
  }
  return out;
}

/**
 * The rules after moving `count` rows or columns from `from` to the
 * boundary `to` (a reorder: the moved span is deleted, then inserted where
 * `to` lands once it is gone). A rule wholly inside the span moves with it;
 * any other rule follows the delete and the insert.
 */
export function moveValidations(
  rules: readonly CellValidation[],
  axis: 'row' | 'col',
  from: number,
  count: number,
  to: number,
): CellValidation[] {
  const dest = to > from ? to - count : to;
  const out: CellValidation[] = [];
  for (const v of rules) {
    const [start, end] = axis === 'row' ? [v.top, v.bottom] : [v.left, v.right];
    if (start >= from && end < from + count) {
      out.push(withSpan(v, axis, start - from + dest, end - from + dest));
    } else {
      const kept = shiftValidationsForDelete([v], axis, from, count);
      out.push(...shiftValidationsForInsert(kept, axis, dest, count));
    }
  }
  return out;
}

function withSpan(v: CellValidation, axis: 'row' | 'col', from: number, to: number): CellValidation {
  return axis === 'row' ? { ...v, top: from, bottom: to } : { ...v, left: from, right: to };
}
