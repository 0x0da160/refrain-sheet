// SPDX-License-Identifier: MIT
/**
 * Reordering the top-level blocks of a Markdown document by their source
 * lines (see `parseMarkdownRanges`), for the visual editor's move buttons
 * and drag. Only the moved block's lines change place: every block keeps its
 * own text, and the lines between blocks (blank lines, anything the parser
 * did not take as a block) stay where they were.
 */

/** Where one block sits in the source lines: `start` inclusive, `end` exclusive. */
interface LineRange {
  start: number;
  end: number;
}

/**
 * `lines` with block `from` moved to position `to` (both indices into
 * `ranges`, which must be in source order and not overlap). Two blocks that
 * end up side by side with nothing between them, and were not side by side
 * before, get a blank line between them, so the move cannot join them into
 * one block (a paragraph running into a list, say).
 */
export function moveMarkdownBlock(
  lines: readonly string[],
  ranges: readonly LineRange[],
  from: number,
  to: number,
): string[] {
  const count = ranges.length;
  if (from < 0 || from >= count || to < 0 || to >= count || from === to) {
    return [...lines];
  }
  const texts = ranges.map((r) => lines.slice(r.start, r.end));
  // gaps[k] is what lies before position k; gaps[count] is what follows the last block.
  const gaps = ranges.map((r, k) => lines.slice(k === 0 ? 0 : ranges[k - 1].end, r.start));
  gaps.push(lines.slice(ranges[count - 1].end));
  const order = ranges.map((_, k) => k);
  order.splice(from, 1);
  order.splice(to, 0, from);
  const out: string[] = [];
  order.forEach((block, position) => {
    const gap = gaps[position];
    const wereNeighbours = position === 0 || order[position - 1] + 1 === block;
    out.push(...(gap.length === 0 && !wereNeighbours ? [''] : gap), ...texts[block]);
  });
  out.push(...gaps[count]);
  return out;
}
