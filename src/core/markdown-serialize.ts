// SPDX-License-Identifier: MIT
/**
 * Markdown text for a block AST (`markdown.ts`), the reverse of
 * `parseMarkdown`: what the Markdown sheet's visual mode saves for a block
 * the user edited there. Parsing the output gives back the same blocks for
 * everything the parser itself produces; what the parser cannot express
 * (emphasis around its own delimiter, a link whose address has spaces)
 * degrades to plain text rather than to Markdown that means something else.
 */
import type { MarkdownBlock, MarkdownInline, MarkdownTableAlign } from './markdown';

function plainText(nodes: MarkdownInline[]): string {
  return nodes
    .map((node) =>
      node.type === 'text' || node.type === 'code'
        ? node.text
        : node.type === 'break'
          ? ' '
          : plainText(node.children),
    )
    .join('');
}

/** Emphasis with whichever delimiter the content does not contain, or plain text when it has both. */
function emphasis(nodes: MarkdownInline[], marks: [string, string]): string {
  const text = plainText(nodes);
  if (text.trim() === '') {
    return text;
  }
  const [star, underscore] = marks;
  if (!text.includes('*')) {
    return `${star}${text}${star}`;
  }
  if (!text.includes('_')) {
    return `${underscore}${text}${underscore}`;
  }
  return text;
}

/** Inline Markdown; a line break becomes `lineBreak` (a newline in a paragraph, a space elsewhere). */
export function inlineToMarkdown(nodes: MarkdownInline[], lineBreak = '\n'): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case 'text':
          return node.text.replace(/\n/g, lineBreak);
        case 'break':
          return lineBreak;
        case 'strong':
          return emphasis(node.children, ['**', '__']);
        case 'em':
          return emphasis(node.children, ['*', '_']);
        case 'code':
          return node.text === '' || node.text.includes('`') ? node.text : `\`${node.text}\``;
        case 'link': {
          const text = plainText(node.children).replace(/[[\]]/g, '');
          return /[\s()]/.test(node.href) ? text : `[${text}](${node.href})`;
        }
      }
    })
    .join('');
}

function tableRow(cells: MarkdownInline[][]): string {
  return `| ${cells.map((cell) => inlineToMarkdown(cell, ' ').replace(/\|/g, '\\|')).join(' | ')} |`;
}

function delimiter(align: MarkdownTableAlign): string {
  switch (align) {
    case 'left':
      return ':---';
    case 'center':
      return ':---:';
    case 'right':
      return '---:';
    default:
      return '---';
  }
}

/** A fence longer than any backtick run the code holds. */
function fence(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  return '`'.repeat(Math.max(3, longest + 1));
}

/** Markdown text for one block, without surrounding blank lines. */
export function blockToMarkdown(block: MarkdownBlock): string {
  switch (block.type) {
    case 'heading':
      return `${'#'.repeat(block.level)} ${inlineToMarkdown(block.children, ' ').trim()}`;
    case 'paragraph':
      return inlineToMarkdown(block.children);
    case 'blockquote':
      return blocksToMarkdown(block.children)
        .split('\n')
        .map((line) => (line === '' ? '>' : `> ${line}`))
        .join('\n');
    case 'list':
      return block.items
        .map((item, i) => `${block.ordered ? `${i + 1}.` : '-'} ${inlineToMarkdown(item, ' ').trim()}`)
        .join('\n');
    case 'codeBlock': {
      const mark = fence(block.text);
      return `${mark}${block.lang ?? ''}\n${block.text}\n${mark}`;
    }
    case 'hr':
      return '---';
    case 'table':
      return [
        tableRow(block.header),
        `| ${block.header.map((_, i) => delimiter(block.align[i] ?? null)).join(' | ')} |`,
        ...block.rows.map(tableRow),
      ].join('\n');
  }
}

/** Blocks separated by blank lines. */
export function blocksToMarkdown(blocks: MarkdownBlock[]): string {
  return blocks.map(blockToMarkdown).join('\n\n');
}
