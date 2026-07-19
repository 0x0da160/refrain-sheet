// SPDX-License-Identifier: MIT
/**
 * Lossy RCSV → CSV export planning and encoding.
 *
 * The export serializes the *displayed* (calculated) values of a spreadsheet
 * document into plain CSV with a user-chosen encoding, line-ending style, and
 * BOM behavior. It never touches the source document. Validation follows the
 * same rules as saving CSV documents: characters the target encoding cannot
 * represent cancel the export unless the user explicitly opts into the
 * documented numeric-character-reference replacement.
 *
 * The scan phase is exposed per-row so the command layer can time-slice it
 * (with progress) for large sheets; the final join/encode is a single
 * synchronous step over the already-prepared rows.
 */
import type { DelimiterId } from './byte-csv-parser';
import {
  UTF8_BOM,
  encodeText,
  findUnrepresentableChars,
  replaceUnrepresentableChars,
  type EncodingId,
} from './encoding';
import type { NcrCellReport, UnrepresentableCell } from './serializer';

export type CsvLineEnding = 'crlf' | 'lf' | 'cr';

export interface CsvExportOptions {
  encoding: EncodingId;
  /** Prepend a UTF-8 BOM. Only applicable to UTF-8; ignored for other encodings. */
  bom: boolean;
  lineEnding: CsvLineEnding;
}

export const DEFAULT_CSV_EXPORT_OPTIONS: CsvExportOptions = {
  encoding: 'utf-8',
  bom: false,
  lineEnding: 'lf',
};

export const LINE_ENDING_TEXT: Record<CsvLineEnding, string> = {
  crlf: '\r\n',
  lf: '\n',
  cr: '\r',
};

/** Accumulated result of the per-row export scan. */
export interface CsvExportScan {
  /** Validated (and, with `allowNcr`, already-replaced) cell texts, row-major. */
  rows: string[][];
  unrepresentable: UnrepresentableCell[];
  ncrReplacements: NcrCellReport[];
}

export function newCsvExportScan(): CsvExportScan {
  return { rows: [], unrepresentable: [], ncrReplacements: [] };
}

/**
 * Validate one row of display values against the target encoding and append
 * it to the scan. Without `allowNcr`, unrepresentable characters are reported
 * per cell (the export is expected to be cancelled); with it they are
 * replaced by numeric character references and counted per cell.
 */
export function scanCsvExportRow(
  scan: CsvExportScan,
  row: number,
  values: string[],
  encoding: EncodingId,
  allowNcr: boolean,
): void {
  const out: string[] = [];
  for (let col = 0; col < values.length; col++) {
    let text = values[col];
    if (encoding !== 'utf-8') {
      const bad = findUnrepresentableChars(text, encoding);
      if (bad.length > 0) {
        if (!allowNcr) {
          scan.unrepresentable.push({ row, col, chars: bad });
        } else {
          const replaced = replaceUnrepresentableChars(text, encoding);
          text = replaced.text;
          scan.ncrReplacements.push({ row, col, count: replaced.count });
        }
      }
    }
    out.push(text);
  }
  scan.rows.push(out);
}

/** Quote a field only when the delimiter, quotes, or line breaks require it. */
function csvField(text: string, delimiter: DelimiterId): string {
  if (text.includes(delimiter) || text.includes('"') || text.includes('\r') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/**
 * Join scanned rows into CSV text and encode it. The selected line ending
 * terminates every record (including the last); the BOM is applied exactly
 * as requested and only for UTF-8.
 */
export function buildCsvExportBytes(
  rows: string[][],
  delimiter: DelimiterId,
  options: CsvExportOptions,
): Uint8Array {
  const eol = LINE_ENDING_TEXT[options.lineEnding];
  const parts: string[] = [];
  for (const row of rows) {
    parts.push(row.map((v) => csvField(v, delimiter)).join(delimiter));
    parts.push(eol);
  }
  const body = encodeText(parts.join(''), options.encoding);
  if (!(options.bom && options.encoding === 'utf-8')) {
    return body;
  }
  const out = new Uint8Array(UTF8_BOM.length + body.length);
  out.set(UTF8_BOM, 0);
  out.set(body, UTF8_BOM.length);
  return out;
}

export type CsvExportResult =
  | { ok: true; bytes: Uint8Array; ncrReplacements: NcrCellReport[] }
  | { ok: false; unrepresentable: UnrepresentableCell[] };

/** One-shot export of a value matrix (scan + encode); used directly by tests. */
export function encodeCsvExport(
  values: string[][],
  delimiter: DelimiterId,
  options: CsvExportOptions,
  allowNcr = false,
): CsvExportResult {
  const scan = newCsvExportScan();
  for (let r = 0; r < values.length; r++) {
    scanCsvExportRow(scan, r, values[r], options.encoding, allowNcr);
  }
  if (scan.unrepresentable.length > 0) {
    return { ok: false, unrepresentable: scan.unrepresentable };
  }
  return {
    ok: true,
    bytes: buildCsvExportBytes(scan.rows, delimiter, options),
    ncrReplacements: scan.ncrReplacements,
  };
}
