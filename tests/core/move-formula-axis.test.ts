// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { moveFormulaAxis, movedAxisIndex } from '../../src/core/formula';

describe('movedAxisIndex', () => {
  it('shifts a span forward and closes the gap behind it', () => {
    // Move index 1 (count 2) to the boundary at 5: [0,1,2,3,4,5] -> 0,3,4,1,2,5.
    expect([0, 1, 2, 3, 4, 5].map((v) => movedAxisIndex(v, 1, 2, 5))).toEqual([0, 3, 4, 1, 2, 5]);
  });

  it('shifts a span backward and pushes the passed-over indices on', () => {
    expect([0, 1, 2, 3, 4].map((v) => movedAxisIndex(v, 3, 1, 1))).toEqual([0, 2, 3, 1, 4]);
  });
});

describe('moveFormulaAxis', () => {
  it('makes references follow moved columns, keeping $ markers', () => {
    expect(moveFormulaAxis('=B1+$C$2', 'col', 1, 1, 3)).toBe('=C1+$B$2');
  });

  it('keeps a range on the same cells when they still form one block', () => {
    expect(moveFormulaAxis('=SUM(A1:A3)', 'row', 2, 1, 0)).toBe('=SUM(A1:A3)');
    expect(moveFormulaAxis('=SUM(A5:A9)', 'row', 2, 1, 0)).toBe('=SUM(A5:A9)');
    expect(moveFormulaAxis('=SUM(A3:A4)', 'row', 2, 2, 0)).toBe('=SUM(A1:A2)');
  });

  it('keeps the endpoint cells of a range the move splits', () => {
    // Rows 2-3 (A2:A3); row 3 moves to the top, so the endpoints are now rows 3 and 1.
    expect(moveFormulaAxis('=SUM(A2:A3)', 'row', 2, 1, 0)).toBe('=SUM(A1:A3)');
    // Row 2 of A1:A4 moves below row 6: endpoints stay rows 1 and 3.
    expect(moveFormulaAxis('=SUM(A1:A4)', 'row', 1, 1, 6)).toBe('=SUM(A1:A3)');
  });

  it('moves whole-column spans with the columns', () => {
    expect(moveFormulaAxis('=SUM(A:A)', 'col', 0, 1, 3)).toBe('=SUM(C:C)');
  });
});
