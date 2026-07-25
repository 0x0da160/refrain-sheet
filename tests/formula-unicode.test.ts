// SPDX-License-Identifier: MIT
/**
 * Text functions against real Unicode: Japanese, emoji (including astral and
 * ZWJ sequences), combining marks, and whitespace policy. The counting unit is
 * the Unicode code point, and these tests pin that choice so it cannot drift
 * silently.
 */
import { describe, expect, it } from 'vitest';
import { RsfDocument } from '../src/core/rsf-document';
import { codePointLength, sliceCodePoints, trimText } from '../src/core/formula-text';

function evaluate(formula: string, cells: Record<string, string> = {}): string {
  const doc = RsfDocument.empty('t.rsf', 12, 6);
  for (const [ref, value] of Object.entries(cells)) {
    doc.setCell(Number(ref.slice(1)) - 1, ref.charCodeAt(0) - 65, value);
  }
  doc.setCell(11, 5, formula);
  return doc.getDisplayValue(11, 5);
}

const APPLE = '\u{1F34E}'; // 🍎, one astral code point
const FAMILY = '\u{1F468}‍\u{1F469}‍\u{1F467}'; // 👨‍👩‍👧, five code points
const E_ACUTE_COMBINING = 'é'; // e + U+0301, two code points

describe('the counting unit is the code point', () => {
  it('LEN counts code points, not UTF-16 units', () => {
    expect(evaluate('=LEN("abc")')).toBe('3');
    expect(evaluate('=LEN("日本語")')).toBe('3');
    expect(evaluate(`=LEN("${APPLE}")`)).toBe('1'); // two UTF-16 units, one code point
    expect(evaluate(`=LEN("${APPLE}${APPLE}")`)).toBe('2');
    expect(evaluate('=LEN("é")')).toBe('1'); // precomposed é
  });

  it('counts a combining sequence and a ZWJ emoji as several, by design', () => {
    // Documented divergence from human perception: grapheme segmentation would
    // depend on the host's Unicode tables, which a portable file cannot allow.
    expect(evaluate(`=LEN("${E_ACUTE_COMBINING}")`)).toBe('2');
    expect(evaluate(`=LEN("${FAMILY}")`)).toBe('5');
    expect(codePointLength(FAMILY)).toBe(5);
  });

  it('never splits a surrogate pair', () => {
    expect(evaluate(`=LEFT("${APPLE}bc",1)`)).toBe(APPLE);
    expect(evaluate(`=RIGHT("ab${APPLE}",1)`)).toBe(APPLE);
    expect(evaluate(`=MID("a${APPLE}c",2,1)`)).toBe(APPLE);
    // Nothing produced can contain a lone surrogate.
    for (const formula of [`=LEFT("${APPLE}",1)`, `=MID("${APPLE}",1,1)`, `=RIGHT("${APPLE}",1)`]) {
      const out = evaluate(formula);
      expect(out, formula).toBe(APPLE);
      expect([...out].length, formula).toBe(1);
    }
  });
});

describe('LEFT / RIGHT / MID', () => {
  it('clamp out-of-range requests instead of erroring', () => {
    expect(evaluate('=LEFT("abc",10)')).toBe('abc');
    expect(evaluate('=RIGHT("abc",10)')).toBe('abc');
    expect(evaluate('=MID("abc",2,100)')).toBe('bc');
    expect(evaluate('=MID("abc",10,2)')).toBe('');
    expect(evaluate('=LEFT("abc",0)')).toBe('');
  });

  it('default to one character when the count is omitted', () => {
    expect(evaluate('=LEFT("abc")')).toBe('a');
    expect(evaluate('=RIGHT("abc")')).toBe('c');
    expect(evaluate('=LEFT("日本語")')).toBe('日');
  });

  it('reject negative counts and a start position below 1', () => {
    expect(evaluate('=LEFT("abc",-1)')).toBe('#VALUE!');
    expect(evaluate('=RIGHT("abc",-1)')).toBe('#VALUE!');
    expect(evaluate('=MID("abc",0,1)')).toBe('#VALUE!');
    expect(evaluate('=MID("abc",1,-1)')).toBe('#VALUE!');
  });

  it('works on Japanese text', () => {
    expect(evaluate('=LEFT("こんにちは世界",5)')).toBe('こんにちは');
    expect(evaluate('=MID("こんにちは世界",6,2)')).toBe('世界');
    expect(sliceCodePoints('こんにちは', 1, 2)).toBe('んに');
  });
});

