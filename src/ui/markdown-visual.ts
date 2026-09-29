// SPDX-License-Identifier: MIT
/**
 * The Markdown sheet's visual mode: the document shown as formatted text and
 * edited in place, while what is saved stays Markdown text in cell (0, 0).
 *
 * Each top-level block (heading, paragraph, list, quote, code block, table)
 * is its own editable element, tied to the source lines it came from
 * (`parseMarkdownRanges`). Editing a block rewrites only those lines
 * (`blockToMarkdown` of the block read back from the page); every other line
 * of the source stays exactly as it was, so switching to visual mode and
 * back never reformats a document by itself. A horizontal rule is not
 * editable here. An empty paragraph at the end takes new text.
 *
 * Content is only ever rendered through `el()`/`textContent`
 * (`markdown-render.ts`), and paste and drop insert plain text, so nothing
 * pasted into the page can add markup or run anything.
 */
import {
  parseMarkdownRanges,
  isSafeMarkdownUrl,
  type MarkdownBlock,
  type MarkdownInline,
} from '../core/markdown';
import { blockToMarkdown } from '../core/markdown-serialize';
import { t } from '../app/i18n';
import { el } from './dom';
import { renderMarkdownBlock } from './markdown-render';

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

const HEADING_LEVEL: Record<string, 1 | 2 | 3 | 4 | 5 | 6> = { H1: 1, H2: 2, H3: 3, H4: 4, H5: 5, H6: 6 };
const INLINE_TAGS: Record<'strong' | 'em' | 'code', string[]> = {
  strong: ['STRONG', 'B'],
  em: ['EM', 'I'],
  code: ['CODE'],
};

// ----- Reading the page back into Markdown blocks -----

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
      out.push({ type: 'break' });
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
function readBlock(element: HTMLElement): MarkdownBlock {
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
    .map((node) => ('text' in node ? node.text : 'children' in node ? plain(node.children) : ''))
    .join('');
}

