// SPDX-License-Identifier: MIT
/** Pure line-editing operations behind the worksheet source editors (`src/core/text-editing.ts`). */
import { describe, expect, it } from 'vitest';
import {
  caretPosition,
  indentLines,
  insertAtSelection,
  newlineKeepingIndent,
  outdentLines,
  selectionSpansLines,
  type TextEdit,
} from '../src/core/text-editing';

function apply(text: string, edit: TextEdit): string {
  return text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
}

describe('text editing', () => {
  it('inserts at the selection and puts the caret after the insertion', () => {
    const edit = insertAtSelection(1, 2, '\t');
    expect(apply('abc', edit)).toBe('a\tc');
    expect([edit.selectionStart, edit.selectionEnd]).toEqual([2, 2]);
  });

  it('detects a selection that spans lines', () => {
    expect(selectionSpansLines('a\nb', 0, 3)).toBe(true);
    expect(selectionSpansLines('a\nb', 0, 1)).toBe(false);
  });

  it('indents every selected line and keeps them selected', () => {
    const text = 'one\ntwo\nthree';
    const edit = indentLines(text, 1, 6, '  ');
    expect(apply(text, edit)).toBe('  one\n  two\nthree');
    expect([edit.selectionStart, edit.selectionEnd]).toEqual([3, 10]);
  });

  it('does not indent the line a whole-line selection ends at the start of', () => {
    const text = 'one\ntwo\nthree';
    expect(apply(text, indentLines(text, 0, 8, '\t'))).toBe('\tone\n\ttwo\nthree');
  });

  it('outdents a tab or up to one indent of spaces per line', () => {
    const text = '\tone\n   two\nthree';
    const edit = outdentLines(text, 0, text.length, '  ')!;
    expect(apply(text, edit)).toBe('one\n two\nthree');
    expect([edit.selectionStart, edit.selectionEnd]).toEqual([0, 14]);
  });

  it('outdents up to four spaces under a tab indent unit, keeping the caret on its character', () => {
    const text = '      x';
    const edit = outdentLines(text, 6, 6, '\t')!;
    expect(apply(text, edit)).toBe('  x');
    expect(edit.selectionStart).toBe(2);
  });

  it('returns null when nothing is indented', () => {
    expect(outdentLines('a\nb', 0, 3, '\t')).toBeNull();
  });

  it('keeps the current line indentation on a new line', () => {
    const text = '  - item';
    const edit = newlineKeepingIndent(text, text.length, text.length)!;
    expect(apply(text, edit)).toBe('  - item\n  ');
    expect(edit.selectionStart).toBe(text.length + 3);
    expect(newlineKeepingIndent('plain', 5, 5)).toBeNull();
  });

  it('reports the caret line and column and the text size', () => {
    expect(caretPosition('ab\ncd\n', 4)).toEqual({ line: 2, col: 2, lines: 3, chars: 6 });
    expect(caretPosition('', 0)).toEqual({ line: 1, col: 1, lines: 1, chars: 0 });
  });
});
