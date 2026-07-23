// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * Moving a rectangular range: the pure planner's reference semantics and
 * bounds checks (core), then the command-layer flow — empty-destination moves,
 * overwrite confirmation acceptance and cancellation, undo/redo, the CSV
 * restriction, and the keyboard-equivalent "Move Selected Cells…".
 */
import { describe, expect, it, vi } from 'vitest';
import { AppState, type Tab } from '../src/app/app-state';
import { Commands, type UiPort } from '../src/app/commands';
import { moveTarget, planRangeMove, validateMove } from '../src/core/range-move';
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
    chooseInsertShift: vi.fn(async () => null),
    confirmFlashFill: vi.fn(async () => false),
    chooseFilter: vi.fn(async () => null),
    promptSheetName: vi.fn(async () => null),
    confirmDeleteSheet: vi.fn(async () => true),
    chooseExportSheet: vi.fn(async () => null),
    confirmReplaceAllWorkbook: vi.fn(async () => true),
    confirmRangeMoveOverwrite: vi.fn(async () => true),
    promptMoveTarget: vi.fn(async () => null),
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

function rsfTab(state: AppState, rows: string[][]): Tab {
  const doc = RsfDocument.empty('book', rows.length, rows[0].length, 'Sheet1');
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      doc.setCell(r, c, rows[r][c]);
    }
  }
  return state.addTab('book.rsf', doc, null);
}

const rect = (top: number, left: number, bottom: number, right: number) => ({ top, left, bottom, right });

describe('range-move planner', () => {
  it('moves values and clears the vacated cells', () => {
    const doc = RsfDocument.empty('b', 4, 4, 'S');
    doc.setCell(0, 0, 'a');
    doc.setCell(0, 1, 'b');
    const plan = planRangeMove(doc.activeSheet, rect(0, 0, 0, 1), 2, 0);
    // Apply to a fresh copy of what the plan says.
    const after = new Map<string, string>();
    for (const ch of plan.changes) after.set(`${ch.row},${ch.col}`, ch.after ?? '');
    expect(after.get('2,0')).toBe('a');
    expect(after.get('2,1')).toBe('b');
    expect(after.get('0,0')).toBe('');
    expect(after.get('0,1')).toBe('');
    expect(plan.overwriteCount).toBe(0);
    expect(plan.movedCells).toBe(2);
  });

  it('keeps an internal formula relationship intact after the move', () => {
    const doc = RsfDocument.empty('b', 6, 3, 'S');
    doc.setCell(0, 0, '10');
    doc.setCell(1, 0, '=A1+5'); // references the cell above, inside the range
    const plan = planRangeMove(doc.activeSheet, rect(0, 0, 1, 0), 3, 1);
    const after = new Map(plan.changes.map((c) => [`${c.row},${c.col}`, c.after]));
    // The block moved to B4:B5; the formula's reference follows A1 to B4.
    expect(after.get('3,1')).toBe('10');
    expect(after.get('4,1')).toBe('=B4+5');
  });

  it('updates a formula elsewhere that referenced a moved cell', () => {
    const doc = RsfDocument.empty('b', 6, 4, 'S');
    doc.setCell(0, 0, '7');
    doc.setCell(5, 3, '=A1*2'); // outside the moved range
    const plan = planRangeMove(doc.activeSheet, rect(0, 0, 0, 0), 2, 1);
    const after = new Map(plan.changes.map((c) => [`${c.row},${c.col}`, c.after]));
    // A1 moved to B3, so the external reference is rewritten to B3.
    expect(after.get('5,3')).toBe('=B3*2');
  });

  it('preserves absolute markers when a reference follows the move', () => {
    const doc = RsfDocument.empty('b', 6, 4, 'S');
    doc.setCell(0, 0, '1');
    doc.setCell(4, 0, '=$A$1');
    const plan = planRangeMove(doc.activeSheet, rect(0, 0, 0, 0), 1, 1);
    const after = new Map(plan.changes.map((c) => [`${c.row},${c.col}`, c.after]));
    expect(after.get('4,0')).toBe('=$B$2');
  });

  it('rewrites a cross-sheet reference to a moved cell', () => {
    const wb = RsfDocument.empty('b', 4, 4, 'Data');
    wb.setCell(0, 0, '9');
    const data = wb.activeSheet;
    const calc = wb.createWorksheet('Calc');
    wb.insertSheetAt(1, calc);
    // A formula on Calc that references Data!A1.
    wb.setActiveSheetId(calc.id);
    wb.setCell(0, 0, '=Data!A1+1');
    wb.setActiveSheetId(data.id);
    const plan = planRangeMove(data, rect(0, 0, 0, 0), 1, 1, wb.sheets);
    const other = plan.otherSheetChanges.get(calc.id);
    expect(other?.[0].after).toBe('=Data!B2+1');
  });

  it('rejects an out-of-bounds destination and a no-op', () => {
    const doc = RsfDocument.empty('b', 3, 3, 'S');
    const src = rect(0, 0, 1, 1);
    expect(validateMove(doc.activeSheet, src, moveTarget(src, 0, 0))).toBe('no-op');
    expect(validateMove(doc.activeSheet, src, moveTarget(src, 5, 0))).toBe('out-of-bounds');
    expect(validateMove(doc.activeSheet, src, moveTarget(src, 1, 1))).toBeNull();
  });

  it('counts non-empty destination cells as overwrites', () => {
    const doc = RsfDocument.empty('b', 4, 4, 'S');
    doc.setCell(0, 0, 'x');
    doc.setCell(2, 0, 'keep');
    const plan = planRangeMove(doc.activeSheet, rect(0, 0, 0, 0), 2, 0);
    expect(plan.overwriteCount).toBe(1);
  });
});

