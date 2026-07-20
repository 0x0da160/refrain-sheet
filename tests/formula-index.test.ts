// SPDX-License-Identifier: MIT
/**
 * Consistency of the incrementally-maintained formula-cell row index in
 * RsfDocument. `countFormulaCells()` / `listFormulaCells()` are backed by a
 * lazily-built per-row index that every mutator updates in place; these tests
 * verify — including property-based random operation sequences — that the
 * index never drifts from a brute-force scan of the actual cell data.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { isFormula } from '../src/core/formula';
import { RsfDocument } from '../src/core/rsf-document';

/** Brute-force reference: scan every cell of the document surface. */
function bruteForce(doc: RsfDocument): Array<{ row: number; col: number; src: string }> {
  const out: Array<{ row: number; col: number; src: string }> = [];
  for (let r = 0; r < doc.rowCount; r++) {
    for (let c = 0; c < doc.columnCount; c++) {
      const v = doc.getValue(r, c);
      if (isFormula(v)) {
        out.push({ row: r, col: c, src: v });
      }
    }
  }
  return out;
}

function expectIndexConsistent(doc: RsfDocument): void {
  const expected = bruteForce(doc);
  expect(doc.listFormulaCells()).toEqual(expected);
  expect(doc.countFormulaCells()).toBe(expected.length);
}

describe('formula-cell index consistency', () => {
  it('counts and lists formulas after simple edits', () => {
    const doc = RsfDocument.empty('t.rsf', 4, 3);
    expectIndexConsistent(doc);
    doc.setCell(0, 0, '=SUM(A2:A4)');
    doc.setCell(1, 0, '5');
    doc.setCell(2, 1, '=A1*2');
    expectIndexConsistent(doc);
    doc.setCell(0, 0, 'plain'); // formula -> literal
    expectIndexConsistent(doc);
    doc.setCell(1, 0, '=A3'); // literal -> formula
    expectIndexConsistent(doc);
    doc.setCell(2, 1, ''); // formula -> empty
    expectIndexConsistent(doc);
  });

  it('tracks structural row and column operations', () => {
    const doc = RsfDocument.empty('t.rsf', 3, 3);
    doc.setCell(0, 0, '=B1');
    doc.setCell(2, 2, '=A1+1');
    doc.insertRows(1, [['=C1', '', 'x']]);
    expectIndexConsistent(doc);
    doc.insertCols(1, [['=A1', 'y', '', '']]);
    expectIndexConsistent(doc);
    doc.deleteRows(0, 2);
    expectIndexConsistent(doc);
    doc.deleteCols(0, 1);
    expectIndexConsistent(doc);
    doc.ensureSize(6, 5);
    expectIndexConsistent(doc);
  });

  it('stays consistent when every row is deleted down to the blank fallback', () => {
    const doc = RsfDocument.empty('t.rsf', 2, 2);
    doc.setCell(0, 0, '=A2');
    doc.setCell(1, 1, '=A1');
    doc.countFormulaCells(); // force the index to exist
    doc.deleteRows(0, 2); // collapses to one blank fallback row
    expectIndexConsistent(doc);
  });

  it('matches a brute-force scan across random operation sequences', () => {
    const cellValue = fc.oneof(
      fc.constant(''),
      fc.constant('text'),
      fc.constant('42'),
      fc.constant('=A1'),
      fc.constant('=SUM(A1:B2)'),
    );
    const op = fc.oneof(
      fc.record({
        kind: fc.constant('set' as const),
        row: fc.nat(9),
        col: fc.nat(5),
        value: cellValue,
      }),
      fc.record({
        kind: fc.constant('insertRows' as const),
        index: fc.nat(10),
        rows: fc.array(fc.array(cellValue, { maxLength: 4 }), { minLength: 1, maxLength: 2 }),
      }),
      fc.record({
        kind: fc.constant('deleteRows' as const),
        index: fc.nat(9),
        count: fc.integer({ min: 1, max: 2 }),
      }),
      fc.record({
        kind: fc.constant('insertCols' as const),
        index: fc.nat(6),
        cols: fc.array(fc.array(cellValue, { maxLength: 10 }), { minLength: 1, maxLength: 2 }),
      }),
      fc.record({
        kind: fc.constant('deleteCols' as const),
        index: fc.nat(5),
        count: fc.integer({ min: 1, max: 2 }),
      }),
      fc.record({ kind: fc.constant('ensureSize' as const), rows: fc.nat(12), cols: fc.nat(8) }),
      // Reads at random points exercise lazy index construction mid-sequence.
      fc.record({ kind: fc.constant('read' as const) }),
    );
    fc.assert(
      fc.property(fc.array(op, { maxLength: 25 }), (ops) => {
        const doc = RsfDocument.empty('p.rsf', 3, 3);
        for (const o of ops) {
          switch (o.kind) {
            case 'set':
              doc.setCell(o.row, o.col, o.value);
              break;
            case 'insertRows':
              doc.insertRows(Math.min(o.index, doc.rowCount), o.rows);
              break;
            case 'deleteRows': {
              const index = Math.min(o.index, doc.rowCount - 1);
              doc.deleteRows(index, Math.min(o.count, doc.rowCount - index));
              break;
            }
            case 'insertCols':
              doc.insertCols(Math.min(o.index, doc.columnCount), o.cols);
              break;
            case 'deleteCols': {
              const index = Math.min(o.index, doc.columnCount - 1);
              doc.deleteCols(index, Math.min(o.count, doc.columnCount - index));
              break;
            }
            case 'ensureSize':
              doc.ensureSize(o.rows, o.cols);
              break;
            case 'read':
              doc.countFormulaCells();
              break;
          }
        }
        expectIndexConsistent(doc);
      }),
      { numRuns: 200 },
    );
  });
});
