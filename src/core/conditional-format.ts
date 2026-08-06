// SPDX-License-Identifier: MIT
/**
 * Conditional formatting: rules that change a cell's *display* background/text
 * color based on its computed value — never the value itself, formula
 * results, sort/filter order, or CSV/XLSX export (see Format > Cell styling,
 * `cell-style.ts`). Mirrors `data-validation.ts`'s session-only-view-state
 * model: a worksheet's rules (`Worksheet.conditionalFormats`) live only in
 * memory, are never persisted in the RSF container, and are dropped (not
 * shifted) whenever the worksheet's row/column structure changes underneath
 * them, exactly like a validation rule's stored range. A worksheet may carry
 * several rules at once (one per exact range); when ranges overlap, the most
 * recently applied rule that actually matches a given cell wins.
 *
 * Three rule kinds, matching the three examples in the feature request:
 *  - `cellValue`: color cells whose value satisfies a comparison (e.g. "> 100").
 *  - `duplicate`: color every value that appears more than once in the range.
 *  - `colorScale`: shade the background along a two-color gradient by where
 *    each numeric value falls between the range's minimum and maximum.
 *
 * Everything here is pure and DOM-free; evaluation reads already-computed
 * `FormulaValue`s (see `formula-value.ts`) supplied by the caller, so this
 * module never evaluates a formula itself.
 */
import type { FormulaValue } from './formula-value';

/** Maximum rules a single worksheet may carry at once (mirrors `MAX_VALIDATION_RULES`). */
export const MAX_CONDITIONAL_FORMAT_RULES = 64;

/** Background/text color a matching rule paints — a subset of `CellStyle`'s color keys. */
export interface ConditionalFormatStyle {
  backgroundColor?: string;
  textColor?: string;
}

export type CellValueOperator = 'greaterThan' | 'lessThan' | 'between' | 'equal' | 'textContains';

/** Color every cell whose value satisfies a comparison against one or two operands. */
export interface CellValueRule {
  kind: 'cellValue';
  operator: CellValueOperator;
  /** The comparison operand (numeric operators) or search text (`textContains`). */
  value1: string;
  /** The upper (or lower) bound for `between`; unused for every other operator. */
  value2?: string;
  style: ConditionalFormatStyle;
}

/** Color every value that appears more than once within the rule's range. */
export interface DuplicateRule {
  kind: 'duplicate';
  style: ConditionalFormatStyle;
}

/** Shade the background along a two-color gradient by relative numeric magnitude. */
export interface ColorScaleRule {
  kind: 'colorScale';
  minColor: string;
  maxColor: string;
}

export type ConditionalFormatRule = CellValueRule | DuplicateRule | ColorScaleRule;

/** One rule applied to a rectangular range (inclusive document coordinates). */
export interface CellConditionalFormat {
  top: number;
  left: number;
  bottom: number;
  right: number;
  rule: ConditionalFormatRule;
}

/** True when two ranges cover exactly the same rectangle. */
export function conditionalFormatRangesEqual(
  a: Pick<CellConditionalFormat, 'top' | 'left' | 'bottom' | 'right'>,
  b: Pick<CellConditionalFormat, 'top' | 'left' | 'bottom' | 'right'>,
): boolean {
  return a.top === b.top && a.left === b.left && a.bottom === b.bottom && a.right === b.right;
}

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

function isValidStyle(style: ConditionalFormatStyle): boolean {
  if (style.backgroundColor === undefined && style.textColor === undefined) {
    return false;
  }
  if (style.backgroundColor !== undefined && !HEX_COLOR_RE.test(style.backgroundColor)) {
    return false;
  }
  if (style.textColor !== undefined && !HEX_COLOR_RE.test(style.textColor)) {
    return false;
  }
  return true;
}

/**
 * Structural validation of a (possibly untrusted) rule against the sheet
 * dimensions and the documented bounds. Returns the rule when fully valid, or
 * null when anything is out of bounds or malformed. Mirrors `validateValidation`.
 */
