// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import {
  decodeBytes,
  decodesCleanly,
  detectEncoding,
  encodeText,
  findUnrepresentableChars,
  hasUtf8Bom,
  replaceUnrepresentableChars,
  UTF8_BOM,
} from '../src/core/encoding';
import { concat, enc, utf8 } from './helpers';

describe('encoding detection', () => {
  it('detects a UTF-8 BOM reliably', () => {
    const detected = detectEncoding(concat(UTF8_BOM, utf8('a,b\n')));
    expect(detected).toMatchObject({ encoding: 'utf-8', hasBom: true, uncertain: false });
    expect(hasUtf8Bom(concat(UTF8_BOM))).toBe(true);
    expect(hasUtf8Bom(utf8('abc'))).toBe(false);
  });

  it('validates UTF-8 strictly', () => {
    expect(detectEncoding(utf8('名前,値\n'))).toMatchObject({ encoding: 'utf-8', hasBom: false });
  });

  it('detects Shift_JIS', () => {
    expect(detectEncoding(enc('日本語の長いテキスト,カタカナ,ひらがな\n', 'shift_jis')).encoding).toBe(
      'shift_jis',
    );
  });

  it('detects EUC-JP', () => {
    expect(detectEncoding(enc('日本語の長いテキスト,漢字とかな\n', 'euc-jp')).encoding).toBe('euc-jp');
  });

  it('flags UTF-16 as an unsupported candidate', () => {
    const utf16le = new Uint8Array([0xff, 0xfe, 0x61, 0x00, 0x2c, 0x00, 0x62, 0x00]);
    const detected = detectEncoding(utf16le);
    expect(detected.unsupportedCandidate).toBe('UTF-16LE');
    expect(detected.uncertain).toBe(true);
  });

  it('presents CP932 as the candidate when detection is uncertain', () => {
    const junk = new Uint8Array([0xff, 0xff, 0xff, 0xff]);
    const detected = detectEncoding(junk);
    expect(detected.encoding).toBe('shift_jis');
    expect(detected.uncertain).toBe(true);
  });
});

describe('decode / encode round-trips', () => {
  it.each(['utf-8', 'shift_jis', 'euc-jp'] as const)('%s round-trips Japanese text', (encoding) => {
    const original = '名前,住所,カタカナ、句読点。ABC 123';
    expect(decodeBytes(encodeText(original, encoding), encoding)).toBe(original);
  });

  it('reports undecodable sequences', () => {
    expect(decodesCleanly(new Uint8Array([0xff, 0xfe]), 'utf-8')).toBe(false);
    expect(decodesCleanly(utf8('ok'), 'utf-8')).toBe(true);
  });
});

describe('unrepresentable characters', () => {
  it('UTF-8 can represent everything', () => {
    expect(findUnrepresentableChars('😀日本語\u{1F984}', 'utf-8')).toEqual([]);
  });

  it('CP932 cannot represent emoji', () => {
    expect(findUnrepresentableChars('a😀b', 'shift_jis')).toEqual(['😀']);
  });

  it('replacement uses numeric character references and counts occurrences', () => {
    const result = replaceUnrepresentableChars('😀a😀', 'shift_jis');
    expect(result.text).toBe('&#128512;a&#128512;');
    expect(result.count).toBe(2);
  });

  it('representable text is returned untouched', () => {
    const result = replaceUnrepresentableChars('日本語', 'shift_jis');
    expect(result).toEqual({ text: '日本語', count: 0 });
  });
});
