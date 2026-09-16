// SPDX-License-Identifier: MIT
/**
 * A hand-written, dependency-free Markdown parser for the in-workbook
 * Markdown worksheet (#433, `src/ui/markdown-sheet.ts`). It parses a scoped
 * subset — headings, paragraphs, bold/italic, inline code, fenced code
 * blocks, links, unordered/ordered lists, blockquotes, horizontal rules —
 * into a typed AST, never an HTML string. `src/ui/markdown-render.ts`
 * renders that AST into DOM nodes via `el()`/`textContent` (see
 * `src/ui/dom.ts`), the same convention every other surface in this app
 * uses to render untrusted content, so injected `<script>`/HTML in the
 * source can only ever appear as literal displayed text: safety comes from
 * never building an HTML string, not from escaping one, and this module
 * does not need to escape anything itself.
 *
 * This is deliberately not a full CommonMark/GFM implementation: no nested
 * emphasis (`**a *b* c**`), no images, no footnotes, no setext (`===`/`---`
 * underline) headings. A single newline inside a paragraph is treated as a
 * line break rather than requiring a blank line or GFM's two-trailing-spaces
 * rule, which better matches a live-preview text area where a user expects
 * the preview to track what they typed line by line. GFM-style pipe tables
 * are supported (#486) since they are common in real-world Markdown notes
 * and have an unambiguous line-oriented grammar that fits this parser's
 * design; fenced code blocks additionally get client-side syntax
 * highlighting at render time (`src/core/syntax-highlight.ts`), not here —
 * this module only ever produces plain block/inline AST nodes.
 */

export type MarkdownInline =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: MarkdownInline[] }
  | { type: 'em'; children: MarkdownInline[] }
  | { type: 'code'; text: string }
  | { type: 'link'; href: string; children: MarkdownInline[] }
  | { type: 'break' };

export type MarkdownTableAlign = 'left' | 'center' | 'right' | null;

export type MarkdownBlock =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; children: MarkdownInline[] }
  | { type: 'paragraph'; children: MarkdownInline[] }
  | { type: 'blockquote'; children: MarkdownBlock[] }
  | { type: 'list'; ordered: boolean; items: MarkdownInline[][] }
  | { type: 'codeBlock'; text: string; lang: string | null }
  | { type: 'hr' }
  | {
      type: 'table';
      align: MarkdownTableAlign[];
      header: MarkdownInline[][];
      rows: MarkdownInline[][][];
    };

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const FENCE_OPEN_RE = /^(`{3,}|~{3,})\s*(\S*)\s*$/;
const HR_RE = /^ {0,3}([-*_])(?: *\1){2,}\s*$/;
const BLOCKQUOTE_RE = /^ {0,3}>/;
const BLOCKQUOTE_STRIP_RE = /^ {0,3}> ?/;
const LIST_ITEM_RE = /^ {0,3}([-*+]|\d+[.)])\s+(.*)$/;
/** A GFM table delimiter row, e.g. `| --- | :-: | --: |` (alignment colons optional on either side). */
const TABLE_DELIMITER_ROW_RE = /^ {0,3}\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const TABLE_DELIMITER_CELL_RE = /^:?-+:?$/;

/** Schemes a rendered link's `href` may use; anything else degrades to literal text. */
const SAFE_URL_SCHEME_RE = /^https?:|^mailto:/i;
const HAS_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

/** True for an empty href, a relative/anchor path, or an allow-listed scheme (never `javascript:`, `data:`, etc.). */
export function isSafeMarkdownUrl(href: string): boolean {
  const trimmed = href.trim();
  if (trimmed === '') {
    return false;
  }
  if (!HAS_SCHEME_RE.test(trimmed)) {
    return true; // relative path or `#anchor`
  }
  return SAFE_URL_SCHEME_RE.test(trimmed);
}

/** Parse Markdown source into a block AST. Never throws; malformed input degrades to plain paragraphs. */
export function parseMarkdown(source: string): MarkdownBlock[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  return parseBlocks(lines);
}

