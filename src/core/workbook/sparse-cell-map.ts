// SPDX-License-Identifier: MIT
/**
 * A sparse per-cell annotation store (a worksheet's styles and comments),
 * keyed row-major so a row insert/delete — the common structural edit — only
 * touches the outer map. Reindexing follows the cells an annotation was
 * attached to; annotations on removed rows or columns are dropped.
 */
export class SparseCellMap<T> {
  private rows: Map<number, Map<number, T>> = new Map();

  get(row: number, col: number): T | null {
    return this.rows.get(row)?.get(col) ?? null;
  }

  /** Set (or clear, with `null`) one cell's value. */
  put(row: number, col: number, value: T | null): void {
    if (value === null) {
      const cells = this.rows.get(row);
      cells?.delete(col);
      if (cells && cells.size === 0) {
        this.rows.delete(row);
      }
      return;
    }
    let cells = this.rows.get(row);
    if (!cells) {
      cells = new Map();
      this.rows.set(row, cells);
    }
    cells.set(col, value);
  }

  /** Every annotated cell as [row, col, value] triples, row-major. */
  collect(): Array<[number, number, T]> {
    const out: Array<[number, number, T]> = [];
    for (const [row, cells] of this.rows) {
      for (const [col, value] of cells) {
        out.push([row, col, value]);
      }
    }
    return out;
  }

  /** Number of annotated cells. */
  get cellCount(): number {
    let n = 0;
    for (const cells of this.rows.values()) {
      n += cells.size;
    }
    return n;
  }

  /** Reindex rows after a row insert/delete (`null` drops the row). */
  shiftRows(mapRow: (row: number) => number | null): void {
    if (this.rows.size === 0) {
      return;
    }
    const next: Map<number, Map<number, T>> = new Map();
    for (const [row, cells] of this.rows) {
      const mapped = mapRow(row);
      if (mapped !== null) {
        next.set(mapped, cells);
      }
    }
    this.rows = next;
  }

  /** Reindex columns after a column insert/delete (`null` drops the column). */
  shiftCols(mapCol: (col: number) => number | null): void {
    if (this.rows.size === 0) {
      return;
    }
    const next: Map<number, Map<number, T>> = new Map();
    for (const [row, cells] of this.rows) {
      const nextRow: Map<number, T> = new Map();
      for (const [col, value] of cells) {
        const mapped = mapCol(col);
        if (mapped !== null) {
          nextRow.set(mapped, value);
        }
      }
      if (nextRow.size > 0) {
        next.set(row, nextRow);
      }
    }
    this.rows = next;
  }

  /** An independent copy (values are shared; they are treated as immutable). */
  clone(): SparseCellMap<T> {
    const copy = new SparseCellMap<T>();
    copy.rows = new Map([...this.rows].map(([row, cells]) => [row, new Map(cells)]));
    return copy;
  }

  /** Copy one row's annotations into `target` (a worksheet shell being filled row by row). */
  copyRowInto(row: number, target: SparseCellMap<T>): void {
    const cells = this.rows.get(row);
    if (cells && cells.size > 0) {
      target.rows.set(row, new Map(cells));
    }
  }
}
