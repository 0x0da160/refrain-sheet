// SPDX-License-Identifier: MIT
/**
 * `.rsf` keys that `rsf-codec.ts` reads and writes through this module
 * rather than itself (knowledge/formats/rsf/json-document.md): a
 * worksheet's `tabColor` and `folder` and the file's `folders`
 * (`rsf-folders.ts`), and a worksheet's `validations`. Like every key in
 * the codec, a known key with the wrong shape fails the whole file.
 */
import { cellLabel, parseRef } from '../formula';
import {
  MAX_VALIDATION_LIST_VALUES,
  MAX_VALIDATION_RULES,
  MAX_VALIDATION_VALUE_LENGTH,
  validateValidation,
  type CellValidation,
  type ValidationRule,
} from './data-validation';
import { placementFromJson, placementToJson, type RsfSheetPlacement } from './rsf-folders';

export { foldersFromJson, foldersToJson, type RsfFolderList } from './rsf-folders';

/** The worksheet fields this module reads and writes. */
export interface RsfSheetExtras extends RsfSheetPlacement {
  /** Data-validation rules, in the order they were applied (later wins). */
  validations?: CellValidation[];
}

type Fail = (reason?: 'too-large') => never;
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** A worksheet's extra keys, for its JSON object. */
export function sheetExtrasToJson(sheet: RsfSheetExtras): { [key: string]: Json } {
  const out: { [key: string]: Json } = { ...placementToJson(sheet) };
  if (sheet.validations && sheet.validations.length > 0) {
    out.validations = sheet.validations.map(validationToJson);
  }
  return out;
}

/**
 * Reads a worksheet's extra keys. `sheet` is the worksheet as read so far;
 * its kind and size bound the validation ranges.
 */
export function sheetExtrasFromJson(
  value: { [key: string]: unknown },
  sheet: { kind?: string; rowCount: number; columnCount: number },
  fail: Fail,
): RsfSheetExtras {
  const out: RsfSheetExtras = placementFromJson(value, fail);
  if (value.validations !== undefined) {
    if (!Array.isArray(value.validations) || (sheet.kind ?? 'grid') !== 'grid') {
      return fail();
    }
    if (value.validations.length > MAX_VALIDATION_RULES) {
      return fail('too-large');
    }
    const rules = value.validations.map((raw: unknown) =>
      validationFromJson(raw, sheet.rowCount, sheet.columnCount, fail),
    );
    if (rules.length > 0) {
      out.validations = rules;
    }
  }
  return out;
}

/** `{ "range": "B2:C10", "list": [...] }` or `{ "range": ..., "min"?, "max"? }`. */
function validationToJson(v: CellValidation): { [key: string]: Json } {
  const range = `${cellLabel(v.top, v.left)}:${cellLabel(v.bottom, v.right)}`;
  if (v.rule.kind === 'list') {
    return { range, list: v.rule.values.slice() };
  }
  return {
    range,
    ...(v.rule.min !== null ? { min: v.rule.min } : {}),
    ...(v.rule.max !== null ? { max: v.rule.max } : {}),
  };
}

function validationFromJson(raw: unknown, rows: number, cols: number, fail: Fail): CellValidation {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return fail();
  }
  const entry = raw as { [key: string]: unknown };
  const range = typeof entry.range === 'string' ? entry.range.split(':') : [];
  const from = range.length === 2 ? canonicalRef(range[0]) : null;
  const to = range.length === 2 ? canonicalRef(range[1]) : null;
  if (!from || !to) {
    return fail();
  }
  let rule: ValidationRule;
  if (entry.list !== undefined) {
    if (entry.min !== undefined || entry.max !== undefined || !Array.isArray(entry.list)) {
      return fail();
    }
    if (entry.list.length > MAX_VALIDATION_LIST_VALUES) {
      return fail('too-large');
    }
    const values = entry.list.map((item: unknown) =>
      typeof item === 'string' && item.length <= MAX_VALIDATION_VALUE_LENGTH ? item : fail(),
    );
    rule = { kind: 'list', values };
  } else {
    const bound = (key: 'min' | 'max'): number | null => {
      const n = entry[key];
      return n === undefined ? null : typeof n === 'number' && Number.isFinite(n) ? n : fail();
    };
    rule = { kind: 'number', min: bound('min'), max: bound('max') };
  }
  const validation = validateValidation(
    { top: from.row, left: from.col, bottom: to.row, right: to.col, rule },
    rows,
    cols,
  );
  return validation ?? fail();
}

/** A1 reference exactly as the writer spells it (upper case, no `$`). */
function canonicalRef(text: string): { row: number; col: number } | null {
  const ref = parseRef(text);
  return ref && cellLabel(ref.row, ref.col) === text ? ref : null;
}
