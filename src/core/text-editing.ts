// SPDX-License-Identifier: MIT

/**
 * Pure text-editing operations for the source editors of the Markdown, JSON,
 * YAML and plain-text worksheets (`ui/source-editor.ts`): indenting and
 * outdenting whole lines, carrying a line's indentation onto a new line, and
 * reporting the caret as a line/column. DOM-free so they are unit-testable;
 * the UI applies each {@link TextEdit} to its textarea.
 */

/** One replacement of `text.slice(from, to)` by `insert`, and the selection to leave afterwards. */
export interface TextEdit {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
}

/** How wide a tab counts when outdenting space-indented lines under a tab indent unit. */
const TAB_WIDTH = 4;

/** Offset of the first character of the line containing `offset`. */
function lineStartOf(text: string, offset: number): number {
  return text.lastIndexOf('\n', offset - 1) + 1;
}

/** Offset just past the last character (before its `\n`) of the line containing `offset`. */
function lineEndOf(text: string, offset: number): number {
  const end = text.indexOf('\n', offset);
  return end === -1 ? text.length : end;
}

/**
 * The line block a selection covers. A selection that ends exactly at the
 * start of a line (a whole-line selection made by dragging or Shift+Down)
 * does not include that last, untouched line — the same rule code editors use.
 */
function selectedBlock(text: string, start: number, end: number): { from: number; to: number } {
  const from = lineStartOf(text, start);
  const lastOffset = end > start && lineStartOf(text, end) === end ? end - 1 : end;
  return { from, to: lineEndOf(text, lastOffset) };
}

/** True when the selection reaches past a line break, so Tab indents lines instead of typing. */
export function selectionSpansLines(text: string, start: number, end: number): boolean {
  return text.slice(start, end).includes('\n');
}

/** Replace the selection with `insert` (the caret lands after it). */
export function insertAtSelection(start: number, end: number, insert: string): TextEdit {
  const caret = start + insert.length;
  return { from: start, to: end, insert, selectionStart: caret, selectionEnd: caret };
}

/** Prefix every line the selection covers with `unit`, keeping the same lines selected. */
export function indentLines(text: string, start: number, end: number, unit: string): TextEdit {
  const block = selectedBlock(text, start, end);
  const lines = text.slice(block.from, block.to).split('\n');
  const insert = lines.map((line) => unit + line).join('\n');
  return {
    from: block.from,
    to: block.to,
    insert,
    selectionStart: start + unit.length,
    selectionEnd: end + unit.length * lines.length,
  };
}

/** How many leading characters one outdent step removes from `line`. */
function outdentWidth(line: string, unit: string): number {
  if (line.startsWith('\t')) {
    return 1;
  }
  const spaces = unit === '\t' ? TAB_WIDTH : unit.length;
  let n = 0;
  while (n < spaces && line[n] === ' ') {
    n += 1;
  }
  return n;
}

/**
 * Remove one indent step (`unit`, a tab, or up to that many spaces) from the
 * start of every line the selection covers. Returns null when no line is
 * indented, so the caller can leave the text (and its undo history) alone.
 */
export function outdentLines(text: string, start: number, end: number, unit: string): TextEdit | null {
  const block = selectedBlock(text, start, end);
  const lines = text.slice(block.from, block.to).split('\n');
  const widths = lines.map((line) => outdentWidth(line, unit));
  if (widths.every((w) => w === 0)) {
    return null;
  }
  const insert = lines.map((line, i) => line.slice(widths[i])).join('\n');
  // Map an offset in the old block to the new one: every line before it
  // loses its whole width, and its own line loses at most up to the offset.
  const mapOffset = (offset: number): number => {
    let lineFrom = block.from;
    let removed = 0;
    for (let i = 0; i < lines.length; i += 1) {
      const lineTo = lineFrom + lines[i].length;
      if (offset <= lineTo) {
        return offset - removed - Math.min(widths[i], offset - lineFrom);
      }
      removed += widths[i];
      lineFrom = lineTo + 1;
    }
    return offset - removed;
  };
  return {
    from: block.from,
    to: block.to,
    insert,
    selectionStart: mapOffset(start),
    selectionEnd: mapOffset(end),
  };
}

/**
 * A line break that keeps the current line's leading whitespace, or null when
 * the line is not indented (the browser's own Enter is then used unchanged).
 */
export function newlineKeepingIndent(text: string, start: number, end: number): TextEdit | null {
  const lineStart = lineStartOf(text, start);
  const indent = /^[ \t]*/.exec(text.slice(lineStart, start))?.[0] ?? '';
  if (indent === '') {
    return null;
  }
  return insertAtSelection(start, end, `\n${indent}`);
}

/** The 1-based line and column of `offset`, plus the text's line and character counts. */
export interface CaretPosition {
  readonly line: number;
  readonly col: number;
  readonly lines: number;
  readonly chars: number;
}

/** Where `offset` sits in `text`, for the status bar. Columns count UTF-16 code units, like the textarea. */
export function caretPosition(text: string, offset: number): CaretPosition {
  const clamped = Math.max(0, Math.min(offset, text.length));
  let line = 1;
  let lines = 1;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) {
      lines += 1;
      if (i < clamped) {
        line += 1;
      }
    }
  }
  return { line, col: clamped - lineStartOf(text, clamped) + 1, lines, chars: text.length };
}