describe('TRIM whitespace policy', () => {
  it('trims the ends and collapses runs of ordinary spaces', () => {
    expect(evaluate('=TRIM("  a   b  ")')).toBe('a b');
    expect(evaluate('=TRIM("a")')).toBe('a');
    expect(evaluate('=TRIM("   ")')).toBe('');
  });

  it('never destroys a line break in a multi-line cell', () => {
    // Multi-line cell content is a supported feature; collapsing a run that
    // contains a newline would silently damage it.
    expect(trimText('a\nb')).toBe('a\nb');
    expect(trimText('a  \n  b')).toBe('a \n b');
  });

  it('preserves the ideographic space, which is content in Japanese', () => {
    expect(trimText('あ　　い')).toBe('あ　　い');
  });
});

describe('joining and replacing', () => {
  it('CONCAT flattens ranges in row-major order', () => {
    const cells = { A1: 'a', B1: 'b', A2: 'c', B2: 'd' };
    expect(evaluate('=CONCAT(A1:B2)', cells)).toBe('abcd');
    expect(evaluate('=CONCAT("x",A1:B1,"y")', cells)).toBe('xaby');
  });

  it('TEXTJOIN honours ignore_empty', () => {
    const cells = { A1: 'a', A2: '', A3: 'c' };
    expect(evaluate('=TEXTJOIN("-",TRUE,A1:A3)', cells)).toBe('a-c');
    expect(evaluate('=TEXTJOIN("-",FALSE,A1:A3)', cells)).toBe('a--c');
    expect(evaluate('=TEXTJOIN("、",TRUE,"日","本")')).toBe('日、本');
    expect(evaluate('=TEXTJOIN("-","yes",A1:A3)', cells)).toBe('#VALUE!');
  });

  it('SUBSTITUTE replaces all occurrences, or one when asked', () => {
    expect(evaluate('=SUBSTITUTE("a-b-c","-","/")')).toBe('a/b/c');
    expect(evaluate('=SUBSTITUTE("a-b-c","-","/",2)')).toBe('a-b/c');
    expect(evaluate('=SUBSTITUTE("a-b-c","-","/",9)')).toBe('a-b-c');
    expect(evaluate('=SUBSTITUTE("a-b","x","/")')).toBe('a-b');
    expect(evaluate('=SUBSTITUTE("abc","","X")')).toBe('abc'); // empty needle matches nothing
    expect(evaluate('=SUBSTITUTE("a-b","-","/",0)')).toBe('#VALUE!');
    expect(evaluate(`=SUBSTITUTE("${APPLE}x${APPLE}","${APPLE}","o")`)).toBe('oxo');
  });

  it('REPLACE swaps a fixed run of code points', () => {
    expect(evaluate('=REPLACE("abcdef",2,3,"XY")')).toBe('aXYef');
    expect(evaluate('=REPLACE("abc",1,0,"Z")')).toBe('Zabc');
    expect(evaluate('=REPLACE("abc",4,1,"Z")')).toBe('abcZ');
    expect(evaluate('=REPLACE("abc",0,1,"Z")')).toBe('#VALUE!');
    expect(evaluate(`=REPLACE("${APPLE}bc",1,1,"a")`)).toBe('abc');
  });

  it('UPPER and LOWER are locale-independent', () => {
    expect(evaluate('=UPPER("abc")')).toBe('ABC');
    expect(evaluate('=LOWER("ABC")')).toBe('abc');
    expect(evaluate('=UPPER("日本語")')).toBe('日本語'); // unchanged, not an error
    expect(evaluate('=UPPER("i")')).toBe('I'); // never the Turkish dotted İ
  });

  it('coerces non-text arguments the documented way', () => {
    expect(evaluate('=LEN(12345)')).toBe('5');
    expect(evaluate('=UPPER(TRUE)')).toBe('TRUE');
    expect(evaluate('=CONCAT(1,2,3)')).toBe('123');
    expect(evaluate('=LEN(1/0)')).toBe('#DIV/0!');
  });
});