/** `block` turned into `kind`, keeping its text. */
function convertBlock(block: MarkdownBlock, kind: MarkdownBlockKind): MarkdownBlock {
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
function markdownOf(block: MarkdownBlock): string {
  const empty =
    block.type === 'paragraph' &&
    plain(block.children).trim() === '' &&
    !block.children.some((node) => node.type === 'break');
  return empty ? '' : blockToMarkdown(block);
}

// ----- Caret helpers -----

function selectionRange(): Range | null {
  const selection = document.getSelection();
  return selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
}

/** Put the caret `offset` characters into `element`'s text (clamped to its end). */
function placeCaret(element: HTMLElement, offset: number): void {
  const selection = document.getSelection();
  if (!selection) {
    return;
  }
  const range = document.createRange();
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let left = offset;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;
    if (left <= length) {
      range.setStart(node, left);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    left -= length;
  }
  range.selectNodeContents(element);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** The inline content before and after the caret in `element`. */
function splitAtCaret(element: HTMLElement, caret: Range): [MarkdownInline[], MarkdownInline[]] {
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

function caretAtStart(element: HTMLElement, caret: Range): boolean {
  if (!caret.collapsed) {
    return false;
  }
  const before = document.createRange();
  before.selectNodeContents(element);
  before.setEnd(caret.startContainer, caret.startOffset);
  return before.toString() === '' && before.cloneContents().querySelector('br') === null;
}

// ----- The editor -----

interface VisualBlock {
  element: HTMLElement;
  /** What the source held for this block (for blocks shown as text only). */
  block: MarkdownBlock;
  start: number;
  end: number;
}

export class MarkdownVisualEditor {
  readonly element: HTMLElement;
  /** Called with the whole new source after every edit. */
  onChange: ((source: string) => void) | null = null;
  /** Called when the block holding the caret changes (for the block-type menu). */
  onFocusBlock: ((block: MarkdownBlock | null) => void) | null = null;

  private lines: string[] = [''];
  private blocks: VisualBlock[] = [];
  private focused = -1;
  private readOnly = false;

  constructor() {
    this.element = el('div', {
      className: 'markdown-visual markdown-editor-preview',
      attrs: { role: 'document', 'aria-label': t('dialog.markdownEditor.visual') },
    });
    this.element.addEventListener('input', (event) => this.onInput(event));
    this.element.addEventListener('keydown', (event) => this.onKeyDown(event));
    this.element.addEventListener('paste', (event) => this.onPaste(event));
    this.element.addEventListener('drop', (event) => event.preventDefault());
    this.element.addEventListener('focusin', (event) => {
      this.focused = this.indexOf(event.target);
      this.onFocusBlock?.(this.focused >= 0 ? readBlock(this.blocks[this.focused].element) : null);
    });
  }

  /** The Markdown source as it stands. */
  get source(): string {
    return this.lines.join('\n');
  }

  /** Show `source`, replacing whatever was shown. */
  load(source: string): void {
    this.lines = source.replace(/\r\n?/g, '\n').split('\n');
    const ranges = parseMarkdownRanges(source);
    this.blocks = ranges.map(({ block, start, end }) => ({ block, start, end, element: this.render(block) }));
    // A trailing empty paragraph takes new text at the end of the document.
    const blank = this.lines.every((line) => line.trim() === '');
    const at = blank ? 0 : this.lines.length;
    const tail = this.render({ type: 'paragraph', children: [] });
    tail.dataset.placeholder = t('dialog.markdownEditor.newParagraph');
    this.blocks.push({
      block: { type: 'paragraph', children: [] },
      start: at,
      end: blank ? this.lines.length : at,
      element: tail,
    });
    this.element.replaceChildren(...this.blocks.map((b) => b.element));
    this.focused = -1;
  }

  setReadOnly(readOnly: boolean): void {
    this.readOnly = readOnly;
    this.element.querySelectorAll<HTMLElement>('[contenteditable]').forEach((node) => {
      node.contentEditable = readOnly ? 'false' : 'true';
    });
  }

  /** Turn the block holding the caret into `kind`. */
  setBlockKind(kind: MarkdownBlockKind): void {
    const index = this.focused;
    if (this.readOnly || index < 0) {
      return;
    }
    const block = readBlock(this.blocks[index].element);
    if (block.type === 'table' || block.type === 'hr') {
      return;
    }
    const next = convertBlock(block, kind);
    this.replace(index, blockToMarkdown(next));
    this.show(index, next, 0);
  }

  /** Make the selected text bold, italic or code, or undo it when the caret is already inside one. */
  toggleInline(kind: 'strong' | 'em' | 'code'): void {
    const range = selectionRange();
    const index = range ? this.indexOf(range.commonAncestorContainer) : -1;
    if (this.readOnly || !range || index < 0) {
      return;
    }
    const blockElement = this.blocks[index].element;
    let node: Node | null = range.commonAncestorContainer;
    while (node && node !== blockElement) {
      if (node instanceof HTMLElement && INLINE_TAGS[kind].includes(node.tagName)) {
        node.replaceWith(...Array.from(node.childNodes));
        this.blockEdited(index);
        return;
      }
      node = node.parentNode;
    }
    if (range.collapsed) {
      return;
    }
    const wrapper = document.createElement(kind);
    wrapper.append(range.extractContents());
    range.insertNode(wrapper);
    range.selectNodeContents(wrapper);
    this.blockEdited(index);
  }

  private render(block: MarkdownBlock): HTMLElement {
    const element = renderMarkdownBlock(block);
    element.classList.add('markdown-visual-block');
    if (block.type === 'codeBlock' && block.lang) {
      element.dataset.lang = block.lang;
    }
    const editable = (node: HTMLElement): void => {
      node.contentEditable = this.readOnly ? 'false' : 'true';
      node.spellcheck = false;
    };
    if (block.type === 'table') {
      element.querySelectorAll<HTMLElement>('th, td').forEach(editable);
    } else if (block.type !== 'hr') {
      editable(element);
    }
    return element;
  }

  /** The block holding `node`, or -1. */
  private indexOf(node: EventTarget | Node | null): number {
    return node instanceof Node ? this.blocks.findIndex((b) => b.element.contains(node)) : -1;
  }

  /**
   * Replace block `index`'s source lines with `text` (none when empty),
   * keeping a blank line between it and its neighbours so it cannot run
   * into them.
   */
  private replace(index: number, text: string): void {
    const target = this.blocks[index];
    const newLines = text === '' ? [] : text.split('\n');
    const padBefore =
      target.start > 0 && this.lines[target.start - 1].trim() !== '' && text !== '' ? [''] : [];
    const padAfter =
      target.end < this.lines.length && this.lines[target.end].trim() !== '' && text !== '' ? [''] : [];
    const inserted = [...padBefore, ...newLines, ...padAfter];
    this.lines.splice(target.start, target.end - target.start, ...inserted);
    let delta = inserted.length - (target.end - target.start);
    target.start += padBefore.length;
    // A removed block leaves one blank line between its neighbours, not two.
    const blank = (at: number): boolean => at >= this.lines.length || this.lines[at].trim() === '';
    if (newLines.length === 0 && target.start > 0 && blank(target.start - 1) && blank(target.start)) {
      this.lines.splice(target.start - 1, 1);
      target.start -= 1;
      delta -= 1;
    }
    target.end = target.start + newLines.length;
    for (const later of this.blocks.slice(index + 1)) {
      later.start += delta;
      later.end += delta;
    }
    this.onChange?.(this.source);
  }

  private blockEdited(index: number): void {
    this.replace(index, markdownOf(readBlock(this.blocks[index].element)));
  }

  /** Show `block` as block `index` and put the caret `offset` characters into it. */
  private show(index: number, block: MarkdownBlock, offset: number): void {
    const target = this.blocks[index];
    const fresh = this.render(block);
    target.element.replaceWith(fresh);
    target.element = fresh;
    target.block = block;
    const editable =
      fresh.contentEditable === 'true' ? fresh : fresh.querySelector<HTMLElement>('[contenteditable="true"]');
    if (editable) {
      editable.focus();
      placeCaret(editable, offset);
    }
  }

  private onInput(event: Event): void {
    const index = this.indexOf(event.target);
    if (index >= 0 && !this.readOnly) {
      this.blockEdited(index);
    }
  }

  private onKeyDown(event: KeyboardEvent): void {
    const index = this.indexOf(event.target);
    const range = selectionRange();
    if (index < 0 || !range || this.readOnly || event.isComposing) {
      return;
    }
    const element = this.blocks[index].element;
    if (event.key === 'Enter' && !event.shiftKey) {
      this.onEnter(event, index, element, range);
    } else if (event.key === 'Backspace' && (element.tagName === 'P' || element.tagName in HEADING_LEVEL)) {
      this.onBackspace(event, index, element, range);
    }
  }

  private onEnter(event: KeyboardEvent, index: number, element: HTMLElement, range: Range): void {
    const tag = element.tagName;
    if (tag === 'PRE') {
      event.preventDefault();
      this.insertText(range, '\n');
      this.blockEdited(index);
    } else if (tag === 'TABLE') {
      event.preventDefault();
    } else if (tag === 'P' || tag in HEADING_LEVEL) {
      // Enter starts a new paragraph; Shift+Enter (browser default) breaks the line.
      event.preventDefault();
      const [before, after] = splitAtCaret(element, range);
      const current = readBlock(element);
      const head: MarkdownBlock =
        current.type === 'heading'
          ? { ...current, children: before }
          : { type: 'paragraph', children: before };
      const tail: MarkdownBlock = { type: 'paragraph', children: after };
      this.replace(index, markdownOf(head));
      this.show(index, head, 0);
      const at = this.blocks[index].end;
      this.blocks.splice(index + 1, 0, { block: tail, start: at, end: at, element: this.render(tail) });
      this.blocks[index].element.after(this.blocks[index + 1].element);
      this.replace(index + 1, markdownOf(tail));
      this.show(index + 1, tail, 0);
    }
  }

  private onBackspace(event: KeyboardEvent, index: number, element: HTMLElement, range: Range): void {
    const previous = this.blocks[index - 1];
    if (
      !previous ||
      !caretAtStart(element, range) ||
      !['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(previous.element.tagName)
    ) {
      return;
    }
    // Join this block onto the end of the one before it.
    event.preventDefault();
    const into = readBlock(previous.element);
    const from = readBlock(element);
    if (
      (into.type !== 'paragraph' && into.type !== 'heading') ||
      (from.type !== 'paragraph' && from.type !== 'heading')
    ) {
      return;
    }
    const offset = previous.element.textContent?.length ?? 0;
    const merged: MarkdownBlock = { ...into, children: [...into.children, ...from.children] };
    this.replace(index, '');
    this.blocks.splice(index, 1);
    element.remove();
    this.replace(index - 1, markdownOf(merged));
    this.show(index - 1, merged, offset);
  }

  private onPaste(event: ClipboardEvent): void {
    event.preventDefault();
    const index = this.indexOf(event.target);
    const range = selectionRange();
    if (index < 0 || !range || this.readOnly) {
      return;
    }
    this.insertText(range, event.clipboardData?.getData('text/plain') ?? '');
    this.blockEdited(index);
  }

  private insertText(range: Range, text: string): void {
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }
}
