// SPDX-License-Identifier: MIT
/**
 * A worksheet's `objects` key in `.rsf` (knowledge/formats/rsf/json-document.md):
 * the shapes over the grid, bottom to top. Like every key in the codec, a
 * known key with the wrong shape fails the whole file; a key this reader
 * does not know is ignored.
 */
import { cellLabel, parseRef } from '../formula';
import { chartFromJson, chartToJson } from './rsf-sheet-charts';
import { MAX_SHEET_OBJECTS, validateObject, type ObjectCrop, type SheetObject } from './sheet-objects';

type Fail = (reason?: 'too-large') => never;
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** The optional keys, written only when set, in this order. */
const OPTIONAL_KEYS = [
  'rotation',
  'flipH',
  'flipV',
  'image',
  'crop',
  'aspectFree',
  'fill',
  'stroke',
  'strokeWidth',
  'text',
  'textColor',
  'fontSize',
  'bold',
  'italic',
  'align',
  'valign',
  'hidden',
  'lockPosition',
  'lockEdit',
] as const;

/** `{ "id", "name", "kind", "at": "B3", "dx", "dy", "width", "height", …optional keys }`. */
export function objectsToJson(objects: readonly SheetObject[]): Json[] {
  return objects.map((o) => {
    const out: { [key: string]: Json } = {
      id: o.id,
      name: o.name,
      kind: o.kind,
      at: cellLabel(o.row, o.col),
      dx: o.dx,
      dy: o.dy,
      width: o.width,
      height: o.height,
    };
    for (const key of OPTIONAL_KEYS) {
      const value = o[key];
      if (value !== undefined) {
        out[key] = typeof value === 'object' ? { ...value } : value;
      }
    }
    if (o.chart) {
      out.chart = chartToJson(o.chart);
    }
    return out;
  });
}

/** `{ "top", "right", "bottom", "left" }`, copied to exactly those keys (ranges are checked with the object). */
function cropFromJson(value: unknown, fail: Fail): ObjectCrop {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail();
  }
  const { top, right, bottom, left } = value as { [key: string]: unknown };
  return { top, right, bottom, left } as ObjectCrop;
}

/** Reads a worksheet's `objects` array for a grid of `rows` × `cols`. */
export function objectsFromJson(value: unknown, rows: number, cols: number, fail: Fail): SheetObject[] {
  if (!Array.isArray(value)) {
    return fail();
  }
  if (value.length > MAX_SHEET_OBJECTS) {
    return fail('too-large');
  }
  const ids = new Set<string>();
  return value.map((raw: unknown) => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return fail();
    }
    const entry = raw as { [key: string]: unknown };
    const at = typeof entry.at === 'string' ? parseRef(entry.at) : null;
    // The anchor exactly as the writer spells it (upper case, no `$`).
    if (!at || cellLabel(at.row, at.col) !== entry.at) {
      return fail();
    }
    const object = {
      id: entry.id,
      name: entry.name,
      kind: entry.kind,
      row: at.row,
      col: at.col,
      dx: entry.dx,
      dy: entry.dy,
      width: entry.width,
      height: entry.height,
    } as SheetObject;
    for (const key of OPTIONAL_KEYS) {
      if (entry[key] !== undefined) {
        (object as unknown as Record<string, unknown>)[key] = entry[key];
      }
    }
    if (entry.crop !== undefined) {
      object.crop = cropFromJson(entry.crop, fail);
    }
    if (entry.chart !== undefined) {
      object.chart = chartFromJson(entry.chart, fail);
    }
    if (!validateObject(object, rows, cols) || ids.has(object.id)) {
      return fail();
    }
    ids.add(object.id);
    return object;
  });
}
