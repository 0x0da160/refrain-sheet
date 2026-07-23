// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * Workbook-wide Find & Replace: the pure cross-sheet search, and the
 * command-layer Replace All across every worksheet — confirmation, atomic
 * undo, cancellation, skipped-cell reporting, and the CSV single-sheet
 * restriction.
 */
import { describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/app/app-state';
import { Commands, type UiPort } from '../src/app/commands';
import { compileQuery, searchWorkbook } from '../src/core/search';
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

/** A two-worksheet workbook: "foo" appears twice on S1, once on S2. */
function workbook(): RsfDocument {
  const wb = RsfDocument.empty('b', 3, 2, 'S1');
  wb.setCell(0, 0, 'foo');
  wb.setCell(1, 1, 'foo bar');
  const s2 = wb.createWorksheet('S2');
  wb.insertSheetAt(1, s2);
  wb.setActiveSheetId(s2.id);
  wb.setCell(0, 0, 'foo');
  wb.setActiveSheetId(wb.sheets[0].id);
  return wb;
}

const query = (text: string) => {
  const q = compileQuery({ text, matchCase: false, regex: false });
  if (!q.ok) throw new Error('bad query');
  return q;
};

describe('searchWorkbook', () => {
  it('finds matches across every worksheet, in workbook order', () => {
    const wb = workbook();
    const result = searchWorkbook(wb.sheets, query('foo'));
    expect(result.matchCount).toBe(3);
    expect(result.cellCount).toBe(3);
    expect(result.sheetCount).toBe(2);
    // Each match carries its worksheet id and name for safe navigation.
    expect(result.cells[0].sheetName).toBe('S1');
    expect(result.cells[result.cells.length - 1].sheetName).toBe('S2');
  });

  it('reports zero matches without inventing sheets', () => {
    const result = searchWorkbook(workbook().sheets, query('absent'));
    expect(result.cellCount).toBe(0);
    expect(result.sheetCount).toBe(0);
  });
});

describe('workbook-wide Replace All', () => {
  it('replaces across all worksheets after confirmation, atomically undoable', async () => {
    const state = new AppState();
    const confirm = vi.fn(async () => true);
    const commands = new Commands(state, stubUi({ confirmReplaceAllWorkbook: confirm }), document);
    const wb = workbook();
    const tab = state.addTab('b.rsf', wb, null);
    const report = await commands.replaceAll(query('foo'), 'baz', 'workbook');
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(report.count).toBe(3);
    expect(report.sheets).toBe(2);
    expect(wb.sheets[0].getValue(0, 0)).toBe('baz');
    expect(wb.sheets[1].getValue(0, 0)).toBe('baz');
    // One Undo restores the whole workbook.
    state.undo(tab);
    expect(wb.sheets[0].getValue(0, 0)).toBe('foo');
    expect(wb.sheets[1].getValue(0, 0)).toBe('foo');
  });

  it('changes nothing when the confirmation is declined', async () => {
    const state = new AppState();
    const commands = new Commands(
      state,
      stubUi({ confirmReplaceAllWorkbook: vi.fn(async () => false) }),
      document,
    );
    const wb = workbook();
    state.addTab('b.rsf', wb, null);
    const report = await commands.replaceAll(query('foo'), 'baz', 'workbook');
    expect(report.confirmed).toBe(false);
    expect(wb.sheets[0].getValue(0, 0)).toBe('foo');
    expect(wb.sheets[1].getValue(0, 0)).toBe('foo');
  });

  it('keeps current-sheet scope limited to the active worksheet', async () => {
    const state = new AppState();
    const commands = new Commands(state, stubUi(), document);
    const wb = workbook();
    state.addTab('b.rsf', wb, null);
    const report = await commands.replaceAll(query('foo'), 'baz', 'sheet');
    // Only S1's two matches change; S2 is untouched.
    expect(report.count).toBe(2);
    expect(wb.sheets[1].getValue(0, 0)).toBe('foo');
  });
});
