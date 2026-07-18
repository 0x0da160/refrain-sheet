// SPDX-License-Identifier: MIT
import { expect } from 'vitest';
import type { DelimiterId } from '../src/core/byte-csv-parser';
import { encodeText, type EncodingId } from '../src/core/encoding';
import { LosslessDocument } from '../src/core/lossless-document';
import { serializeDocument, KEEP_SAVE_OPTIONS, type SaveOptions } from '../src/core/serializer';

export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function enc(text: string, encoding: EncodingId): Uint8Array {
  return encodeText(text, encoding);
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

export function doc(
  input: Uint8Array | string,
  interpretation?: { encoding?: EncodingId; delimiter?: DelimiterId },
): LosslessDocument {
  const bytes = typeof input === 'string' ? utf8(input) : input;
  return LosslessDocument.fromBytes(bytes, interpretation);
}

/** Narrow an EditorDocument union member to the CSV document (asserting). */
export function asCsv(document: { kind: string }): LosslessDocument {
  expect(document.kind).toBe('csv');
  return document as LosslessDocument;
}

/** Serialize with the given options and assert success, returning the bytes. */
export function saved(document: LosslessDocument, options: SaveOptions = KEEP_SAVE_OPTIONS): Uint8Array {
  const result = serializeDocument(document, options);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('unreachable');
  return result.bytes;
}

/** Assert that saving the (unedited) document reproduces the input byte-for-byte. */
export function expectIdentity(input: Uint8Array | string, interpretation?: Parameters<typeof doc>[1]): void {
  const bytes = typeof input === 'string' ? utf8(input) : input;
  const document = doc(bytes, interpretation);
  const result = serializeDocument(document);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.mode).toBe('identity');
  expect(Array.from(result.bytes)).toEqual(Array.from(bytes));
  // Normal saves must reuse the originally loaded buffer, not a re-serialization.
  expect(result.bytes).toBe(document.bytes);
}
