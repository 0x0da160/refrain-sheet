// SPDX-License-Identifier: MIT
/**
 * Criteria parsing, type rules, and wildcard matching — including the bounded
 * cost of a pattern designed to make a regular-expression engine backtrack.
 */
import { describe, expect, it } from 'vitest';
import {
  compileWildcard,
  matchesCriterion,
  matchWildcard,
  parseCriterion,
  unescapeWildcard,
} from '../src/core/formula-criteria';
import { MAX_CRITERIA_LENGTH, type FormulaValue } from '../src/core/formula-value';

const num = (value: number): FormulaValue => ({ type: 'number', value });
const text = (value: string): FormulaValue => ({ type: 'string', value });
const bool = (value: boolean): FormulaValue => ({ type: 'boolean', value });
const blank: FormulaValue = { type: 'empty' };
const err: FormulaValue = { type: 'error', code: '#DIV/0!' };

/** Parse a criterion and test one value against it. */
function matches(criterion: string | number, value: FormulaValue): boolean {
  const parsed = parseCriterion(typeof criterion === 'number' ? num(criterion) : text(criterion));
  expect(parsed.ok).toBe(true);
  return parsed.ok ? matchesCriterion(value, parsed.criterion) : false;
}

describe('criteria parsing', () => {
  it('reads the operator prefix, longest first', () => {
    const cases: Array<[string, string]> = [
      ['apple', '='],
      ['=apple', '='],
      ['<>apple', '<>'],
      ['>10', '>'],
      ['>=10', '>='],
      ['<5', '<'],
      ['<=5', '<='],
    ];
    for (const [src, op] of cases) {
      const parsed = parseCriterion(text(src));
      expect(parsed.ok, src).toBe(true);
      if (parsed.ok) {
        expect(parsed.criterion.op, src).toBe(op);
      }
    }
  });

  it('refuses a criterion longer than the documented cap', () => {
    expect(parseCriterion(text('x'.repeat(MAX_CRITERIA_LENGTH))).ok).toBe(true);
    expect(parseCriterion(text('x'.repeat(MAX_CRITERIA_LENGTH + 1))).ok).toBe(false);
  });

  it('refuses an error as a criterion', () => {
    expect(parseCriterion(err).ok).toBe(false);
  });
});

describe('criteria matching', () => {
  it('compares numbers numerically and ignores text cells', () => {
    expect(matches('>10', num(15))).toBe(true);
    expect(matches('>10', num(10))).toBe(false);
    expect(matches('>=10', num(10))).toBe(true);
    expect(matches('<5', num(4))).toBe(true);
    expect(matches('<=5', num(5))).toBe(true);
    // A numeric ordering comparison never matches text, which is what stops
    // ">10" from counting the word "zebra".
    expect(matches('>10', text('zebra'))).toBe(false);
    expect(matches('>10', text('99'))).toBe(false);
  });

  it('compares text case-insensitively and ignores numeric cells', () => {
    expect(matches('apple', text('APPLE'))).toBe(true);
    expect(matches('=apple', text('Apple'))).toBe(true);
    expect(matches('<>apple', text('pear'))).toBe(true);
    expect(matches('<>apple', text('apple'))).toBe(false);
    expect(matches('>m', text('zebra'))).toBe(true);
    expect(matches('>m', text('alpha'))).toBe(false);
    expect(matches('>m', num(99))).toBe(false);
  });

  it('handles booleans and blanks per the documented rules', () => {
    expect(matches(1, bool(true))).toBe(true);
    expect(matches(0, bool(false))).toBe(true);
    expect(matches('', blank)).toBe(true);
    expect(matches('=', blank)).toBe(true);
    expect(matches('<>', blank)).toBe(false);
    expect(matches('<>', num(1))).toBe(true);
    expect(matches('apple', blank)).toBe(false);
    expect(matches('>0', blank)).toBe(false);
  });

  it('never matches an error cell', () => {
    expect(matches('>0', err)).toBe(false);
    expect(matches('<>', err)).toBe(false);
    expect(matches('', err)).toBe(false);
  });

  it('a numeric criterion matches numbers, not numeric-looking text', () => {
    expect(matches(10, num(10))).toBe(true);
    expect(matches('10', num(10))).toBe(true);
    expect(matches('10', text('10'))).toBe(false);
  });
});

describe('wildcards', () => {
  const wild = (pattern: string, subject: string): boolean => {
    const compiled = compileWildcard(pattern);
    return compiled === null ? unescapeWildcard(pattern) === subject : matchWildcard(compiled, subject);
  };

  it('matches * and ? against code points', () => {
    expect(wild('a*c', 'abc')).toBe(true);
    expect(wild('a*c', 'ac')).toBe(true);
    expect(wild('a*c', 'abbbbc')).toBe(true);
    expect(wild('a*c', 'abcd')).toBe(false);
    expect(wild('a?c', 'abc')).toBe(true);
    expect(wild('a?c', 'ac')).toBe(false);
    expect(wild('a?c', 'abbc')).toBe(false);
    expect(wild('*', 'anything')).toBe(true);
    expect(wild('*', '')).toBe(true);
  });

  it('treats one ? as exactly one code point, even an astral one', () => {
    expect(wild('?', '🍎')).toBe(true);
    expect(wild('??', '🍎')).toBe(false);
    expect(wild('?', '日')).toBe(true);
    expect(wild('日*', '日本語')).toBe(true);
  });

  it('matches case-insensitively', () => {
    expect(wild('AP*', 'apple')).toBe(true);
    expect(wild('*PLE', 'Apple')).toBe(true);
  });

  it('escapes a literal *, ?, or ~ with a tilde', () => {
    expect(compileWildcard('a~*b')).toBeNull(); // no active wildcard remains
    expect(unescapeWildcard('a~*b')).toBe('a*b');
    expect(unescapeWildcard('a~?b')).toBe('a?b');
    expect(unescapeWildcard('a~~b')).toBe('a~b');
    expect(unescapeWildcard('a~b')).toBe('a~b'); // a tilde before anything else is literal
    expect(unescapeWildcard('trailing~')).toBe('trailing~');
    // A mixed pattern keeps the escape literal and the bare wildcard active.
    expect(wild('~*a*', '*abc')).toBe(true);
    expect(wild('~*a*', 'abc')).toBe(false);
  });

  it('has no catastrophic backtracking on an adversarial pattern', () => {
    // The shape that makes a naive regular expression take exponential time.
    // A single-star backtracking scan is O(pattern x subject); this must
    // finish in milliseconds, not seconds.
    const pattern = compileWildcard('*a*a*a*a*a*a*a*a*a*a*b');
    expect(pattern).not.toBeNull();
    const subject = 'a'.repeat(4000);
    const start = Date.now();
    expect(pattern && matchWildcard(pattern, subject)).toBe(false);
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it('matches a long pattern against a long subject in bounded time', () => {
    const pattern = compileWildcard(`${'?'.repeat(500)}*`);
    expect(pattern).not.toBeNull();
    const start = Date.now();
    expect(pattern && matchWildcard(pattern, 'x'.repeat(5000))).toBe(true);
    expect(Date.now() - start).toBeLessThan(2000);
  });
});
