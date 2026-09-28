// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { encodeText } from '../../src/core/csv/encoding';
import {
  decodeTextFile,
  encodeTextFile,
  textFileBaseName,
  textFileKindOf,
} from '../../src/core/interchange/text-file';

const utf8 = (s: string) => new TextEncoder().encode(s);
const text = (b: Uint8Array) => new TextDecoder().decode(b);

describe('textFileKindOf', () => {
  it('maps each plain-text extension to its editor, case-insensitively', () => {
    expect(textFileKindOf('notes.md')).toBe('markdown');
    expect(textFileKindOf('README.MARKDOWN')).toBe('markdown');
    expect(textFileKindOf('data.json')).toBe('json');
    expect(textFileKindOf('ci.yaml')).toBe('yaml');
    expect(textFileKindOf('ci.YML')).toBe('yaml');
    expect(textFileKindOf('memo.txt')).toBe('text');
    expect(textFileKindOf('table.csv')).toBeNull();
    expect(textFileKindOf('book.rsf')).toBeNull();
  });

  it('strips the extension for the base name', () => {
    expect(textFileBaseName('notes.md')).toBe('notes');
    expect(textFileBaseName('ci.YML')).toBe('ci');
    expect(textFileBaseName('table.csv')).toBe('table.csv');
  });
});

describe('decodeTextFile / encodeTextFile', () => {
  it('writes unchanged text back byte for byte, even with mixed line endings', () => {
    const bytes = utf8('a\r\nb\nc\r\n');
    const { text: decoded, format } = decodeTextFile(bytes, 'text');
    expect(decoded).toBe('a\nb\nc\n');
    expect(encodeTextFile(decoded, format)).toBe(bytes);
  });

  it('keeps CRLF line endings and the UTF-8 BOM on an edited file', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('# T\r\n\r\nbody\r\n')]);
    const { text: decoded, format } = decodeTextFile(bytes, 'markdown');
    expect(decoded).toBe('# T\n\nbody\n');
    expect(format.bom).toBe(true);
    expect(format.lineEnding).toBe('crlf');
    const out = encodeTextFile('# T\n\nedited\n', format);
    expect(Array.from(out.subarray(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    expect(text(out.subarray(3))).toBe('# T\r\n\r\nedited\r\n');
  });

  it('keeps LF files LF and without a BOM', () => {
    const { format } = decodeTextFile(utf8('k: v\n'), 'yaml');
    expect(format.lineEnding).toBe('lf');
    expect(text(encodeTextFile('k: w\n', format))).toBe('k: w\n');
  });

  it('keeps a Shift_JIS file in Shift_JIS', () => {
    const bytes = encodeText('日本語のメモ\r\n', 'shift_jis');
    const { text: decoded, format } = decodeTextFile(bytes, 'text');
    expect(format.encoding).toBe('shift_jis');
    expect(decoded).toBe('日本語のメモ\n');
    expect(Array.from(encodeTextFile('日本語\n', format))).toEqual(
      Array.from(encodeText('日本語\r\n', 'shift_jis')),
    );
  });
});
