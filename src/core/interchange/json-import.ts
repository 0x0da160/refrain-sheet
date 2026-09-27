// SPDX-License-Identifier: MIT
/**
 * JSON → workbook import.
 *
 * Reads a flat, tabular subset of JSON — a top-level array of flat objects,
 * one element per row, columns as the union of every object's keys in
 * first-seen order — into row-major grid values, following the same lossy
 * "import → new RSF tab" scope already used for `.xlsx`
 * (`xlsx-import.ts`). Deeply nested values (an object or array as a property
 * value) have no single standard flattening convention, so a document
 * shaped that way is rejected with a typed error rather than being silently
 * flattened or dropped.
 */

export type JsonImportError = 'invalid-json' | 'not-an-array' | 'empty-array' | 'not-flat-object';

export type JsonImportResult =
  { ok: true; rows: string[][]; columnCount: number } | { ok: false; error: JsonImportError };

type FlatValue = string | number | boolean | null;

function isFlatValue(value: unknown): value is FlatValue {
  return (
    value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
  );
}

/** Matches the display text `.xlsx` import already produces for the same JS types (see `xlsx-import.ts`'s `t="b"` case). */
function displayValue(value: FlatValue): string {
  if (value === null) return '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return String(value);
}

/**
 * Parse JSON bytes into a dense grid. Never throws: a parse failure or a
 * document shape this importer does not support (not an array, an empty
 * array, or an element that is not a flat object) is reported as a typed
 * error, and nothing is partially returned.
 */
export function parseJsonWorkbook(bytes: Uint8Array): JsonImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8').decode(bytes));
  } catch {
    return { ok: false, error: 'invalid-json' };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, error: 'not-an-array' };
  }
  if (parsed.length === 0) {
    return { ok: false, error: 'empty-array' };
  }

  const columns: string[] = [];
  const columnIndex = new Map<string, number>();
  const rows: string[][] = [];
  for (const element of parsed) {
    if (typeof element !== 'object' || element === null || Array.isArray(element)) {
      return { ok: false, error: 'not-flat-object' };
    }
    const row: string[] = new Array<string>(columns.length).fill('');
    for (const [key, value] of Object.entries(element as Record<string, unknown>)) {
      if (!isFlatValue(value)) {
        return { ok: false, error: 'not-flat-object' };
      }
      let index = columnIndex.get(key);
      if (index === undefined) {
        index = columns.length;
        columns.push(key);
        columnIndex.set(key, index);
        for (const existing of rows) existing.push('');
        row.push('');
      }
      row[index] = displayValue(value);
    }
    rows.push(row);
  }
  return { ok: true, rows, columnCount: columns.length };
}
