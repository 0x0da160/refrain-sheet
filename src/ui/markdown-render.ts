// SPDX-License-Identifier: MIT
import type { MarkdownBlock, MarkdownInline, MarkdownTableAlign } from '../core/markdown';
import { tokenizeCode } from '../core/syntax-highlight';
import { el } from './dom';

const HEADING_TAGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const;

const TABLE_ALIGN_CLASS: Record<Exclude<MarkdownTableAlign, null>, string> = {
  left: 'md-align-left',
  center: 'md-align-center',
  right: 'md-align-right',
};

function tableCellClass(align: MarkdownTableAlign): string {
  return align === null ? '' : TABLE_ALIGN_CLASS[align];
}

/** Render a fenced code block's text as DOM nodes, one `<span class="tok-*">` per highlighted token. */
function renderCode(text: string, lang: string | null): Array<Node | string> {
  return tokenizeCode(text, lang).map((token) =>
    token.type === 'text'
      ? document.createTextNode(token.text)
      : el('span', { className: `tok-${token.type}`, text: token.text }),
  );
}

/**
 * Render a parsed Markdown AST (`src/core/markdown.ts`) as DOM nodes via
 * `el()`/`textContent` — never as an HTML string — so arbitrary Markdown
 * source (including an embedded `<script>` or other HTML-looking text) can
 * only ever render as literal displayed text, the same guarantee every other
 * surface in this app gives untrusted content (`src/ui/dom.ts`). Used by the
 * in-workbook Markdown worksheet (`markdown-sheet.ts`, #433).
 */
function renderInline(nodes: MarkdownInline[]): Array<Node | string> {
  const out: Array<Node | string> = [];
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        out.push(document.createTextNode(node.text));
        break;
      case 'break':
        out.push(el('br'));
        break;
      case 'strong':
        out.push(el('strong', {}, renderInline(node.children)));
        break;
      case 'em':
        out.push(el('em', {}, renderInline(node.children)));
        break;
      case 'code':
        out.push(el('code', { text: node.text }));
        break;
      case 'link':
        out.push(
          el(
            'a',
            { attrs: { href: node.href, target: '_blank', rel: 'noopener noreferrer' } },
            renderInline(node.children),
          ),
        );
        break;
    }
  }
  return out;
}

function renderBlock(block: MarkdownBlock): Node {
  switch (block.type) {
    case 'heading':
      return el(HEADING_TAGS[block.level - 1], {}, renderInline(block.children));
    case 'paragraph':
      return el('p', {}, renderInline(block.children));
    case 'blockquote':
      return el('blockquote', {}, block.children.map(renderBlock));
    case 'hr':
      return el('hr');
    case 'codeBlock':
      return el('pre', {}, [el('code', {}, renderCode(block.text, block.lang))]);
    case 'list':
      return el(
        block.ordered ? 'ol' : 'ul',
        {},
        block.items.map((item) => el('li', {}, renderInline(item))),
      );
    case 'table':
      return el('table', {}, [
        el('thead', {}, [
          el(
            'tr',
            {},
            block.header.map((cell, index) =>
              el('th', { className: tableCellClass(block.align[index] ?? null) }, renderInline(cell)),
            ),
          ),
        ]),
        el(
          'tbody',
          {},
          block.rows.map((row) =>
            el(
              'tr',
              {},
              row.map((cell, index) =>
                el('td', { className: tableCellClass(block.align[index] ?? null) }, renderInline(cell)),
              ),
            ),
          ),
        ),
      ]);
  }
}

/** Render a full Markdown block AST as an array of DOM nodes, one per block. */
export function renderMarkdownBlocks(blocks: MarkdownBlock[]): Node[] {
  return blocks.map(renderBlock);
}
