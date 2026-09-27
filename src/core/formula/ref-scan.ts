// SPDX-License-Identifier: MIT
/**
 * Reference extraction and shifting over formula source text: live
 * highlighting while a formula is edited, and copy/fill offsets.
 */
import {
  type CellRefEx,
  MAX_REF_COLUMN,
  MAX_REF_ROW,
  parseRef,
  parseWholeColumn,
  parseWholeRow,
} from './refs';
import {
  type RangeMap,
  type RefMap,
  rewriteFormulaRefs,
  type SheetRewriteOptions,
  type SpanMap,
} from './rewrite';

// ---------------------------------------------------------------------------
// Reference extraction (live highlighting while a formula is edited)
// ---------------------------------------------------------------------------

/**
 * A referenced rectangle extracted from formula text. Whole-column and
 * whole-row references are unbounded along one axis (marked by the flags);
 * the renderer clamps them to the used grid.
 */
export interface FormulaRefRange {
  top: number;
  left: number;
  bottom: number;
  right: number;
  /** Whole-column reference (A:C): rows are unbounded. */
  wholeCols?: boolean;
  /** Whole-row reference (2:10): columns are unbounded. */
  wholeRows?: boolean;
  /** The reference exactly as written (for accessible descriptions). */
  text: string;
}

/** Highlighting caps out so a pathological formula cannot flood the grid. */
const MAX_HIGHLIGHTED_REFS = 16;

const REF_SCAN_PATTERN =
  // string literal | A1[:B2] | A:C | 1:10 — each with optional `$` markers
  // ($A$1, $A1, A$1, $A:C, $1:10). Longest alternatives first.
  /"(?:[^"]|"")*"?|\$?([A-Za-z]{1,3})\$?([0-9]{1,7})(?::\$?([A-Za-z]{1,3})\$?([0-9]{1,7}))?|\$?([A-Za-z]{1,3}):\$?([A-Za-z]{1,3})|\$?([0-9]{1,7}):\$?([0-9]{1,7})/g;

/**
 * Extract every cell/range reference from (possibly incomplete) formula text.
 * This is a tolerant text scan, not the strict parser: it works while the
 * formula is mid-edit (`=SUM(A1:B` still highlights `A1`), skips string
 * literals, never throws, and ignores anything that is not valid reference
 * notation. Duplicate rectangles are merged; at most
 * {@link MAX_HIGHLIGHTED_REFS} distinct ranges are returned.
 */
