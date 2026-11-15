// SPDX-License-Identifier: MIT
/**
 * One worksheet column as typed arrays (see `ColumnData` in
 * `../formula/value.ts`), filled from the cells' evaluated values on demand
 * and kept until those cells change.
 *
 * It is a cache of what the cells evaluate to, never a second source of
 * truth: every row is read through the same reader the cell-by-cell path
 * uses, in the same top-to-bottom order, and the recalculation engine marks
 * rows stale ({@link invalidate}) whenever their cells may have changed. Only
 * the rows a range actually covers are ever read, so a short range on a long
 * column does not evaluate the rest of the column.
 */
import {
  type ColumnData,
  ERROR_CODES,
  type FormulaValue,
  KIND_BOOLEAN,
  KIND_EMPTY,
  KIND_ERROR,
  KIND_NUMBER,
  KIND_STRING,
} from '../formula/value';

/**
 * Distinct texts indexed for reuse. A column with more than this many
 * distinct texts (identifiers, free text) stops sharing: each further cell
 * simply gets its own entry, which bounds the index's memory and costs the
 * scans nothing they were not already paying per cell.
 */
const MAX_SHARED_TEXTS = 65_536;

export class ColumnStore {
  private kinds: Uint8Array;
  private nums: Float64Array;
  private ids: Int32Array;
  private readonly strings: string[] = [];
  private readonly shared = new Map<string, number>();
  /** Rows that hold their cells' current values: sorted, disjoint `[start, end]` pairs, flattened. */
  private filled: number[] = [];
  /** What scans derived from the rows above (see `ColumnData.derived`); emptied when any row changes. */
  private readonly derived = new Map<string, Uint32Array>();

  constructor(rows: number) {
    this.kinds = new Uint8Array(rows);
    this.nums = new Float64Array(rows);
    this.ids = new Int32Array(rows);
  }

  /**
   * Rows `top..bottom` as typed arrays, reading through `read` whichever of
   * them are not held yet.
   */
  view(top: number, bottom: number, read: (row: number) => FormulaValue): ColumnData {
    this.grow(bottom + 1);
    // The gaps between the filled intervals that overlap [top, bottom], listed
    // before any is read: reading can re-enter this store and change `filled`.
    const gaps: number[] = [];
    let row = top;
    for (let i = 0; i < this.filled.length && row <= bottom; i += 2) {
      const start = this.filled[i];
      const end = this.filled[i + 1];
      if (end < row) {
        continue;
      }
      if (start > row) {
        gaps.push(row, Math.min(start - 1, bottom));
      }
      row = end + 1;
    }
    if (row <= bottom) {
      gaps.push(row, bottom);
    }
    for (let i = 0; i < gaps.length; i += 2) {
      this.fill(gaps[i], gaps[i + 1], read);
    }
    return {
      length: bottom - top + 1,
      offset: top,
      kinds: this.kinds,
      nums: this.nums,
      ids: this.ids,
      strings: this.strings,
      derived: this.derived,
    };
  }

  /** Rows `top..bottom` may have changed: read them again when next asked for. */
  invalidate(top: number, bottom: number): void {
    this.derived.clear();
    const next: number[] = [];
    for (let i = 0; i < this.filled.length; i += 2) {
      const start = this.filled[i];
      const end = this.filled[i + 1];
      if (end < top || start > bottom) {
        next.push(start, end);
        continue;
      }
      if (start < top) {
        next.push(start, top - 1);
      }
      if (end > bottom) {
        next.push(bottom + 1, end);
      }
    }
    this.filled = next;
  }

  private grow(rows: number): void {
    if (rows <= this.kinds.length) {
      return;
    }
    const kinds = new Uint8Array(rows);
    kinds.set(this.kinds);
    this.kinds = kinds;
    const nums = new Float64Array(rows);
    nums.set(this.nums);
    this.nums = nums;
    const ids = new Int32Array(rows);
    ids.set(this.ids);
    this.ids = ids;
  }

  private fill(top: number, bottom: number, read: (row: number) => FormulaValue): void {
    // A cell that is being evaluated right now reads as a #CYCLE! placeholder,
    // which is never what it settles to. Rows read while one was seen serve
    // the scan that asked for them and are then read again by the next one —
    // the same rule the cell-by-cell range cache follows.
    let sawCycle = false;
    for (let row = top; row <= bottom; row++) {
      // Reading a cell can evaluate formulas that read this column in turn,
      // so the arrays are looked up afresh for every row.
      const value = read(row);
      switch (value.type) {
        case 'number':
          this.kinds[row] = KIND_NUMBER;
          this.nums[row] = value.value;
          break;
        case 'string':
          this.kinds[row] = KIND_STRING;
          this.ids[row] = this.textId(value.value);
          break;
        case 'boolean':
          this.kinds[row] = KIND_BOOLEAN;
          this.nums[row] = value.value ? 1 : 0;
          break;
        case 'empty':
          this.kinds[row] = KIND_EMPTY;
          break;
        case 'error':
          this.kinds[row] = KIND_ERROR;
          this.ids[row] = ERROR_CODES.indexOf(value.code);
          sawCycle ||= value.code === '#CYCLE!';
          break;
      }
    }
    if (!sawCycle) {
      this.markFilled(top, bottom);
    }
  }

  private textId(text: string): number {
    const known = this.shared.get(text);
    if (known !== undefined) {
      return known;
    }
    const id = this.strings.length;
    this.strings.push(text);
    if (this.shared.size < MAX_SHARED_TEXTS) {
      this.shared.set(text, id);
    }
    return id;
  }

  private markFilled(top: number, bottom: number): void {
    const next: number[] = [];
    let start = top;
    let end = bottom;
    let placed = false;
    for (let i = 0; i < this.filled.length; i += 2) {
      const a = this.filled[i];
      const b = this.filled[i + 1];
      if (b < start - 1) {
        next.push(a, b);
      } else if (a > end + 1) {
        if (!placed) {
          next.push(start, end);
          placed = true;
        }
        next.push(a, b);
      } else {
        start = Math.min(start, a);
        end = Math.max(end, b);
      }
    }
    if (!placed) {
      next.push(start, end);
    }
    this.filled = next;
  }
}
