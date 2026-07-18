// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import {
  compileQuery,
  countMatchesInValue,
  expandTemplate,
  MAX_PATTERN_LENGTH,
  replaceAllInValue,
  searchDocument,
} from '../src/core/search';
import { doc } from './helpers';

function q(text: string, opts: { matchCase?: boolean; regex?: boolean } = {}) {
  return compileQuery({ text, matchCase: opts.matchCase ?? false, regex: opts.regex ?? false });
}

describe('normal search', () => {
  it('counts matches and matching cells', () => {
    const d = doc('apple,grape\npineapple,pear\n');
    const result = searchDocument(d, q('apple'));
    expect(result.matchCount).toBe(2);
    expect(result.cellCount).toBe(2);
    expect(result.cells).toEqual([
      { row: 0, col: 0, count: 1 },
      { row: 1, col: 0, count: 1 },
    ]);
  });

  it('is case-insensitive by default (ASCII folding)', () => {
    expect(countMatchesInValue('Apple APPLE apple', q('APPLE'))).toBe(3);
  });

  it('match case restricts results', () => {
    expect(countMatchesInValue('Apple APPLE apple', q('apple', { matchCase: true }))).toBe(1);
  });

  it('counts correctly in long values (WASM byte-count threshold path)', () => {
    // Longer than LITERAL_WASM_THRESHOLD (256) so the byte-level counter runs.
    const value = 'xy'.repeat(200) + 'needle' + 'zz'.repeat(200) + 'needle';
    expect(value.length).toBeGreaterThan(256);
    expect(countMatchesInValue(value, q('needle', { matchCase: true }))).toBe(2);
    // Overlapping needle counts non-overlapping in long values too.
    expect(countMatchesInValue('a'.repeat(300), q('aa', { matchCase: true }))).toBe(150);
  });

  it('searches current (edited) values', () => {
    const d = doc('a,b\n');
    d.setValue(0, 1, 'needle');
    expect(searchDocument(d, q('needle')).cellCount).toBe(1);
    expect(searchDocument(d, q('b', { matchCase: true })).cellCount).toBe(0);
  });

  it('replaces text occurrences', () => {
    expect(replaceAllInValue('one two one', q('one'), 'zero')).toEqual({ value: 'zero two zero', count: 2 });
  });
});

describe('regex search', () => {
  it('matches with regular expressions', () => {
    const d = doc('abc123,xyz\nno-digits,42\n');
    const result = searchDocument(d, q('\\d+', { regex: true }));
    expect(result.matchCount).toBe(2);
    expect(result.cellCount).toBe(2);
  });

  it('expands $1..$9 capture groups', () => {
    const result = replaceAllInValue('2026-07-16', q('(\\d+)-(\\d+)-(\\d+)', { regex: true }), '$3/$2/$1');
    expect(result).toEqual({ value: '16/07/2026', count: 1 });
  });

  it('expands ${name} named groups', () => {
    const result = replaceAllInValue(
      'john.doe',
      q('(?<first>\\w+)\\.(?<last>\\w+)', { regex: true }),
      '${last}, ${first}',
    );
    expect(result).toEqual({ value: 'doe, john', count: 1 });
  });

  it('keeps references to missing groups literal', () => {
    expect(replaceAllInValue('abc', q('(a)', { regex: true }), '$1$5${nope}').value).toBe('a$5${nope}bc');
  });

  it('$$ expands to a literal dollar sign', () => {
    expect(replaceAllInValue('x', q('x', { regex: true }), '$$1').value).toBe('$1');
  });

  it('invalid regex reports a compile error instead of crashing', () => {
    const compiled = q('(unclosed', { regex: true });
    expect(compiled.ok).toBe(false);
    if (!compiled.ok) {
      expect(compiled.error.length).toBeGreaterThan(0);
    }
    // Searching with a failed compilation is a no-op.
    expect(searchDocument(doc('a,b\n'), compiled).cellCount).toBe(0);
  });

  it('rejects overlong patterns as a backtracking safeguard', () => {
    const compiled = q('a'.repeat(MAX_PATTERN_LENGTH + 1), { regex: true });
    expect(compiled.ok).toBe(false);
  });

  it('stops after the time budget instead of freezing', () => {
    const rows = Array.from({ length: 5000 }, () => 'aaaaaaaaaaaaaaaaaaaaaaaa').join('\n');
    const result = searchDocument(doc(rows), q('a+', { regex: true }), -1);
    expect(result.aborted).toBe(true);
  });

  it('handles zero-length matches without infinite loops', () => {
    expect(countMatchesInValue('abc', q('x*', { regex: true }))).toBeGreaterThan(0);
    expect(replaceAllInValue('abc', q('x*', { regex: true }), '-').value.length).toBeGreaterThan(3);
  });
});

describe('expandTemplate', () => {
  it('supports $& for the whole match', () => {
    const pattern = /b+/g;
    const match = pattern.exec('abbc');
    expect(match).not.toBeNull();
    expect(expandTemplate('[$&]', match as RegExpExecArray)).toBe('[bb]');
  });
});
