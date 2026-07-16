// SPDX-License-Identifier: MIT
// The core product guarantee: opening a file and saving it without edits
// produces byte-for-byte identical output, no matter how unusual the input.
import { describe, expect, it } from 'vitest';
import { UTF8_BOM } from '../src/core/encoding';
import { serializeDocument } from '../src/core/serializer';
import { concat, doc, enc, expectIdentity, utf8 } from './helpers';

describe('identity round-trip (unedited save === original bytes)', () => {
  it('plain UTF-8 CSV', () => {
    expectIdentity('name,age\nalice,30\nbob,41\n');
  });

  it('UTF-8 with BOM', () => {
    expectIdentity(concat(UTF8_BOM, utf8('a,b\n1,2\n')));
  });

  it('Shift_JIS / CP932', () => {
    expectIdentity(enc('名前,年齢\r\n山田,30\r\n', 'shift_jis'));
  });

  it('EUC-JP', () => {
    expectIdentity(enc('名前,年齢\n田中,25\n', 'euc-jp'));
  });

  it('CRLF line endings', () => {
    expectIdentity('a,b\r\n1,2\r\n');
  });

  it('LF line endings', () => {
    expectIdentity('a,b\n1,2\n');
  });

  it('CR line endings', () => {
    expectIdentity('a,b\r1,2\r');
  });

  it('mixed line endings', () => {
    expectIdentity('a,b\r\n1,2\n3,4\r5,6');
  });

  it('no final newline', () => {
    expectIdentity('a,b\n1,2');
  });

  it('whitespace around delimiters', () => {
    expectIdentity('a , b ,c\n 1,2 , 3 \n');
  });

  it('whitespace inside and outside quoted fields', () => {
    expectIdentity('a, " b " ,c\n"  x  ",y,z\n');
  });

  it('escaped quotes ("")', () => {
    expectIdentity('a,"he said ""hi""",c\n');
  });

  it('unclosed quote', () => {
    expectIdentity('a,"unclosed\nmore,data\n');
  });

  it('invalid text after a closing quote', () => {
    expectIdentity('a,"x"junk,c\n');
  });

  it('bare quote inside an unquoted field', () => {
    expectIdentity('a,b"c,d\n');
  });

  it('inconsistent field counts across rows', () => {
    expectIdentity('a,b,c\n1,2\nx,y,z,w\n');
  });

  it('undecodable bytes (interpreted as UTF-8)', () => {
    const bytes = concat(utf8('a,'), new Uint8Array([0xff, 0xfe, 0x80]), utf8(',c\n1,2,3\n'));
    expectIdentity(bytes, { encoding: 'utf-8' });
  });

  it('undecodable bytes (interpreted as Shift_JIS)', () => {
    const bytes = concat(utf8('a,'), new Uint8Array([0x81]), utf8('\n'));
    expectIdentity(bytes, { encoding: 'shift_jis' });
  });

  it('empty file', () => {
    expectIdentity('');
  });

  it('file containing only a BOM', () => {
    expectIdentity(concat(UTF8_BOM));
  });

  it('header-only CSV', () => {
    expectIdentity('col1,col2,col3\n');
  });

  it('header-only CSV without newline', () => {
    expectIdentity('col1,col2,col3');
  });

  it('empty fields and trailing delimiters', () => {
    expectIdentity(',,\na,,b,\n,\n');
  });

  it('single newline only', () => {
    expectIdentity('\n');
  });

  it('tab delimiter', () => {
    expectIdentity('a\tb\tc\n1\t2\t3\n', { delimiter: '\t' });
  });

  it('semicolon delimiter', () => {
    expectIdentity('a;b;c\n1;2;3\n', { delimiter: ';' });
  });

  it('quoted CRLF and delimiters inside fields', () => {
    expectIdentity('a,"line1\r\nline2",c\r\n"x,y",z,w\r\n');
  });

  it('CP932 with quotes and CRLF', () => {
    expectIdentity(enc('商品,"説明, 詳細",価格\r\n"りんご",100,"甘い"\r\n', 'shift_jis'), {
      encoding: 'shift_jis',
    });
  });

  it('structural warnings never change saved bytes', () => {
    const input = utf8('a,"broken\nrow,two\nrow,three,extra\n"x"y,z');
    const document = doc(input);
    expect(document.diagnostics.length).toBeGreaterThan(0);
    const result = serializeDocument(document);
    expect(result.ok && result.bytes === document.bytes).toBe(true);
  });

  it('delimiter-only file', () => {
    expectIdentity(',');
  });

  it('quote-only file', () => {
    expectIdentity('"');
  });
});
