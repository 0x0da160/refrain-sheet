// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { RcsvDocument, RCSV_FORMAT, RCSV_VERSION } from '../src/core/rcsv-document';
import { doc, utf8 } from './helpers';

function rcsvFromCells(cells: Array<[number, number, string]>, rows = 4, cols = 3): RcsvDocument {
  const json = {
    format: RCSV_FORMAT,
    version: RCSV_VERSION,
    sheet: { name: 'Sheet1', rowCount: rows, columnCount: cols, cells },
  };
  const result = RcsvDocument.fromBytes(utf8(JSON.stringify(json)), 'test.rcsv');
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('unreachable');
  return result.doc;
}

describe('conversion from CSV', () => {
  it('copies current values (including unsaved edits) into a rectangular sheet', () => {
    const csv = doc('a,b,c\n1,2\n');
    csv.setValue(0, 1, 'edited');
    const rcsv = RcsvDocument.fromLossless(csv, 'x.rcsv');
    expect(rcsv.rowCount).toBe(2);
    expect(rcsv.columnCount).toBe(3);
    expect(rcsv.getValue(0, 1)).toBe('edited');
    expect(rcsv.getValue(1, 0)).toBe('1');
    expect(rcsv.getValue(1, 2)).toBe(''); // jagged row padded
    expect(rcsv.delimiter).toBe(',');
  });
});

describe('formulas in the document', () => {
  it('computes display values while preserving the formula expression', () => {
    const sheet = rcsvFromCells([
      [0, 0, '10'],
      [1, 0, '20'],
      [2, 0, '=SUM(A1:A2)'],
    ]);
    expect(sheet.getValue(2, 0)).toBe('=SUM(A1:A2)');
    expect(sheet.getDisplayValue(2, 0)).toBe('30');
    expect(sheet.isFormulaCell(2, 0)).toBe(true);
    expect(sheet.isFormulaCell(0, 0)).toBe(false);
    expect(sheet.countFormulaCells()).toBe(1);
  });

  it('recalculates dependents when referenced values change', () => {
    const sheet = rcsvFromCells([
      [0, 0, '1'],
      [1, 0, '=A1*2'],
      [2, 0, '=A2+1'],
    ]);
    expect(sheet.getDisplayValue(2, 0)).toBe('3');
    sheet.setCell(0, 0, '10');
    expect(sheet.getDisplayValue(1, 0)).toBe('20');
    expect(sheet.getDisplayValue(2, 0)).toBe('21');
  });

  it('recalculates when a referenced formula changes', () => {
    const sheet = rcsvFromCells([
      [0, 0, '2'],
      [1, 0, '=A1*3'],
      [2, 0, '=A2*10'],
    ]);
    expect(sheet.getDisplayValue(2, 0)).toBe('60');
    sheet.setCell(1, 0, '=A1*5');
    expect(sheet.getDisplayValue(2, 0)).toBe('100');
  });

  it('detects circular references without crashing', () => {
    const sheet = rcsvFromCells([
      [0, 0, '=B1'],
      [0, 1, '=A1'],
    ]);
    expect(sheet.getDisplayValue(0, 0)).toBe('#CYCLE!');
    expect(sheet.getDisplayValue(0, 1)).toBe('#CYCLE!');
    // Self-reference too.
    sheet.setCell(2, 0, '=A3');
    expect(sheet.getDisplayValue(2, 0)).toBe('#CYCLE!');
    // Breaking the cycle recovers.
    sheet.setCell(0, 1, '7');
    expect(sheet.getDisplayValue(0, 0)).toBe('7');
  });

  it('shows explicit errors for invalid formulas and unsupported functions', () => {
    const sheet = rcsvFromCells([
      [0, 0, '=1+'],
      [0, 1, '=NOPE(1)'],
      [0, 2, '=1/0'],
      [1, 0, '=#REF!'],
    ]);
    expect(sheet.getDisplayValue(0, 0)).toBe('#ERROR!');
    expect(sheet.getDisplayValue(0, 1)).toBe('#NAME?');
    expect(sheet.getDisplayValue(0, 2)).toBe('#DIV/0!');
    expect(sheet.getDisplayValue(1, 0)).toBe('#REF!');
  });
});

