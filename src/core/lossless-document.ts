// SPDX-License-Identifier: MIT
import {
  FIELD_STRIDE,
  FLAG_MALFORMED,
  FLAG_QUOTED,
  RECORD_STRIDE,
  materializeDiagnostics,
  unescapeQuotedBytes,
  type DelimiterId,
  type Diagnostic,
  type FieldNode,
  type ParsedIndex,
} from './byte-csv-parser';
import { getCsvEngine } from './csv-engine';
import { decodeBytes, decodesCleanly, detectEncoding, type EncodingId } from './encoding';

export interface DocumentInterpretation {
  encoding: EncodingId;
  hasBom: boolean;
  delimiter: DelimiterId;
}

export interface RecordSpan {
  start: number;
  end: number;
  termStart: number;
  termEnd: number;
  fieldCount: number;
}

/** Longest field {@link asciiString} builds by hand; longer ones go to `TextDecoder`, which wins there. */
const ASCII_FAST_MAX = 32;

/**
 * The string for `bytes[start..end)` when that range is short and pure ASCII
 * (collapsing each doubled quote to one when `unescape` is set, exactly like
 * `unescapeQuotedBytes`), or null to fall back to the full decoder.
 */
function asciiString(bytes: Uint8Array, start: number, end: number, unescape: boolean): string | null {
  if (end - start > ASCII_FAST_MAX) {
    return null;
  }
  let out = '';
  for (let i = start; i < end; i++) {
    const b = bytes[i];
    if (b > 0x7f) {
      return null;
    }
    out += String.fromCharCode(b);
    if (unescape && b === 0x22 && i + 1 < end && bytes[i + 1] === 0x22) {
      i += 1;
    }
  }
  return out;
}

/** Cap on the number of lazily materialized FieldNodes kept in memory. */
const FIELD_CACHE_LIMIT = 100_000;

/**
 * A byte-preserving CSV document. The original bytes are kept verbatim and
 * edits are stored as an overlay keyed by cell position, so a document with
 * no edits can always be saved as the exact original byte sequence.
 *
 * Structure comes from the byte-level engine (Rust/WASM, with a JS fallback)
 * as flat offset arrays; cell values are decoded lazily so files with
 * hundreds of thousands of rows do not materialize millions of strings.
 */
export class LosslessDocument {
  readonly kind = 'csv' as const;
  readonly bytes: Uint8Array;
  readonly encoding: EncodingId;
  readonly hasBom: boolean;
  readonly delimiter: DelimiterId;
  readonly lineEndings: ParsedIndex['lineEndings'];
  readonly hasFinalNewline: boolean;
  readonly bomLength: number;
  readonly columnCount: number;
  /** Name of the engine that parsed this document ('wasm' or 'js'). */
  readonly engineName: string;

  private readonly index: ParsedIndex;
  private readonly edits = new Map<string, string>();
  private readonly fieldCache = new Map<number, FieldNode>();
  private diagnosticsCache: Diagnostic[] | null = null;
  private diagnosticsByField: Map<string, Diagnostic[]> | null = null;
  private undecodableCache: boolean | null = null;

  constructor(bytes: Uint8Array, interpretation: DocumentInterpretation) {
    this.bytes = bytes;
    this.encoding = interpretation.encoding;
    this.hasBom = interpretation.hasBom;
    this.delimiter = interpretation.delimiter;
    const engine = getCsvEngine();
    this.engineName = engine.name;
    this.index = engine.parseIndex(bytes, this.delimiter, this.encoding === 'utf-8');
    this.lineEndings = this.index.lineEndings;
    this.hasFinalNewline = this.index.hasFinalNewline;
    this.bomLength = this.index.bomLength;
    let maxFields = 0;
    const records = this.index.records;
    for (let i = RECORD_STRIDE - 1; i < records.length; i += RECORD_STRIDE) {
      if (records[i] > maxFields) maxFields = records[i];
    }
    this.columnCount = maxFields;
  }

  static fromBytes(bytes: Uint8Array, interpretation?: Partial<DocumentInterpretation>): LosslessDocument {
    const detected = detectEncoding(bytes);
    return new LosslessDocument(bytes, {
      encoding: interpretation?.encoding ?? detected.encoding,
      hasBom: interpretation?.encoding ? (interpretation.hasBom ?? detected.hasBom) : detected.hasBom,
      delimiter: interpretation?.delimiter ?? getCsvEngine().sniffDelimiter(bytes),
    });
  }

