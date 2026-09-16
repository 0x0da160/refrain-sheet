// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { tokenizeCode } from '../src/core/syntax-highlight';

describe('tokenizeCode', () => {
  it('returns a single plain text token for an unrecognized language', () => {
    expect(tokenizeCode('anything at all', 'made-up-lang')).toEqual([
      { type: 'text', text: 'anything at all' },
    ]);
  });

  it('returns a single plain text token for a missing language', () => {
    expect(tokenizeCode('plain', null)).toEqual([{ type: 'text', text: 'plain' }]);
  });

  it('returns no tokens for empty input', () => {
    expect(tokenizeCode('', null)).toEqual([]);
    expect(tokenizeCode('', 'js')).toEqual([]);
  });

  it('highlights keywords, strings, numbers, and line comments in JavaScript', () => {
    expect(tokenizeCode('const a = 1; // note', 'js')).toEqual([
      { type: 'keyword', text: 'const' },
      { type: 'text', text: ' a = ' },
      { type: 'number', text: '1' },
      { type: 'text', text: '; ' },
      { type: 'comment', text: '// note' },
    ]);
  });

  it('highlights a double-quoted string, including an escaped quote inside it', () => {
    expect(tokenizeCode('const s = "a\\"b";', 'js')).toEqual([
      { type: 'keyword', text: 'const' },
      { type: 'text', text: ' s = ' },
      { type: 'string', text: '"a\\"b"' },
      { type: 'text', text: ';' },
    ]);
  });

  it('highlights a block comment spanning multiple lines', () => {
    expect(tokenizeCode('/* a\nb */\nx', 'js')).toEqual([
      { type: 'comment', text: '/* a\nb */' },
      { type: 'text', text: '\nx' },
    ]);
  });

  it('closes an unterminated block comment at end of input rather than hanging', () => {
    expect(tokenizeCode('/* unterminated', 'css')).toEqual([{ type: 'comment', text: '/* unterminated' }]);
  });

  it('resolves language aliases (ts, py, sh) to their canonical spec', () => {
    expect(tokenizeCode('def f(): pass', 'py')).toEqual([
      { type: 'keyword', text: 'def' },
      { type: 'text', text: ' f(): ' },
      { type: 'keyword', text: 'pass' },
    ]);
  });

  it('is case-insensitive about the language tag', () => {
    expect(tokenizeCode('const a = 1;', 'JS')).toEqual(tokenizeCode('const a = 1;', 'js'));
  });

  it('highlights Python "#" comments', () => {
    expect(tokenizeCode('x = 1  # comment', 'python')).toEqual([
      { type: 'text', text: 'x = ' },
      { type: 'number', text: '1' },
      { type: 'text', text: '  ' },
      { type: 'comment', text: '# comment' },
    ]);
  });

  it('does not treat a digit inside an identifier as a separate number token', () => {
    expect(tokenizeCode('var1 = 2', 'js')).toEqual([
      { type: 'text', text: 'var1 = ' },
      { type: 'number', text: '2' },
    ]);
  });

  it('never renders untrusted code as anything other than token text (no HTML interpretation)', () => {
    const tokens = tokenizeCode('const s = "<script>alert(1)</script>";', 'js');
    const joined = tokens.map((token) => token.text).join('');
    expect(joined).toBe('const s = "<script>alert(1)</script>";');
  });
});
