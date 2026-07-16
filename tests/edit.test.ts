// SPDX-License-Identifier: MIT
// Minimal-diff edits: only the byte range of the edited field changes;
// quoting style, surrounding whitespace, and all other bytes are preserved.
import { describe, expect, it } from 'vitest';
import { decodeBytes, UTF8_BOM } from '../src/core/encoding';
import { serializeDocument } from '../src/core/serializer';
import { concat, doc, enc, saved, utf8 } from './helpers';

function text(bytes: Uint8Array): string {
  return decodeBytes(bytes, 'utf-8');
}

describe('minimal-diff editing', () => {
  it('editing one cell preserves every other byte', () => {
    const d = doc('a , b ,c\r\n"q1",q2, q3 \r\nlast,row');
    d.setValue(1, 1, 'EDITED');
    expect(text(saved(d))).toBe('a , b ,c\r\n"q1",EDITED, q3 \r\nlast,row');
  });

  it('quoted fields stay quoted', () => {
    const d = doc('a,"old",c\n');
    d.setValue(0, 1, 'new');
    expect(text(saved(d))).toBe('a,"new",c\n');
  });

  it('whitespace outside quotes is preserved', () => {
    const d = doc('a, "old" ,c\n');
    d.setValue(0, 1, 'new');
    expect(text(saved(d))).toBe('a, "new" ,c\n');
  });

  it('unquoted fields stay unquoted for plain values', () => {
    const d = doc('a,old,c\n');
    d.setValue(0, 1, 'new');
    expect(text(saved(d))).toBe('a,new,c\n');
  });

  it('quotes are added to an unquoted field only when required: delimiter', () => {
    const d = doc('a,old,c\n');
    d.setValue(0, 1, 'x,y');
    expect(text(saved(d))).toBe('a,"x,y",c\n');
  });

  it('quotes are added when the value contains a quote, escaping it as ""', () => {
    const d = doc('a,old,c\n');
    d.setValue(0, 1, 'say "hi"');
    expect(text(saved(d))).toBe('a,"say ""hi""",c\n');
  });

  it('quotes are added when the value contains a newline', () => {
    const d = doc('a,old,c\n');
    d.setValue(0, 1, 'line1\nline2');
    expect(text(saved(d))).toBe('a,"line1\nline2",c\n');
  });

  it('the delimiter of the document decides quoting (tab)', () => {
    const d = doc('a\told\tc\n', { delimiter: '\t' });
    d.setValue(0, 1, 'x\ty');
    expect(text(saved(d))).toBe('a\t"x\ty"\tc\n');
    const d2 = doc('a\told\tc\n', { delimiter: '\t' });
    d2.setValue(0, 1, 'x,y'); // a comma needs no quoting in a TSV
    expect(text(saved(d2))).toBe('a\tx,y\tc\n');
  });

  it('quotes inside an edited quoted field are escaped', () => {
    const d = doc('a,"old",c\n');
    d.setValue(0, 1, '"');
    expect(text(saved(d))).toBe('a,"""",c\n');
  });

  it('editing back to the original value restores byte identity', () => {
    const d = doc('a,b,c\n');
    d.setValue(0, 1, 'x');
    d.setValue(0, 1, 'b');
    expect(d.isDirty).toBe(false);
    const result = serializeDocument(d);
    expect(result.ok && result.mode === 'identity' && result.bytes === d.bytes).toBe(true);
  });

  it('editing a malformed field replaces its whole raw span', () => {
    const d = doc('a,"x"junk,c\n');
    expect(d.getValue(0, 1)).toBe('xjunk');
    d.setValue(0, 1, 'clean');
    expect(text(saved(d))).toBe('a,"clean",c\n');
  });

  it('unmodified malformed regions are preserved when another cell is edited', () => {
    const d = doc('a,"x"junk,c\nfine,"unclosed');
    d.setValue(0, 0, 'A');
    expect(text(saved(d))).toBe('A,"x"junk,c\nfine,"unclosed');
  });

  it('unmodified undecodable bytes survive edits elsewhere', () => {
    const bad = new Uint8Array([0xff, 0x80, 0xfe]);
    const d = doc(concat(utf8('a,'), bad, utf8(',c\n')), { encoding: 'utf-8' });
    d.setValue(0, 0, 'A');
    const out = saved(d);
    expect(Array.from(out)).toEqual(Array.from(concat(utf8('A,'), bad, utf8(',c\n'))));
  });

  it('edited cells that contained undecodable bytes are reported', () => {
    const d = doc(concat(utf8('a,'), new Uint8Array([0xff]), utf8(',c\n')), { encoding: 'utf-8' });
    d.setValue(0, 1, 'clean');
    expect(d.listEditedUndecodable()).toEqual([{ row: 0, col: 1 }]);
  });

  it('edits are encoded in the document encoding (CP932)', () => {
    const d = doc(enc('名前,値\n', 'shift_jis'), { encoding: 'shift_jis' });
    d.setValue(0, 1, '日本語');
    const out = saved(d);
    expect(Array.from(out)).toEqual(Array.from(enc('名前,日本語\n', 'shift_jis')));
  });
});

