// SPDX-License-Identifier: MIT
import type { DelimiterId, FieldNode } from './byte-csv-parser';
import { getCsvEngine } from './csv-engine';
import {
  UTF8_BOM,
  encodeText,
  decodeBytes,
  findUnrepresentableChars,
  replaceUnrepresentableChars,
  type EncodingId,
} from './encoding';
import type { LosslessDocument } from './lossless-document';

export interface SaveOptions {
  encoding: 'keep' | EncodingId;
  bom: 'keep' | 'add' | 'remove';
  lineEnding: 'keep' | 'crlf' | 'lf' | 'cr';
}

export const KEEP_SAVE_OPTIONS: SaveOptions = { encoding: 'keep', bom: 'keep', lineEnding: 'keep' };

export interface UnrepresentableCell {
  row: number;
  col: number;
  chars: string[];
}

export interface NcrCellReport {
  row: number;
  col: number;
  count: number;
}

export type SerializeResult =
  | { ok: true; bytes: Uint8Array; mode: 'identity' | 'patch' | 'reencode'; ncrReplacements: NcrCellReport[] }
  | { ok: false; unrepresentable: UnrepresentableCell[] };

const LINE_ENDING_BYTES = {
  crlf: new Uint8Array([0x0d, 0x0a]),
  lf: new Uint8Array([0x0a]),
  cr: new Uint8Array([0x0d]),
} as const;

export function needsQuoting(value: string, delimiter: DelimiterId): boolean {
  return value.includes(delimiter) || value.includes('"') || value.includes('\r') || value.includes('\n');
}

