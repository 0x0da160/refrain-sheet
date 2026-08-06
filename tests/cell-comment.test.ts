// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * Cell comments: the pure normalization helper, `Worksheet` storage and
 * structural-edit reindexing, and the command-level flow — dialog
 * apply/clear, CSV-mode restriction, and non-undoable/non-dirty session-only
 * behavior. Mirrors `data-validation.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/app/app-state';
import { Commands, type CellCommentDialogResult, type UiPort } from '../src/app/commands';
import { MAX_COMMENT_LENGTH, normalizeCommentText } from '../src/core/cell-comment';
import { RsfDocument } from '../src/core/rsf-document';
import { Worksheet } from '../src/core/worksheet';
import { doc as csvDoc } from './helpers';

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
    confirmExportXlsx: vi.fn(async () => true),
    chooseInsertShift: vi.fn(async () => 'down' as const),
    confirmFlashFill: vi.fn(async () => true),
    chooseFilter: vi.fn(async () => null),
    chooseSort: vi.fn(async () => null),
    chooseDataValidation: vi.fn(async () => null),
    chooseConditionalFormat: vi.fn(async () => null),
    chooseCellComment: vi.fn(async () => null),
    promptSheetName: vi.fn(async () => null),
    confirmDeleteSheet: vi.fn(async () => true),
    chooseExportSheet: vi.fn(async () => null),
    confirmReplaceAllWorkbook: vi.fn(async () => true),
    confirmRangeMoveOverwrite: vi.fn(async () => true),
    promptMoveTarget: vi.fn(async () => null),
    promptGoToCell: vi.fn(async () => null),
    confirm: vi.fn(async () => true),
    showMessage: vi.fn(async () => undefined),
    notify: vi.fn(),
    openFindBar: vi.fn(),
    findNext: vi.fn(),
    showAbout: vi.fn(),
    showFormulaHelp: vi.fn(),
    showSqlQuery: vi.fn(async () => undefined),
    showDiff: vi.fn(async () => undefined),
    chooseSettings: vi.fn(async () => null),
    chooseTimezone: vi.fn(async () => null),
    chooseDisplayLanguage: vi.fn(async () => null),
    chooseTextColor: vi.fn(async () => null),
    chooseBackgroundColor: vi.fn(async () => null),
    chooseBorders: vi.fn(async () => null),
    chooseNumberFormat: vi.fn(async () => null),
    setBusy: vi.fn(),
    ...overrides,
  };
}

function sheet(values: string[][], ui: UiPort = stubUi()) {
  const state = new AppState();
  const commands = new Commands(state, ui, document);
  const doc = RsfDocument.empty('t.rsf', values.length, values[0].length);
  for (let r = 0; r < values.length; r++) {
    for (let c = 0; c < values[r].length; c++) {
      doc.setCell(r, c, values[r][c]);
    }
  }
  doc.markSaved();
  const tab = state.addTab('t.rsf', doc, null);
  return { state, commands, tab, doc, ui };
}

describe('normalizeCommentText', () => {
  it('trims surrounding whitespace', () => {
    expect(normalizeCommentText('  hello  ')).toBe('hello');
  });

  it('returns null for blank (or whitespace-only) input', () => {
    expect(normalizeCommentText('')).toBeNull();
    expect(normalizeCommentText('   \n\t ')).toBeNull();
  });

  it('caps length at MAX_COMMENT_LENGTH', () => {
    const long = 'x'.repeat(MAX_COMMENT_LENGTH + 50);
    const normalized = normalizeCommentText(long);
    expect(normalized).not.toBeNull();
    expect(normalized?.length).toBe(MAX_COMMENT_LENGTH);
  });
});

describe('Worksheet cell comments', () => {
  it('getComment/setComment/collectComments/commentedCellCount round-trip', () => {
    const ws = Worksheet.empty('s1', 'Sheet1', 5, 5);
    expect(ws.getComment(1, 1)).toBeNull();
    expect(ws.setComment(1, 1, 'note')).toBe(true);
    expect(ws.getComment(1, 1)).toBe('note');
    expect(ws.commentedCellCount).toBe(1);
    expect(ws.collectComments()).toEqual([[1, 1, 'note']]);
    // Setting an equal comment is a no-op change.
    expect(ws.setComment(1, 1, 'note')).toBe(false);
    // Clearing removes the entry entirely.
    expect(ws.setComment(1, 1, null)).toBe(true);
    expect(ws.getComment(1, 1)).toBeNull();
    expect(ws.commentedCellCount).toBe(0);
    expect(ws.collectComments()).toEqual([]);
  });

  it('setComment on an out-of-bounds cell is a no-op', () => {
    const ws = Worksheet.empty('s1', 'Sheet1', 2, 2);
    expect(ws.setComment(99, 99, 'note')).toBe(false);
    expect(ws.commentedCellCount).toBe(0);
  });

  it('clone copies every comment independently of the original', () => {
    const ws = Worksheet.empty('s1', 'Sheet1', 3, 3);
    ws.setComment(0, 0, 'original');
    const copy = ws.clone('s2', 'Sheet2');
    expect(copy.getComment(0, 0)).toBe('original');
    copy.setComment(0, 0, 'changed');
    expect(ws.getComment(0, 0)).toBe('original'); // original untouched
  });

  it('inserting rows shifts commented cells below the insertion point (not dropped)', () => {
    const ws = Worksheet.empty('s1', 'Sheet1', 5, 2);
    ws.setComment(0, 0, 'above');
    ws.setComment(3, 0, 'below');
    ws.insertRows(1, [
      ['', ''],
      ['', ''],
    ]);
    expect(ws.getComment(0, 0)).toBe('above'); // above insertion: unmoved
    expect(ws.getComment(5, 0)).toBe('below'); // at/below: shifted down by 2
    expect(ws.getComment(3, 0)).toBeNull();
  });

  it('deleting rows drops comments on removed rows and shifts the rest up', () => {
    const ws = Worksheet.empty('s1', 'Sheet1', 5, 2);
    ws.setComment(1, 0, 'removed');
    ws.setComment(4, 0, 'shifted');
    ws.deleteRows(1, 2);
    expect(ws.getComment(1, 0)).toBeNull();
    expect(ws.getComment(2, 0)).toBe('shifted');
    expect(ws.commentedCellCount).toBe(1);
  });

  it('inserting/deleting columns reindexes commented cells the same way', () => {
    const ws = Worksheet.empty('s1', 'Sheet1', 2, 5);
    ws.setComment(0, 3, 'note');
    ws.insertCols(1, [
      ['', ''],
      ['', ''],
    ]);
    expect(ws.getComment(0, 5)).toBe('note');
    ws.deleteCols(0, 1);
    expect(ws.getComment(0, 4)).toBe('note');
  });

  it('copyRowInto (row duplication) carries the row comment along with its values', () => {
    const ws = Worksheet.empty('s1', 'Sheet1', 3, 2);
    ws.setComment(0, 0, 'note');
    const shell = ws.cloneShell('s2', 'Sheet2');
    ws.copyRowInto(0, shell);
    expect(shell.getComment(0, 0)).toBe('note');
  });
});

describe('cell comment command flow', () => {
  it('applies via the dialog route to the active cell and reports it', async () => {
    const applied: CellCommentDialogResult = { action: 'apply', text: 'Great result!' };
    const ui = stubUi({ chooseCellComment: vi.fn(async () => applied) });
    const { state, commands, tab, doc } = sheet([['', '']], ui);
    state.setSelection(tab, { row: 0, col: 0 }, null);
    const ok = await commands.commentDialog(tab);
    expect(ok).toBe(true);
    expect(ui.chooseCellComment).toHaveBeenCalled();
    expect(doc.getComment(0, 0)).toBe('Great result!');
    expect(ui.notify).toHaveBeenCalled();
    expect(commands.commentAt(tab, 0, 0)).toBe('Great result!');
    expect(commands.commentAt(tab, 0, 1)).toBeNull(); // untouched cell
  });

  it('applying blank/whitespace-only text clears the comment instead of storing it', async () => {
    const { state, tab, doc } = sheet([['']]);
    expect(state.setComment(tab, 0, 0, 'note')).toBe(true);
    const blank: CellCommentDialogResult = { action: 'apply', text: '   ' };
    const ui = stubUi({ chooseCellComment: vi.fn(async () => blank) });
    const commands = new Commands(state, ui, document);
    state.setSelection(tab, { row: 0, col: 0 }, null);
    const ok = await commands.commentDialog(tab);
    expect(ok).toBe(true);
    expect(doc.getComment(0, 0)).toBeNull();
  });

  it('CSV documents refuse to open the dialog with a localized explanation', async () => {
    const ui = stubUi();
    const state = new AppState();
    const commands = new Commands(state, ui, document);
    const tab = state.addTab('t.csv', csvDoc('a,b\n1,2\n'), null);
    state.setSelection(tab, { row: 0, col: 0 }, null);
    const result = await commands.commentDialog(tab);
    expect(result).toBe(false);
    expect(ui.showMessage).toHaveBeenCalled();
    expect(ui.chooseCellComment).not.toHaveBeenCalled();
  });

  it('clearing removes the comment on the active cell and notifies', async () => {
    const { state, tab, doc } = sheet([['']]);
    expect(state.setComment(tab, 0, 0, 'note')).toBe(true);
    const cleared: CellCommentDialogResult = { action: 'clear' };
    const ui = stubUi({ chooseCellComment: vi.fn(async () => cleared) });
    const commands = new Commands(state, ui, document);
    state.setSelection(tab, { row: 0, col: 0 }, null);
    const ok = await commands.commentDialog(tab);
    expect(ok).toBe(true);
    expect(doc.getComment(0, 0)).toBeNull();
    expect(ui.notify).toHaveBeenCalled();
  });

  it('cancelling the dialog (null result) leaves the comment untouched', async () => {
    const { state, tab, doc } = sheet([['']]);
    expect(state.setComment(tab, 0, 0, 'note')).toBe(true);
    const ui = stubUi({ chooseCellComment: vi.fn(async () => null) });
    const commands = new Commands(state, ui, document);
    state.setSelection(tab, { row: 0, col: 0 }, null);
    const ok = await commands.commentDialog(tab);
    expect(ok).toBe(false);
    expect(doc.getComment(0, 0)).toBe('note');
  });

  it('is session-only view state: not undoable and does not mark the document dirty', () => {
    const { state, tab, doc } = sheet([['']]);
    expect(doc.isDirty).toBe(false);
    expect(state.setComment(tab, 0, 0, 'note')).toBe(true);
    expect(doc.isDirty).toBe(false);
    expect(tab.history.canUndo).toBe(false);
    state.undo(tab); // no-op: nothing to undo
    expect(doc.getComment(0, 0)).toBe('note'); // survives, since it was never history-tracked
  });

  it('never affects the cell value, formula evaluation, or CSV export path', () => {
    const { state, tab, doc } = sheet([['42']]);
    expect(state.setComment(tab, 0, 0, 'a note')).toBe(true);
    expect(doc.getValue(0, 0)).toBe('42');
    expect(doc.getDisplayValue(0, 0)).toBe('42');
  });
});
