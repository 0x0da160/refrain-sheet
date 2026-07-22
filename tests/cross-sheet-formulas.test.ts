// SPDX-License-Identifier: MIT
/**
 * Worksheet-qualified formula references: grammar, quoting and escaping,
 * evaluation across worksheets, cross-worksheet circular detection, and the
 * rewrites that keep formulas correct when a worksheet is renamed or deleted.
 */
import { describe, expect, it } from 'vitest';
import {
  adjustFormulaForAxis,
  extractFormulaRefs,
  formulaReferencesSheet,
  invalidateSheetRefsInFormula,
  isValidSheetName,
  MAX_SHEET_NAME_LENGTH,
  parseFormula,
  quoteSheetName,
  renameSheetInFormula,
  sheetNameKey,
  sheetNameNeedsQuoting,
  shiftFormulaRefs,
  type AstNode,
} from '../src/core/formula';
import { RsfDocument } from '../src/core/rsf-document';

/** A two-worksheet workbook with known values on each sheet. */
function workbook(): RsfDocument {
  const doc = RsfDocument.empty('book.rsf', 10, 5, 'Sheet1');
  const second = doc.createWorksheet('Quarter 1', 10, 5);
  doc.insertSheetAt(1, second);
  return doc;
}

describe('worksheet-name policy', () => {
  it('accepts ordinary names and rejects reserved characters', () => {
    for (const name of ['Sheet1', 'Quarter 1', 'シート1', 'O’Brien', "O'Brien", 'a'.repeat(100)]) {
      expect(isValidSheetName(name), name).toBe(true);
    }
    for (const name of ['', '   ', 'a/b', 'a\\b', 'a:b', 'a?b', 'a*b', 'a[b', 'a]b', 'a'.repeat(101)]) {
      expect(isValidSheetName(name), JSON.stringify(name)).toBe(false);
    }
  });

  it('bounds the documented maximum length', () => {
    expect(MAX_SHEET_NAME_LENGTH).toBe(100);
    expect(isValidSheetName('a'.repeat(MAX_SHEET_NAME_LENGTH))).toBe(true);
    expect(isValidSheetName('a'.repeat(MAX_SHEET_NAME_LENGTH + 1))).toBe(false);
  });

  it('compares names case-insensitively for uniqueness', () => {
    expect(sheetNameKey('Sheet1')).toBe(sheetNameKey('SHEET1'));
    expect(sheetNameKey('  Sheet1  ')).toBe('sheet1');
  });

  it('quotes only names that are not plain identifiers, doubling single quotes', () => {
    expect(sheetNameNeedsQuoting('Sheet1')).toBe(false);
    expect(quoteSheetName('Sheet1')).toBe('Sheet1');
    expect(quoteSheetName('Quarter 1')).toBe("'Quarter 1'");
    expect(quoteSheetName("O'Brien")).toBe("'O''Brien'");
    expect(quoteSheetName('2024')).toBe("'2024'");
    expect(quoteSheetName('シート1')).toBe("'シート1'");
  });
});

describe('cross-sheet reference grammar', () => {
  const ok = (src: string): AstNode => {
    const parsed = parseFormula(src);
    expect(parsed.ok, src).toBe(true);
    if (!parsed.ok) throw new Error('unreachable');
    return parsed.ast;
  };

  it('parses every documented qualified form', () => {
    expect(ok('=Sheet1!A1')).toMatchObject({ kind: 'ref', row: 0, col: 0, sheet: 'Sheet1' });
    expect(ok('=Sheet1!A1:B10')).toMatchObject({ kind: 'range', sheet: 'Sheet1' });
    expect(ok('=Sheet1!$A$1')).toMatchObject({ kind: 'ref', row: 0, col: 0, sheet: 'Sheet1' });
    expect(ok("='Quarter 1'!A1")).toMatchObject({ kind: 'ref', sheet: 'Quarter 1' });
    expect(ok("='Quarter 1'!$A$1:$B10")).toMatchObject({ kind: 'range', sheet: 'Quarter 1' });
    expect(ok('=SUM(Sheet1!A1:A10)')).toMatchObject({ kind: 'call', name: 'SUM' });
    expect(ok('=Sheet1!A:B')).toMatchObject({ kind: 'colrange', sheet: 'Sheet1' });
    expect(ok('=Sheet1!1:10')).toMatchObject({ kind: 'rowrange', sheet: 'Sheet1' });
  });

  it('unescapes a doubled single quote inside a quoted name', () => {
    expect(ok("='O''Brien'!A1")).toMatchObject({ kind: 'ref', sheet: "O'Brien" });
  });

  it('leaves unqualified references pointing at the current worksheet', () => {
    expect(ok('=A1')).toMatchObject({ kind: 'ref', row: 0, col: 0 });
    expect(ok('=A1')).not.toHaveProperty('sheet');
  });

  it('rejects 3D ranges spanning two worksheets rather than guessing', () => {
    expect(parseFormula('=Sheet1!A1:Sheet2!B2').ok).toBe(false);
    expect(parseFormula('=SUM(Sheet1!A1:Sheet2!B2)').ok).toBe(false);
  });

  it('rejects malformed qualifiers', () => {
    for (const src of ['=Sheet1!', "='Unterminated!A1", '=Sheet1!!A1', '=!A1', "=''!A1"]) {
      expect(parseFormula(src).ok, src).toBe(false);
    }
  });
});

