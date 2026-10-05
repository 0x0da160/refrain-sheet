// SPDX-License-Identifier: MIT
/**
 * The mapping between a live {@link Worksheet} and its persisted record in the
 * `.rsf` container (`RsfWorksheetData`, defined and validated by
 * `rsf-codec.ts`), and a worksheet's values-only CSV text. Every optional key is written only when it carries
 * information, so a worksheet without styles, comments, filters, locks or
 * display settings produces exactly the record earlier releases wrote.
 */
import { isEmptyGridLook } from '../grid-look';
import { MAX_VALIDATION_RULES, validateValidation } from './data-validation';
import type { RsfWorksheetData } from './rsf-codec';
import { MAX_SHEET_OBJECTS, validateObject } from './sheet-objects';
import { Worksheet } from './worksheet';

/** Materialize one decoded worksheet record (already validated by the codec). */
export function worksheetFromData(entry: RsfWorksheetData): Worksheet {
  const rows: string[][] = [];
  for (let r = 0; r < entry.rowCount; r++) {
    rows.push(new Array<string>(entry.columnCount).fill(''));
  }
  for (const [r, c, input] of entry.cells) {
    rows[r][c] = input;
  }
  const sheet = new Worksheet(entry.id, entry.name, rows, entry.columnCount, entry.kind ?? 'grid');
  if (entry.display) {
    sheet.displayZoom = entry.display.zoom;
    for (const [col, width] of entry.display.colWidths ?? []) {
      sheet.displayColWidths[col] = width;
    }
    if (entry.display.wrap === true || (entry.display.wrap === false && sheet.kind !== 'grid')) {
      sheet.displayWrap = entry.display.wrap;
    }
    sheet.displayFont = entry.display.font;
    sheet.displayLook = { ...entry.display.look };
  }
  sheet.filter = entry.filter ?? null;
  sheet.filterDropped = entry.filterDropped === true;
  sheet.locked = entry.locked === true;
  sheet.tabColor = entry.tabColor;
  sheet.folderId = entry.folderId;
  sheet.paper = entry.paper;
  if (entry.rowHeights) {
    sheet.rowHeights = new Map(entry.rowHeights);
  }
  sheet.validations = entry.validations?.slice() ?? [];
  sheet.objects = entry.objects?.slice() ?? [];
  for (const [r, c, style] of entry.styles ?? []) {
    sheet.setStyle(r, c, style);
  }
  for (const [r, c, text] of entry.comments ?? []) {
    sheet.setComment(r, c, text);
  }
  return sheet;
}

/** A worksheet's own display settings as persisted, or undefined when it has none. */
function displayToData(sheet: Worksheet): RsfWorksheetData['display'] {
  const colWidths: Array<[number, number]> = [];
  for (let c = 0; c < sheet.displayColWidths.length && c < sheet.columnCount; c++) {
    const w = sheet.displayColWidths[c];
    if (w && w > 0) {
      colWidths.push([c, w]);
    }
  }
  // A text worksheet keeps wrap off as a choice (it wraps by default); a grid only wrap on.
  const wrap = sheet.kind === 'grid' ? (sheet.displayWrap === true ? true : undefined) : sheet.displayWrap;
  if (
    sheet.displayZoom !== undefined ||
    colWidths.length > 0 ||
    wrap !== undefined ||
    sheet.displayFont !== undefined ||
    !isEmptyGridLook(sheet.displayLook)
  ) {
    return {
      ...(sheet.displayZoom !== undefined ? { zoom: sheet.displayZoom } : {}),
      ...(colWidths.length > 0 ? { colWidths } : {}),
      ...(wrap !== undefined ? { wrap } : {}),
      ...(sheet.displayFont !== undefined ? { font: sheet.displayFont } : {}),
      ...(!isEmptyGridLook(sheet.displayLook) ? { look: { ...sheet.displayLook } } : {}),
    };
  }
  return undefined;
}

/** The persisted record of a worksheet whose non-empty cells are `cells`. */
export function worksheetToData(sheet: Worksheet, cells: Array<[number, number, string]>): RsfWorksheetData {
  const entry: RsfWorksheetData = {
    id: sheet.id,
    name: sheet.name,
    rowCount: sheet.rowCount,
    columnCount: sheet.columnCount,
    cells,
  };
  if (sheet.kind !== 'grid') {
    entry.kind = sheet.kind;
  }
  const display = displayToData(sheet);
  if (display) {
    entry.display = display;
  }
  if (sheet.filter !== null) {
    entry.filter = sheet.filter;
  }
  if (sheet.locked) {
    entry.locked = true;
  }
  if (sheet.tabColor !== undefined) {
    entry.tabColor = sheet.tabColor;
  }
  if (sheet.folderId !== undefined) {
    entry.folderId = sheet.folderId;
  }
  if (sheet.rowHeights.size > 0 && sheet.kind === 'grid') {
    entry.rowHeights = [...sheet.rowHeights]
      .filter(([row]) => row < sheet.rowCount)
      .sort((a, b) => a[0] - b[0]);
  }
  if (sheet.paper !== undefined && sheet.kind === 'grid') {
    entry.paper = sheet.paper;
  }
  // Only rules that fit the worksheet as it is, so the file always reads back.
  const validations = sheet.validations.filter((v) =>
    validateValidation(v, sheet.rowCount, sheet.columnCount),
  );
  if (validations.length > 0 && sheet.kind === 'grid') {
    entry.validations = validations.slice(0, MAX_VALIDATION_RULES);
  }
  // Likewise only objects that fit (an anchor past the last row never reads
  // back), each id once.
  const ids = new Set<string>();
  const objects = sheet.objects.filter(
    (o) => validateObject(o, sheet.rowCount, sheet.columnCount) && !ids.has(o.id) && ids.add(o.id),
  );
  if (objects.length > 0 && sheet.kind === 'grid') {
    entry.objects = objects.slice(0, MAX_SHEET_OBJECTS);
  }
  const styles = sheet.collectStyles();
  if (styles.length > 0) {
    entry.styles = styles;
  }
  const comments = sheet.collectComments();
  if (comments.length > 0) {
    entry.comments = comments;
  }
  return entry;
}

/**
 * Computed values as CSV text: fields quoted only when needed, LF terminators.
 * The lossy "values only" export of a worksheet (formulas become results).
 */
export function valuesToCsvText(
  rowCount: number,
  columnCount: number,
  delimiter: string,
  textAt: (row: number, col: number) => string,
): string {
  const lines: string[] = [];
  for (let r = 0; r < rowCount; r++) {
    const parts: string[] = [];
    for (let c = 0; c < columnCount; c++) {
      let text = textAt(r, c);
      if (text.includes(delimiter) || text.includes('"') || text.includes('\r') || text.includes('\n')) {
        text = `"${text.replace(/"/g, '""')}"`;
      }
      parts.push(text);
    }
    lines.push(parts.join(delimiter));
  }
  return lines.join('\n') + '\n';
}