  /** Reinterpret the same original bytes with a different encoding or delimiter. Edits are not carried over. */
  reinterpret(interpretation: Partial<DocumentInterpretation>): LosslessDocument {
    return new LosslessDocument(this.bytes, {
      encoding: interpretation.encoding ?? this.encoding,
      hasBom: interpretation.encoding
        ? interpretation.encoding === 'utf-8' && this.bomLength > 0
        : this.hasBom,
      delimiter: interpretation.delimiter ?? this.delimiter,
    });
  }

  get rowCount(): number {
    return this.index.records.length / RECORD_STRIDE;
  }

  /** Number of fields in one record (0 for out-of-range rows). */
  fieldCount(row: number): number {
    if (row < 0 || row >= this.rowCount) {
      return 0;
    }
    return this.index.records[row * RECORD_STRIDE + 5];
  }

  /** Byte spans of one record, including its terminator. */
  recordSpan(row: number): RecordSpan | null {
    if (row < 0 || row >= this.rowCount) {
      return null;
    }
    const base = row * RECORD_STRIDE;
    const records = this.index.records;
    return {
      start: records[base],
      end: records[base + 1],
      termStart: records[base + 2],
      termEnd: records[base + 3],
      fieldCount: records[base + 5],
    };
  }

  /** Structural diagnostics (materialized lazily from the parse index). */
  get diagnostics(): Diagnostic[] {
    this.diagnosticsCache ??= materializeDiagnostics(this.index);
    return this.diagnosticsCache;
  }

  /** Number of structural diagnostics without materializing them. */
  get diagnosticCount(): number {
    return this.index.diagnostics.length / 5;
  }

  /** Structural diagnostics attached to one field (row/col are 0-based). */
  getFieldDiagnostics(row: number, col: number): Diagnostic[] {
    if (!this.diagnosticsByField) {
      const map = new Map<string, Diagnostic[]>();
      for (const d of this.diagnostics) {
        const key = `${d.row - 1},${d.column - 1}`;
        const list = map.get(key);
        if (list) {
          list.push(d);
        } else {
          map.set(key, [d]);
        }
      }
      this.diagnosticsByField = map;
    }
    return this.diagnosticsByField.get(`${row},${col}`) ?? [];
  }

  /**
   * Materialize one field lazily: offsets come from the flat index, the
   * value is decoded on demand and cached (bounded cache).
   */
  getField(row: number, col: number): FieldNode | null {
    const fieldIndex = this.fieldIndexOf(row, col);
    if (fieldIndex < 0) {
      return null;
    }
    const cached = this.fieldCache.get(fieldIndex);
    if (cached) {
      return cached;
    }
    const f = fieldIndex * FIELD_STRIDE;
    const fields = this.index.fields;
    const start = fields[f];
    const end = fields[f + 1];
    const contentStart = fields[f + 2];
    const contentEnd = fields[f + 3];
    const flags = fields[f + 6];
    const quoted = (flags & FLAG_QUOTED) !== 0;
    const malformed = (flags & FLAG_MALFORMED) !== 0;
    const suffixStart = fields[f + 5];
    const value = this.decodeField(fieldIndex);
    // A file that decodes cleanly as a whole has no undecodable field (see
    // hasUndecodableAnywhere), so the per-field strict decode only runs for
    // the rare file that does contain undecodable bytes.
    let hasUndecodable = false;
    if (this.hasUndecodableAnywhere()) {
      const raw = quoted
        ? unescapeQuotedBytes(this.bytes.subarray(contentStart, contentEnd))
        : this.bytes.subarray(contentStart, contentEnd);
      hasUndecodable = !decodesCleanly(raw, this.encoding);
      if (quoted && malformed && suffixStart < end) {
        hasUndecodable =
          hasUndecodable || !decodesCleanly(this.bytes.subarray(suffixStart, end), this.encoding);
      }
    }

    const node: FieldNode = {
      start,
      end,
      quoted,
      contentStart,
      contentEnd,
      prefixEnd: fields[f + 4],
      suffixStart,
      value,
      hasUndecodable,
      malformed,
    };
    if (this.fieldCache.size >= FIELD_CACHE_LIMIT) {
      this.fieldCache.clear();
    }
    this.fieldCache.set(fieldIndex, node);
    return node;
  }

  /** Flat index of a field in the parse index, or -1 when (row, col) holds none. */
  private fieldIndexOf(row: number, col: number): number {
    const records = this.index.records;
    const base = row * RECORD_STRIDE;
    if (row < 0 || base >= records.length || col < 0 || col >= records[base + 5]) {
      return -1;
    }
    return records[base + 4] + col;
  }

