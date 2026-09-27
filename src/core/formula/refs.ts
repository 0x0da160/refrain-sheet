// SPDX-License-Identifier: MIT
/**
 * Formula notation shared by every stage: the formula marker, worksheet-name
 * quoting for cross-sheet references, and A1-style cell, column and row
 * references.
 */

/** True when a string is a formula (leading `=`, at least one more character). */
export function isFormula(input: string): boolean {
  return input.length > 1 && input.startsWith('=');
}

// ---------------------------------------------------------------------------
// Worksheet-name notation (cross-sheet references)
// ---------------------------------------------------------------------------

/**
 * Documented maximum worksheet-name length (characters). Names are trimmed and
 * validated at the command layer; the codec also bounds the stored bytes.
 */
export const MAX_SHEET_NAME_LENGTH = 100;

/**
 * True when a name character conflicts with formula-reference or file-format
 * syntax: a C0 control character or one of `[ ] : \ / ? *`. A single quote is
 * allowed (escaped by doubling inside a quoted reference).
 */
function isDisallowedSheetChar(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return (
    code < 0x20 ||
    ch === '[' ||
    ch === ']' ||
    ch === ':' ||
    ch === '\\' ||
    ch === '/' ||
    ch === '?' ||
    ch === '*'
  );
}

/** True when a trimmed worksheet name is non-empty, within length, and free of disallowed characters. */
export function isValidSheetName(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_SHEET_NAME_LENGTH) {
    return false;
  }
  for (const ch of trimmed) {
    if (isDisallowedSheetChar(ch)) {
      return false;
    }
  }
  return true;
}

/**
 * The uniqueness key for a worksheet name. Worksheet names are unique
 * case-insensitively (documented policy), matching conventional spreadsheets,
 * so this normalizes to a trimmed, case-folded key.
 */
export function sheetNameKey(name: string): string {
  return name.trim().toLocaleLowerCase();
}

/**
 * True when a worksheet name must be single-quoted to appear as a formula
 * reference prefix: it is bare-safe only when it reads as one plain identifier
 * token (letter/underscore start, then letters/digits/underscore).
 */
export function sheetNameNeedsQuoting(name: string): boolean {
  return !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

/**
 * Render a worksheet name as a formula-reference prefix, single-quoting and
 * escaping (`'` → `''`) when required so `Quarter 1` becomes `'Quarter 1'` and
 * `O'Brien` becomes `'O''Brien'`.
 */
export function quoteSheetName(name: string): string {
  return sheetNameNeedsQuoting(name) ? `'${name.replace(/'/g, "''")}'` : name;
}

// ---------------------------------------------------------------------------
// Cell reference notation
// ---------------------------------------------------------------------------

export const MAX_REF_COLUMN = 16_383; // 'XFD', a conventional spreadsheet limit
export const MAX_REF_ROW = 9_999_999;

/** Convert a 0-based column index to spreadsheet letters (0 -> A, 26 -> AA). */
export function columnLabel(col: number): string {
  let label = '';
  let n = col;
  for (;;) {
    label = String.fromCharCode(0x41 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
    if (n < 0) break;
  }
  return label;
}

/** Convert column letters to a 0-based index (A -> 0, AA -> 26). */
export function columnIndex(label: string): number {
  let n = 0;
  for (const ch of label.toUpperCase()) {
    n = n * 26 + (ch.charCodeAt(0) - 0x40);
  }
  return n - 1;
}

export function cellLabel(row: number, col: number): string {
  return `${columnLabel(col)}${row + 1}`;
}

const REF_PATTERN = /^(\$?)([A-Za-z]{1,3})(\$?)([1-9][0-9]{0,6})$/;
const COL_LABEL_PATTERN = /^(\$?)([A-Za-z]{1,3})$/;
const ROW_NUMBER_PATTERN = /^(\$?)([1-9][0-9]{0,6})$/;

/**
 * A parsed A1-style cell reference with its `$` absolute markers. The markers
 * never change which cell is referenced; they mark components that stay fixed
 * when the formula is copied/filled (see the module doc).
 */
export interface CellRefEx {
  row: number;
  col: number;
  absRow: boolean;
  absCol: boolean;
}

/**
 * Parse "A1"-style notation (including `$A$1` / `$A1` / `A$1` absolute and
 * mixed forms) into 0-based coordinates, or null.
 */
export function parseRef(text: string): { row: number; col: number } | null {
  const full = parseRefEx(text);
  return full ? { row: full.row, col: full.col } : null;
}

/** Like {@link parseRef} but also reports the `$` absolute markers. */
export function parseRefEx(text: string): CellRefEx | null {
  const m = REF_PATTERN.exec(text);
  if (!m) {
    return null;
  }
  const col = columnIndex(m[2]);
  const row = Number(m[4]) - 1;
  if (col > MAX_REF_COLUMN || row > MAX_REF_ROW) {
    return null;
  }
  return { row, col, absCol: m[1] === '$', absRow: m[3] === '$' };
}

/** Render a reference, preserving `$` absolute markers ("A1", "$A$1", …). */
export function refLabel(row: number, col: number, absRow = false, absCol = false): string {
  return `${absCol ? '$' : ''}${columnLabel(col)}${absRow ? '$' : ''}${row + 1}`;
}

/** One endpoint of a whole-column or whole-row span, with its `$` marker. */
export interface SpanEnd {
  index: number;
  abs: boolean;
}

/** Parse a bare column label ("A", "$AB") to a 0-based column index, or null. */
export function parseWholeColumn(text: string): number | null {
  return parseWholeColumnEx(text)?.index ?? null;
}

/** Like {@link parseWholeColumn} but also reports the `$` marker. */
export function parseWholeColumnEx(text: string): SpanEnd | null {
  const m = COL_LABEL_PATTERN.exec(text);
  if (!m) {
    return null;
  }
  const col = columnIndex(m[2]);
  return col >= 0 && col <= MAX_REF_COLUMN ? { index: col, abs: m[1] === '$' } : null;
}

/** Parse a bare row number ("1", "$10") to a 0-based row index, or null. */
export function parseWholeRow(text: string): number | null {
  return parseWholeRowEx(text)?.index ?? null;
}

/** Like {@link parseWholeRow} but also reports the `$` marker. */
export function parseWholeRowEx(text: string): SpanEnd | null {
  const m = ROW_NUMBER_PATTERN.exec(text);
  if (!m) {
    return null;
  }
  const row = Number(m[2]) - 1;
  return row >= 0 && row <= MAX_REF_ROW ? { index: row, abs: m[1] === '$' } : null;
}
