// SPDX-License-Identifier: MIT
import { hasUtf8Bom } from './encoding';

export type DelimiterId = ',' | ';' | '\t';

const QUOTE = 0x22;
const CR = 0x0d;
const LF = 0x0a;
const SPACE = 0x20;
const TAB = 0x09;

export type DiagnosticType =
  'unclosed-quote' | 'text-after-quote' | 'bare-quote' | 'inconsistent-field-count' | 'ambiguous';

export interface Diagnostic {
  /** 1-based record number. */
  row: number;
  /** 1-based field number within the record. */
  column: number;
  type: DiagnosticType;
  /** Extra data for inconsistent-field-count. */
  expected?: number;
  actual?: number;
}

/**
 * A materialized field. All positions are byte offsets into the original
 * file, so the serializer can copy unmodified regions byte-for-byte.
 * Fields are materialized lazily from the flat parse index (see
 * LosslessDocument); for large files most fields are never materialized.
 */
export interface FieldNode {
  /** Full raw span of the field, including whitespace around quotes. */
  start: number;
  end: number;
  quoted: boolean;
  /** Byte range of the value portion (inside the quotes for quoted fields). */
  contentStart: number;
  contentEnd: number;
  /** start..prefixEnd — preserved bytes before the opening quote. */
  prefixEnd: number;
  /** suffixStart..end — preserved bytes after the closing quote. */
  suffixStart: number;
  /** Original decoded display value. */
  value: string;
  /** The field's value bytes contain sequences the encoding cannot decode. */
  hasUndecodable: boolean;
  /** The field has a structural problem (unclosed quote, bare quote, trailing text). */
  malformed: boolean;
}

export interface LineEndingStats {
  crlf: number;
  lf: number;
  cr: number;
}

/**
 * Flat structural index of a parsed CSV byte sequence. The layout matches
 * the Rust/WASM core exactly (see wasm/src/csv.rs):
 *
 * - records, stride RECORD_STRIDE:
 *   [start, end, termStart, termEnd, fieldOffset, fieldCount]
 * - fields, stride FIELD_STRIDE:
 *   [start, end, contentStart, contentEnd, prefixEnd, suffixStart, flags]
 * - diagnostics, stride DIAG_STRIDE:
 *   [row (1-based), column (1-based), type, expected, actual]
 */
export interface ParsedIndex {
  records: Uint32Array;
  fields: Uint32Array;
  diagnostics: Uint32Array;
  lineEndings: LineEndingStats;
  hasFinalNewline: boolean;
  /** Byte length of a leading UTF-8 BOM (0 or 3). */
  bomLength: number;
}

export const RECORD_STRIDE = 6;
export const FIELD_STRIDE = 7;
export const DIAG_STRIDE = 5;

export const FLAG_QUOTED = 1;
export const FLAG_MALFORMED = 2;

/** Numeric diagnostic codes shared with the WASM core. */
export const DIAG_TYPES: readonly DiagnosticType[] = [
  'unclosed-quote',
  'text-after-quote',
  'bare-quote',
  'inconsistent-field-count',
  'ambiguous',
];

const DIAG_UNCLOSED_QUOTE = 0;
const DIAG_TEXT_AFTER_QUOTE = 1;
const DIAG_BARE_QUOTE = 2;
const DIAG_INCONSISTENT_FIELD_COUNT = 3;
const DIAG_AMBIGUOUS = 4;

function isFieldWhitespace(byte: number, delimiter: number): boolean {
  return byte === SPACE || (byte === TAB && delimiter !== TAB);
}

/** Replace `""` byte pairs with `"` inside quoted content. Safe at byte level for all supported encodings. */
export function unescapeQuotedBytes(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length);
  let n = 0;
  for (let i = 0; i < bytes.length; i++) {
    out[n++] = bytes[i];
    if (bytes[i] === QUOTE && i + 1 < bytes.length && bytes[i + 1] === QUOTE) {
      i += 1;
    }
  }
  return out.subarray(0, n);
}

/**
 * Guess the delimiter by counting candidate bytes outside quoted regions in
 * the first part of the file. Defaults to a comma. (JS fallback; the WASM
 * engine implements the identical heuristic.)
 */
