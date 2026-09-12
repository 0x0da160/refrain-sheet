// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import {
  looksLikeMarkdownTable,
  normalizeRange,
  parseClipboardText,
  parseMarkdownTable,
  parsePastedText,
  rangeContains,
  rangeToMarkdownTable,
  rangeToMatrix,
  rangeToTsv,
} from '../src/core/clipboard';
import { doc } from './helpers';

describe('range normalization', () => {
  it('normalizes any two corners into top/left/bottom/right', () => {
    expect(normalizeRange({ row: 3, col: 4 }, { row: 1, col: 2 })).toEqual({
      top: 1,
      left: 2,
      bottom: 3,
      right: 4,
    });
    expect(normalizeRange({ row: 0, col: 0 }, { row: 0, col: 0 })).toEqual({
      top: 0,
      left: 0,
      bottom: 0,
      right: 0,
    });
  });

  it('tests containment', () => {
    const range = normalizeRange({ row: 1, col: 1 }, { row: 2, col: 3 });
    expect(rangeContains(range, 1, 1)).toBe(true);
    expect(rangeContains(range, 2, 3)).toBe(true);
    expect(rangeContains(range, 0, 1)).toBe(false);
    expect(rangeContains(range, 1, 4)).toBe(false);
  });
});

describe('TSV copy output', () => {
  it('produces tab-separated, newline-separated display values', () => {
    const d = doc('a,b,c\n1,2,3\n');
    const tsv = rangeToTsv(d, { top: 0, left: 0, bottom: 1, right: 2 });
    expect(tsv).toBe('a\tb\tc\n1\t2\t3');
  });

  it('quotes cells containing tabs or newlines like spreadsheet software', () => {
    const d = doc('"multi\nline","has\ttab"\n');
    const tsv = rangeToTsv(d, { top: 0, left: 0, bottom: 0, right: 1 });
    expect(tsv).toBe('"multi\nline"\t"has\ttab"');
  });

  it('copies empty strings for cells beyond a jagged row', () => {
    const d = doc('a,b\nonly\n');
    const tsv = rangeToTsv(d, { top: 0, left: 0, bottom: 1, right: 1 });
    expect(tsv).toBe('a\tb\nonly\t');
  });

  it('extracts the raw input matrix for the internal clipboard', () => {
    const d = doc('x,y\n1,2\n');
    expect(rangeToMatrix(d, { top: 0, left: 1, bottom: 1, right: 1 })).toEqual([['y'], ['2']]);
  });
});

describe('clipboard text parsing', () => {
  it('splits tabs and all newline conventions', () => {
    expect(parseClipboardText('a\tb\nc\td')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    expect(parseClipboardText('a\r\nb')).toEqual([['a'], ['b']]);
    expect(parseClipboardText('a\rb')).toEqual([['a'], ['b']]);
  });

  it('drops the conventional single trailing empty line', () => {
    expect(parseClipboardText('a\tb\n')).toEqual([['a', 'b']]);
    expect(parseClipboardText('a\n\n')).toEqual([['a'], ['']]);
  });

  it('pads jagged input into a rectangle', () => {
    expect(parseClipboardText('a\tb\tc\nd')).toEqual([
      ['a', 'b', 'c'],
      ['d', '', ''],
    ]);
  });

  it('unquotes multi-line quoted cells from spreadsheet software', () => {
    expect(parseClipboardText('"multi\nline"\tx')).toEqual([['multi\nline', 'x']]);
    expect(parseClipboardText('"say ""hi"""')).toEqual([['say "hi"']]);
  });

  it('round-trips through copy format and back', () => {
    const d = doc('"a\nb",c\n1,2\n');
    const tsv = rangeToTsv(d, { top: 0, left: 0, bottom: 1, right: 1 });
    expect(parseClipboardText(tsv)).toEqual([
      ['a\nb', 'c'],
      ['1', '2'],
    ]);
  });

  it('returns an empty matrix for empty text', () => {
    expect(parseClipboardText('')).toEqual([]);
  });
});

describe('Markdown table copy output', () => {
  it('produces a GFM table with the first row as the header', () => {
    const d = doc('a,b,c\n1,2,3\n');
    const md = rangeToMarkdownTable(d, { top: 0, left: 0, bottom: 1, right: 2 });
    expect(md).toBe('| a | b | c |\n| --- | --- | --- |\n| 1 | 2 | 3 |');
  });

  it('escapes pipes and collapses newlines in cells', () => {
    const d = doc('"a|b","c\nd"\n');
    const md = rangeToMarkdownTable(d, { top: 0, left: 0, bottom: 0, right: 1 });
    expect(md).toBe('| a\\|b | c d |\n| --- | --- |');
  });

  it('returns an empty string when there are no rows to copy', () => {
    const d = doc('a,b\n');
    expect(rangeToMarkdownTable(d, { top: 0, left: 0, bottom: 0, right: 1 }, [])).toBe('');
  });
});

describe('Markdown table detection and parsing', () => {
  it('recognizes a piped header followed by a --- separator row', () => {
    expect(looksLikeMarkdownTable('| a | b |\n| --- | --- |\n| 1 | 2 |')).toBe(true);
    expect(looksLikeMarkdownTable('| a | b |\n|:---|---:|\n| 1 | 2 |')).toBe(true);
  });

  it('rejects plain tab-separated text', () => {
    expect(looksLikeMarkdownTable('a\tb\n1\t2')).toBe(false);
    expect(looksLikeMarkdownTable('| a | b |')).toBe(false);
  });

  it('parses a Markdown table into a rectangular matrix, dropping the separator row', () => {
    expect(parseMarkdownTable('| a | b |\n| --- | --- |\n| 1 | 2 |')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('unescapes escaped pipes within cells', () => {
    expect(parseMarkdownTable('| a\\|b | c |\n| --- | --- |\n| 1 | 2 |')).toEqual([
      ['a|b', 'c'],
      ['1', '2'],
    ]);
  });

  it('round-trips a copied Markdown table back into a matrix via parsePastedText', () => {
    const d = doc('a,b\n1,2\n');
    const md = rangeToMarkdownTable(d, { top: 0, left: 0, bottom: 1, right: 1 });
    expect(parsePastedText(md)).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('falls back to tab-separated parsing for non-Markdown text', () => {
    expect(parsePastedText('a\tb\n1\t2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});
