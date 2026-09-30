// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { moveMarkdownBlock } from '../../src/core/markdown-blocks';
import { parseMarkdownRanges } from '../../src/core/markdown';

function move(source: string, from: number, to: number): string {
  const ranges = parseMarkdownRanges(source);
  return moveMarkdownBlock(source.split('\n'), ranges, from, to).join('\n');
}

describe('moving a Markdown block', () => {
  const doc = '# Title\n\nFirst para.\n\n- a\n- b\n\nLast para.';

  it('moves a block down one place, keeping the blank lines where they were', () => {
    expect(move(doc, 1, 2)).toBe('# Title\n\n- a\n- b\n\nFirst para.\n\nLast para.');
  });

  it('moves a block to the top and to the end', () => {
    expect(move(doc, 3, 0)).toBe('Last para.\n\n# Title\n\nFirst para.\n\n- a\n- b');
    expect(move(doc, 0, 3)).toBe('First para.\n\n- a\n- b\n\nLast para.\n\n# Title');
  });

  it('keeps each block exactly as written, markers and all', () => {
    const source = '* one\n* two\n\n> quoted **bold**\n\n```js\nx = 1\n```';
    expect(move(source, 2, 0)).toBe('```js\nx = 1\n```\n\n* one\n* two\n\n> quoted **bold**');
  });

  it('adds a blank line where the move would join two blocks', () => {
    // A heading followed directly by a paragraph, then a list.
    expect(move('# H\ntext\n\n- a', 2, 1)).toBe('# H\n\n- a\n\ntext');
  });

  it('leaves the source as it was for a move to the same place or out of range', () => {
    expect(move(doc, 1, 1)).toBe(doc);
    expect(move(doc, 0, -1)).toBe(doc);
    expect(move(doc, 4, 0)).toBe(doc);
  });

  it('keeps what comes before the first block and after the last', () => {
    expect(move('\n\nA\n\nB\n\n', 1, 0)).toBe('\n\nB\n\nA\n\n');
  });
});