export function detectDelimiterJs(bytes: Uint8Array): DelimiterId {
  const limit = Math.min(bytes.length, 64 * 1024);
  const counts: Record<DelimiterId, number> = { ',': 0, ';': 0, '\t': 0 };
  let inQuotes = false;
  for (let i = hasUtf8Bom(bytes) ? 3 : 0; i < limit; i++) {
    const b = bytes[i];
    if (b === QUOTE) {
      inQuotes = !inQuotes;
    } else if (!inQuotes) {
      if (b === 0x2c) counts[','] += 1;
      else if (b === 0x3b) counts[';'] += 1;
      else if (b === TAB) counts['\t'] += 1;
    }
  }
  let best: DelimiterId = ',';
  for (const d of [';', '\t'] as DelimiterId[]) {
    if (counts[d] > counts[best]) best = d;
  }
  return best;
}

/** Growable Uint32Array buffer so large files avoid millions of array pushes. */
class U32Buf {
  private buf = new Uint32Array(1024);
  length = 0;

  push6(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.ensure(6);
    const buf = this.buf;
    let n = this.length;
    buf[n++] = a;
    buf[n++] = b;
    buf[n++] = c;
    buf[n++] = d;
    buf[n++] = e;
    buf[n++] = f;
    this.length = n;
  }

  push7(a: number, b: number, c: number, d: number, e: number, f: number, g: number): void {
    this.ensure(7);
    const buf = this.buf;
    let n = this.length;
    buf[n++] = a;
    buf[n++] = b;
    buf[n++] = c;
    buf[n++] = d;
    buf[n++] = e;
    buf[n++] = f;
    buf[n++] = g;
    this.length = n;
  }

  push5(a: number, b: number, c: number, d: number, e: number): void {
    this.ensure(5);
    const buf = this.buf;
    let n = this.length;
    buf[n++] = a;
    buf[n++] = b;
    buf[n++] = c;
    buf[n++] = d;
    buf[n++] = e;
    this.length = n;
  }

  at(i: number): number {
    return this.buf[i];
  }

  toArray(): Uint32Array {
    return this.buf.slice(0, this.length);
  }

  private ensure(extra: number): void {
    if (this.length + extra <= this.buf.length) return;
    const next = new Uint32Array(Math.max(this.buf.length * 2, this.length + extra));
    next.set(this.buf.subarray(0, this.length));
    this.buf = next;
  }
}

/**
 * Parse CSV structure at the byte level into a flat index (JS fallback
 * implementation; semantics identical to the Rust/WASM core). The structural
 * bytes `"`, the delimiter, CR, and LF never occur inside multibyte
 * characters in UTF-8, CP932, or EUC-JP, so structure is tracked before any
 * text is decoded. Parsing never modifies the input and never repairs
 * malformed content.
 */
