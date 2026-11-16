// SPDX-License-Identifier: MIT
/**
 * The formatted editor's blocks as Markdown (`markdown-visual.ts`): reading a
 * block back from its element on the page, the block kinds the block-type menu
 * turns a block into, and converting a block from one kind to another. These
 * only read and build Markdown blocks; the editor writes them into the source.
 */
import { isSafeMarkdownUrl, type MarkdownBlock, type MarkdownInline } from '../core/markdown';
import { blockToMarkdown } from '../core/markdown-serialize';
import { INLINE_TAGS } from './markdown-visual-marks';

/** The block kinds the block-type menu can turn a block into. */
export type MarkdownBlockKind = 'paragraph' | 'h1' | 'h2' | 'h3' | 'bullets' | 'numbers' | 'quote' | 'code';

export const MARKDOWN_BLOCK_KINDS: readonly MarkdownBlockKind[] = [
  'paragraph',
  'h1',
  'h2',
  'h3',
  'bullets',
  'numbers',
  'quote',
  'code',
];

/** The heading level of each heading tag the page shows. */
export const HEADING_LEVEL: Record<string, 1 | 2 | 3 | 4 | 5 | 6> = {
  H1: 1,
  H2: 2,
  H3: 3,
  H4: 4,
  H5: 5,
  H6: 6,
};

function pushText(out: MarkdownInline[], text: string): void {
  if (text === '') {
    return;
  }
  const last = out[out.length - 1];
  if (last?.type === 'text') {
    last.text += text;
  } else {
    out.push({ type: 'text', text });
  }
}

/** Inline content of `node`'s children; nested blocks the browser inserted (a `div` on Enter) become line breaks. */
function readInline(node: Node, out: MarkdownInline[] = []): MarkdownInline[] {
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      pushText(out, child.textContent ?? '');
      return;
    }
    if (!(child instanceof HTMLElement)) {
      return;
    }
    const tag = child.tagName;
    if (tag === 'BR') {
      // A `<br>` the source held comes back as that tag, so it is written back as typed.
      const raw = child.getAttribute('data-md-raw');
      out.push(raw === null ? { type: 'break' } : { type: 'htmlBreak', raw });
    } else if (INLINE_TAGS.strong.includes(tag)) {
      out.push({ type: 'strong', children: readInline(child) });
    } else if (INLINE_TAGS.em.includes(tag)) {
      out.push({ type: 'em', children: readInline(child) });
    } else if (tag === 'CODE') {
      out.push({ type: 'code', text: child.textContent ?? '' });
    } else if (tag === 'A') {
      const href = child.getAttribute('href') ?? '';
      if (isSafeMarkdownUrl(href)) {
        out.push({ type: 'link', href, children: readInline(child) });
      } else {
        readInline(child, out);
      }
    } else if (tag === 'DIV' || tag === 'P' || tag === 'LI') {
      if (out.length > 0 && out[out.length - 1].type !== 'break') {
        out.push({ type: 'break' });
      }
      readInline(child, out);
    } else {
      readInline(child, out);
    }
  });
  return out;
}

/** Inline content split at line breaks. */
function splitLines(nodes: MarkdownInline[]): MarkdownInline[][] {
  const lines: MarkdownInline[][] = [[]];
  for (const node of nodes) {
    if (node.type === 'break') {
      lines.push([]);
    } else {
      lines[lines.length - 1].push(node);
    }
  }
  return lines;
}

function joinLines(lines: MarkdownInline[][]): MarkdownInline[] {
  return lines.flatMap((line, i) => (i === 0 ? line : [{ type: 'break' as const }, ...line]));
}

function alignOf(cell: Element): 'left' | 'center' | 'right' | null {
  for (const align of ['left', 'center', 'right'] as const) {
    if (cell.classList.contains(`md-align-${align}`)) {
      return align;
    }
  }
  return null;
}

