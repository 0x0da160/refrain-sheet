// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { isSafeMarkdownUrl, parseMarkdown, type MarkdownInline } from '../src/core/markdown';

function text(t: string): MarkdownInline {
  return { type: 'text', text: t };
}

describe('parseMarkdown', () => {
  it('parses headings of every level', () => {
    for (let level = 1; level <= 6; level++) {
      const blocks = parseMarkdown(`${'#'.repeat(level)} Title ${level}`);
      expect(blocks).toEqual([{ type: 'heading', level, children: [text(`Title ${level}`)] }]);
    }
  });

  it('does not treat a 7th "#" as a heading', () => {
    const blocks = parseMarkdown('####### not a heading');
    expect(blocks).toEqual([{ type: 'paragraph', children: [text('####### not a heading')] }]);
  });

  it('parses a plain paragraph', () => {
    expect(parseMarkdown('hello world')).toEqual([{ type: 'paragraph', children: [text('hello world')] }]);
  });

  it('treats a single newline inside a paragraph as a line break', () => {
    expect(parseMarkdown('line one\nline two')).toEqual([
      {
        type: 'paragraph',
        children: [text('line one'), { type: 'break' }, text('line two')],
      },
    ]);
  });

  it('splits paragraphs on a blank line', () => {
    expect(parseMarkdown('first\n\nsecond')).toEqual([
      { type: 'paragraph', children: [text('first')] },
      { type: 'paragraph', children: [text('second')] },
    ]);
  });

  it('parses bold with ** and __', () => {
    expect(parseMarkdown('**bold**')).toEqual([
      { type: 'paragraph', children: [{ type: 'strong', children: [text('bold')] }] },
    ]);
    expect(parseMarkdown('__bold__')).toEqual([
      { type: 'paragraph', children: [{ type: 'strong', children: [text('bold')] }] },
    ]);
  });

  it('parses italic with * and _', () => {
    expect(parseMarkdown('*em*')).toEqual([
      { type: 'paragraph', children: [{ type: 'em', children: [text('em')] }] },
    ]);
    expect(parseMarkdown('_em_')).toEqual([
      { type: 'paragraph', children: [{ type: 'em', children: [text('em')] }] },
    ]);
  });

  it('parses inline code', () => {
    expect(parseMarkdown('here is `code`')).toEqual([
      {
        type: 'paragraph',
        children: [text('here is '), { type: 'code', text: 'code' }],
      },
    ]);
  });

  it('parses a mix of inline styles in one paragraph', () => {
    expect(parseMarkdown('a **b** c *d* e `f`')).toEqual([
      {
        type: 'paragraph',
        children: [
          text('a '),
          { type: 'strong', children: [text('b')] },
          text(' c '),
          { type: 'em', children: [text('d')] },
          text(' e '),
          { type: 'code', text: 'f' },
        ],
      },
    ]);
  });

  it('parses a link with an allow-listed scheme', () => {
    expect(parseMarkdown('[docs](https://example.com/page)')).toEqual([
      {
        type: 'paragraph',
        children: [{ type: 'link', href: 'https://example.com/page', children: [text('docs')] }],
      },
    ]);
  });

  it('parses a relative link and an anchor link', () => {
    expect(parseMarkdown('[rel](./page.md)')).toEqual([
      { type: 'paragraph', children: [{ type: 'link', href: './page.md', children: [text('rel')] }] },
    ]);
    expect(parseMarkdown('[anchor](#section)')).toEqual([
      { type: 'paragraph', children: [{ type: 'link', href: '#section', children: [text('anchor')] }] },
    ]);
  });

  it('degrades a javascript: link to literal text instead of rendering it as a link', () => {
    expect(parseMarkdown('[click me](javascript:alert(1))')).toEqual([
      { type: 'paragraph', children: [text('[click me](javascript:alert(1))')] },
    ]);
  });

  it('degrades a data: link to literal text', () => {
    const blocks = parseMarkdown('[x](data:text/html,<script>alert(1)</script>)');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: 'paragraph' });
  });

  it('parses an unordered list', () => {
    expect(parseMarkdown('- one\n- two\n- three')).toEqual([
      {
        type: 'list',
        ordered: false,
        items: [[text('one')], [text('two')], [text('three')]],
      },
    ]);
  });

  it('parses an ordered list', () => {
    expect(parseMarkdown('1. one\n2. two')).toEqual([
      { type: 'list', ordered: true, items: [[text('one')], [text('two')]] },
    ]);
  });

  it('starts a new list when the marker style switches between ordered and unordered', () => {
    const blocks = parseMarkdown('- one\n1. two');
    expect(blocks).toEqual([
      { type: 'list', ordered: false, items: [[text('one')]] },
      { type: 'list', ordered: true, items: [[text('two')]] },
    ]);
  });

  it('parses a blockquote', () => {
    expect(parseMarkdown('> quoted line')).toEqual([
      {
        type: 'blockquote',
        children: [{ type: 'paragraph', children: [text('quoted line')] }],
      },
    ]);
  });

  it('parses a blockquote spanning multiple lines with a blank line inside as two paragraphs', () => {
    expect(parseMarkdown('> first\n>\n> second')).toEqual([
      {
        type: 'blockquote',
        children: [
          { type: 'paragraph', children: [text('first')] },
          { type: 'paragraph', children: [text('second')] },
        ],
      },
    ]);
  });

  it('parses horizontal rules made of -, *, or _', () => {
    for (const rule of ['---', '***', '___', '- - -']) {
      expect(parseMarkdown(rule)).toEqual([{ type: 'hr' }]);
    }
  });

  it('does not treat a short "--" as a horizontal rule', () => {
    expect(parseMarkdown('--')).toEqual([{ type: 'paragraph', children: [text('--')] }]);
  });

  it('parses a fenced code block, verbatim, without interpreting inline markup inside it', () => {
    expect(parseMarkdown('```js\nconst a = **not bold**;\n```')).toEqual([
      { type: 'codeBlock', text: 'const a = **not bold**;', lang: 'js' },
    ]);
  });

  it('parses a fenced code block with no language', () => {
    expect(parseMarkdown('```\nplain\n```')).toEqual([{ type: 'codeBlock', text: 'plain', lang: null }]);
  });

  it('closes an unterminated fence at end of input rather than hanging', () => {
    expect(parseMarkdown('```\nunterminated')).toEqual([
      { type: 'codeBlock', text: 'unterminated', lang: null },
    ]);
  });

  it('never renders an embedded HTML/script tag as anything but literal text in the AST', () => {
    const blocks = parseMarkdown('<script>alert(1)</script>');
    expect(blocks).toEqual([{ type: 'paragraph', children: [text('<script>alert(1)</script>')] }]);
  });

  it('returns an empty block list for empty input', () => {
    expect(parseMarkdown('')).toEqual([]);
    expect(parseMarkdown('   \n\n  ')).toEqual([]);
  });

  it('normalizes CRLF and CR line endings like LF', () => {
    expect(parseMarkdown('a\r\nb')).toEqual(parseMarkdown('a\nb'));
    expect(parseMarkdown('a\rb')).toEqual(parseMarkdown('a\nb'));
  });
});

describe('isSafeMarkdownUrl', () => {
  it('allows http, https, mailto, relative, and anchor links', () => {
    expect(isSafeMarkdownUrl('https://example.com')).toBe(true);
    expect(isSafeMarkdownUrl('http://example.com')).toBe(true);
    expect(isSafeMarkdownUrl('mailto:a@example.com')).toBe(true);
    expect(isSafeMarkdownUrl('./relative.md')).toBe(true);
    expect(isSafeMarkdownUrl('../up.md')).toBe(true);
    expect(isSafeMarkdownUrl('#anchor')).toBe(true);
  });

  it('rejects javascript:, data:, vbscript:, file:, and blank hrefs', () => {
    expect(isSafeMarkdownUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeMarkdownUrl('JavaScript:alert(1)')).toBe(false);
    expect(isSafeMarkdownUrl('data:text/html,evil')).toBe(false);
    expect(isSafeMarkdownUrl('vbscript:msgbox(1)')).toBe(false);
    expect(isSafeMarkdownUrl('file:///etc/passwd')).toBe(false);
    expect(isSafeMarkdownUrl('')).toBe(false);
    expect(isSafeMarkdownUrl('   ')).toBe(false);
  });
});
