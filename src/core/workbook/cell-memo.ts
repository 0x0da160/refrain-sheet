// SPDX-License-Identifier: MIT
/**
 * The evaluated values of one worksheet's formula cells, addressed by cell.
 *
 * A million formula results are kept as plain arrays — one page of
 * {@link PAGE_ROWS} rows per column, allocated when a row in it is first
 * stored — rather than under a string key each: reading one is three array
 * reads, and forgetting a run of rows is a fill. Pages make the cost follow
 * the cells that actually hold formulas, so a lone total at the bottom of a
 * long column costs one page, not the column.
 */
const PAGE_BITS = 10;
const PAGE_ROWS = 1 << PAGE_BITS;
const PAGE_MASK = PAGE_ROWS - 1;

export class CellMemo<T> {
  /** `columns[col][row >> PAGE_BITS][row & PAGE_MASK]`. */
  private readonly columns: Array<Array<Array<T | undefined> | undefined> | undefined> = [];

  get(row: number, col: number): T | undefined {
    return this.columns[col]?.[row >> PAGE_BITS]?.[row & PAGE_MASK];
  }

  set(row: number, col: number, value: T | undefined): void {
    const pages = (this.columns[col] ??= []);
    const index = row >> PAGE_BITS;
    let page = pages[index];
    if (!page) {
      if (value === undefined) {
        return;
      }
      page = new Array<T | undefined>(PAGE_ROWS).fill(undefined);
      pages[index] = page;
    }
    page[row & PAGE_MASK] = value;
  }

  /** Forget rows `top..bottom` (inclusive) of one column. */
  clearRows(col: number, top: number, bottom: number): void {
    const pages = this.columns[col];
    if (!pages) {
      return;
    }
    const last = Math.min(bottom >> PAGE_BITS, pages.length - 1);
    for (let index = top >> PAGE_BITS; index <= last; index++) {
      const page = pages[index];
      if (!page) {
        continue;
      }
      const first = index << PAGE_BITS;
      if (top <= first && bottom >= first + PAGE_MASK) {
        pages[index] = undefined;
      } else {
        page.fill(undefined, Math.max(top - first, 0), Math.min(bottom - first, PAGE_MASK) + 1);
      }
    }
  }
}