export function parseCsvIndexJs(
  bytes: Uint8Array,
  delimiter: DelimiterId,
  treatUtf8Bom: boolean,
): ParsedIndex {
  const delimByte = delimiter.charCodeAt(0);
  const bomLength = treatUtf8Bom && hasUtf8Bom(bytes) ? 3 : 0;
  const len = bytes.length;
  const records = new U32Buf();
  const fields = new U32Buf();
  const diagnostics = new U32Buf();
  const lineEndings: LineEndingStats = { crlf: 0, lf: 0, cr: 0 };

  let pos = bomLength;
  let recordCount = 0;
  while (pos < len) {
    const recordStart = pos;
    const fieldOffset = fields.length / FIELD_STRIDE;
    let fieldCount = 0;
    let termStart = len;
    let termEnd = len;
    let lastFieldEnd = recordStart;
    for (;;) {
      // ----- scan one field (same algorithm as wasm/src/csv.rs) -----
      const fieldStart = pos;
      let i = pos;
      while (i < len && isFieldWhitespace(bytes[i], delimByte)) i++;
      if (i < len && bytes[i] === QUOTE) {
        const prefixEnd = i;
        const contentStart = i + 1;
        let j = contentStart;
        let closed = false;
        while (j < len) {
          if (bytes[j] === QUOTE) {
            if (j + 1 < len && bytes[j + 1] === QUOTE) {
              j += 2;
              continue;
            }
            closed = true;
            break;
          }
          j += 1;
        }
        if (!closed) {
          // Unclosed quote: the rest of the file belongs to this field.
          fields.push7(fieldStart, len, contentStart, len, prefixEnd, len, FLAG_QUOTED | FLAG_MALFORMED);
          fieldCount += 1;
          diagnostics.push5(recordCount + 1, fieldCount, DIAG_UNCLOSED_QUOTE, 0, 0);
          let sawTerminator = false;
          for (let k = contentStart; k < len; k++) {
            if (bytes[k] === CR || bytes[k] === LF) {
              sawTerminator = true;
              break;
            }
          }
          if (sawTerminator) {
            diagnostics.push5(recordCount + 1, fieldCount, DIAG_AMBIGUOUS, 0, 0);
          }
          lastFieldEnd = len;
          pos = len;
        } else {
          const contentEnd = j;
          const suffixStart = j + 1;
          let end = suffixStart;
          let junk = false;
          while (end < len && bytes[end] !== delimByte && bytes[end] !== CR && bytes[end] !== LF) {
            if (!isFieldWhitespace(bytes[end], delimByte)) junk = true;
            end += 1;
          }
          fields.push7(
            fieldStart,
            end,
            contentStart,
            contentEnd,
            prefixEnd,
            suffixStart,
            FLAG_QUOTED | (junk ? FLAG_MALFORMED : 0),
          );
          fieldCount += 1;
          if (junk) {
            diagnostics.push5(recordCount + 1, fieldCount, DIAG_TEXT_AFTER_QUOTE, 0, 0);
          }
          lastFieldEnd = end;
          pos = end;
        }
      } else {
        // Unquoted field: everything up to the delimiter or record
        // terminator, including surrounding whitespace, is the raw value.
        let end = i;
        let bareQuote = false;
        while (end < len && bytes[end] !== delimByte && bytes[end] !== CR && bytes[end] !== LF) {
          if (bytes[end] === QUOTE) bareQuote = true;
          end += 1;
        }
        fields.push7(fieldStart, end, fieldStart, end, fieldStart, end, bareQuote ? FLAG_MALFORMED : 0);
        fieldCount += 1;
        if (bareQuote) {
          diagnostics.push5(recordCount + 1, fieldCount, DIAG_BARE_QUOTE, 0, 0);
        }
        lastFieldEnd = end;
        pos = end;
      }

      if (pos >= len) {
        termStart = len;
        termEnd = len;
        break;
      }
      const b = bytes[pos];
      if (b === delimByte) {
        pos += 1;
        if (pos >= len) {
          // Trailing delimiter at EOF implies a final empty field.
          fields.push7(len, len, len, len, len, len, 0);
          fieldCount += 1;
          lastFieldEnd = len;
          termStart = len;
          termEnd = len;
          break;
        }
        continue;
      }
      termStart = pos;
      if (b === CR && pos + 1 < len && bytes[pos + 1] === LF) {
        termEnd = pos + 2;
        lineEndings.crlf += 1;
      } else {
        termEnd = pos + 1;
        if (b === CR) lineEndings.cr += 1;
        else lineEndings.lf += 1;
      }
      pos = termEnd;
      break;
    }
    records.push6(recordStart, lastFieldEnd, termStart, termEnd, fieldOffset, fieldCount);
    recordCount += 1;
  }

  if (recordCount > 1) {
    const expected = records.at(5);
    for (let r = 1; r < recordCount; r++) {
      const actual = records.at(r * RECORD_STRIDE + 5);
      if (actual !== expected) {
        diagnostics.push5(r + 1, 1, DIAG_INCONSISTENT_FIELD_COUNT, expected, actual);
      }
    }
  }

  const hasFinalNewline =
    recordCount > 0 &&
    records.at((recordCount - 1) * RECORD_STRIDE + 2) < records.at((recordCount - 1) * RECORD_STRIDE + 3);

  return {
    records: records.toArray(),
    fields: fields.toArray(),
    diagnostics: diagnostics.toArray(),
    lineEndings,
    hasFinalNewline,
    bomLength,
  };
}

/** Materialize the Diagnostic list from a flat index. */
export function materializeDiagnostics(index: ParsedIndex): Diagnostic[] {
  const out: Diagnostic[] = [];
  const d = index.diagnostics;
  for (let i = 0; i < d.length; i += DIAG_STRIDE) {
    const type = DIAG_TYPES[d[i + 2]];
    const diag: Diagnostic = { row: d[i], column: d[i + 1], type };
    if (type === 'inconsistent-field-count') {
      diag.expected = d[i + 3];
      diag.actual = d[i + 4];
    }
    out.push(diag);
  }
  return out;
}
