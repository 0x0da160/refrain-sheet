// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { parseJsonWorkbook } from '../src/core/json-import';
import { buildJsonExport } from '../src/core/json-export';

function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe('parseJsonWorkbook: round trip with this app’s own export', () => {
  it('reads back a table produced by buildJsonExport', () => {
    const rows = [
      ['a', 'b'],
      ['1', 'hello'],
      ['2', 'world'],
    ];
    const result = parseJsonWorkbook(buildJsonExport(rows));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.columnCount).toBe(2);
    expect(result.rows).toEqual([
      ['1', 'hello'],
      ['2', 'world'],
    ]);
  });

  it('round-trips TRUE/FALSE and blank cells through export and back', () => {
    const rows = [
      ['flag', 'note'],
      ['TRUE', ''],
      ['FALSE', 'x'],
    ];
    const result = parseJsonWorkbook(buildJsonExport(rows));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toEqual([
      ['TRUE', ''],
      ['FALSE', 'x'],
    ]);
  });
});

describe('parseJsonWorkbook: flat array-of-objects shape', () => {
  it('reads a simple array of flat objects into a dense grid', () => {
    const result = parseJsonWorkbook(
      bytesOf(
        JSON.stringify([
          { a: 1, b: 'x' },
          { a: 2, b: 'y' },
        ]),
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.columnCount).toBe(2);
    expect(result.rows).toEqual([
      ['1', 'x'],
      ['2', 'y'],
    ]);
  });

  it('uses the union of every object’s keys, in first-seen order, as columns', () => {
    const result = parseJsonWorkbook(bytesOf(JSON.stringify([{ a: 1 }, { b: 2 }, { a: 3, c: 4 }])));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.columnCount).toBe(3);
    expect(result.rows).toEqual([
      ['1', '', ''],
      ['', '2', ''],
      ['3', '', '4'],
    ]);
  });

  it('converts booleans to TRUE/FALSE and null to a blank cell, matching XLSX import', () => {
    const result = parseJsonWorkbook(bytesOf(JSON.stringify([{ a: true, b: false, c: null }])));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toEqual([['TRUE', 'FALSE', '']]);
  });

  it('converts numbers to their plain decimal text', () => {
    const result = parseJsonWorkbook(bytesOf(JSON.stringify([{ a: 42 }, { a: -3.5 }])));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toEqual([['42'], ['-3.5']]);
  });
});

describe('parseJsonWorkbook: malformed or unsupported input is rejected, never partially imported', () => {
  it('rejects bytes that are not valid JSON at all', () => {
    const result = parseJsonWorkbook(bytesOf('not json'));
    expect(result).toEqual({ ok: false, error: 'invalid-json' });
  });

  it('rejects a top-level JSON object instead of an array', () => {
    const result = parseJsonWorkbook(bytesOf(JSON.stringify({ a: 1 })));
    expect(result).toEqual({ ok: false, error: 'not-an-array' });
  });

  it('rejects a top-level array of primitives', () => {
    const result = parseJsonWorkbook(bytesOf(JSON.stringify([1, 2, 3])));
    expect(result).toEqual({ ok: false, error: 'not-flat-object' });
  });

  it('rejects an empty array', () => {
    const result = parseJsonWorkbook(bytesOf('[]'));
    expect(result).toEqual({ ok: false, error: 'empty-array' });
  });

  it('rejects an element that is itself an array', () => {
    const result = parseJsonWorkbook(bytesOf(JSON.stringify([[1, 2]])));
    expect(result).toEqual({ ok: false, error: 'not-flat-object' });
  });

  it('rejects a null element', () => {
    const result = parseJsonWorkbook(bytesOf(JSON.stringify([null])));
    expect(result).toEqual({ ok: false, error: 'not-flat-object' });
  });

  it('rejects a nested object as a property value', () => {
    const result = parseJsonWorkbook(bytesOf(JSON.stringify([{ a: { nested: true } }])));
    expect(result).toEqual({ ok: false, error: 'not-flat-object' });
  });

  it('rejects an array as a property value', () => {
    const result = parseJsonWorkbook(bytesOf(JSON.stringify([{ a: [1, 2] }])));
    expect(result).toEqual({ ok: false, error: 'not-flat-object' });
  });
});
