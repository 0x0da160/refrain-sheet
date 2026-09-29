// SPDX-License-Identifier: MIT
/**
 * Shapes, pictures and charts placed over a spreadsheet worksheet:
 * rectangles, ellipses, lines, arrows, text boxes, images and charts
 * (`Worksheet.objects`; an image's bytes are in the workbook's picture
 * store, `sheet-images.ts`; a chart's settings are in `sheet-charts.ts`). Each is anchored to a cell —
 * its top-left corner sits `dx`/`dy` pixels (at 100% zoom) right of and
 * below that cell's top-left corner — so inserting or deleting rows and
 * columns before it moves it with the cells, and a row-height or
 * column-width change moves it without resizing it. The list order is the
 * stacking order: the last object is drawn on top.
 *
 * Saved in the RSF container (the worksheet's `objects` key,
 * knowledge/formats/rsf/json-document.md); changed only through undoable
 * history entries that swap the whole list. Treat the array and its objects
 * as immutable.
 */
import { movedAxisIndex } from '../formula';
import { normalizeHexColor } from './cell-style';
import { chartSpecValid, type ChartSpec } from './sheet-charts';
import { IMAGE_ID_PATTERN } from './sheet-images';
import { normalizeFontSize } from './text-font';

const SHEET_OBJECT_KINDS = ['rect', 'ellipse', 'line', 'arrow', 'text', 'image', 'chart'] as const;
export type SheetObjectKind = (typeof SHEET_OBJECT_KINDS)[number];

export const OBJECT_TEXT_ALIGNS = ['left', 'center', 'right'] as const;
export const OBJECT_TEXT_VALIGNS = ['top', 'middle', 'bottom'] as const;

/** Most objects one worksheet may hold. */
export const MAX_SHEET_OBJECTS = 1000;
/** Longest object name, and longest object text. */
export const MAX_OBJECT_NAME_LENGTH = 100;
export const MAX_OBJECT_TEXT_LENGTH = 10000;
/** Largest offset, width or height, in pixels at 100% zoom. */
const MAX_OBJECT_EXTENT = 100000;
/**
 * How much of a picture is cut off each side, in percent of its width
 * (`left`, `right`) or height (`top`, `bottom`); what is left fills the box.
 */