export function extractFormulaRefs(src: string): FormulaRefRange[] {
  if (!src.startsWith('=')) {
    return [];
  }
  const body = src.slice(1);
  const out: FormulaRefRange[] = [];
  const seen = new Set<string>();
  const isWordChar = (ch: string | undefined): boolean => ch !== undefined && /[A-Za-z0-9_.]/.test(ch);
  REF_SCAN_PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = REF_SCAN_PATTERN.exec(body)) !== null) {
    if (m[0].startsWith('"')) {
      continue; // string literal
    }
    // Reject matches embedded in longer identifiers/numbers (e.g. `ABCD1`,
    // the `1.5` in a decimal, or `_A1`).
    if (isWordChar(body[m.index - 1]) || isWordChar(body[m.index + m[0].length])) {
      continue;
    }
    // A worksheet-qualified reference (`Sheet1!A1`) points at another
    // worksheet, so it has no rectangle to highlight in the current grid —
    // and the qualifier itself (`AB1` in `AB1!C2`) is a name, not a reference.
    if (body[m.index - 1] === '!' || body[m.index + m[0].length] === '!') {
      continue;
    }
    let range: FormulaRefRange | null = null;
    if (m[1] !== undefined && m[2] !== undefined) {
      const from = parseRef(`${m[1]}${m[2]}`);
      if (!from) continue;
      if (m[3] !== undefined && m[4] !== undefined) {
        const to = parseRef(`${m[3]}${m[4]}`);
        if (!to) continue;
        range = {
          top: Math.min(from.row, to.row),
          left: Math.min(from.col, to.col),
          bottom: Math.max(from.row, to.row),
          right: Math.max(from.col, to.col),
          text: m[0],
        };
      } else {
        range = { top: from.row, left: from.col, bottom: from.row, right: from.col, text: m[0] };
      }
    } else if (m[5] !== undefined && m[6] !== undefined) {
      const a = parseWholeColumn(m[5]);
      const b = parseWholeColumn(m[6]);
      if (a === null || b === null) continue;
      range = {
        top: 0,
        bottom: Number.MAX_SAFE_INTEGER,
        left: Math.min(a, b),
        right: Math.max(a, b),
        wholeCols: true,
        text: m[0],
      };
    } else if (m[7] !== undefined && m[8] !== undefined) {
      const a = parseWholeRow(m[7]);
      const b = parseWholeRow(m[8]);
      if (a === null || b === null) continue;
      range = {
        top: Math.min(a, b),
        bottom: Math.max(a, b),
        left: 0,
        right: Number.MAX_SAFE_INTEGER,
        wholeRows: true,
        text: m[0],
      };
    }
    if (!range) {
      continue;
    }
    const key = `${range.top},${range.left},${range.bottom},${range.right}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(range);
    if (out.length >= MAX_HIGHLIGHTED_REFS) {
      break;
    }
  }
  return out;
}

/**
 * Shift all references by a fixed delta (used for copy/paste/fill). Only
 * relative components move: `$`-marked absolute rows/columns (and `$`-marked
 * whole-column/row span endpoints) stay fixed, exactly like conventional
 * spreadsheets. Out-of-sheet results become #REF!.
 */
export function shiftFormulaRefs(src: string, deltaRow: number, deltaCol: number): string {
  const mapOne = (ref: CellRefEx): { row: number; col: number } | 'REF_ERROR' => {
    const r = ref.absRow ? ref.row : ref.row + deltaRow;
    const c = ref.absCol ? ref.col : ref.col + deltaCol;
    if (r < 0 || c < 0 || r > MAX_REF_ROW || c > MAX_REF_COLUMN) {
      return 'REF_ERROR';
    }
    return { row: r, col: c };
  };
  const spanShift =
    (delta: number, max: number): SpanMap =>
    (from, to) => {
      const a = from.abs ? from.index : from.index + delta;
      const b = to.abs ? to.index : to.index + delta;
      if (a < 0 || b < 0 || a > max || b > max) {
        return 'REF_ERROR';
      }
      return { from: a, to: b };
    };
  return rewriteFormulaRefs(
    src,
    mapOne,
    (from, to) => {
      const a = mapOne(from);
      const b = mapOne(to);
      if (a === 'REF_ERROR' || b === 'REF_ERROR') {
        return 'REF_ERROR';
      }
      return { from: a, to: b };
    },
    spanShift(deltaCol, MAX_REF_COLUMN),
    spanShift(deltaRow, MAX_REF_ROW),
  );
}

/**
 * Adjust references for a row or column insertion/deletion along one axis.
 * `index`/`count` describe the affected rows (axis 'row') or columns
 * (axis 'col'). Deletion follows conventional spreadsheet behavior:
 * references into the deleted span become #REF!; ranges are clamped and
 * become #REF! only when the whole range is deleted. Absolute (`$`) and
 * relative references adjust identically here — both track the referenced
 * cell's new position — and every `$` marker is preserved in the rewritten
 * text (`$` only fixes references against copy/fill, not structural edits).
 */
export function adjustFormulaForAxis(
  src: string,
  axis: 'row' | 'col',
  op: 'insert' | 'delete',
  index: number,
  count: number,
  sheetOpts?: SheetRewriteOptions,
): string {
  const shiftPoint = (v: number): number | 'deleted' => {
    if (op === 'insert') {
      return v >= index ? v + count : v;
    }
    if (v < index) {
      return v;
    }
    if (v < index + count) {
      return 'deleted';
    }
    return v - count;
  };
  const clampLow = (v: number): number => {
    // Deleted range start clamps to the first surviving position at `index`.
    const shifted = shiftPoint(v);
    return shifted === 'deleted' ? index : shifted;
  };
  const clampHigh = (v: number): number => {
    // Deleted range end clamps to the last surviving position before `index`.
    const shifted = shiftPoint(v);
    return shifted === 'deleted' ? index - 1 : shifted;
  };
  const mapRef: RefMap = (ref) => {
    const v = axis === 'row' ? ref.row : ref.col;
    const shifted = shiftPoint(v);
    if (shifted === 'deleted') {
      return 'REF_ERROR';
    }
    return axis === 'row' ? { row: shifted, col: ref.col } : { row: ref.row, col: shifted };
  };
  const mapRange: RangeMap = (from, to) => {
    const lowIn = axis === 'row' ? Math.min(from.row, to.row) : Math.min(from.col, to.col);
    const highIn = axis === 'row' ? Math.max(from.row, to.row) : Math.max(from.col, to.col);
    if (op === 'delete' && lowIn >= index && highIn < index + count) {
      return 'REF_ERROR';
    }
    const low = clampLow(lowIn);
    const high = clampHigh(highIn);
    if (high < low) {
      return 'REF_ERROR';
    }
    const withAxis = (base: { row: number; col: number }, v: number): { row: number; col: number } =>
      axis === 'row' ? { row: v, col: base.col } : { row: base.row, col: v };
    // Preserve the original endpoint order.
    const fromIsLow = (axis === 'row' ? from.row : from.col) === lowIn;
    return fromIsLow
      ? { from: withAxis(from, low), to: withAxis(to, high) }
      : { from: withAxis(from, high), to: withAxis(to, low) };
  };
  // Whole-column / whole-row spans use the same 1-D clamp semantics as ranges.
  const mapSpan: SpanMap = (from, to) => {
    const lowIn = Math.min(from.index, to.index);
    const highIn = Math.max(from.index, to.index);
    if (op === 'delete' && lowIn >= index && highIn < index + count) {
      return 'REF_ERROR';
    }
    const low = clampLow(lowIn);
    const high = clampHigh(highIn);
    if (high < low) {
      return 'REF_ERROR';
    }
    return from.index === lowIn ? { from: low, to: high } : { from: high, to: low };
  };
  // A column operation shifts whole-column spans; a row operation shifts
  // whole-row spans. The orthogonal span kind is left untouched.
  const mapColSpan = axis === 'col' ? mapSpan : undefined;
  const mapRowSpan = axis === 'row' ? mapSpan : undefined;
  return rewriteFormulaRefs(src, mapRef, mapRange, mapColSpan, mapRowSpan, sheetOpts);
}

/**
 * Where index `v` along an axis ends up when the `count` rows/columns
 * starting at `from` are moved to the boundary `to` (a position in the
 * pre-move layout, outside `[from + 1, from + count - 1]`): the moved span
 * shifts as a block and the rows/columns it passes over close the gap.
 */
export function movedAxisIndex(v: number, from: number, count: number, to: number): number {
  if (to > from + count) {
    if (v >= from && v < from + count) {
      return v + (to - from - count);
    }
    return v >= from + count && v < to ? v - count : v;
  }
  if (to < from) {
    if (v >= from && v < from + count) {
      return v - (from - to);
    }
    return v >= to && v < from ? v + count : v;
  }
  return v;
}

/**
 * Where the span `[low, high]` ends up under the same move: the block it
 * becomes when its rows/columns stay together (all inside it or all outside
 * the move), otherwise its two endpoints' new positions, in order.
 */
function movedAxisSpan(low: number, high: number, from: number, count: number, to: number): [number, number] {
  const p = (v: number): number => movedAxisIndex(v, from, count, to);
  // The move shuffles only [first, last): the moved span plus what it passes over.
  const first = Math.min(from, to);
  const last = Math.max(from + count, to);
  const pieces: Array<[number, number]> = [];
  const piece = (a: number, b: number): void => {
    const lo = Math.max(a, low);
    const hi = Math.min(b, high);
    if (lo <= hi) {
      pieces.push([p(lo), p(hi)]);
    }
  };
  piece(-Infinity, first - 1);
  piece(from, from + count - 1);
  piece(to < from ? to : from + count, to < from ? from - 1 : to - 1);
  piece(last, Infinity);
  pieces.sort((a, b) => a[0] - b[0]);
  const contiguous = pieces.every((cur, i) => i === 0 || cur[0] === pieces[i - 1][1] + 1);
  if (contiguous && pieces.length > 0) {
    return [pieces[0][0], pieces[pieces.length - 1][1]];
  }
  const a = p(low);
  const b = p(high);
  return a <= b ? [a, b] : [b, a];
}

/**
 * Adjust references for moving whole rows or columns (a reorder, not an
 * overwrite): every reference follows the cell it pointed at to its new
 * position, so a formula keeps reading the same values. A range that still
 * covers one unbroken block afterwards becomes that block (a total over rows
 * 1-3 still totals them when row 3 moves to the top); a range the move splits
 * keeps its two endpoint cells, like any spreadsheet. `$` markers are
 * preserved.
 */
export function moveFormulaAxis(
  src: string,
  axis: 'row' | 'col',
  from: number,
  count: number,
  to: number,
  sheetOpts?: SheetRewriteOptions,
): string {
  const p = (v: number): number => movedAxisIndex(v, from, count, to);
  const span = (a: number, b: number): [number, number] => {
    const [low, high] = movedAxisSpan(Math.min(a, b), Math.max(a, b), from, count, to);
    return a <= b ? [low, high] : [high, low];
  };
  const mapRef: RefMap = (ref) =>
    axis === 'row' ? { row: p(ref.row), col: ref.col } : { row: ref.row, col: p(ref.col) };
  const mapRange: RangeMap = (a, b) => {
    if (axis === 'row') {
      const [ra, rb] = span(a.row, b.row);
      return { from: { row: ra, col: a.col }, to: { row: rb, col: b.col } };
    }
    const [ca, cb] = span(a.col, b.col);
    return { from: { row: a.row, col: ca }, to: { row: b.row, col: cb } };
  };
  const mapSpan: SpanMap = (a, b) => {
    const [fa, fb] = span(a.index, b.index);
    return { from: fa, to: fb };
  };
  return rewriteFormulaRefs(
    src,
    mapRef,
    mapRange,
    axis === 'col' ? mapSpan : undefined,
    axis === 'row' ? mapSpan : undefined,
    sheetOpts,
  );
}
