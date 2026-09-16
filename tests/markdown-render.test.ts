// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '../src/core/markdown';
import { renderMarkdownBlocks } from '../src/ui/markdown-render';

function render(source: string): HTMLDivElement {
  const container = document.createElement('div');
  container.append(...renderMarkdownBlocks(parseMarkdown(source)));
  return container;
}

describe('renderMarkdownBlocks', () => {
  it('renders a GFM table as a real <table> with <th>/<td> cells', () => {
    const container = render('| A | B |\n| --- | --- |\n| 1 | 2 |');
    const table = container.querySelector('table');
    expect(table).not.toBeNull();
    expect(Array.from(table!.querySelectorAll('th')).map((th) => th.textContent)).toEqual(['A', 'B']);
    expect(Array.from(table!.querySelectorAll('td')).map((td) => td.textContent)).toEqual(['1', '2']);
    // An unspecified (colon-less) delimiter cell gets no alignment class at all.
    expect(table!.querySelector('th')!.className).toBe('');
  });

  it('applies alignment classes from the delimiter row', () => {
    const container = render('| L | C | R |\n| :-- | :-: | --: |\n| a | b | c |');
    const ths = container.querySelectorAll('th');
    expect(ths[0].className).toBe('md-align-left');
    expect(ths[1].className).toBe('md-align-center');
    expect(ths[2].className).toBe('md-align-right');
  });

  it('never renders table cell content as anything but literal text', () => {
    const container = render('| A |\n| --- |\n| <script>alert(1)</script> |');
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('td')?.textContent).toBe('<script>alert(1)</script>');
  });

  it('renders a highlighted fenced code block as spans, preserving the full text', () => {
    const container = render('```js\nconst a = 1;\n```');
    const code = container.querySelector('pre code');
    expect(code).not.toBeNull();
    expect(code!.textContent).toBe('const a = 1;');
    expect(code!.querySelector('.tok-keyword')?.textContent).toBe('const');
    expect(code!.querySelector('.tok-number')?.textContent).toBe('1');
  });

  it('renders a fenced code block with no/unrecognized language as plain text, no highlighting', () => {
    const container = render('```\nplain text\n```');
    const code = container.querySelector('pre code');
    expect(code!.textContent).toBe('plain text');
    expect(code!.querySelector('span')).toBeNull();
  });

  it('never renders script-like code block content as an executable element', () => {
    const container = render('```js\nconst s = "<script>alert(1)</script>";\n```');
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('pre code')?.textContent).toBe('const s = "<script>alert(1)</script>";');
  });
});
