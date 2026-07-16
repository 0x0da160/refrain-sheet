// SPDX-License-Identifier: MIT
import {
  detectDelimiter,
  parseCsvBytes,
  type DelimiterId,
  type Diagnostic,
  type FieldNode,
  type ParseResult,
  type RecordNode,
} from './byte-csv-parser';
import { detectEncoding, type EncodingId } from './encoding';

export interface DocumentInterpretation {
  encoding: EncodingId;
  hasBom: boolean;
  delimiter: DelimiterId;
}

/**
 * A byte-preserving CSV document. The original bytes are kept verbatim and
 * edits are stored as an overlay keyed by cell position, so a document with
 * no edits can always be saved as the exact original byte sequence.
 */
export class LosslessDocument {
  readonly bytes: Uint8Array;
  readonly encoding: EncodingId;
  readonly hasBom: boolean;
  readonly delimiter: DelimiterId;
  readonly records: RecordNode[];
  readonly diagnostics: Diagnostic[];
  readonly lineEndings: ParseResult['lineEndings'];
  readonly hasFinalNewline: boolean;
  readonly bomLength: number;
  readonly columnCount: number;

  private readonly edits = new Map<string, string>();

  constructor(bytes: Uint8Array, interpretation: DocumentInterpretation) {
    this.bytes = bytes;
    this.encoding = interpretation.encoding;
    this.hasBom = interpretation.hasBom;
    this.delimiter = interpretation.delimiter;
    const parsed = parseCsvBytes(bytes, this.encoding, this.delimiter);
    this.records = parsed.records;
    this.diagnostics = parsed.diagnostics;
    this.lineEndings = parsed.lineEndings;
    this.hasFinalNewline = parsed.hasFinalNewline;
    this.bomLength = parsed.bomLength;
    this.columnCount = this.records.reduce((max, r) => Math.max(max, r.fields.length), 0);
  }

  static fromBytes(bytes: Uint8Array, interpretation?: Partial<DocumentInterpretation>): LosslessDocument {
    const detected = detectEncoding(bytes);
    return new LosslessDocument(bytes, {
      encoding: interpretation?.encoding ?? detected.encoding,
      hasBom: interpretation?.encoding ? (interpretation.hasBom ?? detected.hasBom) : detected.hasBom,
      delimiter: interpretation?.delimiter ?? detectDelimiter(bytes),
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
    return this.records.length;
  }

  getField(row: number, col: number): FieldNode | null {
    return this.records[row]?.fields[col] ?? null;
  }

  /** Original decoded value of a cell. */
  getOriginalValue(row: number, col: number): string {
    return this.getField(row, col)?.value ?? '';
  }

  /** Current value of a cell: the edited value if present, otherwise the original. */
  getValue(row: number, col: number): string {
    return this.edits.get(`${row},${col}`) ?? this.getOriginalValue(row, col);
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
}
