// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { buildJsonExport } from '../src/core/json-export';

function parse(bytes: Uint8Array): unknown {
  return JSON.parse(new TextDecoder().decode(bytes));
}

describe('buildJsonExport (pure)', () => {
  it('builds an array of objects, one per row after the header', () => {
    const rows = [
      ['name', 'age'],
      ['Alice', '30'],
      ['Bob', '25'],
    ];
    expect(parse(buildJsonExport(rows))).toEqual([
      { name: 'Alice', age: 30 },
      { name: 'Bob', age: 25 },
    ]);
  });

  it('produces an empty array for a header-only or empty input', () => {
    expect(parse(buildJsonExport([['a', 'b']]))).toEqual([]);
    expect(parse(buildJsonExport([]))).toEqual([]);
  });

  it('encodes canonical-decimal text as a JSON number and everything else as a string', () => {
    const rows = [
      ['n1', 'n2', 'n3', 'n4', 'text'],
      ['42', '-3.5', '007', '1.0', 'hello'],
    ];
    expect(parse(buildJsonExport(rows))).toEqual([
      // Leading zeros and a trailing ".0" are not canonical, so they stay text
      // — the same scope XLSX export documents for `isCanonicalNumber`.
      { n1: 42, n2: -3.5, n3: '007', n4: '1.0', text: 'hello' },
    ]);
  });

  it('encodes TRUE/FALSE as JSON booleans and blank cells as null', () => {
    const rows = [
      ['flag', 'note'],
      ['TRUE', ''],
      ['FALSE', 'x'],
    ];
    expect(parse(buildJsonExport(rows))).toEqual([
      { flag: true, note: null },
      { flag: false, note: 'x' },
    ]);
  });

  it('fills a missing trailing cell in a ragged row with null', () => {
    const rows = [['a', 'b'], ['1']];
    expect(parse(buildJsonExport(rows))).toEqual([{ a: 1, b: null }]);
  });

  it('replaces a blank header cell with a positional Column<N> fallback', () => {
    const rows = [
      ['a', '', 'c'],
      ['1', '2', '3'],
    ];
    expect(parse(buildJsonExport(rows))).toEqual([{ a: 1, Column2: 2, c: 3 }]);
  });

  it('de-duplicates repeated header names so no field is silently overwritten', () => {
    const rows = [
      ['a', 'a', 'a (2)'],
      ['1', '2', '3'],
    ];
    expect(parse(buildJsonExport(rows))).toEqual([{ a: 1, 'a (2)': 2, 'a (2) (2)': 3 }]);
  });

  it('produces well-formed, human-readable (indented) JSON', () => {
    const text = new TextDecoder().decode(buildJsonExport([['a'], ['1']]));
    expect(text).toBe('[\n  {\n    "a": 1\n  }\n]');
  });
});
