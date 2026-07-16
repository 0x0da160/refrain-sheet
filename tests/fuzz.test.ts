// SPDX-License-Identifier: MIT
// Property-based testing: the identity guarantee must hold for *arbitrary*
// byte sequences, under every supported encoding interpretation and
// delimiter, because unedited saves reuse the original buffer and the parser
// must tolerate any input without crashing.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { DelimiterId } from '../src/core/byte-csv-parser';
import type { EncodingId } from '../src/core/encoding';
import { LosslessDocument } from '../src/core/lossless-document';
import { serializeDocument } from '../src/core/serializer';
import { utf8 } from './helpers';

const ENCODINGS: EncodingId[] = ['utf-8', 'shift_jis', 'euc-jp'];
const DELIMITERS: DelimiterId[] = [',', ';', '\t'];

function roundTrips(bytes: Uint8Array, encoding: EncodingId, delimiter: DelimiterId): boolean {
  const doc = new LosslessDocument(bytes, { encoding, hasBom: false, delimiter });
  const result = serializeDocument(doc);
  if (!result.ok || result.bytes.length !== bytes.length) {
    return false;
  }
  for (let i = 0; i < bytes.length; i++) {
    if (result.bytes[i] !== bytes[i]) {
      return false;
    }
  }
  return true;
}

describe('fuzzed identity round-trips', () => {
  it('arbitrary byte sequences round-trip for every encoding and delimiter', () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ maxLength: 2048 }),
        fc.constantFrom(...ENCODINGS),
        fc.constantFrom(...DELIMITERS),
        (bytes, encoding, delimiter) => roundTrips(bytes, encoding, delimiter),
      ),
      { numRuns: 300 },
    );
  });

  it('CSV-flavoured random text round-trips', () => {
    const csvChar = fc.constantFrom(
      'a',
      'z',
      '0',
      '9',
      '"',
      ',',
      ';',
      '\t',
      ' ',
      '\r',
      '\n',
      '=',
      '@',
      'あ',
      '漢',
      '🙂',
    );
    fc.assert(
      fc.property(
        fc.array(csvChar, { maxLength: 400 }).map((chars) => chars.join('')),
        fc.constantFrom(...DELIMITERS),
        (text, delimiter) => roundTrips(utf8(text), 'utf-8', delimiter),
      ),
      { numRuns: 300 },
    );
  });

  it('parsing arbitrary bytes never throws and never repairs content', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 1024 }), (bytes) => {
        const doc = new LosslessDocument(bytes, { encoding: 'utf-8', hasBom: false, delimiter: ',' });
        expect(doc.bytes).toBe(bytes);
        expect(doc.rowCount).toBeGreaterThanOrEqual(0);
        return true;
      }),
      { numRuns: 200 },
    );
  });
});
