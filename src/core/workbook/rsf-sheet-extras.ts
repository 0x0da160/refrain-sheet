// SPDX-License-Identifier: MIT
/**
 * `.rsf` keys that `rsf-codec.ts` reads and writes through this module
 * rather than itself (knowledge/formats/rsf/json-document.md): a
 * worksheet's `tabColor` and `folder` and the file's `folders`
 * (`rsf-folders.ts`), a worksheet's `validations`, its `objects`
 * (`rsf-sheet-objects.ts`), its `paper` square (`grid-paper.ts`), its
 * `rowHeights` (`row-heights.ts`), its `printArea` (`print-area.ts`), and the file's `images`
 * (`rsf-images.ts`). Like every key in
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
import {
  foldersFromJson,
  foldersToJson,
  placementFromJson,
  placementToJson,
  type RsfFolderList,
  type RsfSheetPlacement,
} from './rsf-folders';
import { checkImageReferences, imagesFromJson, imagesToJson, type RsfImageList } from './rsf-images';
import { checkChartSources } from './rsf-sheet-charts';
import { objectsFromJson, objectsToJson } from './rsf-sheet-objects';
import type { SheetObject } from './sheet-objects';
import { isPaperSquare } from './grid-paper';
import { clampRowHeight } from './row-heights';
import { clipPrintArea, parsePrintArea, printAreaToText } from './print-area';
import type { PrintArea } from '../print-layout';

/** The file-level keys kept here: the sheet folders and the pictures. */
export interface RsfFileExtras extends RsfFolderList, RsfImageList {}

/** The file's `folders` and `images` keys, each left out when empty. */
export function fileExtrasToJson(data: RsfFileExtras): { folders?: Json; images?: Json } {
  return { ...foldersToJson(data), ...imagesToJson(data) };
}

/**
 * Reads the file's `folders` and `images`, checking every worksheet's folder
 * and every image object's picture against them, and every chart's range
 * against the worksheets.
 */
export function fileExtrasFromJson(
  value: { [key: string]: unknown },
  sheets: ReadonlyArray<
    RsfSheetPlacement & {
      id: string;
      kind?: string;
      rowCount: number;
      columnCount: number;
      objects?: readonly SheetObject[];
    }
  >,
  fail: Fail,
): RsfFileExtras {
  const out: RsfFileExtras = {
    ...foldersFromJson(value.folders, sheets, fail),
    ...imagesFromJson(value.images, fail),
  };
  checkImageReferences(out, sheets, fail);
  checkChartSources(sheets, fail);
  return out;
}

/** The worksheet fields this module reads and writes. */
export interface RsfSheetExtras extends RsfSheetPlacement {
  /** Data-validation rules, in the order they were applied (later wins). */
  validations?: CellValidation[];
  /** Shapes over the grid, bottom to top. */
  objects?: SheetObject[];
  /** A grid-paper sheet's square side (px at 100% zoom). */
  paper?: number;
  /** Row heights a person set, as [row, px-at-100%] pairs in row order. */
  rowHeights?: Array<[number, number]>;
  /** The block File > Print… prints for "Print area". */
  printArea?: PrintArea;
}