describe('range-move command flow', () => {
  it('moves an empty destination without confirmation and is undoable', async () => {
    const state = new AppState();
    const confirm = vi.fn(async () => true);
    const ui = stubUi({ confirmRangeMoveOverwrite: confirm });
    const commands = new Commands(state, ui, document);
    const tab = rsfTab(state, [
      ['a', 'b', ''],
      ['', '', ''],
      ['', '', ''],
    ]);
    const ok = await commands.moveRange(tab, rect(0, 0, 0, 1), 2, 0);
    expect(ok).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(tab.doc.getValue(2, 0)).toBe('a');
    expect(tab.doc.getValue(0, 0)).toBe('');
    // Undo restores the original placement atomically.
    state.undo(tab);
    expect(tab.doc.getValue(0, 0)).toBe('a');
    expect(tab.doc.getValue(2, 0)).toBe('');
  });

  it('confirms before overwriting and cancels cleanly', async () => {
    const state = new AppState();
    const confirm = vi.fn(async () => false);
    const commands = new Commands(state, stubUi({ confirmRangeMoveOverwrite: confirm }), document);
    const tab = rsfTab(state, [
      ['a', ''],
      ['keep', ''],
    ]);
    const ok = await commands.moveRange(tab, rect(0, 0, 0, 0), 1, 0);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(ok).toBe(false);
    // Nothing changed.
    expect(tab.doc.getValue(0, 0)).toBe('a');
    expect(tab.doc.getValue(1, 0)).toBe('keep');
  });

  it('overwrites after the confirmation is accepted', async () => {
    const state = new AppState();
    const commands = new Commands(
      state,
      stubUi({ confirmRangeMoveOverwrite: vi.fn(async () => true) }),
      document,
    );
    const tab = rsfTab(state, [
      ['a', ''],
      ['old', ''],
    ]);
    const ok = await commands.moveRange(tab, rect(0, 0, 0, 0), 1, 0);
    expect(ok).toBe(true);
    expect(tab.doc.getValue(1, 0)).toBe('a');
    expect(tab.doc.getValue(0, 0)).toBe('');
  });

  it('refuses to move a range in a plain CSV document', async () => {
    const state = new AppState();
    const message = vi.fn(async () => undefined);
    const commands = new Commands(state, stubUi({ showMessage: message }), document);
    const csv = await import('./helpers');
    const tab = state.addTab('a.csv', csv.doc('a,b\n1,2\n'), null);
    state.setSelection(tab, { row: 0, col: 0 }, { row: 0, col: 1 });
    const ok = await commands.promptAndMoveRange(tab);
    expect(ok).toBe(false);
    expect(message).toHaveBeenCalled();
  });

  it('drives the keyboard-equivalent Move Selected Cells… command', async () => {
    const state = new AppState();
    const prompt = vi.fn(async () => 'A3');
    const commands = new Commands(state, stubUi({ promptMoveTarget: prompt }), document);
    const tab = rsfTab(state, [
      ['a', ''],
      ['', ''],
      ['', ''],
    ]);
    state.setSelection(tab, { row: 0, col: 0 }, null);
    const ok = await commands.promptAndMoveRange(tab);
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(ok).toBe(true);
    expect(tab.doc.getValue(2, 0)).toBe('a');
  });
});
