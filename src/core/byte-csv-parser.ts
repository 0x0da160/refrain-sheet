// SPDX-License-Identifier: MIT
import { decodeBytes, decodesCleanly, hasUtf8Bom, type EncodingId } from './encoding';

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
 * A parsed field. All positions are byte offsets into the original file,
 * so the serializer can copy unmodified regions byte-for-byte.
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

export interface RecordNode {
  start: number;
  /** End of the last field (terminator excluded). */
  end: number;
  fields: FieldNode[];
  /** Byte range of the record terminator; termStart === termEnd when the file ends without one. */
  termStart: number;
  termEnd: number;
}

export interface LineEndingStats {
  crlf: number;
  lf: number;
  cr: number;
}

export interface ParseResult {
  records: RecordNode[];
  diagnostics: Diagnostic[];
  lineEndings: LineEndingStats;
  hasFinalNewline: boolean;
  /** Byte length of a leading UTF-8 BOM (0 or 3). */
  bomLength: number;
}

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
 * the first part of the file. Defaults to a comma.
 */
export function detectDelimiter(bytes: Uint8Array): DelimiterId {
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

interface FieldScan {
  field: FieldNode;
  /** Position of the byte that ended the field (delimiter, CR, LF, or EOF). */
  next: number;
  diagnostics: Omit<Diagnostic, 'row' | 'column'>[];
}

function scanField(bytes: Uint8Array, pos: number, delimiter: number, encoding: EncodingId): FieldScan {
  const len = bytes.length;
  const start = pos;
  const diags: Omit<Diagnostic, 'row' | 'column'>[] = [];
  let i = pos;
  while (i < len && isFieldWhitespace(bytes[i], delimiter)) i++;

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
      const contentEnd = len;
      const raw = unescapeQuotedBytes(bytes.subarray(contentStart, contentEnd));
      diags.push({ type: 'unclosed-quote' });
      let sawTerminator = false;
      for (let k = contentStart; k < contentEnd; k++) {
        if (bytes[k] === CR || bytes[k] === LF) {
          sawTerminator = true;
          break;
        }
      }
      if (sawTerminator) {
        diags.push({ type: 'ambiguous' });
      }
      return {
        field: {
          start,
          end: len,
          quoted: true,
          contentStart,
          contentEnd,
          prefixEnd,
          suffixStart: len,
          value: decodeBytes(raw, encoding),
          hasUndecodable: !decodesCleanly(raw, encoding),
          malformed: true,
        },
        next: len,
        diagnostics: diags,
      };
    }
    const contentEnd = j;
    const suffixStart = j + 1;
    let end = suffixStart;
    let junk = false;
    while (end < len && bytes[end] !== delimiter && bytes[end] !== CR && bytes[end] !== LF) {
      if (!isFieldWhitespace(bytes[end], delimiter)) junk = true;
      end += 1;
    }
    if (junk) diags.push({ type: 'text-after-quote' });
    const raw = unescapeQuotedBytes(bytes.subarray(contentStart, contentEnd));
    const suffixBytes = bytes.subarray(suffixStart, end);
    const value = junk
      ? decodeBytes(raw, encoding) + decodeBytes(suffixBytes, encoding)
      : decodeBytes(raw, encoding);
    const hasUndecodable = !decodesCleanly(raw, encoding) || (junk && !decodesCleanly(suffixBytes, encoding));
    return {
      field: {
        start,
        end,
        quoted: true,
        contentStart,
        contentEnd,
        prefixEnd,
        suffixStart,
        value,
        hasUndecodable,
        malformed: junk,
      },
      next: end,
      diagnostics: diags,
    };
  }

  // Unquoted field: everything up to the delimiter or record terminator,
  // including surrounding whitespace, is part of the raw value.
  let end = i;
  let bareQuote = false;
  while (end < len && bytes[end] !== delimiter && bytes[end] !== CR && bytes[end] !== LF) {
    if (bytes[end] === QUOTE) bareQuote = true;
    end += 1;
  }
  if (bareQuote) diags.push({ type: 'bare-quote' });
  const raw = bytes.subarray(start, end);
  return {
    field: {
      start,
      end,
      quoted: false,
      contentStart: start,
      contentEnd: end,
      prefixEnd: start,
      suffixStart: end,
      value: decodeBytes(raw, encoding),
      hasUndecodable: !decodesCleanly(raw, encoding),
      malformed: bareQuote,
    },
    next: end,
    diagnostics: diags,
  };
}

/**
 * Parse CSV structure at the byte level. The structural bytes `"`, the
 * delimiter, CR, and LF never occur inside multibyte characters in UTF-8,
 * CP932, or EUC-JP, so structure is tracked before any text is decoded.
 * Parsing never modifies the input and never repairs malformed content.
 */
export function parseCsvBytes(bytes: Uint8Array, encoding: EncodingId, delimiter: DelimiterId): ParseResult {
  const delimByte = delimiter.charCodeAt(0);
  const bomLength = encoding === 'utf-8' && hasUtf8Bom(bytes) ? 3 : 0;
  const len = bytes.length;
  const records: RecordNode[] = [];
  const diagnostics: Diagnostic[] = [];
  const lineEndings: LineEndingStats = { crlf: 0, lf: 0, cr: 0 };

  let pos = bomLength;
  while (pos < len) {
    const recordStart = pos;
    const fields: FieldNode[] = [];
    let termStart = len;
    let termEnd = len;
    for (;;) {
      const scan = scanField(bytes, pos, delimByte, encoding);
      const columnNumber = fields.length + 1;
      fields.push(scan.field);
      for (const d of scan.diagnostics) {
        diagnostics.push({ row: records.length + 1, column: columnNumber, ...d });
      }
      pos = scan.next;
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
          fields.push({
            start: len,
            end: len,
            quoted: false,
            contentStart: len,
            contentEnd: len,
            prefixEnd: len,
            suffixStart: len,
            value: '',
            hasUndecodable: false,
            malformed: false,
          });
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
    records.push({
      start: recordStart,
      end: fields.length > 0 ? fields[fields.length - 1].end : recordStart,
      fields,
      termStart,
      termEnd,
    });
  }

  if (records.length > 1) {
    const expected = records[0].fields.length;
    for (let r = 1; r < records.length; r++) {
      const actual = records[r].fields.length;
      if (actual !== expected) {
        diagnostics.push({
          row: r + 1,
          column: 1,
          type: 'inconsistent-field-count',
          expected,
          actual,
        });
      }
    }
  }

  const last = records[records.length - 1];
  const hasFinalNewline = records.length > 0 && last.termStart < last.termEnd;

  return { records, diagnostics, lineEndings, hasFinalNewline, bomLength };
}
