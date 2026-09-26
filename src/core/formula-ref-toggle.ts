// SPDX-License-Identifier: MIT
/**
 * The F4 reference toggle for formula entry: cycle the `$` markers of the
 * cell reference (or range) at the caret through the four A1 forms,
 * `A1` → `$A$1` → `A$1` → `$A1` → `A1`. For a range (`A1:B2`) both ends take
 * the next form of the first end, so the range stays uniform.
 *
 * Pure text manipulation: it never parses the whole formula, only finds the
 * reference token touching the caret, skipping text inside string literals
 * and function names such as `LOG10(`.
 */

/** One `$`-marked A1 reference, with or without markers (`A1`, `$A$1`, …). */
const REF = String.raw`\$?[A-Za-z]{1,3}\$?\d+`;
/** A reference or a two-ended range, not part of a longer name or a call. */
const TOKEN = new RegExp(String.raw`(?<![A-Za-z0-9_.$])(${REF})(?::(${REF}))?(?![A-Za-z0-9_.(])`, 'g');

interface Markers {
  col: boolean;
  row: boolean;
}

function markersOf(ref: string): Markers {
  const m = /^(\$?)[A-Za-z]+(\$?)\d+$/.exec(ref);
  return { col: m?.[1] === '$', row: m?.[2] === '$' };
}

/** The next form in the cycle: relative → absolute → row-absolute → column-absolute → relative. */
function nextMarkers({ col, row }: Markers): Markers {
  if (!col && !row) return { col: true, row: true };
  if (col && row) return { col: false, row: true };
  if (!col && row) return { col: true, row: false };
  return { col: false, row: false };
}

function withMarkers(ref: string, markers: Markers): string {
  const m = /^\$?([A-Za-z]+)\$?(\d+)$/.exec(ref);
  if (!m) return ref;
  return `${markers.col ? '$' : ''}${m[1]}${markers.row ? '$' : ''}${m[2]}`;
}

/** Whether `index` falls inside a double-quoted string literal of `text`. */
function insideString(text: string, index: number): boolean {
  let open = false;
  for (let i = 0; i < index; i++) {
    if (text[i] === '"') open = !open;
  }
  return open;
}

export interface RefToggleResult {
  /** The whole field text after the toggle. */
  text: string;
  /** The rewritten reference's span in `text`, for re-selecting it. */
  start: number;
  end: number;
}

/**
 * Toggle the reference touching `caret` in the formula `text`. Returns
 * `null` when `text` is not a formula (no leading `=`) or no reference
 * touches the caret, so the caller can leave the key alone.
 */
export function toggleReferenceAt(text: string, caret: number): RefToggleResult | null {
  if (!text.startsWith('=')) return null;
  for (const match of text.matchAll(TOKEN)) {
    const start = match.index;
    const end = start + match[0].length;
    if (caret < start || caret > end) continue;
    if (insideString(text, start)) continue;
    const first = match[1] ?? '';
    const second = match[2];
    const next = nextMarkers(markersOf(first));
    const replacement =
      second === undefined
        ? withMarkers(first, next)
        : `${withMarkers(first, next)}:${withMarkers(second, next)}`;
    return {
      text: text.slice(0, start) + replacement + text.slice(end),
      start,
      end: start + replacement.length,
    };
  }
  return null;
}