describe('cross-sheet evaluation', () => {
  it('reads cells and ranges from another worksheet', () => {
    const doc = workbook();
    const q1 = doc.sheetByName('Quarter 1')!;
    doc.setCellOn(q1.id, 0, 0, '10');
    doc.setCellOn(q1.id, 1, 0, '20');
    doc.setCell(0, 0, "='Quarter 1'!A1");
    doc.setCell(1, 0, "=SUM('Quarter 1'!A1:A2)");
    expect(doc.getDisplayValue(0, 0)).toBe('10');
    expect(doc.getDisplayValue(1, 0)).toBe('30');
  });

  it('recalculates dependents when the referenced worksheet changes', () => {
    const doc = workbook();
    const q1 = doc.sheetByName('Quarter 1')!;
    doc.setCellOn(q1.id, 0, 0, '5');
    doc.setCell(0, 0, "='Quarter 1'!A1*2");
    expect(doc.getDisplayValue(0, 0)).toBe('10');
    doc.setCellOn(q1.id, 0, 0, '7');
    expect(doc.getDisplayValue(0, 0)).toBe('14');
  });

  it('resolves worksheet names case-insensitively', () => {
    const doc = workbook();
    doc.setCellOn(doc.sheetByName('Quarter 1')!.id, 0, 0, '42');
    doc.setCell(0, 0, "='QUARTER 1'!A1");
    expect(doc.getDisplayValue(0, 0)).toBe('42');
  });

  it('detects circular references that travel through another worksheet', () => {
    const doc = workbook();
    const q1 = doc.sheetByName('Quarter 1')!;
    doc.setCell(0, 0, "='Quarter 1'!A1");
    doc.setCellOn(q1.id, 0, 0, '=Sheet1!A1');
    expect(doc.getDisplayValue(0, 0)).toBe('#CYCLE!');
    expect(doc.getSheetDisplayValue(q1.id, 0, 0)).toBe('#CYCLE!');
    // Breaking the cycle recovers.
    doc.setCellOn(q1.id, 0, 0, '3');
    expect(doc.getDisplayValue(0, 0)).toBe('3');
  });

  it('reports #REF! for a worksheet that does not exist', () => {
    const doc = workbook();
    doc.setCell(0, 0, '=Missing!A1');
    doc.setCell(1, 0, '=SUM(Missing!A1:A5)');
    expect(doc.getDisplayValue(0, 0)).toBe('#REF!');
    expect(doc.getDisplayValue(1, 0)).toBe('#REF!');
  });

  it('bounds a qualified whole-column range to that worksheet, not the current one', () => {
    const doc = RsfDocument.empty('b.rsf', 3, 2, 'Sheet1');
    const wide = doc.createWorksheet('Wide', 6, 2);
    doc.insertSheetAt(1, wide);
    for (let r = 0; r < 6; r++) {
      doc.setCellOn(wide.id, r, 0, '1');
    }
    // Sheet1 has 3 rows, Wide has 6: the range must cover Wide's used grid.
    doc.setCell(0, 1, '=SUM(Wide!A:A)');
    expect(doc.getDisplayValue(0, 1)).toBe('6');
  });
});

