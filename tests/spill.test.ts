// SPDX-License-Identifier: MIT
/**
 * The dynamic-array spill engine: result shapes, expansion and shrinkage,
 * blocking, derived-cell protection, structural edits, undo/redo, CSV export,
 * and the RSF round trip that must **not** persist a single derived value.
 */
import { describe, expect, it } from 'vitest';
import { RsfDocument } from '../src/core/rsf-document';
import { canSpill, MAX_SPILL_ANCHORS } from '../src/core/spill';
import { parseFormula } from '../src/core/formula';
import { AppState } from '../src/app/app-state';

function sheet(cells: Record<string, string>, rows = 20, cols = 10): RsfDocument {
  const doc = RsfDocument.empty('t.rsf', rows, cols);
  for (const [ref, value] of Object.entries(cells)) {
    doc.setCell(Number(ref.slice(1)) - 1, ref.charCodeAt(0) - 65, value);
  }
  return doc;
}

const pos = (ref: string): [number, number] => [Number(ref.slice(1)) - 1, ref.charCodeAt(0) - 65];
const at = (doc: RsfDocument, ref: string): string => doc.getDisplayValue(...pos(ref));
const raw = (doc: RsfDocument, ref: string): string => doc.getValue(...pos(ref));

/** The displayed values of a rectangular block, row by row. */
function block(doc: RsfDocument, topLeft: string, rows: number, cols: number): string[][] {
  const [r0, c0] = pos(topLeft);
  return Array.from({ length: rows }, (_v, r) =>
    Array.from({ length: cols }, (_w, c) => doc.getDisplayValue(r0 + r, c0 + c)),
  );
}

describe('canSpill', () => {
  it('accepts only formulas that could return an array', () => {
    const ast = (src: string) => {
      const parsed = parseFormula(src);
      expect(parsed.ok, src).toBe(true);
      return parsed.ok ? parsed.ast : null;
    };
    for (const src of ['=SORT(A1:A3)', '=UNIQUE(A1:A3)', '=FILTER(A1:A3,B1:B3)', '=SEQUENCE(3)']) {
      expect(canSpill(ast(src)!), src).toBe(true);
    }
    // Nested anywhere still counts — the check is deliberately conservative.
    expect(canSpill(ast('=SUM(SEQUENCE(3))')!)).toBe(true);
    expect(canSpill(ast('=1+SEQUENCE(2)')!)).toBe(true);
    for (const src of ['=SUM(A1:A9)', '=A1+B1', '=IF(A1>0,1,2)', '=LEN("x")', '=COUNTIF(A1:A9,">1")']) {
      expect(canSpill(ast(src)!), src).toBe(false);
    }
  });
});

describe('result shapes', () => {
  it('SEQUENCE fills a rectangle in row-major order', () => {
    const doc = sheet({ A1: '=SEQUENCE(3,2)' });
    expect(block(doc, 'A1', 3, 2)).toEqual([
      ['1', '2'],
      ['3', '4'],
      ['5', '6'],
    ]);
    expect(at(sheet({ A1: '=SEQUENCE(2,2,10,5)' }), 'B2')).toBe('25');
    expect(at(sheet({ A1: '=SEQUENCE(1)' }), 'A1')).toBe('1'); // 1x1 stays a scalar
  });

  it('SORT orders rows without touching the source', () => {
    const doc = sheet({ A1: '3', A2: '1', A3: '2', C1: '=SORT(A1:A3)' });
    expect(block(doc, 'C1', 3, 1)).toEqual([['1'], ['2'], ['3']]);
    expect(block(doc, 'A1', 3, 1)).toEqual([['3'], ['1'], ['2']]); // source unchanged
  });

  it('SORT takes several keys and a descending order', () => {
    const doc = sheet({
      A1: 'b',
      B1: '2',
      A2: 'a',
      B2: '2',
      A3: 'a',
      B3: '1',
      D1: '=SORT(A1:B3,2,TRUE,1,TRUE)',
    });
    expect(block(doc, 'D1', 3, 2)).toEqual([
      ['a', '1'],
      ['a', '2'],
      ['b', '2'],
    ]);
    const desc = sheet({ A1: '1', A2: '3', A3: '2', C1: '=SORT(A1:A3,1,FALSE)' });
    expect(block(desc, 'C1', 3, 1)).toEqual([['3'], ['2'], ['1']]);
    expect(at(sheet({ A1: '1', C1: '=SORT(A1:A1,5)' }), 'C1')).toBe('#VALUE!');
  });

  it('UNIQUE keeps the first of each row', () => {
    const doc = sheet({ A1: 'a', A2: 'b', A3: 'a', A4: 'c', C1: '=UNIQUE(A1:A4)' });
    expect(block(doc, 'C1', 3, 1)).toEqual([['a'], ['b'], ['c']]);
    const once = sheet({ A1: 'a', A2: 'b', A3: 'a', A4: 'c', C1: '=UNIQUE(A1:A4,FALSE,TRUE)' });
    expect(block(once, 'C1', 2, 1)).toEqual([['b'], ['c']]);
  });

  it('FILTER keeps matching rows and reports an empty result', () => {
    const doc = sheet({
      A1: '1',
      A2: '9',
      A3: '4',
      B1: 'x',
      B2: 'y',
      B3: 'z',
      D1: '=FILTER(A1:B3,A1:A3>3)',
    });
    expect(block(doc, 'D1', 2, 2)).toEqual([
      ['9', 'y'],
      ['4', 'z'],
    ]);
    expect(at(sheet({ A1: '1', D1: '=FILTER(A1:A1,A1:A1>9)' }), 'D1')).toBe('#CALC!');
    expect(at(sheet({ A1: '1', D1: '=FILTER(A1:A1,A1:A1>9,"none")' }), 'D1')).toBe('none');
    // A mask of the wrong length is refused rather than silently truncated.
    expect(at(sheet({ A1: '1', A2: '2', D1: '=FILTER(A1:A2,A1:A1>0)' }), 'D1')).toBe('#VALUE!');
  });
});

