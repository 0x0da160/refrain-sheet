// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { snippetAround, sourceAnchor, type FoundMatch } from '../../src/ui/find-occurrences';

/** A source-text match at `start`..`end` of the worksheet 't1'. */
function found(start: number, end: number): FoundMatch {
  return {
    row: 0,
    col: 0,
    count: 1,
    sheetId: 't1',
    sheetName: 'Notes',
    range: { start, end, text: '', exec: null },
  };
}

describe('snippetAround', () => {
  it('shows the whole line holding the anchor, marking the ranges in it', () => {
    const value = 'one cat\ntwo cat cat\nthree';

    const snippet = snippetAround(
      value,
      { start: 12, end: 15 },
      [
        { start: 12, end: 15 },
        { start: 16, end: 19 },
      ],
      120,
    );

    expect(snippet).toEqual({
      text: 'two cat cat',
      marks: [
        { start: 4, end: 7 },
        { start: 8, end: 11 },
      ],
    });
  });

  it('shows a window of a long line centred on the anchor, with ellipses where it was cut', () => {
    const value = `${'a'.repeat(50)}cat${'b'.repeat(50)}`;

    const snippet = snippetAround(value, { start: 50, end: 53 }, [{ start: 50, end: 53 }], 20);

    expect(snippet).toEqual({ text: '…aaaaaaaacatbbbbbbbbb…', marks: [{ start: 9, end: 12 }] });
  });

  it('clips a mark that runs past the window to the window', () => {
    const value = 'x'.repeat(100);

    const snippet = snippetAround(value, { start: 0, end: 30 }, [{ start: 0, end: 30 }], 20);

    expect(snippet).toEqual({ text: `…${'x'.repeat(20)}…`, marks: [{ start: 1, end: 21 }] });
  });

  it('shows nothing and marks nothing for an empty anchor in an empty text', () => {
    expect(snippetAround('', { start: 0, end: 0 }, [], 120)).toEqual({ text: '', marks: [] });
  });
});

describe('sourceAnchor', () => {
  const matches = [found(0, 3), found(8, 11), found(16, 19)];
  const all = (): boolean => true;

  it('starts Next before the first occurrence at or after the selection', () => {
    expect(sourceAnchor(matches, all, { start: 0, end: 0 }, 1)).toBe(-1);
    expect(sourceAnchor(matches, all, { start: 0, end: 3 }, 1)).toBe(0);
  });

  it('starts Previous so the step lands on the last occurrence ending before the selection', () => {
    expect(sourceAnchor(matches, all, { start: 8, end: 11 }, -1)).toBe(1);
  });

  it('wraps Next past the last occurrence and Previous before the first', () => {
    expect(sourceAnchor(matches, all, { start: 19, end: 19 }, 1)).toBe(2);
    expect(sourceAnchor(matches, all, { start: 0, end: 0 }, -1)).toBe(0);
  });

  it('skips occurrences the predicate rejects', () => {
    const onSecond = (m: FoundMatch): boolean => m.range?.start !== 8;
    expect(sourceAnchor(matches, onSecond, { start: 0, end: 3 }, 1)).toBe(1);
  });
});