describe('unrepresentable characters', () => {
  it('saving is cancelled by default when the encoding cannot represent a character', () => {
    const d = doc(enc('a,b\n', 'shift_jis'), { encoding: 'shift_jis' });
    d.setValue(0, 1, 'emoji 😀');
    const result = serializeDocument(d);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.unrepresentable).toEqual([{ row: 0, col: 1, chars: ['😀'] }]);
    }
  });

  it('explicit continuation replaces the characters with numeric character references', () => {
    const d = doc(enc('a,b\n', 'shift_jis'), { encoding: 'shift_jis' });
    d.setValue(0, 1, '😀x😀');
    const result = serializeDocument(d, { encoding: 'keep', bom: 'keep', lineEnding: 'keep' }, true);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(decodeBytes(result.bytes, 'shift_jis')).toBe('a,&#128512;x&#128512;\n');
      expect(result.ncrReplacements).toEqual([{ row: 0, col: 1, count: 2 }]);
    }
  });
});

describe('save options', () => {
  it('adding a UTF-8 BOM', () => {
    const d = doc('a,b\n');
    const out = saved(d, { encoding: 'keep', bom: 'add', lineEnding: 'keep' });
    expect(Array.from(out)).toEqual(Array.from(concat(UTF8_BOM, utf8('a,b\n'))));
  });

  it('removing a UTF-8 BOM', () => {
    const d = doc(concat(UTF8_BOM, utf8('a,b\n')));
    const out = saved(d, { encoding: 'keep', bom: 'remove', lineEnding: 'keep' });
    expect(text(out)).toBe('a,b\n');
  });

  it('line-ending conversion only rewrites terminators', () => {
    const d = doc('a , b\r\n"q ",x\ny,z');
    const out = saved(d, { encoding: 'keep', bom: 'keep', lineEnding: 'lf' });
    expect(text(out)).toBe('a , b\n"q ",x\ny,z');
  });

  it('line-ending conversion does not add a missing final newline', () => {
    const d = doc('a,b\nc,d');
    const out = saved(d, { encoding: 'keep', bom: 'keep', lineEnding: 'crlf' });
    expect(text(out)).toBe('a,b\r\nc,d');
  });

  it('line-ending conversion preserves quoted newlines', () => {
    const d = doc('a,"x\ny"\r\nc,d\r\n');
    const out = saved(d, { encoding: 'keep', bom: 'keep', lineEnding: 'lf' });
    expect(text(out)).toBe('a,"x\ny"\nc,d\n');
  });

  it('full re-encode preserves quoting, whitespace, and structure', () => {
    const input = enc('名前, "説明" ,数\r\nりんご,"甘い, 赤い",3\r\n', 'shift_jis');
    const d = doc(input, { encoding: 'shift_jis' });
    const out = saved(d, { encoding: 'utf-8', bom: 'keep', lineEnding: 'keep' });
    expect(text(out)).toBe('名前, "説明" ,数\r\nりんご,"甘い, 赤い",3\r\n');
  });

  it('re-encode with edits applies the edited values', () => {
    const d = doc(enc('a,古い\n', 'shift_jis'), { encoding: 'shift_jis' });
    d.setValue(0, 1, '新しい');
    const out = saved(d, { encoding: 'utf-8', bom: 'keep', lineEnding: 'keep' });
    expect(text(out)).toBe('a,新しい\n');
  });

  it('re-encode to CP932 cancels on unrepresentable characters', () => {
    const d = doc('a,😀\n');
    const result = serializeDocument(d, { encoding: 'shift_jis', bom: 'keep', lineEnding: 'keep' });
    expect(result.ok).toBe(false);
  });

  it('re-encode keeps a BOM when requested', () => {
    const d = doc(enc('a,b\n', 'euc-jp'), { encoding: 'euc-jp' });
    const out = saved(d, { encoding: 'utf-8', bom: 'add', lineEnding: 'keep' });
    expect(Array.from(out.subarray(0, 3))).toEqual(Array.from(UTF8_BOM));
    expect(text(out.subarray(3))).toBe('a,b\n');
  });
});
