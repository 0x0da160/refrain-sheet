// SPDX-License-Identifier: MIT
/**
 * Bold, italic and code on the text a selection covers in the formatted editor
 * (`markdown-visual.ts`): making the selected text marked, taking the mark off
 * part of it, and telling which marks the selection is entirely in. Only the
 * selected characters change; marked text beside the selection keeps its mark.
 * The editor writes the changed block back into the Markdown source.
 */

export type InlineMark = 'strong' | 'em' | 'code';

/** The tags a mark is shown as on the page: bold is `<strong>` or `<b>`, and so on. */
export const INLINE_TAGS: Record<InlineMark, string[]> = {
  strong: ['STRONG', 'B'],
  em: ['EM', 'I'],
  code: ['CODE'],
};

/** The text nodes of `root`, each with the span of `root`'s text it holds (offsets from the start of `root`). */
function textSpans(root: HTMLElement): { node: Text; start: number; end: number }[] {
  const spans: { node: Text; start: number; end: number }[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let start = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    spans.push({ node: text, start, end: start + text.data.length });
    start += text.data.length;
  }
  return spans;
}

/** The text offset of the point (`node`, `offset`) inside `root`. */
export function textOffset(root: HTMLElement, node: Node, offset: number): number {
  const range = document.createRange();
  range.selectNodeContents(root);
  range.setEnd(node, offset);
  return range.toString().length;
}

function clamp(value: number, max: number): number {
  return Math.min(Math.max(value, 0), max);
}

/** Select the text of `root` from offset `start` to `end`. */
function selectText(root: HTMLElement, start: number, end: number): void {
  const spans = textSpans(root);
  const from = spans.find((span) => span.end > start) ?? spans[spans.length - 1];
  const to = [...spans].reverse().find((span) => span.start < end) ?? spans[0];
  const selection = document.getSelection();
  if (!from || !to || !selection) {
    return;
  }
  const range = document.createRange();
  range.setStart(from.node, clamp(start - from.start, from.node.data.length));
  range.setEnd(to.node, clamp(end - to.start, to.node.data.length));
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Split the text node of `root` that holds `offset`, so that offset falls on a node boundary. */
function splitTextAt(root: HTMLElement, offset: number): void {
  const span = textSpans(root).find((s) => s.start < offset && offset < s.end);
  if (span) {
    span.node.splitText(offset - span.start);
  }
}

/** The `mark` element that holds `node` (or is `node`) inside `root`, or null. */
export function markAround(node: Node, mark: InlineMark, root: HTMLElement): HTMLElement | null {
  for (let current: Node | null = node; current && current !== root; current = current.parentNode) {
    if (current instanceof HTMLElement && INLINE_TAGS[mark].includes(current.tagName)) {
      return current;
    }
  }
  return null;
}

/** Whether all the text from `start` to `end` of `root` already has `mark`. */
export function markedThroughout(root: HTMLElement, start: number, end: number, mark: InlineMark): boolean {
  const spans = textSpans(root).filter((span) => span.start < end && span.end > start);
  return spans.length > 0 && spans.every((span) => markAround(span.node, mark, root) !== null);
}

/** Whether a fragment holds any text or line break, not only empty elements. */
function holdsText(fragment: DocumentFragment): boolean {
  return (fragment.textContent ?? '') !== '' || fragment.querySelector('br') !== null;
}

/** Remove the elements of `fragment` that hold neither text nor a line break. */
function pruneEmpty(fragment: DocumentFragment): void {
  for (const element of Array.from(fragment.querySelectorAll('*')).reverse()) {
    if (
      element.tagName !== 'BR' &&
      (element.textContent ?? '') === '' &&
      element.querySelector('br') === null
    ) {
      element.remove();
    }
  }
}

/** An empty copy of `mark` (same tag and attributes) that holds `content`. */
function withContent(mark: HTMLElement, content: DocumentFragment): HTMLElement {
  const copy = mark.cloneNode(false) as HTMLElement;
  copy.append(content);
  return copy;
}

/**
 * Move `node` out of `mark`. The part of `mark` before `node` and the part after
 * it stay marked, as copies of `mark` either side of `node`.
 */
function liftOut(node: Node, mark: HTMLElement): void {
  const head = document.createRange();
  head.setStart(mark, 0);
  head.setEndBefore(node);
  const tail = document.createRange();
  tail.setStartAfter(node);
  tail.setEnd(mark, mark.childNodes.length);
  const before = head.extractContents();
  const after = tail.extractContents();
  pruneEmpty(before);
  pruneEmpty(after);
  if (holdsText(before)) {
    mark.before(withContent(mark, before));
  }
  mark.before(node);
  if (holdsText(after)) {
    mark.before(withContent(mark, after));
  }
  mark.remove();
}

/** Fold `element` into the element right before or after it when that has the same tag. */
function joinSameTag(element: HTMLElement): void {
  const before = element.previousSibling;
  if (before instanceof HTMLElement && before.tagName === element.tagName) {
    element.prepend(...Array.from(before.childNodes));
    before.remove();
  }
  const after = element.nextSibling;
  if (after instanceof HTMLElement && after.tagName === element.tagName) {
    element.append(...Array.from(after.childNodes));
    after.remove();
  }
}

/** Wrap each text node in a `mark` element of its own, joined to a neighbour of the same kind. */
function markNodes(nodes: Text[], mark: InlineMark): void {
  for (const node of nodes) {
    const wrapper = document.createElement(mark);
    node.before(wrapper);
    wrapper.append(node);
    joinSameTag(wrapper);
  }
}

/**
 * Give the text from `start` to `end` of `root` the `mark`, or take it off all of
 * that text when all of it has the mark already. The text stays selected after.
 */
export function toggleMarkOver(root: HTMLElement, start: number, end: number, mark: InlineMark): void {
  const allMarked = markedThroughout(root, start, end, mark);
  splitTextAt(root, end);
  splitTextAt(root, start);
  const nodes = textSpans(root)
    .filter((span) => span.start >= start && span.end <= end && span.end > span.start)
    .map((span) => span.node);
  for (const node of nodes) {
    for (let holder = markAround(node, mark, root); holder; holder = markAround(node, mark, root)) {
      liftOut(node, holder);
    }
  }
  if (!allMarked) {
    markNodes(nodes, mark);
  }
  selectText(root, start, end);
}
