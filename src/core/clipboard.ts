// SPDX-License-Identifier: MIT

/** A normalized rectangular cell range (inclusive bounds). */
export interface CellRange {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export interface CellCoord {
  row: number;
  col: number;
}

export function normalizeRange(a: CellCoord, b: CellCoord): CellRange {
  return {
    top: Math.min(a.row, b.row),
    left: Math.min(a.col, b.col),
    bottom: Math.max(a.row, b.row),
    right: Math.max(a.col, b.col),
  };
}

export function rangeContains(range: CellRange, row: number, col: number): boolean {
  return row >= range.top && row <= range.bottom && col >= range.left && col <= range.right;
}

export function rangeSize(range: CellRange): { rows: number; cols: number } {
  return { rows: range.bottom - range.top + 1, cols: range.right - range.left + 1 };
}

interface ReadableDocument {
  getDisplayValue(row: number, col: number): string;
  getValue(row: number, col: number): string;
}

/**
 * The document rows of a range that a copy actually reads: every row of the
 * rectangle except those in `hidden` (rows hidden by an active filter are
 * excluded from copies — documented behavior — so what is copied is exactly
 * what is visible on screen).
 */
export function copyRows(range: CellRange, hidden: ReadonlySet<number> | null): number[] {
  const rows: number[] = [];
  for (let r = range.top; r <= range.bottom; r++) {
    if (!hidden?.has(r)) {
      rows.push(r);
    }
  }
  return rows;
}

/**
 * Build tab-separated, newline-separated text from a range so it can be
 * pasted into spreadsheet software. Cells are the *displayed* values
 * (formulas contribute their calculated values). Cells containing tabs or
 * newlines are quoted the way conventional spreadsheets do. `rows` limits
 * the copy to specific document rows (visible rows under an active filter);
 * omitted, every row of the rectangle is copied.
 */
export function rangeToTsv(doc: ReadableDocument, range: CellRange, rows?: readonly number[]): string {
  const lines: string[] = [];
  const rowList = rows ?? copyRows(range, null);
  for (const r of rowList) {
    const parts: string[] = [];
    for (let c = range.left; c <= range.right; c++) {
      let text = doc.getDisplayValue(r, c);
      if (text.includes('\t') || text.includes('\n') || text.includes('\r') || text.includes('"')) {
        text = `"${text.replace(/"/g, '""')}"`;
      }
      parts.push(text);
    }
    lines.push(parts.join('\t'));
  }
  return lines.join('\n');
}

/** The raw cell inputs of a range (formula expressions preserved), row-major.
 *  `rows` limits the copy to specific document rows (see {@link rangeToTsv}). */
export function rangeToMatrix(doc: ReadableDocument, range: CellRange, rows?: readonly number[]): string[][] {
  const out: string[][] = [];
  const rowList = rows ?? copyRows(range, null);
  for (const r of rowList) {
    const row: string[] = [];
    for (let c = range.left; c <= range.right; c++) {
      row.push(doc.getValue(r, c));
    }
    out.push(row);
  }
  return out;
}

/**
 * Parse clipboard text into a rectangular matrix: rows split on CRLF/LF/CR,
 * cells split on tabs. Quoted cells (produced by spreadsheet software for
 * multi-line content) are unquoted. A single trailing empty line — which
 * spreadsheet software appends — is dropped. The matrix is padded to be
 * rectangular.
 */
export function parseClipboardText(text: string): string[][] {
  if (text === '') {
    return [];
  }
  // Quoted cells may contain newlines; split rows respecting quotes.
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  let cellStarted = false;
  let quotedCell = false;
  let i = 0;
  const pushCell = () => {
    if (quotedCell) {
      // Strip the surrounding quotes and unescape doubled quotes.
      cell = cell.replace(/""/g, '"');
    }
    row.push(cell);
    cell = '';
    cellStarted = false;
    quotedCell = false;
  };
  const pushRow = () => {
    pushCell();
    rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && !cellStarted) {
      inQuotes = true;
      cellStarted = true;
      quotedCell = true;
      i += 1;
      continue;
    }
    if (ch === '\t') {
      pushCell();
      i += 1;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      pushRow();
      i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    cell += ch;
    cellStarted = true;
    i += 1;
  }
  pushRow();
  // Drop a single trailing empty row (trailing newline convention).
  if (rows.length > 1) {
    const last = rows[rows.length - 1];
    if (last.length === 1 && last[0] === '') {
      rows.pop();
    }
  }
  // Pad to a rectangle.
  const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
  for (const r of rows) {
    while (r.length < width) {
      r.push('');
    }
  }
  return rows;
}
