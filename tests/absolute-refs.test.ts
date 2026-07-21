// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * Absolute and mixed A1-style references ($A$1, $A1, A$1) across the whole
 * pipeline: parsing, evaluation, `$`-preserving display/storage, copy/fill
 * shifting (absolute components fixed), structural insert/delete adjustment
 * (markers preserved, positions tracked), range endpoints, highlighting, and
 * autocomplete interplay.
 */
import { describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/app/app-state';
import { Commands, type UiPort } from '../src/app/commands';
import {
  adjustFormulaForAxis,
  extractFormulaRefs,
  functionCompletions,
  parseFormula,
  parseRef,
  parseRefEx,
  parseWholeColumnEx,
  parseWholeRowEx,
  refLabel,
  shiftFormulaRefs,
} from '../src/core/formula';
import { RsfDocument } from '../src/core/rsf-document';

function stubUi(overrides: Partial<UiPort> = {}): UiPort {
  return {
    confirmValidation: vi.fn(async () => true),
    confirmUnsaved: vi.fn(async () => 'discard' as const),
    chooseSaveOptions: vi.fn(async () => null),
    confirmUnrepresentable: vi.fn(async () => false),
    notifyNcr: vi.fn(async () => undefined),
    confirmUndecodableEdit: vi.fn(async () => true),
    chooseReopen: vi.fn(async () => null),
    confirmConvert: vi.fn(async () => true),
    explainRsfSave: vi.fn(async () => true),
    chooseRsfSave: vi.fn(async () => 2),
    chooseExportCsv: vi.fn(async () => null),
    chooseInsertShift: vi.fn(async () => 'down' as const),
    confirmFlashFill: vi.fn(async () => false),
    chooseFilter: vi.fn(async () => null),
    confirm: vi.fn(async () => true),
    showMessage: vi.fn(async () => undefined),
    notify: vi.fn(),
    openFindBar: vi.fn(),
    findNext: vi.fn(),
    showAbout: vi.fn(),
    showFormulaHelp: vi.fn(),
    chooseSettings: vi.fn(async () => null),
    setBusy: vi.fn(),
    ...overrides,
  };
}

function sheet(values: string[][]): {
  state: AppState;
  commands: Commands;
  tab: ReturnType<AppState['addTab']>;
  doc: RsfDocument;
} {
  const state = new AppState();
  const commands = new Commands(state, stubUi(), document);
  const doc = RsfDocument.empty('t.rsf', values.length, values[0].length);
  for (let r = 0; r < values.length; r++) {
    for (let c = 0; c < values[r].length; c++) {
      doc.setCell(r, c, values[r][c]);
    }
  }
  doc.markSaved();
  const tab = state.addTab('t.rsf', doc, null);
  return { state, commands, tab, doc };
}

describe('parsing the four reference forms', () => {
  it('parseRefEx reports coordinates and $ markers', () => {
    expect(parseRefEx('A1')).toEqual({ row: 0, col: 0, absRow: false, absCol: false });
    expect(parseRefEx('$A$1')).toEqual({ row: 0, col: 0, absRow: true, absCol: true });
    expect(parseRefEx('$A1')).toEqual({ row: 0, col: 0, absRow: false, absCol: true });
    expect(parseRefEx('A$1')).toEqual({ row: 0, col: 0, absRow: true, absCol: false });
    expect(parseRefEx('$aa$10')).toEqual({ row: 9, col: 26, absRow: true, absCol: true });
    expect(parseRefEx('$')).toBeNull();
    expect(parseRefEx('$$A1')).toBeNull();
    expect(parseRefEx('A$')).toBeNull();
  });

  it('parseRef keeps its plain shape and accepts $ forms', () => {
    expect(parseRef('$B$2')).toEqual({ row: 1, col: 1 });
    expect(parseRef('B$2')).toEqual({ row: 1, col: 1 });
  });

  it('span endpoints report $ markers', () => {
    expect(parseWholeColumnEx('$A')).toEqual({ index: 0, abs: true });
    expect(parseWholeColumnEx('A')).toEqual({ index: 0, abs: false });
    expect(parseWholeRowEx('$3')).toEqual({ index: 2, abs: true });
    expect(parseWholeRowEx('3')).toEqual({ index: 2, abs: false });
  });

  it('refLabel round-trips markers', () => {
    expect(refLabel(0, 0)).toBe('A1');
    expect(refLabel(9, 26, true, true)).toBe('$AA$10');
    expect(refLabel(1, 1, true, false)).toBe('B$2');
    expect(refLabel(1, 1, false, true)).toBe('$B2');
  });

  it('parses formulas using every form, including range endpoints', () => {
    for (const src of [
      '=$A$1',
      '=$A1',
      '=A$1',
      '=$A$1+B2*$C3',
      '=SUM($A$1:$A10)',
      '=SUM(A$1:$B10)',
      '=SUM($A$1:B10)',
      '=SUM($A:C)',
      '=SUM($A:$C)',
      '=SUM($1:10)',
      '=SUM(1:$10)',
      '=IF($A$1>1,"y",$B2)',
    ]) {
      expect(parseFormula(src).ok, src).toBe(true);
    }
  });

  it('rejects malformed $ syntax', () => {
    for (const src of ['=$', '=$+1', '=A1+$', '=$$A$1', '=$A$']) {
      expect(parseFormula(src).ok, src).toBe(false);
    }
  });
});

describe('evaluation ignores $ markers (same cell either way)', () => {
  it('evaluates absolute and mixed refs like their relative counterparts', () => {
    const doc = RsfDocument.empty('t.rsf', 4, 3);
    doc.setCell(0, 0, '7'); // A1
    doc.setCell(1, 0, '3'); // A2
    doc.setCell(0, 1, '=$A$1+A2');
    doc.setCell(1, 1, '=SUM($A$1:$A2)');
    doc.setCell(2, 1, '=SUM($A:A)');
    expect(doc.getDisplayValue(0, 1)).toBe('10');
    expect(doc.getDisplayValue(1, 1)).toBe('10');
    expect(doc.getDisplayValue(2, 1)).toBe('10');
  });

  it('detects cycles through absolute references', () => {
    const doc = RsfDocument.empty('t.rsf', 2, 2);
    doc.setCell(0, 0, '=$B$1');
    doc.setCell(0, 1, '=$A$1');
    expect(doc.getDisplayValue(0, 0)).toBe('#CYCLE!');
  });

  it('stores and displays the $ markers verbatim', () => {
    const doc = RsfDocument.empty('t.rsf', 2, 2);
    doc.setCell(0, 0, '=$A$2 + B$1');
    expect(doc.getValue(0, 0)).toBe('=$A$2 + B$1');
  });
});

describe('copy/fill shifting: absolute components stay fixed', () => {
  it('shifts only relative components of single refs', () => {
    expect(shiftFormulaRefs('=$A$1', 5, 5)).toBe('=$A$1');
    expect(shiftFormulaRefs('=$A1', 2, 3)).toBe('=$A3');
    expect(shiftFormulaRefs('=A$1', 2, 3)).toBe('=D$1');
    expect(shiftFormulaRefs('=A1', 2, 3)).toBe('=D3');
    expect(shiftFormulaRefs('=$A$1+B2', 1, 1)).toBe('=$A$1+C3');
  });

  it('shifts range endpoints independently, preserving each marker', () => {
    expect(shiftFormulaRefs('=SUM($A$1:B10)', 1, 1)).toBe('=SUM($A$1:C11)');
    expect(shiftFormulaRefs('=SUM(A$1:$B10)', 2, 2)).toBe('=SUM(C$1:$B12)');
    expect(shiftFormulaRefs('=SUM($A$1:$B$2)', 9, 9)).toBe('=SUM($A$1:$B$2)');
  });

  it('shifts whole-column/row spans, honoring $ endpoints', () => {
    expect(shiftFormulaRefs('=SUM($A:C)', 0, 1)).toBe('=SUM($A:D)');
    expect(shiftFormulaRefs('=SUM($A:$C)', 0, 5)).toBe('=SUM($A:$C)');
    expect(shiftFormulaRefs('=SUM($1:3)', 2, 0)).toBe('=SUM($1:5)');
    expect(shiftFormulaRefs('=SUM(1:$3)', 2, 0)).toBe('=SUM(3:$3)');
  });

  it('absolute components never go out of range; relative ones can #REF!', () => {
    expect(shiftFormulaRefs('=$A$1', -5, -5)).toBe('=$A$1');
    expect(shiftFormulaRefs('=$A1', -1, 0)).toBe('=#REF!');
    expect(shiftFormulaRefs('=A$1', 0, -1)).toBe('=#REF!');
  });
});

describe('structural insert/delete: positions track, markers persist', () => {
  it('adjusts absolute refs on row insertion and preserves markers', () => {
    expect(adjustFormulaForAxis('=$A$5', 'row', 'insert', 1, 3)).toBe('=$A$8');
    expect(adjustFormulaForAxis('=$A5', 'row', 'insert', 1, 3)).toBe('=$A8');
    expect(adjustFormulaForAxis('=A$5', 'row', 'insert', 1, 3)).toBe('=A$8');
    expect(adjustFormulaForAxis('=$A$1', 'row', 'insert', 5, 3)).toBe('=$A$1');
  });

  it('adjusts absolute refs on column operations', () => {
    expect(adjustFormulaForAxis('=$B$1+C1', 'col', 'insert', 1, 1)).toBe('=$C$1+D1');
    expect(adjustFormulaForAxis('=$B$1', 'col', 'delete', 1, 1)).toBe('=#REF!');
  });

  it('clamps ranges with $ endpoints on deletion', () => {
    expect(adjustFormulaForAxis('=SUM($A$1:$A$10)', 'row', 'delete', 1, 2)).toBe('=SUM($A$1:$A$8)');
    expect(adjustFormulaForAxis('=SUM($A$2:A$3)', 'row', 'delete', 1, 2)).toBe('=SUM(#REF!)');
    expect(adjustFormulaForAxis('=SUM($A:$C)', 'col', 'delete', 1, 1)).toBe('=SUM($A:$B)');
    expect(adjustFormulaForAxis('=SUM($1:$1)', 'row', 'insert', 0, 1)).toBe('=SUM($2:$2)');
  });
});

describe('document-level integration', () => {
  it('rewrites $ formulas when rows are inserted (single undoable entry)', () => {
    const { state, tab, doc } = sheet([
      ['1', ''],
      ['2', '=$A$1+$A2'],
    ]);
    expect(state.insertRows(tab, 0, 1)).toBe(true);
    expect(doc.getValue(2, 1)).toBe('=$A$2+$A3');
    state.undo(tab);
    expect(doc.getValue(1, 1)).toBe('=$A$1+$A2');
    state.redo(tab);
    expect(doc.getValue(2, 1)).toBe('=$A$2+$A3');
  });

  it('paste shifts only relative components (Commands.applyPaste)', async () => {
    const { state, commands, tab, doc } = sheet([
      ['10', '20', ''],
      ['', '', ''],
      ['', '', ''],
    ]);
    doc.setCell(0, 2, '=$A$1+A1');
    state.setSelection(tab, { row: 2, col: 2 }, null);
    const applied = await commands.applyPaste(tab, [['=$A$1+A1']], { row: 0, col: 2 });
    expect(applied).toBe(true);
    expect(doc.getValue(2, 2)).toBe('=$A$1+A3');
  });

  it('fill down keeps absolute anchors fixed (Commands.applyFill)', async () => {
    const { state, commands, tab, doc } = sheet([
      ['1', '=A1*$B$1'],
      ['2', ''],
      ['3', ''],
    ]);
    const applied = await commands.applyFill(
      tab,
      { top: 0, bottom: 0, left: 1, right: 1 },
      { top: 0, bottom: 2, left: 1, right: 1 },
    );
    expect(applied).toBe(true);
    expect(doc.getValue(1, 1)).toBe('=A2*$B$1');
    expect(doc.getValue(2, 1)).toBe('=A3*$B$1');
    state.undo(tab);
    expect(doc.getValue(1, 1)).toBe('');
  });

  it('insert copied cells adjusts inserted $ formulas by the paste offset', () => {
    const { state, tab, doc } = sheet([
      ['1', '2'],
      ['3', '4'],
    ]);
    const applied = state.insertCopiedCells(tab, { row: 1, col: 0 }, [['=$A$1+A1']], 'down', {
      row: 0,
      col: 0,
    });
    expect(applied).toBe(true);
    expect(doc.getValue(1, 0)).toBe('=$A$1+A2');
  });
});

describe('highlighting and autocomplete', () => {
  it('extracts $-marked references and ranges for highlighting', () => {
    expect(extractFormulaRefs('=$A$1+A2')).toMatchObject([
      { top: 0, left: 0, bottom: 0, right: 0, text: '$A$1' },
      { top: 1, left: 0, text: 'A2' },
    ]);
    expect(extractFormulaRefs('=SUM($A$1:B$3)')).toMatchObject([
      { top: 0, left: 0, bottom: 2, right: 1, text: '$A$1:B$3' },
    ]);
    expect(extractFormulaRefs('=SUM($A:$B)')).toMatchObject([{ left: 0, right: 1, wholeCols: true }]);
    expect(extractFormulaRefs('=SUM($1:$2)')).toMatchObject([{ top: 0, bottom: 1, wholeRows: true }]);
    // Identical rectangles merge regardless of markers.
    expect(extractFormulaRefs('=$A$1+A1')).toHaveLength(1);
  });

  it('does not offer function completions right after a $ marker', () => {
    expect(functionCompletions('=$SU', 4).matches).toEqual([]);
    expect(functionCompletions('=SU', 3).matches.map((m) => m.name)).toContain('SUM');
  });
});