export function validateConditionalFormat(
  candidate: CellConditionalFormat,
  rowCount: number,
  columnCount: number,
): CellConditionalFormat | null {
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
  if (rule.kind === 'cellValue') {
    if (!isValidStyle(rule.style)) {
      return null;
    }
    if (rule.operator === 'textContains') {
      return rule.value1.trim() === '' ? null : candidate;
    }
    if (!Number.isFinite(Number(rule.value1))) {
      return null;
    }
    if (rule.operator === 'between' && !Number.isFinite(Number(rule.value2))) {
      return null;
    }
    return candidate;
  }
  if (rule.kind === 'duplicate') {
    return isValidStyle(rule.style) ? candidate : null;
  }
  if (rule.kind === 'colorScale') {
    return HEX_COLOR_RE.test(rule.minColor) && HEX_COLOR_RE.test(rule.maxColor) ? candidate : null;
  }
  return null;
}

/** The rule's numeric operand for a cell whose computed value is `number`-typed; null otherwise. */
function numericOperand(value: FormulaValue): number | null {
  return value.type === 'number' ? value.value : null;
}

/** The rule's text operand: a string cell as-is, a number cell rendered plainly; blank/boolean/error never match. */
function textOperand(value: FormulaValue): string | null {
  if (value.type === 'string') {
    return value.value;
  }
  if (value.type === 'number') {
    return String(value.value);
  }
  return null;
}

/** Whether `value` satisfies `rule`'s comparison. Blank, boolean, and error cells never match. */
export function matchesCellValueRule(rule: CellValueRule, value: FormulaValue): boolean {
  if (rule.operator === 'textContains') {
    const text = textOperand(value);
    return text !== null && text.toLowerCase().includes(rule.value1.toLowerCase());
  }
  const n = numericOperand(value);
  if (n === null) {
    return false;
  }
  const v1 = Number(rule.value1);
  switch (rule.operator) {
    case 'greaterThan':
      return n > v1;
    case 'lessThan':
      return n < v1;
    case 'equal':
      return n === v1;
    case 'between': {
      const v2 = Number(rule.value2);
      const lo = Math.min(v1, v2);
      const hi = Math.max(v1, v2);
      return n >= lo && n <= hi;
    }
  }
}

/** A canonical key for duplicate detection: numbers and text never collide with each other; a blank value never participates. */
export function duplicateKey(value: FormulaValue): string | null {
  if (value.type === 'number') {
    return `n:${value.value}`;
  }
  if (value.type === 'string' && value.value !== '') {
    return `s:${value.value}`;
  }
  return null;
}

/** The set of duplicate keys among `keys` — values appearing more than once; blanks (`null`) never count. */
export function findDuplicateKeys(keys: readonly (string | null)[]): Set<string> {
  const counts = new Map<string, number>();
  for (const key of keys) {
    if (key !== null) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const duplicates = new Set<string>();
  for (const [key, count] of counts) {
    if (count > 1) {
      duplicates.add(key);
    }
  }
  return duplicates;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function rgbToHex(rgb: readonly [number, number, number]): string {
  return `#${rgb
    .map((c) =>
      Math.round(Math.max(0, Math.min(255, c)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/** Linearly interpolate between two `#rrggbb` colors; `t` is clamped to [0, 1]. */
export function interpolateHexColor(from: string, to: string, t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  return rgbToHex([
    a[0] + (b[0] - a[0]) * clamped,
    a[1] + (b[1] - a[1]) * clamped,
    a[2] + (b[2] - a[2]) * clamped,
  ]);
}

/** The [min, max] of `values`, or null when none are present (an all-blank/all-text range). */
export function colorScaleRange(values: readonly number[]): { min: number; max: number } | null {
  if (values.length === 0) {
    return null;
  }
  let min = values[0];
  let max = values[0];
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}

/** The color-scale background color for one value; `range.min === range.max` paints every cell `minColor`. */
export function colorScaleColor(
  rule: ColorScaleRule,
  value: number,
  range: { min: number; max: number },
): string {
  if (range.max === range.min) {
    return rule.minColor;
  }
  return interpolateHexColor(rule.minColor, rule.maxColor, (value - range.min) / (range.max - range.min));
}