type Fail = (reason?: 'too-large') => never;
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** A worksheet's extra keys, for its JSON object. */
export function sheetExtrasToJson(sheet: RsfSheetExtras): { [key: string]: Json } {
  const out: { [key: string]: Json } = { ...placementToJson(sheet) };
  if (sheet.validations && sheet.validations.length > 0) {
    out.validations = sheet.validations.map(validationToJson);
  }
  if (sheet.objects && sheet.objects.length > 0) {
    out.objects = objectsToJson(sheet.objects);
  }
  if (sheet.paper !== undefined) {
    out.paper = sheet.paper;
  }
  if (sheet.rowHeights && sheet.rowHeights.length > 0) {
    out.rowHeights = Object.fromEntries(sheet.rowHeights.map(([row, px]) => [String(row + 1), px]));
  }
  if (sheet.printArea) {
    out.printArea = printAreaToText(sheet.printArea);
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
  if (value.objects !== undefined) {
    if ((sheet.kind ?? 'grid') !== 'grid') {
      return fail();
    }
    const objects = objectsFromJson(value.objects, sheet.rowCount, sheet.columnCount, fail);
    if (objects.length > 0) {
      out.objects = objects;
    }
  }
  if (value.paper !== undefined) {
    out.paper = (sheet.kind ?? 'grid') === 'grid' && isPaperSquare(value.paper) ? value.paper : fail();
  }
  if (value.rowHeights !== undefined) {
    const heights = rowHeightsFromJson(value.rowHeights, sheet, fail);
    if (heights.length > 0) {
      out.rowHeights = heights;
    }
  }
  if (value.printArea !== undefined) {
    // Written as "A1:F40" (upper case, no `$`); a block reaching past the
    // worksheet is cut to it, and one wholly outside it is dropped.
    const text = value.printArea;
    const area = typeof text === 'string' ? parsePrintArea(text) : null;
    if (!area || printAreaToText(area) !== text || (sheet.kind ?? 'grid') !== 'grid') {
      return fail();
    }
    const clipped = clipPrintArea(area, sheet.rowCount, sheet.columnCount);
    if (clipped) {
      out.printArea = clipped;
    }
  }
  return out;
}

/**
 * `{ "3": 40 }`: a grid worksheet's row heights by 1-based row number, in px
 * at 100% zoom (clamped into range). A row past the worksheet's rows is
 * dropped; a key that is not a row number, or a height that is not a
 * number, is `bad-shape`.
 */
function rowHeightsFromJson(
  value: unknown,
  sheet: { kind?: string; rowCount: number },
  fail: Fail,
): Array<[number, number]> {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    (sheet.kind ?? 'grid') !== 'grid'
  ) {
    return fail();
  }
  const out: Array<[number, number]> = [];
  for (const [key, px] of Object.entries(value)) {
    if (!/^[1-9][0-9]{0,8}$/.test(key) || typeof px !== 'number' || !Number.isFinite(px)) {
      return fail();
    }
    const row = Number(key) - 1;
    if (row < sheet.rowCount) {
      out.push([row, clampRowHeight(px)]);
    }
  }
  return out.sort((a, b) => a[0] - b[0]);
}

/**
 * `{ "range": "B2:C10", "list": [...] }`, `{ "range": ..., "min"?, "max"?,
 * "integer"? }` (a number), or `{ "range": ..., "type": "textLength" |
 * "date", "min"?, "max"? }`; `required` and `toEnd` when set.
 */
function validationToJson(v: CellValidation): { [key: string]: Json } {
  const out: { [key: string]: Json } = {
    range: `${cellLabel(v.top, v.left)}:${cellLabel(v.bottom, v.right)}`,
  };
  const { rule } = v;
  if (rule.kind === 'list') {
    out.list = rule.values.slice();
  } else {
    if (rule.kind !== 'number') out.type = rule.kind;
    if (rule.min !== null) out.min = rule.min;
    if (rule.max !== null) out.max = rule.max;
    if (rule.kind === 'number' && rule.integer === true) out.integer = true;
  }
  if (v.required === true) out.required = true;
  if (v.toEnd === true) out.toEnd = true;
  return out;
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
  const flag = (key: string): true | undefined =>
    entry[key] === undefined ? undefined : entry[key] === true ? true : fail();
  let rule: ValidationRule;
  if (entry.list !== undefined) {
    const extra = ['type', 'min', 'max', 'integer'].some((key) => entry[key] !== undefined);
    if (extra || !Array.isArray(entry.list)) {
      return fail();
    }
    if (entry.list.length > MAX_VALIDATION_LIST_VALUES) {
      return fail('too-large');
    }
    const values = entry.list.map((item: unknown) =>
      typeof item === 'string' && item.length <= MAX_VALIDATION_VALUE_LENGTH ? item : fail(),
    );
    rule = { kind: 'list', values };
  } else if (entry.type === 'date') {
    const day = (key: 'min' | 'max'): string | null =>
      entry[key] === undefined ? null : typeof entry[key] === 'string' ? entry[key] : fail();
    rule = { kind: 'date', min: day('min'), max: day('max') };
  } else if (entry.type === undefined || entry.type === 'textLength') {
    const bound = (key: 'min' | 'max'): number | null => {
      const n = entry[key];
      return n === undefined ? null : typeof n === 'number' && Number.isFinite(n) ? n : fail();
    };
    rule =
      entry.type === 'textLength'
        ? { kind: 'textLength', min: bound('min'), max: bound('max') }
        : {
            kind: 'number',
            min: bound('min'),
            max: bound('max'),
            ...(flag('integer') ? { integer: true } : {}),
          };
  } else {
    return fail();
  }
  if (rule.kind !== 'number' && entry.integer !== undefined) {
    return fail();
  }
  const required = flag('required');
  const toEnd = flag('toEnd');
  const validation = validateValidation(
    {
      top: from.row,
      left: from.col,
      bottom: to.row,
      right: to.col,
      rule,
      ...(required ? { required } : {}),
      ...(toEnd ? { toEnd } : {}),
    },
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
