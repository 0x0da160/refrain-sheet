// SPDX-License-Identifier: MIT
/**
 * Caret helpers for the contenteditable blocks of the Markdown visual editor:
 * reading the current selection, putting the caret at a character offset, and
 * telling whether the caret is at the start of a block.
 */

export function selectionRange(): Range | null {
  const selection = document.getSelection();
  return selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
}

/** Put the caret `offset` characters into `element`'s text (clamped to its end). */
export function placeCaret(element: HTMLElement, offset: number): void {
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
  // No text to go past: into the innermost last element (the empty item of
  // a new list, the empty paragraph of a new quote), so what is typed next
  // lands inside it rather than beside it.
  let inner = element;
  while (inner.lastElementChild instanceof HTMLElement && inner.lastElementChild.tagName !== 'BR') {
    inner = inner.lastElementChild;
  }
  range.selectNodeContents(inner);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

export function caretAtStart(element: HTMLElement, caret: Range): boolean {
  if (!caret.collapsed) {
    return false;
  }
  const before = document.createRange();
  before.selectNodeContents(element);
  before.setEnd(caret.startContainer, caret.startOffset);
  return before.toString() === '' && before.cloneContents().querySelector('br') === null;
}
