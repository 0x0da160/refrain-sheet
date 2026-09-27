// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { colWidthsAt, deleteColWidths, insertColWidths } from '../../src/app/state/col-widths';

describe('column width bookkeeping', () => {
  it('shifts widths right of an insert and gives new columns the default', () => {
    expect(insertColWidths([10, 20, 30], 1, 2)).toEqual([10, 0, 0, 20, 30]);
  });

  it('restores given widths into inserted columns', () => {
    expect(insertColWidths([10, 30], 1, 1, [20])).toEqual([10, 20, 30]);
    expect(insertColWidths([], 3, 1, [50])).toEqual([0, 0, 0, 50]);
  });

  it('leaves widths alone when inserting past every custom width', () => {
    expect(insertColWidths([10], 4, 2)).toEqual([10]);
  });

  it('removes deleted columns and fills sparse holes with the default', () => {
    const sparse: number[] = [10];
    sparse[2] = 30;
    sparse[3] = 40;
    expect(deleteColWidths(sparse, 0, 1)).toEqual([0, 30, 40]);
    expect(deleteColWidths([10, 20], 1, 5)).toEqual([10]);
  });

  it('reads the widths of a column span', () => {
    expect(colWidthsAt([10, 20], 1, 3)).toEqual([20, 0, 0]);
  });
});