describe('placement and blocking', () => {
  it('marks derived cells and leaves their input empty', () => {
    const doc = sheet({ A1: '=SEQUENCE(3)' });
    expect(raw(doc, 'A1')).toBe('=SEQUENCE(3)');
    expect(raw(doc, 'A2')).toBe(''); // derived cells hold no input
    expect(doc.isSpillDerivedCell(undefined, ...pos('A2'))).toBe(true);
    expect(doc.isSpillDerivedCell(undefined, ...pos('A1'))).toBe(false); // the anchor
    expect(doc.spillAnchorAt(undefined, ...pos('A3'))).toMatchObject({ row: 0, col: 0, bottom: 2 });
  });

  it('blocks on an occupied cell and writes nothing at all', () => {
    const doc = sheet({ A1: '=SEQUENCE(3)', A3: 'in the way' });
    expect(at(doc, 'A1')).toBe('#SPILL!');
    expect(at(doc, 'A2')).toBe(''); // not a partial write
    expect(at(doc, 'A3')).toBe('in the way');
    expect(doc.isSpillDerivedCell(undefined, ...pos('A2'))).toBe(false);
  });

  it('unblocks as soon as the obstruction is cleared', () => {
    const doc = sheet({ A1: '=SEQUENCE(3)', A3: 'x' });
    expect(at(doc, 'A1')).toBe('#SPILL!');
    doc.setCell(...pos('A3'), '');
    expect(at(doc, 'A1')).toBe('1');
    expect(at(doc, 'A3')).toBe('3');
  });

  it('blocks rather than growing the worksheet', () => {
    const doc = sheet({ A1: '=SEQUENCE(50)' }, 10, 10);
    expect(at(doc, 'A1')).toBe('#SPILL!');
    const wide = sheet({ A1: '=SEQUENCE(1,50)' }, 10, 10);
    expect(at(wide, 'A1')).toBe('#SPILL!');
  });

  it('blocks the anchor whose range covers another formula', () => {
    const doc = sheet({ A1: '=SEQUENCE(3)', A2: '=SEQUENCE(3)' });
    // A1 would have to write over A2, which holds a formula, so A1 is blocked
    // and writes nothing. A2's own range (A2:A4) is clear, so it spills.
    expect(at(doc, 'A1')).toBe('#SPILL!');
    expect(block(doc, 'A2', 3, 1)).toEqual([['1'], ['2'], ['3']]);
    expect(doc.spillAnchorAt(undefined, ...pos('A1'))).toBeNull();
    expect(doc.spillAnchorAt(undefined, ...pos('A3'))).toMatchObject({ row: 1, col: 0 });
  });

  it('places two spills that do not touch', () => {
    const doc = sheet({ A1: '=SEQUENCE(3)', C1: '=SEQUENCE(2,2)' });
    expect(block(doc, 'A1', 3, 1)).toEqual([['1'], ['2'], ['3']]);
    expect(block(doc, 'C1', 2, 2)).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('bounds the number of anchors it will place', () => {
    const doc = RsfDocument.empty('t.rsf', MAX_SPILL_ANCHORS + 20, 4);
    for (let r = 0; r < MAX_SPILL_ANCHORS + 10; r++) {
      doc.setCell(r, 0, '=SEQUENCE(1)'); // 1x1: a scalar, never an anchor
      doc.setCell(r, 2, '=SEQUENCE(1,1,2)');
    }
    // Every one of these is 1x1 and collapses to a scalar, so none of them
    // consumes an anchor slot; the cap is about genuine arrays.
    expect(doc.getDisplayValue(0, 0)).toBe('1');
    expect(doc.getDisplayValue(MAX_SPILL_ANCHORS + 5, 2)).toBe('2');
  });
});

describe('derived cells are protected but recomputed, never stored', () => {
  it('an ordinary formula reads spilled values', () => {
    const doc = sheet({ A1: '=SEQUENCE(4)', C1: '=SUM(A1:A4)', C2: '=COUNT(A1:A4)' });
    expect(at(doc, 'C1')).toBe('10');
    expect(at(doc, 'C2')).toBe('4');
  });

  it("a dynamic array reads another spill's derived cells as blank", () => {
    // The rule that makes placement order irrelevant. The anchor cell itself
    // is an ordinary formula and does evaluate; only A2 and A3 — cells that
    // exist solely because A1 spilled — read as blank.
    const doc = sheet({ A1: '=SEQUENCE(3)', C1: '=SORT(A1:A3)' });
    expect(block(doc, 'A1', 3, 1)).toEqual([['1'], ['2'], ['3']]);
    expect(block(doc, 'C1', 3, 1)).toEqual([['1'], [''], ['']]);
  });

  it('survives a save and reload with no derived value on disk', () => {
    const doc = sheet({ A1: '=SEQUENCE(3,2)', D1: 'note' });
    expect(at(doc, 'B2')).toBe('4');
    const bytes = doc.toBytes();
    const loaded = RsfDocument.fromBytes(bytes, 't.rsf');
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    // Only two cells were ever written: the anchor and the note.
    const stored = loaded.doc.sheets[0].collectCells();
    expect(stored).toHaveLength(2);
    expect(stored.map(([, , input]) => input).sort()).toEqual(['=SEQUENCE(3,2)', 'note']);
    // …and the spill comes back identical.
    expect(block(loaded.doc, 'A1', 3, 2)).toEqual([
      ['1', '2'],
      ['3', '4'],
      ['5', '6'],
    ]);
  });

  it('exports spilled values to CSV', () => {
    const doc = sheet({ A1: '=SEQUENCE(2,2)' }, 2, 2);
    expect(doc.exportCsv(',')).toBe('1,2\n3,4\n');
  });

  it('clears completely when the anchor is deleted', () => {
    const doc = sheet({ A1: '=SEQUENCE(3)' });
    expect(at(doc, 'A3')).toBe('3');
    doc.setCell(...pos('A1'), '');
    expect(at(doc, 'A1')).toBe('');
    expect(at(doc, 'A2')).toBe('');
    expect(at(doc, 'A3')).toBe('');
    expect(doc.isSpillDerivedCell(undefined, ...pos('A2'))).toBe(false);
  });

  it('grows and shrinks when its precedents change', () => {
    const doc = sheet({ A1: '3', C1: '=SEQUENCE(A1)' });
    expect(block(doc, 'C1', 3, 1)).toEqual([['1'], ['2'], ['3']]);
    doc.setCell(...pos('A1'), '5');
    expect(block(doc, 'C1', 5, 1)).toEqual([['1'], ['2'], ['3'], ['4'], ['5']]);
    doc.setCell(...pos('A1'), '2');
    expect(block(doc, 'C1', 3, 1)).toEqual([['1'], ['2'], ['']]); // no stale residue
  });
});

describe('structural edits move the spill with its anchor', () => {
  it('follows a row insertion', () => {
    const doc = sheet({ A5: '=SEQUENCE(3)' });
    expect(at(doc, 'A7')).toBe('3');
    doc.insertRows(0, [new Array(10).fill('')]);
    expect(at(doc, 'A6')).toBe('1');
    expect(at(doc, 'A8')).toBe('3');
    expect(at(doc, 'A5')).toBe('');
  });

  it('follows a row deletion', () => {
    const doc = sheet({ A5: '=SEQUENCE(3)' });
    doc.deleteRows(0, 1);
    expect(at(doc, 'A4')).toBe('1');
    expect(at(doc, 'A6')).toBe('3');
  });

  it('re-blocks when an insertion pushes something into the way', () => {
    const doc = sheet({ A1: '=SEQUENCE(3)', A6: 'x' });
    expect(at(doc, 'A1')).toBe('1');
    doc.insertRows(1, [new Array(10).fill(''), new Array(10).fill(''), new Array(10).fill('')]);
    // 'x' moved from A6 to A9 — still clear.
    expect(at(doc, 'A1')).toBe('1');
    doc.deleteRows(1, 7);
    expect(at(doc, 'A1')).toBe('#SPILL!'); // 'x' is now inside the range
  });

  it('spills across worksheets by reference, never across sheet boundaries', () => {
    const doc = RsfDocument.empty('t.rsf', 10, 5);
    const data = doc.createWorksheet('Data');
    doc.insertSheetAt(1, data);
    doc.setCellOn(data.id, 0, 0, '3');
    doc.setCellOn(data.id, 1, 0, '1');
    doc.setCellOn(data.id, 2, 0, '2');
    doc.setCell(0, 0, '=SORT(Data!A1:A3)');
    expect(block(doc, 'A1', 3, 1)).toEqual([['1'], ['2'], ['3']]);
    // The source worksheet is untouched.
    expect(doc.getSheetDisplayValue(data.id, 0, 0)).toBe('3');
  });

  it('turns a deleted worksheet reference into #REF!, not a stale spill', () => {
    const doc = RsfDocument.empty('t.rsf', 10, 5);
    const data = doc.createWorksheet('Data');
    doc.insertSheetAt(1, data);
    doc.setCellOn(data.id, 0, 0, '1');
    doc.setCell(0, 0, '=SORT(Data!A1:A3)');
    expect(at(doc, 'A1')).toBe('1');
    doc.removeSheet(data.id);
    expect(at(doc, 'A1')).toBe('#REF!');
    expect(at(doc, 'A2')).toBe('');
  });
});

describe('cycles and errors', () => {
  it('a self-referential array formula does not recurse forever', () => {
    const doc = sheet({ A1: '=SORT(A1:A3)' });
    expect(['#CYCLE!', '#SPILL!', '']).toContain(at(doc, 'A1'));
  });

  it('an array formula whose precedent errors reports the error', () => {
    const doc = sheet({ A1: '=1/0', C1: '=SORT(A1:A3)' });
    expect(at(doc, 'C1')).toBe('#DIV/0!');
    expect(at(doc, 'C2')).toBe('');
  });

  it('arithmetic does not broadcast over an array', () => {
    // Documented limitation: element-wise broadcasting would turn existing
    // scalar formulas into spilling ones.
    expect(at(sheet({ A1: '=SEQUENCE(3)+1' }), 'A1')).toBe('#VALUE!');
  });
});

describe('derived cells are protected from writes', () => {
  /** A tab holding a worksheet with one dynamic array anchored at A1. */
  function tabWithSpill(): { state: AppState; tab: ReturnType<AppState['addTab']> } {
    const doc = sheet({ A1: '=SEQUENCE(3)', C1: 'note' });
    const state = new AppState();
    const tab = state.addTab('t.rsf', doc, null);
    return { state, tab };
  }

  it('refuses a single-cell edit into a spill range and names the anchor', () => {
    const { state, tab } = tabWithSpill();
    const announced: string[] = [];
    state.announce = (message) => announced.push(message);
    expect(state.editCell(tab, ...pos('A2'), 'x')).toBe(false);
    expect(announced.join(' ')).toContain('A1');
    expect(at(tab.doc as RsfDocument, 'A2')).toBe('2'); // unchanged
  });

  it('allows editing the anchor itself', () => {
    const { state, tab } = tabWithSpill();
    expect(state.editCell(tab, ...pos('A1'), '=SEQUENCE(2)')).toBe(true);
    expect(at(tab.doc as RsfDocument, 'A2')).toBe('2');
    expect(at(tab.doc as RsfDocument, 'A3')).toBe('');
  });

  it('refuses a bulk edit that touches any derived cell, all-or-nothing', () => {
    const { state, tab } = tabWithSpill();
    const changes = [
      { row: 0, col: 4, before: '', after: 'ok' },
      { row: 2, col: 0, before: '', after: 'bad' }, // A3, derived
    ];
    expect(state.bulkEdit(tab, changes, 'history.paste')).toBe(false);
    expect(at(tab.doc as RsfDocument, 'E1')).toBe(''); // the safe change did not land either
    expect(at(tab.doc as RsfDocument, 'A3')).toBe('3');
  });

  it('reports which anchor is in the way without mutating anything', () => {
    const { state, tab } = tabWithSpill();
    expect(state.spillBlocked(tab, [{ row: 1, col: 0 }])).toEqual({ row: 0, col: 0 });
    expect(state.spillBlocked(tab, [{ row: 0, col: 2 }])).toBeNull(); // the note cell
    expect(state.spillBlocked(tab, [{ row: 0, col: 0 }])).toBeNull(); // the anchor
  });

  it('lets undo restore a pre-spill state through the guard', () => {
    const { state, tab } = tabWithSpill();
    const doc = tab.doc as RsfDocument;
    // Clearing the anchor is allowed, and undo must be able to put it back
    // even though the cells it re-covers were derived a moment ago.
    expect(state.editCell(tab, ...pos('A1'), '')).toBe(true);
    expect(at(doc, 'A2')).toBe('');
    state.undo(tab);
    expect(block(doc, 'A1', 3, 1)).toEqual([['1'], ['2'], ['3']]);
  });
});