describe('rewrites when worksheets change', () => {
  it('renames references and re-quotes only as the new name requires', () => {
    expect(renameSheetInFormula('=Sheet1!A1', 'Sheet1', 'Sales')).toBe('=Sales!A1');
    expect(renameSheetInFormula('=Sheet1!A1', 'Sheet1', 'Q1 Sales')).toBe("='Q1 Sales'!A1");
    expect(renameSheetInFormula("='Quarter 1'!A1:B2", 'Quarter 1', 'Q1')).toBe('=Q1!A1:B2');
    expect(renameSheetInFormula("='Quarter 1'!A1", 'Quarter 1', "O'Brien")).toBe("='O''Brien'!A1");
    // Case-insensitive match, other worksheets untouched.
    expect(renameSheetInFormula('=SHEET1!A1+Other!B2', 'Sheet1', 'X')).toBe('=X!A1+Other!B2');
    // Unqualified references and non-matching names are left alone.
    expect(renameSheetInFormula('=A1+B2', 'Sheet1', 'X')).toBe('=A1+B2');
  });

  it('turns references to a deleted worksheet into #REF! without touching others', () => {
    expect(invalidateSheetRefsInFormula('=Sheet1!A1', 'Sheet1')).toBe('=#REF!');
    expect(invalidateSheetRefsInFormula('=SUM(Sheet1!A1:A9)', 'Sheet1')).toBe('=SUM(#REF!)');
    expect(invalidateSheetRefsInFormula('=Sheet1!A1+Other!B2', 'Sheet1')).toBe('=#REF!+Other!B2');
    expect(invalidateSheetRefsInFormula('=A1+Other!B2', 'Sheet1')).toBe('=A1+Other!B2');
  });

  it('reports which formulas reference a worksheet', () => {
    expect(formulaReferencesSheet('=Sheet1!A1', 'Sheet1')).toBe(true);
    expect(formulaReferencesSheet("='Quarter 1'!A1", 'quarter 1')).toBe(true);
    expect(formulaReferencesSheet('=A1+B2', 'Sheet1')).toBe(false);
  });

  it('shifts a qualified reference on copy while keeping its worksheet', () => {
    expect(shiftFormulaRefs('=Sheet1!A1', 1, 0)).toBe('=Sheet1!A2');
    expect(shiftFormulaRefs("='Quarter 1'!$A$1", 5, 5)).toBe("='Quarter 1'!$A$1");
    expect(shiftFormulaRefs('=SUM(Sheet1!A1:B2)', 1, 1)).toBe('=SUM(Sheet1!B2:C3)');
  });

  it('adjusts only references whose effective worksheet is the edited one', () => {
    const opts = { homeSheet: 'Sheet1', shouldMapCoords: (s: string | null) => s === 'Sheet1' };
    // Inserting a row in Sheet1 moves Sheet1's own and Sheet1-qualified refs…
    expect(adjustFormulaForAxis('=A5', 'row', 'insert', 0, 1, opts)).toBe('=A6');
    expect(adjustFormulaForAxis('=Sheet1!A5', 'row', 'insert', 0, 1, opts)).toBe('=Sheet1!A6');
    // …but never a reference into a different worksheet.
    expect(adjustFormulaForAxis('=Other!A5', 'row', 'insert', 0, 1, opts)).toBe('=Other!A5');
    // A formula living on another worksheet keeps its own unqualified refs.
    const away = { homeSheet: 'Other', shouldMapCoords: (s: string | null) => s === 'Sheet1' };
    expect(adjustFormulaForAxis('=A5', 'row', 'insert', 0, 1, away)).toBe('=A5');
    expect(adjustFormulaForAxis('=Sheet1!A5', 'row', 'insert', 0, 1, away)).toBe('=Sheet1!A6');
  });
});

describe('reference highlighting', () => {
  it('ignores cross-sheet references, which have no rectangle in the current grid', () => {
    expect(extractFormulaRefs('=Sheet1!A1')).toEqual([]);
    expect(extractFormulaRefs("='Quarter 1'!A1:B2")).toEqual([]);
    // The qualifier itself is a name, not a reference (`AB1` in `AB1!C2`).
    expect(extractFormulaRefs('=AB1!C2')).toEqual([]);
    // Unqualified references in the same formula still highlight.
    expect(extractFormulaRefs('=Sheet1!A1+B2')).toMatchObject([{ top: 1, left: 1 }]);
  });
});