/** The Markdown block an element on the page now shows. */
export function readBlock(element: HTMLElement): MarkdownBlock {
  const tag = element.tagName;
  if (tag in HEADING_LEVEL) {
    return { type: 'heading', level: HEADING_LEVEL[tag], children: readInline(element) };
  }
  switch (tag) {
    case 'UL':
    case 'OL': {
      const items = Array.from(element.children).map((item) => readInline(item));
      return { type: 'list', ordered: tag === 'OL', items: items.length > 0 ? items : [[]] };
    }
    case 'BLOCKQUOTE': {
      const children = Array.from(element.children)
        .filter((child): child is HTMLElement => child instanceof HTMLElement)
        .map(readBlock);
      return { type: 'blockquote', children };
    }
    case 'PRE':
      return { type: 'codeBlock', text: element.textContent ?? '', lang: element.dataset.lang || null };
    case 'TABLE': {
      const header = Array.from(element.querySelectorAll('thead th'));
      return {
        type: 'table',
        align: header.map(alignOf),
        header: header.map((cell) => readInline(cell)),
        rows: Array.from(element.querySelectorAll('tbody tr')).map((row) =>
          Array.from(row.children).map((cell) => readInline(cell)),
        ),
      };
    }
    case 'HR':
      return { type: 'hr' };
    default:
      return { type: 'paragraph', children: readInline(element) };
  }
}

/** The lines of text a block holds, for turning it into another kind. */
function blockLines(block: MarkdownBlock): MarkdownInline[][] {
  switch (block.type) {
    case 'heading':
      return [block.children];
    case 'paragraph':
      return splitLines(block.children);
    case 'list':
      return block.items;
    case 'blockquote':
      return block.children.flatMap(blockLines);
    case 'codeBlock':
      return block.text.split('\n').map((line) => [{ type: 'text', text: line }]);
    case 'table':
    case 'hr':
      return [[]];
  }
}

function plain(line: MarkdownInline[]): string {
  return line
    .map((node) =>
      node.type === 'htmlBreak'
        ? node.raw
        : 'text' in node
          ? node.text
          : 'children' in node
            ? plain(node.children)
            : '',
    )
    .join('');
}

/** `block` turned into `kind`, keeping its text. */
export function convertBlock(block: MarkdownBlock, kind: MarkdownBlockKind): MarkdownBlock {
  const lines = blockLines(block);
  switch (kind) {
    case 'paragraph':
      return { type: 'paragraph', children: joinLines(lines) };
    case 'h1':
    case 'h2':
    case 'h3':
      return {
        type: 'heading',
        level: Number(kind[1]) as 1 | 2 | 3,
        children: lines.flatMap((line, i) =>
          i === 0 ? line : [{ type: 'text' as const, text: ' ' }, ...line],
        ),
      };
    case 'bullets':
    case 'numbers':
      return { type: 'list', ordered: kind === 'numbers', items: lines };
    case 'quote':
      return { type: 'blockquote', children: [{ type: 'paragraph', children: joinLines(lines) }] };
    case 'code':
      return { type: 'codeBlock', text: lines.map(plain).join('\n'), lang: null };
  }
}

/** Which block-type menu entry a block is, or null for one the menu cannot show (table, rule, deep heading). */
export function blockKind(block: MarkdownBlock): MarkdownBlockKind | null {
  switch (block.type) {
    case 'paragraph':
      return 'paragraph';
    case 'heading':
      return block.level <= 3 ? (`h${block.level}` as MarkdownBlockKind) : null;
    case 'list':
      return block.ordered ? 'numbers' : 'bullets';
    case 'blockquote':
      return 'quote';
    case 'codeBlock':
      return 'code';
    default:
      return null;
  }
}

/** A block's Markdown, or nothing for an empty paragraph. */
export function markdownOf(block: MarkdownBlock): string {
  const empty =
    block.type === 'paragraph' &&
    plain(block.children).trim() === '' &&
    !block.children.some((node) => node.type === 'break');
  return empty ? '' : blockToMarkdown(block);
}

/** The inline content before and after the caret in `element`. */
export function splitAtCaret(element: HTMLElement, caret: Range): [MarkdownInline[], MarkdownInline[]] {
  const before = document.createRange();
  before.selectNodeContents(element);
  before.setEnd(caret.startContainer, caret.startOffset);
  const after = document.createRange();
  after.selectNodeContents(element);
  after.setStart(caret.endContainer, caret.endOffset);
  const holder = (range: Range): HTMLElement => {
    const div = document.createElement('div');
    div.append(range.cloneContents());
    return div;
  };
  return [readInline(holder(before)), readInline(holder(after))];
}
