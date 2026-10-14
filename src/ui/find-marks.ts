// SPDX-License-Identifier: MIT
/**
 * Painting the matched substrings of a find. A grid cell's text, the overlay
 * behind a source editor, and a Find All row all mark their matches the same
 * way, so the markup and its classes live here once.
 */
import type { CompiledQuery } from '../core/search';
import { el } from './dom';

/** A matched range of a text, in UTF-16 code units (see `ValueMatch`). */
export interface TextRange {
  readonly start: number;
  readonly end: number;
}

/**
 * What the find panel paints on the active grid sheet: the query, and the cell
 * holding the current match (every match in that cell is then emphasized).
 */
export interface FindHighlight {
  readonly query: CompiledQuery;
  readonly current: { readonly row: number; readonly col: number } | null;
}

/**
 * The text as plain text nodes, with each non-empty range wrapped in a `mark`
 * (`find-hit`, plus `find-hit-current` where `emphasized` says so). Ranges must
 * be in order and must not overlap. The text is only ever set as text.
 */
export function markedText(
  text: string,
  ranges: readonly TextRange[],
  emphasized: (index: number) => boolean = () => false,
): Node[] {
  const nodes: Node[] = [];
  let from = 0;
  ranges.forEach((range, index) => {
    if (range.end <= range.start) {
      return;
    }
    if (range.start > from) {
      nodes.push(document.createTextNode(text.slice(from, range.start)));
    }
    const className = emphasized(index) ? 'find-hit find-hit-current' : 'find-hit';
    nodes.push(el('mark', { className, text: text.slice(range.start, range.end) }));
    from = range.end;
  });
  if (from < text.length) {
    nodes.push(document.createTextNode(text.slice(from)));
  }
  return nodes;
}
