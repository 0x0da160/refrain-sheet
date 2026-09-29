// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { parseMarkdown, parseMarkdownRanges } from '../../src/core/markdown';
import { blocksToMarkdown, blockToMarkdown, inlineToMarkdown } from '../../src/core/markdown-serialize';

const SAMPLE = [
  '# Title',
  '',
  'Some **bold**, *italic*, `code` and [a link](https://example.com).',
  'Second line.',
  '',
  '- one',
  '- two',
  '',
  '1. first',
  '2. second',
  '',
  '> quoted',
  '>',
  '> ## inside',
  '',
  '```js',
  'const a = 1;',
  '```',
  '',
  '---',
  '',
  '| a | b |',
  '| :--- | ---: |',
  '| 1 | x \\| y |',
].join('\n');

describe('blockToMarkdown', () => {
  it('writes back Markdown that parses to the same blocks', () => {
    const blocks = parseMarkdown(SAMPLE);
    expect(parseMarkdown(blocksToMarkdown(blocks))).toEqual(blocks);
  });

  it('writes the canonical form of each block', () => {
    const blocks = parseMarkdown(SAMPLE);
    expect(blocks.map(blockToMarkdown)).toEqual([
      '# Title',
      'Some **bold**, *italic*, `code` and [a link](https://example.com).\nSecond line.',
      '- one\n- two',
      '1. first\n2. second',
      '> quoted\n>\n> ## inside',
      '```js\nconst a = 1;\n```',
      '---',
      '| a | b |\n| :--- | ---: |\n| 1 | x \\| y |',
    ]);
  });

  it('picks the other emphasis mark, or plain text, when the content holds one', () => {
    expect(inlineToMarkdown([{ type: 'strong', children: [{ type: 'text', text: 'a*b' }] }])).toBe('__a*b__');
    expect(inlineToMarkdown([{ type: 'em', children: [{ type: 'text', text: 'a*b_c' }] }])).toBe('a*b_c');
    expect(inlineToMarkdown([{ type: 'code', text: 'a`b' }])).toBe('a`b');
    expect(inlineToMarkdown([{ type: 'strong', children: [{ type: 'text', text: ' ' }] }])).toBe(' ');
  });

  it('drops a link it cannot write and keeps its text', () => {
    expect(
      inlineToMarkdown([{ type: 'link', href: 'a b', children: [{ type: 'text', text: 'here' }] }]),
    ).toBe('here');
  });

  it('fences code with more backticks than it holds', () => {
    const md = blockToMarkdown({ type: 'codeBlock', text: 'x\n```\ny', lang: null });
    expect(md).toBe('````\nx\n```\ny\n````');
    expect(parseMarkdown(md)).toEqual([{ type: 'codeBlock', text: 'x\n```\ny', lang: null }]);
  });
});

describe('parseMarkdownRanges', () => {
  it('gives each top-level block its source lines', () => {
    const ranges = parseMarkdownRanges(SAMPLE);
    expect(ranges.map(({ start, end }) => [start, end])).toEqual([
      [0, 1],
      [2, 4],
      [5, 7],
      [8, 10],
      [11, 14],
      [15, 18],
      [19, 20],
      [21, 24],
    ]);
    expect(ranges.map((r) => r.block)).toEqual(parseMarkdown(SAMPLE));
  });

  it('is empty for blank text', () => {
    expect(parseMarkdownRanges('\n\n')).toEqual([]);
  });
});
