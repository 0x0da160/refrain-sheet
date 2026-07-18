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

  /**
   * Materialize one field lazily: offsets come from the flat index, the
   * value is decoded on demand and cached (bounded cache).
   */
  getField(row: number, col: number): FieldNode | null {
    if (row < 0 || row >= this.rowCount || col < 0) {
      return null;
    }
    const base = row * RECORD_STRIDE;
    const records = this.index.records;
    if (col >= records[base + 5]) {
      return null;
    }
    const fieldIndex = records[base + 4] + col;
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
    const prefixEnd = fields[f + 4];
    const suffixStart = fields[f + 5];
    const flags = fields[f + 6];
    const quoted = (flags & FLAG_QUOTED) !== 0;
    const malformed = (flags & FLAG_MALFORMED) !== 0;

    let value: string;
    let hasUndecodable: boolean;
    if (quoted) {
      const raw = unescapeQuotedBytes(this.bytes.subarray(contentStart, contentEnd));
      value = decodeBytes(raw, this.encoding);
      hasUndecodable = !decodesCleanly(raw, this.encoding);
      if (malformed && suffixStart < end) {
        // Junk after the closing quote is part of the displayed value.
        const suffixBytes = this.bytes.subarray(suffixStart, end);
        value += decodeBytes(suffixBytes, this.encoding);
        hasUndecodable = hasUndecodable || !decodesCleanly(suffixBytes, this.encoding);
      }
    } else {
      const raw = this.bytes.subarray(contentStart, contentEnd);
      value = decodeBytes(raw, this.encoding);
      hasUndecodable = !decodesCleanly(raw, this.encoding);
    }

    const node: FieldNode = {
      start,
      end,
      quoted,
      contentStart,
      contentEnd,
      prefixEnd,
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

  /** Original decoded value of a cell. */
  getOriginalValue(row: number, col: number): string {
    return this.getField(row, col)?.value ?? '';
  }

  /** Current value of a cell: the edited value if present, otherwise the original. */
  getValue(row: number, col: number): string {
    return this.edits.get(`${row},${col}`) ?? this.getOriginalValue(row, col);
  }

  /** Displayed value; identical to getValue for CSV documents (no formulas). */
  getDisplayValue(row: number, col: number): string {
    return this.getValue(row, col);
  }

  isEdited(row: number, col: number): boolean {
    return this.edits.has(`${row},${col}`);
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
