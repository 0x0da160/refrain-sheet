// SPDX-License-Identifier: MIT
/**
 * Parity of `LosslessDocument`'s field decoding fast paths (the hand-built
 * short-ASCII string and the cache-free value read) with a plain
 * `TextDecoder` reference, and of the per-field undecodable flag with a
 * strict per-field decode.
 */
import { describe, expect, it } from 'vitest';
import { unescapeQuotedBytes } from '../src/core/byte-csv-parser';
import { initCsvEngine, setCsvEngineForTesting, type CsvEngineName } from '../src/core/csv-engine';
import { decodeBytes, decodesCleanly, type EncodingId } from '../src/core/encoding';
import type { LosslessDocument } from '../src/core/lossless-document';
import { concat, doc, enc, utf8 } from './helpers';

const wasm = (await initCsvEngine()) === 'wasm';
const engines: CsvEngineName[] = wasm ? ['js', 'wasm'] : ['js'];

/** The value and flag the pre-fast-path implementation computed for (row, col). */
function reference(d: LosslessDocument, row: number, col: number): { value: string; bad: boolean } {
  const f = d.getField(row, col);
  if (!f) {
    return { value: '', bad: false };
  }
  const raw = f.quoted
    ? unescapeQuotedBytes(d.bytes.subarray(f.contentStart, f.contentEnd))
    : d.bytes.subarray(f.contentStart, f.contentEnd);
  let value = decodeBytes(raw, d.encoding);
  let bad = !decodesCleanly(raw, d.encoding);
  if (f.quoted && f.malformed && f.suffixStart < f.end) {
    const suffix = d.bytes.subarray(f.suffixStart, f.end);
    value += decodeBytes(suffix, d.encoding);
    bad = bad || !decodesCleanly(suffix, d.encoding);
  }
  return { value, bad };
}

function expectParity(bytes: Uint8Array, encoding: EncodingId): void {
  for (const engine of engines) {
    setCsvEngineForTesting(engine);
    // A fresh document per read order: value-only reads first (no cache), then fields.
    const cold = doc(bytes, { encoding });
    const warm = doc(bytes, { encoding });
    for (let r = 0; r < warm.rowCount; r++) {
      for (let c = 0; c < warm.columnCount + 1; c++) {
        const ref = reference(warm, r, c);
        expect(cold.getValue(r, c), `${engine} r${r}c${c}`).toBe(ref.value);
        expect(warm.getValue(r, c), `${engine} r${r}c${c}`).toBe(ref.value);
        expect(warm.getField(r, c)?.hasUndecodable ?? false, `${engine} r${r}c${c}`).toBe(ref.bad);
      }
    }
    expect(cold.getValue(-1, 0)).toBe('');
    expect(cold.getValue(warm.rowCount, 0)).toBe('');
  }
}

describe('field decoding fast paths', () => {
  it('matches TextDecoder for ASCII, quoted, escaped, malformed, long and empty fields', () => {
    const long = 'x'.repeat(33);
    const text = [
      'a,,"",plain text,123',
      `"q","a""b","""","x""y""z",${long}`,
      `"${long}","${'y'.repeat(31)}""",\t~\\,`,
      '"ab"junk,"a"""tail,"unterminated',
      '',
    ].join('\n');
    expectParity(utf8(text), 'utf-8');
    expectParity(utf8(text), 'shift_jis');
    expectParity(utf8(text), 'euc-jp');
  });

  it('matches TextDecoder for non-ASCII UTF-8 and a UTF-8 BOM', () => {
    const text = '名前,"値,""引用""",é\n"日本"語,x y,😀\n';
    expectParity(utf8(text), 'utf-8');
    expectParity(concat(new Uint8Array([0xef, 0xbb, 0xbf]), utf8(text)), 'utf-8');
  });

  it('matches TextDecoder for Shift_JIS and EUC-JP text', () => {
    const text = '名前,"表示"",ソ",ｱｲｳ,\\x\n予定,"能"x,abc\n';
    expectParity(enc(text, 'shift_jis'), 'shift_jis');
    expectParity(enc(text, 'euc-jp'), 'euc-jp');
  });

  it('flags only the fields whose own bytes are undecodable', () => {
    const bytes = concat(
      utf8('ok,'),
      new Uint8Array([0xff]),
      utf8(',"q'),
      new Uint8Array([0xc3]),
      utf8('"\nfine,x,y\n'),
    );
    expectParity(bytes, 'utf-8');
    const d = doc(bytes, { encoding: 'utf-8' });
    expect(d.getField(0, 0)?.hasUndecodable).toBe(false);
    expect(d.getField(0, 1)?.hasUndecodable).toBe(true);
    expect(d.getField(0, 2)?.hasUndecodable).toBe(true);
    expect(d.getField(1, 0)?.hasUndecodable).toBe(false);
  });
});
