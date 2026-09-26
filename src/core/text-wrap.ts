// SPDX-License-Identifier: MIT
/**
 * DOM-independent visual-line counting for conditional cell-text wrapping.
 *
 * Wrapping is decided from *measured text width* — the injected `measure`
 * returns the rendered pixel width of a string under the active sheet font —
 * never from a character or byte count, and a formula cell passes its
 * *displayed result* here, not its source expression. The model mirrors the
 * CSS the grid actually applies to wrapped cells (`white-space: pre-wrap` +
 * `overflow-wrap: break-word`):
 *
 *   - explicit newlines (`\n`, `\r\n`, `\r`) always start a new visual line;
 *   - within a line, text wraps at whitespace when the next word would
 *     overflow the content box;
 *   - a single word wider than the content box breaks within the word so it
 *     never overflows.
 *
 * The result is capped at `maxLines` so a pathological value cannot grow a row
 * without bound.
 */

export type WrapMeasure = (text: string) => number;

/** Visual lines that one segment (no explicit newline) occupies. */
function segmentLines(segment: string, measure: WrapMeasure, contentWidth: number, maxLines: number): number {
  // A blank segment (e.g. between two newlines) still occupies one line, and a
  // segment that already fits never wraps — the fast path for typical cells.
  if (segment === '' || measure(segment) <= contentWidth) {
    return 1;
  }
  const spaceWidth = measure(' ');
  let lines = 1;
  let lineWidth = 0;
  for (const word of segment.split(' ')) {
    const separator = lineWidth > 0 ? spaceWidth : 0;
    const wordWidth = measure(word);
    if (lineWidth + separator + wordWidth <= contentWidth) {
      lineWidth += separator + wordWidth;
      continue;
    }
    // The word does not fit on the current line: move to a fresh line.
    if (lineWidth > 0) {
      lines += 1;
      if (lines >= maxLines) {
        return maxLines;
      }
    }
    if (wordWidth <= contentWidth) {
      lineWidth = wordWidth;
      continue;
    }
    // Long unbroken word: break it grapheme by grapheme (overflow-wrap).
    let chunkWidth = 0;
    for (const ch of word) {
      const chWidth = measure(ch);
      if (chunkWidth > 0 && chunkWidth + chWidth > contentWidth) {
        lines += 1;
        chunkWidth = 0;
        if (lines >= maxLines) {
          return maxLines;
        }
      }
      chunkWidth += chWidth;
    }
    lineWidth = chunkWidth;
  }
  return Math.min(maxLines, lines);
}

/**
 * Number of visual lines the displayed value occupies inside a content box of
 * `contentWidth` pixels. Returns 1 when the box is too narrow to wrap into or
 * wrapping is disabled (`maxLines <= 1`), so callers get single-line behavior
 * as the safe default.
 */
export function countVisualLines(
  value: string,
  measure: WrapMeasure,
  contentWidth: number,
  maxLines: number,
): number {
  if (contentWidth <= 0 || maxLines <= 1) {
    return 1;
  }
  let total = 0;
  for (const segment of value.split(/\r\n|\r|\n/)) {
    total += segmentLines(segment, measure, contentWidth, maxLines);
    if (total >= maxLines) {
      return maxLines;
    }
  }
  return Math.max(1, Math.min(maxLines, total));
}

/** One segment's (no explicit newline) actual wrapped line strings — the same walk as `segmentLines`. */
function segmentToLines(
  segment: string,
  measure: WrapMeasure,
  contentWidth: number,
  maxLines: number,
): string[] {
  if (segment === '' || measure(segment) <= contentWidth) {
    return [segment];
  }
  const spaceWidth = measure(' ');
  const lines: string[] = [];
  let current = '';
  let currentWidth = 0;
  for (const word of segment.split(' ')) {
    if (lines.length >= maxLines) {
      return lines;
    }
    const separator = currentWidth > 0 ? spaceWidth : 0;
    const wordWidth = measure(word);
    if (currentWidth + separator + wordWidth <= contentWidth) {
      current += currentWidth > 0 ? ` ${word}` : word;
      currentWidth += separator + wordWidth;
      continue;
    }
    if (currentWidth > 0) {
      lines.push(current);
      if (lines.length >= maxLines) {
        return lines;
      }
    }
    if (wordWidth <= contentWidth) {
      current = word;
      currentWidth = wordWidth;
      continue;
    }
    // Long unbroken word: break it grapheme by grapheme (overflow-wrap).
    let chunk = '';
    let chunkWidth = 0;
    for (const ch of word) {
      const chWidth = measure(ch);
      if (chunkWidth > 0 && chunkWidth + chWidth > contentWidth) {
        lines.push(chunk);
        if (lines.length >= maxLines) {
          return lines;
        }
        chunk = '';
        chunkWidth = 0;
      }
      chunk += ch;
      chunkWidth += chWidth;
    }
    current = chunk;
    currentWidth = chunkWidth;
  }
  if (current !== '' || lines.length === 0) {
    lines.push(current);
  }
  return lines.slice(0, maxLines);
}

/**
 * The actual wrapped line strings for `value` inside a content box of
 * `contentWidth` pixels, using the same wrapping rules as
 * {@link countVisualLines} (so `wrapVisualLines(...).length` never exceeds
 * `countVisualLines(...)`). Used where the rendered text itself is needed
 * (e.g. painting a screen-accurate screenshot to a canvas) rather than just a
 * line count.
 */
export function wrapVisualLines(
  value: string,
  measure: WrapMeasure,
  contentWidth: number,
  maxLines: number,
): string[] {
  if (contentWidth <= 0 || maxLines <= 1) {
    return [value];
  }
  const lines: string[] = [];
  for (const segment of value.split(/\r\n|\r|\n/)) {
    if (lines.length >= maxLines) {
      break;
    }
    lines.push(...segmentToLines(segment, measure, contentWidth, maxLines - lines.length));
  }
  return lines.length > 0 ? lines.slice(0, maxLines) : [''];
}

/**
 * Pixel height for a row occupying `lines` visual lines. A single line keeps
 * the exact single-line row height (`base`) so unwrapped rows are pixel-for-
 * pixel identical to a uniform grid; multi-line rows are the vertical chrome
 * (padding + borders) plus `lines` line boxes.
 */
export function rowHeightForLines(
  lines: number,
  base: number,
  lineHeight: number,
  verticalChrome: number,
): number {
  if (lines <= 1) {
    return base;
  }
  return Math.ceil(verticalChrome + lines * lineHeight);
}
