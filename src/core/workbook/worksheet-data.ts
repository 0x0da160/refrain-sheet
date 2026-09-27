// SPDX-License-Identifier: MIT
/**
 * The mapping between a live {@link Worksheet} and its persisted record in the
 * `.rsf` container (`RsfWorksheetData`, defined and validated by
 * `rsf-codec.ts`), and a worksheet's values-only CSV text. Every optional key is written only when it carries
 * information, so a worksheet without styles, comments, filters, locks or
 * display settings produces exactly the record earlier releases wrote.
 */
import { isEmptyGridLook } from '../grid-look';
import type { RsfWorksheetData } from './rsf-codec';
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
    if (entry.display.wrap) {
      sheet.displayWrap = true;
    }
    sheet.displayFont = entry.display.font;
    sheet.displayLook = { ...entry.display.look };
  }
  sheet.filter = entry.filter ?? null;
  sheet.filterDropped = entry.filterDropped === true;
  sheet.locked = entry.locked === true;
  for (const [r, c, style] of entry.styles ?? []) {
    sheet.setStyle(r, c, style);
  }
  for (const [r, c, text] of entry.comments ?? []) {
    sheet.setComment(r, c, text);
  }
  return sheet;
}

/** The persisted record of a worksheet whose non-empty cells are `cells`. */
export function worksheetToData(sheet: Worksheet, cells: Array<[number, number, string]>): RsfWorksheetData {
  const colWidths: Array<[number, number]> = [];
  for (let c = 0; c < sheet.displayColWidths.length && c < sheet.columnCount; c++) {
    const w = sheet.displayColWidths[c];
    if (w && w > 0) {
      colWidths.push([c, w]);
    }
  }
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
  if (
    sheet.displayZoom !== undefined ||
    colWidths.length > 0 ||
    sheet.displayWrap === true ||
    sheet.displayFont !== undefined ||
    !isEmptyGridLook(sheet.displayLook)
  ) {
    entry.display = {
      ...(sheet.displayZoom !== undefined ? { zoom: sheet.displayZoom } : {}),
      ...(colWidths.length > 0 ? { colWidths } : {}),
      ...(sheet.displayWrap === true ? { wrap: true } : {}),
      ...(sheet.displayFont !== undefined ? { font: sheet.displayFont } : {}),
      ...(!isEmptyGridLook(sheet.displayLook) ? { look: { ...sheet.displayLook } } : {}),
    };
  }
  if (sheet.filter !== null) {
    entry.filter = sheet.filter;
  }
  if (sheet.locked) {
    entry.locked = true;
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
