// SPDX-License-Identifier: MIT
/**
 * Lossy grid → JSON (array-of-records) export.
 *
 * Unlike `.xlsx`, a plain JSON document has no native concept of multiple
 * worksheets, so this mirrors CSV export's single-table scope rather than
 * XLSX export's whole-workbook scope: the caller (`FileIoCommands.exportJson`)
 * picks one worksheet, exactly as `exportCsv` does, and this module turns its
 * displayed (calculated) values into a JSON array of objects — the first row
 * supplies field names, and every following row becomes one record. Field
 * names are sanitized (blank becomes `ColumnN`) and de-duplicated, mirroring
 * `xlsx-export.ts`'s worksheet-name handling, since JSON object keys must be
 * unique to be lossless. Cell text becomes a JSON number or boolean only when
 * it is the exact canonical form `.xlsx` export already treats as a plain
 * number (see `xlsx-export.ts`'s `isCanonicalNumber`) or exactly "TRUE"/
 * "FALSE"; every other value round-trips as a JSON string.
 */

const CANONICAL_NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?$/;

function isCanonicalNumber(text: string): boolean {
  return CANONICAL_NUMBER.test(text) && Number.isFinite(Number(text)) && String(Number(text)) === text;
}

function cellToJsonValue(text: string): string | number | boolean | null {
  if (text === '') return null;
  if (text === 'TRUE') return true;
  if (text === 'FALSE') return false;
  if (isCanonicalNumber(text)) return Number(text);
  return text;
}

/** Blank names get a positional fallback; repeats get a `(2)`, `(3)`, … suffix, both like `xlsx-export.ts`'s `sanitizeSheetName`. */
function sanitizeFieldNames(header: string[]): string[] {
  const taken = new Set<string>();
  return header.map((name, i) => {
    const base = name.trim().length > 0 ? name.trim() : `Column${i + 1}`;
    let candidate = base;
    let suffix = 2;
    while (taken.has(candidate)) {
      candidate = `${base} (${suffix})`;
      suffix++;
    }
    taken.add(candidate);
    return candidate;
  });
}

/**
 * Build a JSON array-of-objects document from one worksheet's display
 * values; `rows[0]` supplies the field names and every following row becomes
 * one record. An input with no rows produces an empty JSON array.
 */
export function buildJsonExport(rows: string[][]): Uint8Array {
  const header = sanitizeFieldNames(rows[0] ?? []);
  const records = rows.slice(1).map((row) => {
    const record: Record<string, string | number | boolean | null> = {};
    header.forEach((field, i) => {
      record[field] = cellToJsonValue(row[i] ?? '');
    });
    return record;
  });
  return new TextEncoder().encode(JSON.stringify(records, null, 2));
}
