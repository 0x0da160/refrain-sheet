// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { countVisualLines, rowHeightForLines, wrapVisualLines } from '../src/core/text-wrap';

/** Fixed-width measurer: every character is 10px wide (deterministic). */
const measure = (text: string): number => text.length * 10;

describe('countVisualLines', () => {
  it('keeps content that fits on a single line', () => {
    expect(countVisualLines('hello', measure, 100, 12)).toBe(1);
    // Exactly filling the box is still one line.
    expect(countVisualLines('0123456789', measure, 100, 12)).toBe(1);
  });

  it('wraps at whitespace when the next word would overflow', () => {
    // "hello world foo" = 150px of text in a 100px box → 2 lines.
    expect(countVisualLines('hello world foo', measure, 100, 12)).toBe(2);
  });

  it('starts a new visual line at every explicit newline (\\n, \\r\\n, \\r)', () => {
    expect(countVisualLines('a\nb', measure, 100, 12)).toBe(2);
    expect(countVisualLines('a\r\nb\r\nc', measure, 100, 12)).toBe(3);
    expect(countVisualLines('a\rb', measure, 100, 12)).toBe(2);
    // A blank line between two newlines still occupies a line.
    expect(countVisualLines('a\n\nb', measure, 100, 12)).toBe(3);
  });

  it('breaks a single unbroken word wider than the box (overflow-wrap)', () => {
    // 12 chars × 10px = 120px in a 100px box → 2 lines (10 chars + 2 chars).
    expect(countVisualLines('aaaaaaaaaaaa', measure, 100, 12)).toBe(2);
    // 25 chars in a 100px (10-char) box → 3 lines.
    expect(countVisualLines('a'.repeat(25), measure, 100, 12)).toBe(3);
  });

  it('decides from measured width, not character count', () => {
    // The same 8 characters fit on one line in a wide box and wrap in a narrow
    // one — the count of characters never decides wrapping on its own.
    expect(countVisualLines('abcdefgh', measure, 200, 12)).toBe(1);
    expect(countVisualLines('abcd efgh', measure, 50, 12)).toBe(2);
  });

  it('never reports fewer than one or more than maxLines', () => {
    expect(countVisualLines('', measure, 100, 12)).toBe(1);
    // Ten explicit lines but a cap of 3.
    expect(countVisualLines('a\nb\nc\nd\ne\nf', measure, 100, 3)).toBe(3);
  });

  it('does not wrap when the box is unusably narrow or wrapping is disabled', () => {
    expect(countVisualLines('hello world', measure, 0, 12)).toBe(1);
    expect(countVisualLines('hello world', measure, 100, 1)).toBe(1);
  });
});

describe('wrapVisualLines', () => {
  it('returns the whole value as one line when it fits', () => {
    expect(wrapVisualLines('hello', measure, 100, 12)).toEqual(['hello']);
  });

  it('splits at whitespace, matching countVisualLines', () => {
    // "hello world foo" = 150px in a 100px box: "hello"(50) fits alone, then
    // "world"(50)+" "+"foo"(30) = 90px fits on the next line.
    const lines = wrapVisualLines('hello world foo', measure, 100, 12);
    expect(lines).toEqual(['hello', 'world foo']);
    expect(lines.length).toBe(countVisualLines('hello world foo', measure, 100, 12));
  });

  it('starts a new line at every explicit newline', () => {
    expect(wrapVisualLines('a\nb', measure, 100, 12)).toEqual(['a', 'b']);
  });

  it('breaks a single unbroken word wider than the box', () => {
    expect(wrapVisualLines('aaaaaaaaaaaa', measure, 100, 12)).toEqual(['aaaaaaaaaa', 'aa']);
  });

  it('caps at maxLines, mirroring countVisualLines', () => {
    const lines = wrapVisualLines('a\nb\nc\nd\ne\nf', measure, 100, 3);
    expect(lines.length).toBe(3);
  });

  it('does not wrap when the box is unusably narrow or wrapping is disabled', () => {
    expect(wrapVisualLines('hello world', measure, 0, 12)).toEqual(['hello world']);
    expect(wrapVisualLines('hello world', measure, 100, 1)).toEqual(['hello world']);
  });
});

describe('rowHeightForLines', () => {
  it('keeps the exact single-line base height for one line', () => {
    expect(rowHeightForLines(1, 26, 18, 8)).toBe(26);
  });

  it('adds a line box and the vertical chrome for each extra line', () => {
    expect(rowHeightForLines(2, 26, 18, 8)).toBe(Math.ceil(8 + 2 * 18));
    expect(rowHeightForLines(3, 26, 18, 8)).toBe(Math.ceil(8 + 3 * 18));
  });
});
