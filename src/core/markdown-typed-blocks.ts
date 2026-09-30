// SPDX-License-Identifier: MIT
/**
 * Markdown typed at the start of a line in the Markdown sheet's Formatted
 * editor (`ui/markdown-visual.ts`) that turns the line into the block it
 * stands for, the way the Markdown text would show it. Pure: blocks in,
 * blocks out.
 */
import type { MarkdownBlock, MarkdownInline } from './markdown';

/** The plain text of inline content. */
function plain(line: MarkdownInline[]): string {
  return line
    .map((node) => ('text' in node ? node.text : 'children' in node ? plain(node.children) : ''))
    .join('');
}

/**
 * Markdown typed at the start of a paragraph that turns it into another
 * kind of block as you type, like the Markdown text would show it: `# ` to
 * `###### ` a heading, `- ` / `* ` / `+ ` a bulleted list, `1. ` / `1) ` a
 * numbered list and `> ` a quote. The full-width forms a Japanese input
 * method types (`＃`, `－`, `１．`, `＞`, and a full-width space after them) count too.
 */
const TYPED_BLOCK_MARKERS: ReadonlyArray<{
  pattern: RegExp;
  kind: (match: RegExpMatchArray) => MarkdownBlock;
}> = [
  {
    pattern: /^([#＃]{1,6})[ \u3000]/,
    kind: (m) => ({ type: 'heading', level: m[1].length as 1 | 2 | 3 | 4 | 5 | 6, children: [] }),
  },
  { pattern: /^[-*+－＊＋・][ \u3000]/, kind: () => ({ type: 'list', ordered: false, items: [[]] }) },
  {
    pattern: /^[0-9０-９]{1,9}[.)．）][ \u3000]/,
    kind: () => ({ type: 'list', ordered: true, items: [[]] }),
  },
  { pattern: /^[>＞][ \u3000]/, kind: () => ({ type: 'blockquote', children: [] }) },
];

/**
 * The block a one-line paragraph becomes when it starts with a typed block
 * marker (see {@link TYPED_BLOCK_MARKERS}), and how many characters the
 * marker took; null when it does not start with one.
 */
export function typedBlock(block: MarkdownBlock): { block: MarkdownBlock; marker: number } | null {
  if (block.type !== 'paragraph' || block.children.some((node) => node.type === 'break')) {
    return null;
  }
  const first = block.children[0];
  if (first?.type !== 'text') {
    return null;
  }
  for (const { pattern, kind } of TYPED_BLOCK_MARKERS) {
    const match = first.text.match(pattern);
    if (!match) {
      continue;
    }
    const rest: MarkdownInline[] = [
      ...(first.text.length > match[0].length
        ? [{ type: 'text' as const, text: first.text.slice(match[0].length) }]
        : []),
      ...block.children.slice(1),
    ];
    const shell = kind(match);
    const next: MarkdownBlock =
      shell.type === 'heading'
        ? { ...shell, children: rest }
        : shell.type === 'list'
          ? { ...shell, items: [rest] }
          : { type: 'blockquote', children: [{ type: 'paragraph', children: rest }] };
    return { block: next, marker: match[0].length };
  }
  return null;
}

/** A paragraph that is only a code fence (```` ``` ```` or `~~~`, maybe with a language): Enter makes it a code block. */
export function typedCodeFence(block: MarkdownBlock): MarkdownBlock | null {
  if (block.type !== 'paragraph') {
    return null;
  }
  const match = plain(block.children)
    .trim()
    .match(/^(?:```|~~~|｀｀｀)([A-Za-z0-9_+-]*)$/);
  return match ? { type: 'codeBlock', text: '', lang: match[1] || null } : null;
}
