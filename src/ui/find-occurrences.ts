// SPDX-License-Identifier: MIT
/**
 * The find results' building blocks, kept apart from the panel itself: what a
 * match is (a cell, or one occurrence inside a source-text worksheet), when
 * two matches are the same one, where a line starts, the text shown for a
 * match in the Find All list, and where the matches are painted.
 */
import type { CompiledQuery, SheetCellMatch, ValueMatch } from '../core/search';
import type { Grid } from './grid';
import type { TextRange } from './find-marks';
import type { SourceEditor } from './source-editor';

/**
 * One match in the results. A grid cell is one match however many times the
 * query occurs in it; a source-text worksheet's match is one occurrence, with
 * its range in that worksheet's text.
 */
export type FoundMatch = SheetCellMatch & { range?: ValueMatch };

/**
 * The editor of a Markdown, JSON, YAML or plain-text worksheet, as the find bar
 * sees it: `active` while it shows the active worksheet.
 */
export interface SourceFindView {
  readonly active: boolean;
  readonly editor: SourceEditor;
  /** Commit typed text still waiting for its debounce, so the find sees what the user sees. */
  flushCommit(): void;
  /**
   * Show the text Find works in, for a view that shows it another way (a
   * Markdown sheet's formatted view). Takes no focus.
   */
  showTextForFind?(): void;
  /** Undo `showTextForFind` once Find has closed. */
  releaseTextForFind?(): void;
}

export function sameMatch(a: FoundMatch, b: FoundMatch): boolean {
  return a.sheetId === b.sheetId && a.row === b.row && a.col === b.col && a.range?.start === b.range?.start;
}

/**
 * The index a step through a source-text worksheet's occurrences starts from;
 * the step that follows moves by `direction` from it. The selection decides, not
 * the last match, so a caret moved by hand is respected and the occurrence just
 * revealed is never found again: Next takes the first occurrence (`onText`)
 * starting at or after the selection's end, Previous the last one ending at or
 * before its start. Past either end, the step wraps.
 */
export function sourceAnchor(
  matches: readonly FoundMatch[],
  onText: (match: FoundMatch) => boolean,
  selection: { readonly start: number; readonly end: number },
  direction: 1 | -1,
): number {
  let target: number;
  if (direction === 1) {
    const found = matches.findIndex(
      (m) => onText(m) && m.range !== undefined && m.range.start >= selection.end,
    );
    target = found >= 0 ? found : matches.length;
  } else {
    target = -1;
    for (let i = matches.length - 1; i >= 0; i--) {
      const m = matches[i];
      if (onText(m) && m.range !== undefined && m.range.end <= selection.start) {
        target = i;
        break;
      }
    }
  }
  return target - direction;
}

/** The offsets where each line of a text starts; the first line starts at 0. */
export function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) {
    starts.push(i + 1);
  }
  return starts;
}

/** The index of the line holding `offset`: the last line start at or before it. */
export function lineIndexOf(starts: readonly number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo;
}

/** The text a Find All row shows, with the ranges to mark at their offsets in it. */
export interface Snippet {
  readonly text: string;
  readonly marks: readonly TextRange[];
}

/**
 * The text a Find All row shows for a value: the line holding `anchor`, or when
 * that line is longer than `limit`, a window of it centred on `anchor`, with "…"
 * where the window was cut. Each of `ranges` that falls inside that text is
 * marked, so a match past the first `limit` characters still shows.
 */
export function snippetAround(
  value: string,
  anchor: TextRange,
  ranges: readonly TextRange[],
  limit: number,
): Snippet {
  const lineStart = anchor.start === 0 ? 0 : value.lastIndexOf('\n', anchor.start - 1) + 1;
  const newline = value.indexOf('\n', anchor.end);
  const lineEnd = newline < 0 ? value.length : newline;
  let from = lineStart;
  let to = lineEnd;
  if (lineEnd - lineStart > limit) {
    const centred = anchor.start - Math.floor((limit - (anchor.end - anchor.start)) / 2);
    from = Math.max(lineStart, Math.min(centred, lineEnd - limit));
    to = Math.min(lineEnd, from + limit);
  }
  const lead = from > lineStart ? '…' : '';
  const marks: TextRange[] = [];
  for (const range of ranges) {
    const start = Math.max(range.start, from);
    const end = Math.min(range.end, to);
    if (end > start) {
      marks.push({ start: start - from + lead.length, end: end - from + lead.length });
    }
  }
  return { text: `${lead}${value.slice(from, to)}${to < lineEnd ? '…' : ''}`, marks };
}

/** What the find panel paints: the searched query, and the matches it found. */
export interface FindPaint {
  /** The compiled query, or null when nothing is searched (panel closed, query empty or invalid). */
  readonly query: CompiledQuery | null;
  /** The editor of the active worksheet when it is a source-text worksheet; null for a grid sheet. */
  readonly source: SourceFindView | null;
  readonly matches: readonly FoundMatch[];
  /** Index of the current match in `matches`, or -1. */
  readonly current: number;
  /** The active worksheet's stable id ('' for a CSV document). */
  readonly activeSheetId: string;
}

/**
 * Paint the matches where they are shown: inside the active source-text
 * worksheet's editor, or on the cells of the active grid sheet with the current
 * match's cell emphasized. Every other editor is cleared.
 */
export function paintFindHighlights(
  grid: Pick<Grid, 'setFindHighlight'>,
  sources: readonly SourceFindView[],
  paint: FindPaint,
): void {
  const { query, source, matches, current, activeSheetId } = paint;
  for (const view of sources) {
    if (view !== source) {
      view.editor.setMatches([], -1);
    }
  }
  const onActive = (match: FoundMatch): boolean => match.sheetId === '' || match.sheetId === activeSheetId;
  if (query === null) {
    grid.setFindHighlight(null);
    return;
  }
  if (source === null) {
    const hit = current >= 0 ? matches[current] : undefined;
    const onCell = hit !== undefined && hit.range === undefined && onActive(hit);
    grid.setFindHighlight({ query, current: onCell ? { row: hit.row, col: hit.col } : null });
    return;
  }
  grid.setFindHighlight(null);
  const ranges: TextRange[] = [];
  let shown = -1;
  matches.forEach((match, index) => {
    if (match.range && onActive(match)) {
      if (index === current) {
        shown = ranges.length;
      }
      ranges.push(match.range);
    }
  });
  source.editor.setMatches(ranges, shown);
}