function parseBlocks(lines: string[]): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      i++;
      continue;
    }

    const fenceMatch = FENCE_OPEN_RE.exec(line);
    if (fenceMatch) {
      const fenceChar = fenceMatch[1][0];
      const fenceLen = fenceMatch[1].length;
      const lang = fenceMatch[2] || null;
      const closeRe = new RegExp(`^${fenceChar}{${fenceLen},}\\s*$`);
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !closeRe.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) {
        i++; // consume the closing fence
      }
      blocks.push({ type: 'codeBlock', text: codeLines.join('\n'), lang });
      continue;
    }

    const headingMatch = HEADING_RE.exec(line);
    if (headingMatch) {
      const level = headingMatch[1].length as 1 | 2 | 3 | 4 | 5 | 6;
      blocks.push({ type: 'heading', level, children: parseInline(headingMatch[2].trim()) });
      i++;
      continue;
    }

    if (HR_RE.test(line)) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    if (BLOCKQUOTE_RE.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && BLOCKQUOTE_RE.test(lines[i])) {
        quoteLines.push(lines[i].replace(BLOCKQUOTE_STRIP_RE, ''));
        i++;
      }
      blocks.push({ type: 'blockquote', children: parseBlocks(quoteLines) });
      continue;
    }

    if (line.includes('|') && i + 1 < lines.length && TABLE_DELIMITER_ROW_RE.test(lines[i + 1])) {
      const delimiterCells = splitTableRow(lines[i + 1]);
      if (delimiterCells.length > 0 && delimiterCells.every((cell) => TABLE_DELIMITER_CELL_RE.test(cell))) {
        const header = splitTableRow(line).map((cell) => parseInline(cell));
        const align = delimiterCells.map(tableCellAlign);
        i += 2;
        const rows: MarkdownInline[][][] = [];
        while (i < lines.length && lines[i].trim() !== '' && lines[i].includes('|')) {
          rows.push(splitTableRow(lines[i]).map((cell) => parseInline(cell)));
          i++;
        }
        blocks.push({ type: 'table', align, header, rows });
        continue;
      }
    }

    const firstItemMatch = LIST_ITEM_RE.exec(line);
    if (firstItemMatch) {
      const ordered = /^\d/.test(firstItemMatch[1]);
      const items: MarkdownInline[][] = [];
      while (i < lines.length) {
        const itemMatch = LIST_ITEM_RE.exec(lines[i]);
        if (!itemMatch || /^\d/.test(itemMatch[1]) !== ordered) {
          break;
        }
        items.push(parseInline(itemMatch[2]));
        i++;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !HEADING_RE.test(lines[i]) &&
      !FENCE_OPEN_RE.test(lines[i]) &&
      !HR_RE.test(lines[i]) &&
      !BLOCKQUOTE_RE.test(lines[i]) &&
      !LIST_ITEM_RE.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push({ type: 'paragraph', children: parseInlineLines(paraLines) });
  }
  return blocks;
}

/** Split a table row on unescaped `|`, trimming a leading/trailing delimiter and each cell's whitespace. */
function splitTableRow(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith('|')) {
    trimmed = trimmed.slice(1);
  }
  if (trimmed.endsWith('|') && !trimmed.endsWith('\\|')) {
    trimmed = trimmed.slice(0, -1);
  }
  const cells: string[] = [];
  let current = '';
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] === '\\' && trimmed[i + 1] === '|') {
      current += '|';
      i++;
    } else if (trimmed[i] === '|') {
      cells.push(current.trim());
      current = '';
    } else {
      current += trimmed[i];
    }
  }
  cells.push(current.trim());
  return cells;
}

/** Alignment implied by a table delimiter cell's colons, e.g. `:-:` → `center`. */
function tableCellAlign(cell: string): MarkdownTableAlign {
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  if (left) return 'left';
  return null;
}

function parseInlineLines(lines: string[]): MarkdownInline[] {
  const out: MarkdownInline[] = [];
  lines.forEach((line, index) => {
    if (index > 0) {
      out.push({ type: 'break' });
    }
    out.push(...parseInline(line));
  });
  return out;
}

// Alternatives tried left-to-right; each captures its delimited content in
// one numbered group so the winning alternative is identified by which
// group is defined. Emphasis/code content excludes its own delimiter
// character so a run of `**`/`*`/`_`/`` ` `` never spans past the intended
// closing delimiter.
const INLINE_TOKEN_RE =
  /\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_|`([^`]+)`|\[([^\]]*)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/;

function parseInline(text: string): MarkdownInline[] {
  const out: MarkdownInline[] = [];
  let rest = text;
  while (rest.length > 0) {
    const match = INLINE_TOKEN_RE.exec(rest);
    if (!match || match[0].length === 0) {
      out.push({ type: 'text', text: rest });
      break;
    }
    if (match.index > 0) {
      out.push({ type: 'text', text: rest.slice(0, match.index) });
    }
    const [whole, strongA, strongB, emA, emB, code, linkText, linkHref] = match;
    if (strongA !== undefined || strongB !== undefined) {
      out.push({ type: 'strong', children: [{ type: 'text', text: (strongA ?? strongB)! }] });
    } else if (emA !== undefined || emB !== undefined) {
      out.push({ type: 'em', children: [{ type: 'text', text: (emA ?? emB)! }] });
    } else if (code !== undefined) {
      out.push({ type: 'code', text: code });
    } else if (linkHref !== undefined) {
      if (isSafeMarkdownUrl(linkHref)) {
        out.push({
          type: 'link',
          href: linkHref,
          children: [{ type: 'text', text: linkText || linkHref }],
        });
      } else {
        out.push({ type: 'text', text: whole });
      }
    }
    rest = rest.slice(match.index + whole.length);
  }
  return out;
}