  /**
   * Decode one field's displayed value. Short all-ASCII fields — the bulk of
   * a typical CSV — are built directly from the bytes: every supported
   * encoding maps ASCII bytes to the same code points, so this is exactly
   * what `TextDecoder` returns, without a view allocation and a native call
   * per field. Anything else goes through the encoding's decoder.
   */
  private decodeField(fieldIndex: number): string {
    const f = fieldIndex * FIELD_STRIDE;
    const fields = this.index.fields;
    const contentStart = fields[f + 2];
    const contentEnd = fields[f + 3];
    const flags = fields[f + 6];
    const bytes = this.bytes;
    if ((flags & FLAG_QUOTED) === 0) {
      return (
        asciiString(bytes, contentStart, contentEnd, false) ??
        decodeBytes(bytes.subarray(contentStart, contentEnd), this.encoding)
      );
    }
    let value =
      asciiString(bytes, contentStart, contentEnd, true) ??
      decodeBytes(unescapeQuotedBytes(bytes.subarray(contentStart, contentEnd)), this.encoding);
    const end = fields[f + 1];
    const suffixStart = fields[f + 5];
    if ((flags & FLAG_MALFORMED) !== 0 && suffixStart < end) {
      // Junk after the closing quote is part of the displayed value.
      value +=
        asciiString(bytes, suffixStart, end, false) ??
        decodeBytes(bytes.subarray(suffixStart, end), this.encoding);
    }
    return value;
  }

  /** Original decoded value of a cell. */
  getOriginalValue(row: number, col: number): string {
    // Value-only reads (whole-sheet scans, conversion, rendering) skip the
    // FieldNode and its cache: decoding is cheaper than the bookkeeping.
    const fieldIndex = this.fieldIndexOf(row, col);
    if (fieldIndex < 0) {
      return '';
    }
    return this.fieldCache.get(fieldIndex)?.value ?? this.decodeField(fieldIndex);
  }

  /** Current value of a cell: the edited value if present, otherwise the original. */
  getValue(row: number, col: number): string {
    if (this.edits.size === 0) {
      return this.getOriginalValue(row, col);
    }
    return this.edits.get(`${row},${col}`) ?? this.getOriginalValue(row, col);
  }

  /** Displayed value; identical to getValue for CSV documents (no formulas). */
  getDisplayValue(row: number, col: number): string {
    return this.getValue(row, col);
  }

  isEdited(row: number, col: number): boolean {
    return this.edits.size > 0 && this.edits.has(`${row},${col}`);
  }

  /**
   * Set a cell's current value. Setting a cell back to its original value
   * removes the edit, so the dirty state reflects real differences only.
   */
  setValue(row: number, col: number, value: string): void {
    const field = this.getField(row, col);
    if (!field) {
      return;
    }
    if (value === field.value) {
      this.edits.delete(`${row},${col}`);
    } else {
      this.edits.set(`${row},${col}`, value);
    }
  }

  revert(row: number, col: number): void {
    this.edits.delete(`${row},${col}`);
  }

  revertAll(): void {
    this.edits.clear();
  }

  get editCount(): number {
    return this.edits.size;
  }

  get isDirty(): boolean {
    return this.edits.size > 0;
  }

  /** All current edits as [row, col, value] triples, in row/column order. */
  listEdits(): Array<{ row: number; col: number; value: string }> {
    const out: Array<{ row: number; col: number; value: string }> = [];
    for (const [key, value] of this.edits) {
      const [row, col] = key.split(',').map(Number);
      out.push({ row, col, value });
    }
    out.sort((a, b) => a.row - b.row || a.col - b.col);
    return out;
  }

  /** Edited cells whose original bytes contained undecodable sequences. */
  listEditedUndecodable(): Array<{ row: number; col: number }> {
    return this.listEdits()
      .filter(({ row, col }) => this.getField(row, col)?.hasUndecodable)
      .map(({ row, col }) => ({ row, col }));
  }

  /**
   * True when the file contains byte sequences the current encoding cannot
   * decode. Structural bytes (quotes, delimiters, terminators, BOM) are
   * ASCII and always decodable, so a whole-file check is equivalent to
   * checking every field, without materializing any of them.
   */
  hasUndecodableAnywhere(): boolean {
    this.undecodableCache ??= !decodesCleanly(this.bytes, this.encoding);
    return this.undecodableCache;
  }
}