export interface ObjectCrop {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Line widths, in pixels at 100% zoom. */
export const MIN_OBJECT_LINE_WIDTH = 0.25;
export const MAX_OBJECT_LINE_WIDTH = 20;

export interface SheetObject {
  /** Unique within its worksheet; kept through copies, never shown. */
  id: string;
  /** Shown in the object list; unique names are not required. */
  name: string;
  kind: SheetObjectKind;
  /** The anchor cell (document row and column). */
  row: number;
  col: number;
  /** Offset of the top-left corner from the anchor cell's, in px at 100%. */
  dx: number;
  dy: number;
  width: number;
  height: number;
  /** Clockwise, in whole or fractional degrees, 0 ≤ r < 360. Left out when 0. */
  rotation?: number;
  /**
   * A line or arrow runs from the top-left to the bottom-right corner of its
   * box; `flipH` starts it at the right, `flipV` at the bottom. The arrow
   * head is at the end. An image is mirrored left to right (`flipH`) or
   * top to bottom (`flipV`); other shapes leave both out.
   */
  flipH?: true;
  flipV?: true;
  /** Image only: the id of its picture in the workbook's store (required). */
  image?: string;
  /** Image only: the part of the picture cut off. Left out when none is. */
  crop?: ObjectCrop;
  /** Image only: resizing may change its width-to-height ratio (kept by default). */
  aspectFree?: true;
  /** Chart only: what it shows and how (required). */
  chart?: ChartSpec;
  /** `#rrggbb`, or `'none'` for no fill / no line. Left out: the kind's default. */
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  text?: string;
  textColor?: string;
  fontSize?: number;
  bold?: true;
  italic?: true;
  align?: (typeof OBJECT_TEXT_ALIGNS)[number];
  valign?: (typeof OBJECT_TEXT_VALIGNS)[number];
  /** Left off the screen, print and image export (still listed). */
  hidden?: true;
  /** 配置を固定: cannot be moved or resized. */
  lockPosition?: true;
  /** 編集をロック: cannot be moved, resized, edited or deleted (the stronger lock). */
  lockEdit?: true;
}

/** Whether a kind is drawn as a line between two corners of its box. */
export function isLineKind(kind: SheetObjectKind): boolean {
  return kind === 'line' || kind === 'arrow';
}

/** The fill, line and text defaults of a kind, used where an object leaves them out. */
export function objectDefaults(kind: SheetObjectKind): {
  fill: string;
  stroke: string;
  strokeWidth: number;
  align: (typeof OBJECT_TEXT_ALIGNS)[number];
  valign: (typeof OBJECT_TEXT_VALIGNS)[number];
} {
  if (kind === 'text' || kind === 'image' || kind === 'chart') {
    return { fill: 'none', stroke: 'none', strokeWidth: 1, align: 'left', valign: 'top' };
  }
  return {
    fill: isLineKind(kind) ? 'none' : '#ffffff',
    stroke: '#404040',
    strokeWidth: isLineKind(kind) ? 2 : 1,
    align: 'center',
    valign: 'middle',
  };
}

/** Whether an object may not be moved or resized (either lock). */
export function isPositionLocked(object: SheetObject): boolean {
  return object.lockPosition === true || object.lockEdit === true;
}

/** Whether two object lists are the same, object for object. */
export function objectListsEqual(a: readonly SheetObject[], b: readonly SheetObject[]): boolean {
  return a.length === b.length && a.every((o, i) => o === b[i] || JSON.stringify(o) === JSON.stringify(b[i]));
}

/** An id not used by any of `objects` (`o1`, `o2`, …). */
export function nextObjectId(objects: readonly SheetObject[]): string {
  const used = new Set(objects.map((o) => o.id));
  let n = objects.length + 1;
  while (used.has(`o${n}`)) {
    n += 1;
  }
  return `o${n}`;
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

function extent(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_OBJECT_EXTENT;
}

function paint(value: unknown): value is string {
  return value === 'none' || (typeof value === 'string' && normalizeHexColor(value) === value);
}

/** Whether the id, name, kind, anchor and size fit a worksheet of `rows` × `cols`. */
function placementValid(o: SheetObject, rows: number, cols: number): boolean {
  const index = (value: number, limit: number): boolean =>
    Number.isInteger(value) && value >= 0 && value < limit;
  return (
    typeof o.id === 'string' &&
    ID_PATTERN.test(o.id) &&
    typeof o.name === 'string' &&
    o.name.length >= 1 &&
    o.name.length <= MAX_OBJECT_NAME_LENGTH &&
    !CONTROL_CHARS.test(o.name) &&
    (SHEET_OBJECT_KINDS as readonly string[]).includes(o.kind) &&
    index(o.row, rows) &&
    index(o.col, cols) &&
    [o.dx, o.dy, o.width, o.height].every(extent) &&
    (o.rotation === undefined ||
      (typeof o.rotation === 'number' && Number.isFinite(o.rotation) && o.rotation > 0 && o.rotation < 360))
  );
}

function cropValid(crop: ObjectCrop): boolean {
  const side = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 100;
  return (
    typeof crop === 'object' &&
    crop !== null &&
    side(crop.top) &&
    side(crop.right) &&
    side(crop.bottom) &&
    side(crop.left) &&
    crop.top + crop.bottom < 100 &&
    crop.left + crop.right < 100
  );
}

/** Whether the picture fields fit the kind: an image names its picture and holds no text. */
function imageFieldsValid(o: SheetObject): boolean {
  if (o.kind !== 'image') {
    return o.image === undefined && o.crop === undefined && o.aspectFree === undefined;
  }
  return (
    typeof o.image === 'string' &&
    IMAGE_ID_PATTERN.test(o.image) &&
    o.text === undefined &&
    (o.crop === undefined || cropValid(o.crop)) &&
    (o.aspectFree === undefined || o.aspectFree === true)
  );
}

/** Whether the chart settings fit the kind: a chart has them and holds no text. */
function chartFieldsValid(o: SheetObject): boolean {
  if (o.kind !== 'chart') {
    return o.chart === undefined;
  }
  return o.chart !== undefined && chartSpecValid(o.chart) && o.text === undefined;
}

/** Whether the fill, line and text settings are all in range. */
function formatValid(o: SheetObject): boolean {
  const optional = <T>(value: T | undefined, test: (value: T) => boolean): boolean =>
    value === undefined || test(value);
  return (
    optional(o.fill, paint) &&
    optional(o.stroke, paint) &&
    optional(
      o.strokeWidth,
      (w) => typeof w === 'number' && w >= MIN_OBJECT_LINE_WIDTH && w <= MAX_OBJECT_LINE_WIDTH,
    ) &&
    optional(o.text, (text) => typeof text === 'string' && text.length <= MAX_OBJECT_TEXT_LENGTH) &&
    optional(o.textColor, (color) => typeof color === 'string' && normalizeHexColor(color) === color) &&
    optional(o.fontSize, (size) => typeof size === 'number' && normalizeFontSize(size) !== null) &&
    optional(o.align, (align) => (OBJECT_TEXT_ALIGNS as readonly string[]).includes(align)) &&
    optional(o.valign, (valign) => (OBJECT_TEXT_VALIGNS as readonly string[]).includes(valign)) &&
    [o.flipH, o.flipV, o.bold, o.italic, o.hidden, o.lockPosition, o.lockEdit].every(
      (flag) => flag === undefined || flag === true,
    )
  );
}

/**
 * The object as stored, or null when any field is out of range for a
 * worksheet of `rows` × `cols` (every rule the file reader enforces).
 */
export function validateObject(object: SheetObject, rows: number, cols: number): SheetObject | null {
  return placementValid(object, rows, cols) &&
    formatValid(object) &&
    imageFieldsValid(object) &&
    chartFieldsValid(object)
    ? object
    : null;
}

function withAxis(o: SheetObject, axis: 'row' | 'col', index: number, resetOffset: boolean): SheetObject {
  if ((axis === 'row' ? o.row : o.col) === index && !resetOffset) {
    return o;
  }
  if (axis === 'row') {
    return { ...o, row: index, ...(resetOffset ? { dy: 0 } : {}) };
  }
  return { ...o, col: index, ...(resetOffset ? { dx: 0 } : {}) };
}

/** The objects after `count` rows or columns were inserted at `index` on `axis`. */
export function shiftObjectsForInsert(
  objects: readonly SheetObject[],
  axis: 'row' | 'col',
  index: number,
  count: number,
): SheetObject[] {
  return objects.map((o) => {
    const at = axis === 'row' ? o.row : o.col;
    return at >= index ? withAxis(o, axis, at + count, false) : o;
  });
}

/**
 * The objects after `count` rows or columns starting at `index` were
 * deleted on `axis`. An object anchored in the deleted span is kept and
 * moves to the edge where the span was (never deleted with the cells);
 * `limit` is the axis length left, so an anchor past the new last row or
 * column is pulled back onto it.
 */
export function shiftObjectsForDelete(
  objects: readonly SheetObject[],
  axis: 'row' | 'col',
  index: number,
  count: number,
  limit: number,
): SheetObject[] {
  return objects.map((o) => {
    const at = axis === 'row' ? o.row : o.col;
    if (at < index) {
      return o;
    }
    if (at >= index + count) {
      return withAxis(o, axis, at - count, false);
    }
    return withAxis(o, axis, Math.max(0, Math.min(index, limit - 1)), true);
  });
}

/**
 * The objects after moving `count` rows or columns from `from` to the
 * boundary `to` (a reorder): an object anchored in the moved span moves
 * with it, others follow the gap closing.
 */
export function moveObjects(
  objects: readonly SheetObject[],
  axis: 'row' | 'col',
  from: number,
  count: number,
  to: number,
): SheetObject[] {
  return objects.map((o) => {
    const at = axis === 'row' ? o.row : o.col;
    return withAxis(o, axis, movedAxisIndex(at, from, count, to), false);
  });
}
