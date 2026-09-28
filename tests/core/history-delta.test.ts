// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import {
  applyJsonDelta,
  diffJson,
  HistoryDeltaError,
  type Json,
} from '../../src/core/workbook/history-delta';

function roundTrip(base: Json, target: Json): Json | null {
  const delta = diffJson(base, target);
  if (delta !== null) {
    const rebuilt = applyJsonDelta(base, JSON.parse(JSON.stringify(delta)));
    expect(JSON.stringify(rebuilt)).toBe(JSON.stringify(target));
  }
  return delta;
}

describe('history deltas', () => {
  it('is null for equal trees', () => {
    expect(diffJson({ a: [1, [2]] }, { a: [1, [2]] })).toBeNull();
  });

  it('patches one cell of one row', () => {
    const base = {
      cells: [
        ['a', 'b'],
        ['c', 'd'],
        ['e', 'f'],
      ],
    };
    const target = {
      cells: [
        ['a', 'b'],
        ['c', 'X'],
        ['e', 'f'],
      ],
    };
    expect(roundTrip(base, target)).toEqual({ o: { cells: { a: [[1, { a: [[1, { v: 'X' }]] }]] } } });
  });

  it('splices an inserted or deleted row', () => {
    const rows = [['1'], ['2'], ['3'], ['4']];
    expect(roundTrip(rows, [['1'], ['new'], ['2'], ['3'], ['4']])).toEqual({ s: [1, 0, [['new']]] });
    expect(roundTrip(rows, [['1'], ['2'], ['4']])).toEqual({ s: [2, 1, []] });
  });

  it('replaces an array that mostly changed', () => {
    expect(roundTrip([1, 2, 3], [4, 5, 3])).toEqual({ v: [4, 5, 3] });
  });

  it('adds, removes, and reorders keys', () => {
    expect(roundTrip({ a: 1, b: 2 }, { a: 1, c: 3 })).toEqual({ o: { c: { v: 3 } }, d: ['b'] });
    expect(roundTrip({ a: 1, c: 3 }, { a: 1, b: 2, c: 3 })).toEqual({
      o: { b: { v: 2 } },
      k: ['a', 'b', 'c'],
    });
  });

  it('keeps __proto__ as a plain key', () => {
    const target = JSON.parse('{"__proto__":{"x":1}}') as Json;
    roundTrip({}, target);
    const rebuilt = applyJsonDelta({}, diffJson({}, target)) as object;
    expect(Object.getPrototypeOf(rebuilt)).toBe(Object.prototype);
  });

  it.each([
    ['a non-object delta', 1],
    ['an unknown form', { x: 1 }],
    ['an object delta on an array', { o: {} }],
    ['an element past the end', { a: [[3, { v: 1 }]] }],
    [
      'elements out of order',
      {
        a: [
          [1, { v: 1 }],
          [0, { v: 1 }],
        ],
      },
    ],
    ['a splice past the end', { s: [2, 5, []] }],
    ['a fractional index', { a: [[0.5, { v: 1 }]] }],
  ])('refuses %s', (_label, delta) => {
    expect(() => applyJsonDelta([1, 2, 3], delta)).toThrow(HistoryDeltaError);
  });

  it.each([
    ['removing a missing key', { o: {}, d: ['z'] }],
    ['adding a key without a value', { o: { z: { o: {} } } }],
    ['an order that misses a key', { o: {}, k: ['a'] }],
    ['an order with a duplicate', { o: {}, k: ['a', 'a'] }],
  ])('refuses %s', (_label, delta) => {
    expect(() => applyJsonDelta({ a: 1, b: 2 }, delta)).toThrow(HistoryDeltaError);
  });

  it('refuses a delta nested deeper than any workbook', () => {
    let delta: Json = { v: 1 };
    let base: Json = 1;
    for (let i = 0; i < 40; i++) {
      delta = { a: [[0, delta]] };
      base = [base];
    }
    expect(() => applyJsonDelta(base, delta)).toThrow(HistoryDeltaError);
  });
});
