// SPDX-License-Identifier: MIT
import { type MarkdownBlock, type MarkdownInline } from '../core/markdown';
import { el } from './dom';

const HEADING_TAGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const;

/**
 * Render a parsed Markdown AST (`src/core/markdown.ts`) as DOM nodes via
 * `el()`/`textContent` — never as an HTML string — so arbitrary Markdown
 * source (including an embedded `<script>` or other HTML-looking text) can
 * only ever render as literal displayed text, the same guarantee every other
 * surface in this app gives untrusted content (`src/ui/dom.ts`). Shared by
 * the standalone Markdown editor (`dialogs/markdown-editor.ts`, #433) and the
 * in-workbook Markdown worksheet (`markdown-sheet.ts`) so this safety-critical
 * rendering logic exists exactly once.
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
      return el('pre', {}, [el('code', { text: block.text })]);
    case 'list':
      return el(
        block.ordered ? 'ol' : 'ul',
        {},
        block.items.map((item) => el('li', {}, renderInline(item))),
      );
  }
}

/** Render a full Markdown block AST as an array of DOM nodes, one per block. */
export function renderMarkdownBlocks(blocks: MarkdownBlock[]): Node[] {
  return blocks.map(renderBlock);
}