function escapeQuotes(value: string): string {
  return value.replace(/"/g, '""');
}

interface Replacement {
  start: number;
  end: number;
  bytes: Uint8Array;
}

/**
 * Apply byte-range replacements through the CSV engine (Rust/WASM
 * serialization planning, with an identical JS fallback). Bytes outside the
 * replaced ranges are copied verbatim from the original input.
 */
function applyReplacements(bytes: Uint8Array, replacements: Replacement[]): Uint8Array {
  const ranges = new Uint32Array(replacements.length * 2);
  const payloadLens = new Uint32Array(replacements.length);
  let payloadTotal = 0;
  for (let i = 0; i < replacements.length; i++) {
    ranges[i * 2] = replacements[i].start;
    ranges[i * 2 + 1] = replacements[i].end;
    payloadLens[i] = replacements[i].bytes.length;
    payloadTotal += replacements[i].bytes.length;
  }
  const payload = new Uint8Array(payloadTotal);
  let off = 0;
  for (const r of replacements) {
    payload.set(r.bytes, off);
    off += r.bytes.length;
  }
  return getCsvEngine().applyReplacements(bytes, ranges, payload, payloadLens);
}

/**
 * Build the replacement bytes for a single edited field, preserving the
 * original quoting style and the original whitespace outside the quotes.
 */
function buildFieldBytes(
  doc: LosslessDocument,
  field: FieldNode,
  value: string,
  encoding: EncodingId,
): Uint8Array {
  const pieces: Uint8Array[] = [];
  if (field.quoted) {
    pieces.push(doc.bytes.subarray(field.start, field.prefixEnd));
    pieces.push(encodeText(`"${escapeQuotes(value)}"`, encoding));
    if (!field.malformed) {
      // Well-formed trailing whitespace is preserved; malformed trailing text
      // was part of the displayed value and is covered by the new value.
      pieces.push(doc.bytes.subarray(field.suffixStart, field.end));
    }
  } else if (needsQuoting(value, doc.delimiter)) {
    pieces.push(encodeText(`"${escapeQuotes(value)}"`, encoding));
  } else {
    pieces.push(encodeText(value, encoding));
  }
  let total = 0;
  for (const p of pieces) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of pieces) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** Textual image of a field for the whole-document re-encode path. */
function fieldText(doc: LosslessDocument, field: FieldNode, row: number, col: number): string {
  if (!doc.isEdited(row, col)) {
    // Unmodified fields keep their exact textual image (quotes, whitespace,
    // escaped quotes, malformed trailing text). Undecodable bytes cannot
    // survive a re-encode and become replacement characters.
    return decodeBytes(doc.bytes.subarray(field.start, field.end), doc.encoding);
  }
  const value = doc.getValue(row, col);
  if (field.quoted) {
    const prefix = decodeBytes(doc.bytes.subarray(field.start, field.prefixEnd), doc.encoding);
    const suffix = field.malformed
      ? ''
      : decodeBytes(doc.bytes.subarray(field.suffixStart, field.end), doc.encoding);
    return `${prefix}"${escapeQuotes(value)}"${suffix}`;
  }
  if (needsQuoting(value, doc.delimiter)) {
    return `"${escapeQuotes(value)}"`;
  }
  return value;
}

/**
 * Serialize a document.
 *
 * - With no edits and all options set to "keep", the original bytes are
 *   returned as-is (identity), never reserialized.
 * - With edits but no encoding change, only the byte ranges of edited fields
 *   (and, when requested, record terminators) are replaced; every other byte
 *   is copied verbatim from the original file.
 * - An explicit encoding change re-encodes the whole document while
 *   preserving quoting, whitespace, delimiters, and record structure.
 *
 * Characters the target encoding cannot represent cancel the save
 * (`ok: false`) unless `allowNcr` is set, in which case they are replaced by
 * numeric character references such as `&#128512;` and reported per cell.
 */
export function serializeDocument(
  doc: LosslessDocument,
  options: SaveOptions = KEEP_SAVE_OPTIONS,
  allowNcr = false,
): SerializeResult {
  const reencode = options.encoding !== 'keep' && options.encoding !== doc.encoding;
  if (reencode) {
    return serializeReencoded(doc, options, options.encoding as EncodingId, allowNcr);
  }
  return serializePatched(doc, options, allowNcr);
}

function serializePatched(doc: LosslessDocument, options: SaveOptions, allowNcr: boolean): SerializeResult {
  const encoding = doc.encoding;
  const replacements: Replacement[] = [];
  const unrepresentable: UnrepresentableCell[] = [];
  const ncrReplacements: NcrCellReport[] = [];

  if (options.bom === 'remove' && doc.bomLength > 0) {
    replacements.push({ start: 0, end: doc.bomLength, bytes: new Uint8Array(0) });
  } else if (options.bom === 'add' && doc.bomLength === 0 && encoding === 'utf-8') {
    replacements.push({ start: 0, end: 0, bytes: UTF8_BOM });
  }

  for (const { row, col, value } of doc.listEdits()) {
    const field = doc.getField(row, col);
    if (!field) continue;
    let text = value;
    const bad = findUnrepresentableChars(text, encoding);
    if (bad.length > 0) {
      if (!allowNcr) {
        unrepresentable.push({ row, col, chars: bad });
        continue;
      }
      const replaced = replaceUnrepresentableChars(text, encoding);
      text = replaced.text;
      ncrReplacements.push({ row, col, count: replaced.count });
    }
    replacements.push({
      start: field.start,
      end: field.end,
      bytes: buildFieldBytes(doc, field, text, encoding),
    });
  }

  if (unrepresentable.length > 0) {
    return { ok: false, unrepresentable };
  }

  if (options.lineEnding !== 'keep') {
    const target = LINE_ENDING_BYTES[options.lineEnding];
    for (let r = 0; r < doc.rowCount; r++) {
      const record = doc.recordSpan(r);
      if (!record || record.termStart >= record.termEnd) continue;
      const current = doc.bytes.subarray(record.termStart, record.termEnd);
      if (current.length === target.length && current.every((b, i) => b === target[i])) continue;
      replacements.push({ start: record.termStart, end: record.termEnd, bytes: target });
    }
  }

  if (replacements.length === 0) {
    return { ok: true, bytes: doc.bytes, mode: 'identity', ncrReplacements };
  }
  return { ok: true, bytes: applyReplacements(doc.bytes, replacements), mode: 'patch', ncrReplacements };
}

function serializeReencoded(
  doc: LosslessDocument,
  options: SaveOptions,
  encoding: EncodingId,
  allowNcr: boolean,
): SerializeResult {
  const unrepresentable: UnrepresentableCell[] = [];
  const ncrReplacements: NcrCellReport[] = [];
  const parts: string[] = [];

  for (let r = 0; r < doc.rowCount; r++) {
    const record = doc.recordSpan(r);
    if (!record) continue;
    for (let c = 0; c < record.fieldCount; c++) {
      if (c > 0) parts.push(doc.delimiter);
      const field = doc.getField(r, c);
      if (!field) continue;
      let text = fieldText(doc, field, r, c);
      const bad = findUnrepresentableChars(text, encoding);
      if (bad.length > 0) {
        if (!allowNcr) {
          unrepresentable.push({ row: r, col: c, chars: bad });
        } else {
          const replaced = replaceUnrepresentableChars(text, encoding);
          text = replaced.text;
          ncrReplacements.push({ row: r, col: c, count: replaced.count });
        }
      }
      parts.push(text);
    }
    if (record.termStart < record.termEnd) {
      // Only existing record terminators are rewritten; a missing final
      // newline stays missing.
      if (options.lineEnding === 'keep') {
        parts.push(decodeBytes(doc.bytes.subarray(record.termStart, record.termEnd), doc.encoding));
      } else {
        parts.push(options.lineEnding === 'crlf' ? '\r\n' : options.lineEnding === 'lf' ? '\n' : '\r');
      }
    }
  }

  if (unrepresentable.length > 0) {
    return { ok: false, unrepresentable };
  }

  const body = encodeText(parts.join(''), encoding);
  const wantBom =
    encoding === 'utf-8' && (options.bom === 'add' || (options.bom === 'keep' && doc.bomLength > 0));
  if (!wantBom) {
    return { ok: true, bytes: body, mode: 'reencode', ncrReplacements };
  }
  const out = new Uint8Array(UTF8_BOM.length + body.length);
  out.set(UTF8_BOM, 0);
  out.set(body, UTF8_BOM.length);
  return { ok: true, bytes: out, mode: 'reencode', ncrReplacements };
}