describe('versioned serialization', () => {
  it('round-trips values, formulas, structure, and settings', () => {
    const original = rcsvFromCells(
      [
        [0, 0, 'v'],
        [1, 2, '=SUM(A1:A2)'],
        [3, 1, 'multi\nline'],
      ],
      5,
      4,
    );
    original.delimiter = ';';
    const bytes = original.toBytes();
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    expect(parsed.format).toBe('refrain-rcsv');
    expect(parsed.version).toBe(1);
    const reloaded = RcsvDocument.fromBytes(bytes, 'again.rcsv');
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) return;
    expect(reloaded.doc.rowCount).toBe(5);
    expect(reloaded.doc.columnCount).toBe(4);
    expect(reloaded.doc.getValue(0, 0)).toBe('v');
    expect(reloaded.doc.getValue(1, 2)).toBe('=SUM(A1:A2)');
    expect(reloaded.doc.getValue(3, 1)).toBe('multi\nline');
    expect(reloaded.doc.delimiter).toBe(';');
  });

  it('rejects wrong formats, versions, shapes, and encodings', () => {
    const cases: Array<[Uint8Array, string]> = [
      [utf8('not json at all'), 'not-json'],
      [new Uint8Array([0xff, 0xfe, 0x00]), 'not-utf8'],
      [utf8(JSON.stringify({ format: 'other', version: 1, sheet: {} })), 'bad-format'],
      [
        utf8(
          JSON.stringify({
            format: RCSV_FORMAT,
            version: 2,
            sheet: { name: 's', rowCount: 1, columnCount: 1, cells: [] },
          }),
        ),
        'bad-version',
      ],
      [utf8(JSON.stringify({ format: RCSV_FORMAT, version: 1 })), 'bad-shape'],
      [
        utf8(
          JSON.stringify({
            format: RCSV_FORMAT,
            version: 1,
            sheet: { name: 's', rowCount: 2, columnCount: 2, cells: [[5, 0, 'out of range']] },
          }),
        ),
        'bad-shape',
      ],
      [
        utf8(
          JSON.stringify({
            format: RCSV_FORMAT,
            version: 1,
            sheet: { name: 's', rowCount: 1, columnCount: 1, cells: [[0, 0, 42]] },
          }),
        ),
        'bad-shape',
      ],
      [
        utf8(
          JSON.stringify({
            format: RCSV_FORMAT,
            version: 1,
            sheet: { name: 's', rowCount: 100_000_000, columnCount: 100, cells: [] },
          }),
        ),
        'too-large',
      ],
      [
        utf8(
          JSON.stringify({
            format: RCSV_FORMAT,
            version: 1,
            sheet: { name: 's', rowCount: 1, columnCount: 1, cells: [] },
            settings: { delimiter: '|' },
          }),
        ),
        'bad-shape',
      ],
    ];
    for (const [bytes, error] of cases) {
      const result = RcsvDocument.fromBytes(bytes, 'bad.rcsv');
      expect(result.ok, error).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe(error);
      }
    }
  });

  it('stores only inert data (no code is ever executed by loading)', () => {
    // Hostile-looking strings stay plain strings.
    const sheet = rcsvFromCells([
      [0, 0, '<script>window.x=1</script>'],
      [0, 1, '=SUM(A1:A1)'],
    ]);
    expect(sheet.getDisplayValue(0, 0)).toBe('<script>window.x=1</script>');
    const bytes = sheet.toBytes();
    const text = new TextDecoder().decode(bytes);
    expect(text).not.toContain('function');
    expect(text).not.toContain('http');
  });
});

describe('dirty state', () => {
  it('tracks mutations against the saved revision', () => {
    const sheet = rcsvFromCells([[0, 0, 'a']]);
    expect(sheet.isDirty).toBe(false);
    sheet.setCell(0, 0, 'b');
    expect(sheet.isDirty).toBe(true);
    sheet.markSaved();
    expect(sheet.isDirty).toBe(false);
    sheet.insertRows(0, [[]]);
    expect(sheet.isDirty).toBe(true);
  });

  it('ignores no-op cell writes', () => {
    const sheet = rcsvFromCells([[0, 0, 'a']]);
    sheet.setCell(0, 0, 'a');
    expect(sheet.isDirty).toBe(false);
  });
});

describe('CSV export (calculated values)', () => {
  it('exports formulas as their calculated values with minimal quoting', () => {
    const sheet = rcsvFromCells(
      [
        [0, 0, '1'],
        [0, 1, '2'],
        [1, 0, '=A1+B1'],
        [1, 1, 'has,comma'],
        [2, 0, 'quote"inside'],
        [2, 1, 'multi\nline'],
      ],
      3,
      2,
    );
    const csv = sheet.exportCsv();
    expect(csv).toBe('1,2\n3,"has,comma"\n"quote""inside","multi\nline"\n');
  });

  it('honours the delimiter setting', () => {
    const sheet = rcsvFromCells(
      [
        [0, 0, 'a;x'],
        [0, 1, 'b'],
      ],
      1,
      2,
    );
    expect(sheet.exportCsv(';')).toBe('"a;x";b\n');
  });
});

describe('structural mutators', () => {
  it('splices rows and columns and can grow for pastes', () => {
    const sheet = rcsvFromCells(
      [
        [0, 0, 'a'],
        [1, 0, 'b'],
      ],
      2,
      2,
    );
    sheet.insertRows(1, [['mid', 'x']]);
    expect(sheet.rowCount).toBe(3);
    expect(sheet.getValue(1, 0)).toBe('mid');
    const removed = sheet.deleteRows(1, 1);
    expect(removed).toEqual([['mid', 'x']]);
    expect(sheet.rowCount).toBe(2);

    sheet.insertCols(1, [['c1', 'c2']]);
    expect(sheet.columnCount).toBe(3);
    expect(sheet.getValue(0, 1)).toBe('c1');
    const removedCols = sheet.deleteCols(1, 1);
    expect(removedCols).toEqual([['c1', 'c2']]);
    expect(sheet.columnCount).toBe(2);

    sheet.ensureSize(5, 4);
    expect(sheet.rowCount).toBe(5);
    expect(sheet.columnCount).toBe(4);
    expect(sheet.getValue(4, 3)).toBe('');
  });
});
