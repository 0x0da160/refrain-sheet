// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/app/app-state';
import { Commands, type UiPort } from '../src/app/commands';
import { ClipboardController } from '../src/app/clipboard-controller';
import { RCSV_COMPRESSION_LZ4 } from '../src/core/csv-engine';
import type { RcsvDocument } from '../src/core/rcsv-document';
import { serializeDocument } from '../src/core/serializer';
import { asCsv, doc, utf8 } from './helpers';

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
    explainRcsvSave: vi.fn(async () => true),
    chooseRcsvSave: vi.fn(async () => 2),
    chooseExportCsv: vi.fn(async () => ({
      encoding: 'utf-8' as const,
      bom: false,
      lineEnding: 'lf' as const,
    })),
    chooseInsertShift: vi.fn(async () => null),
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

function setup(csv = 'a,b,c\n1,2,3\n', ui: UiPort = stubUi()) {
  const state = new AppState();
  const commands = new Commands(state, ui, document);
  const tab = state.addTab('data.csv', doc(csv), null);
  return { state, commands, ui, tab };
}

async function converted(csv = 'a,b,c\n1,2,3\n', ui: UiPort = stubUi()) {
  const base = setup(csv, ui);
  const rcsv = await base.commands.ensureRcsv(base.tab, 'structure');
  expect(rcsv).not.toBeNull();
  return { ...base, rcsv: rcsv as RcsvDocument };
}

describe('explicit CSV -> RCSV conversion', () => {
  it('entering a formula offers conversion; accepting converts and evaluates', async () => {
    const ui = stubUi();
    const { commands, tab } = setup('1,2\n3,4\n', ui);
    await commands.commitCellEdit(tab, 1, 1, '=A1+B1');
    expect(ui.confirmConvert).toHaveBeenCalledWith('formula', 'data.csv');
    expect(tab.doc.kind).toBe('rcsv');
    expect(tab.name).toBe('data.rcsv');
    expect(tab.handle).toBeNull();
    expect(tab.doc.getValue(1, 1)).toBe('=A1+B1');
    expect(tab.doc.getDisplayValue(1, 1)).toBe('3');
  });

  it('declining keeps the text as a plain CSV value and stays byte-preserving', async () => {
    const ui = stubUi({ confirmConvert: vi.fn(async () => false) });
    const { commands, tab } = setup('1,2\n3,4\n', ui);
    await commands.commitCellEdit(tab, 1, 1, '=A1+B1');
    expect(tab.doc.kind).toBe('csv');
    expect(tab.doc.getValue(1, 1)).toBe('=A1+B1');
    expect(tab.doc.getDisplayValue(1, 1)).toBe('=A1+B1'); // literal, not evaluated
    const saved = serializeDocument(asCsv(tab.doc));
    expect(saved.ok).toBe(true);
    if (saved.ok) {
      expect(new TextDecoder().decode(saved.bytes)).toBe('1,2\n3,=A1+B1\n');
    }
  });

  it('plain CSV documents stay byte-identical before any spreadsheet-only operation', () => {
    const input = 'a,"b﻿",c\r\nmalformed,"x\n';
    const { tab } = setup(input);
    const result = serializeDocument(asCsv(tab.doc));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.mode).toBe('identity');
      expect(Array.from(result.bytes)).toEqual(Array.from(utf8(input)));
    }
  });

  it('conversion copies values, renames to .rcsv, drops the handle, and clears history', async () => {
    const ui = stubUi();
    const { state, commands, tab } = setup('a,b\n1,2\n', ui);
    state.editCell(tab, 0, 0, 'edited');
    const rcsv = await commands.ensureRcsv(tab, 'structure');
    expect(rcsv?.getValue(0, 0)).toBe('edited');
    expect(tab.name).toBe('data.rcsv');
    expect(tab.history.canUndo).toBe(false);
    // Converting an already-RCSV tab is a no-op.
    const again = await commands.ensureRcsv(tab, 'structure');
    expect(again).toBe(rcsv);
    expect(ui.confirmConvert).toHaveBeenCalledTimes(1);
  });
});

describe('range selection state', () => {
  it('tracks anchor + active cell as a normalized rectangle', () => {
    const { state, tab } = setup();
    state.setSelection(tab, { row: 1, col: 2 }, { row: 0, col: 0 });
    expect(state.selectedRange(tab)).toEqual({ top: 0, left: 0, bottom: 1, right: 2 });
    state.setSelection(tab, { row: 0, col: 1 }, null);
    expect(state.selectedRange(tab)).toEqual({ top: 0, left: 1, bottom: 0, right: 1 });
  });
});

describe('copy / paste', () => {
  it('copies the selected range as TSV of display values', async () => {
    const { state, commands, tab } = await converted('1,2\n3,4\n');
    state.editCell(tab, 1, 1, '=A1+B1');
    state.setSelection(tab, { row: 1, col: 1 }, { row: 0, col: 0 });
    const clip = new ClipboardController(state, commands, () => undefined);
    expect(clip.copyText()).toBe('1\t2\n3\t3');
  });

  it('pastes TSV into a CSV document within bounds as one undoable operation', async () => {
    const { state, commands, tab } = setup('a,b\nc,d\n');
    state.setSelection(tab, { row: 0, col: 0 }, null);
    const applied = await commands.applyPaste(
      tab,
      [
        ['X', 'Y'],
        ['Z', 'W'],
      ],
      null,
    );
    expect(applied).toBe(true);
    expect(tab.doc.getValue(1, 1)).toBe('W');
    // Selection now covers the pasted rectangle.
    expect(state.selectedRange(tab)).toEqual({ top: 0, left: 0, bottom: 1, right: 1 });
    state.undo(tab);
    expect(tab.doc.getValue(0, 0)).toBe('a');
    expect(tab.doc.getValue(1, 1)).toBe('d');
    expect(tab.doc.isDirty).toBe(false);
    state.redo(tab);
    expect(tab.doc.getValue(0, 0)).toBe('X');
  });

  it('out-of-bounds paste into CSV requires conversion; declining changes nothing', async () => {
    const ui = stubUi({ confirmConvert: vi.fn(async () => false) });
    const { state, commands, tab } = setup('a,b\n', ui);
    state.setSelection(tab, { row: 0, col: 1 }, null);
    const applied = await commands.applyPaste(tab, [['1', '2']], null);
    expect(applied).toBe(false);
    expect(ui.confirmConvert).toHaveBeenCalledWith('paste', 'data.csv');
    expect(tab.doc.kind).toBe('csv');
    expect(tab.doc.getValue(0, 1)).toBe('b');
  });

  it('accepted out-of-bounds paste converts and expands the sheet atomically', async () => {
    const { state, commands, tab } = setup('a,b\n');
    state.setSelection(tab, { row: 0, col: 1 }, null);
    const applied = await commands.applyPaste(
      tab,
      [
        ['1', '2'],
        ['3', '4'],
      ],
      null,
    );
    expect(applied).toBe(true);
    expect(tab.doc.kind).toBe('rcsv');
    expect(tab.doc.rowCount).toBe(2);
    expect(tab.doc.columnCount).toBe(3);
    expect(tab.doc.getValue(1, 2)).toBe('4');
    // Atomic undo removes both the values and the grown rows/columns.
    state.undo(tab);
    expect(tab.doc.rowCount).toBe(1);
    expect(tab.doc.columnCount).toBe(2);
    expect(tab.doc.getValue(0, 1)).toBe('b');
    state.redo(tab);
    expect(tab.doc.rowCount).toBe(2);
    expect(tab.doc.getValue(1, 2)).toBe('4');
  });

  it('internal paste preserves formulas and adjusts relative references', async () => {
    const { state, commands, tab } = await converted('1,2,\n3,4,\n');
    state.editCell(tab, 0, 2, '=A1+B1');
    state.setSelection(tab, { row: 0, col: 2 }, null);
    const clip = new ClipboardController(state, commands, () => undefined);
    const text = clip.copyText()!;
    state.setSelection(tab, { row: 1, col: 2 }, null);
    await clip.pasteText(text);
    expect(tab.doc.getValue(1, 2)).toBe('=A2+B2');
    expect(tab.doc.getDisplayValue(1, 2)).toBe('7');
  });

  it('external paste of the same-looking text pastes literally', async () => {
    const { state, commands, tab } = await converted('1,2,\n3,4,\n');
    state.setSelection(tab, { row: 1, col: 2 }, null);
    const clip = new ClipboardController(state, commands, () => undefined);
    await clip.pasteText('external');
    expect(tab.doc.getValue(1, 2)).toBe('external');
  });

  it('clears the selected range as one undoable operation', () => {
    const { state, commands, tab } = setup('a,b\nc,d\n');
    state.setSelection(tab, { row: 1, col: 1 }, { row: 0, col: 0 });
    expect(commands.clearRange(tab)).toBe(true);
    expect(tab.doc.getValue(0, 0)).toBe('');
    expect(tab.doc.getValue(1, 1)).toBe('');
    state.undo(tab);
    expect(tab.doc.getValue(0, 0)).toBe('a');
    expect(tab.doc.getValue(1, 1)).toBe('d');
  });
});

describe('row and column operations', () => {
  it('inserts rows above/below the selection and shifts formula references', async () => {
    const { state, tab } = await converted('1,\n2,\n=SUM(A1:A2),\n');
    state.editCell(tab, 2, 0, '=SUM(A1:A2)');
    state.setSelection(tab, { row: 1, col: 0 }, null);
    state.insertRows(tab, 1, 1);
    expect(tab.doc.rowCount).toBe(4);
    expect(tab.doc.getValue(1, 0)).toBe('');
    expect(tab.doc.getValue(3, 0)).toBe('=SUM(A1:A3)');
    expect(tab.doc.getDisplayValue(3, 0)).toBe('3');
    state.undo(tab);
    expect(tab.doc.rowCount).toBe(3);
    expect(tab.doc.getValue(2, 0)).toBe('=SUM(A1:A2)');
    state.redo(tab);
    expect(tab.doc.rowCount).toBe(4);
    expect(tab.doc.getValue(3, 0)).toBe('=SUM(A1:A3)');
  });

  it('deletes rows, clamps ranges, produces #REF!, and restores on undo', async () => {
    const { state, tab } = await converted('10,\n20,\n30,\n=SUM(A1:A3),\n=A2,\n');
    state.editCell(tab, 3, 0, '=SUM(A1:A3)');
    state.editCell(tab, 4, 0, '=A2');
    state.deleteRows(tab, 1, 1); // delete the "20" row
    expect(tab.doc.rowCount).toBe(4);
    expect(tab.doc.getValue(2, 0)).toBe('=SUM(A1:A2)');
    expect(tab.doc.getDisplayValue(2, 0)).toBe('40');
    expect(tab.doc.getValue(3, 0)).toBe('=#REF!');
    expect(tab.doc.getDisplayValue(3, 0)).toBe('#REF!');
    // One undo restores data and formulas exactly.
    state.undo(tab);
    expect(tab.doc.rowCount).toBe(5);
    expect(tab.doc.getValue(1, 0)).toBe('20');
    expect(tab.doc.getValue(3, 0)).toBe('=SUM(A1:A3)');
    expect(tab.doc.getValue(4, 0)).toBe('=A2');
    expect(tab.doc.getDisplayValue(3, 0)).toBe('60');
  });

  it('inserts and deletes columns with reference updates', async () => {
    const { state, tab } = await converted('1,2,=A1+B1\n');
    state.editCell(tab, 0, 2, '=A1+B1');
    state.insertCols(tab, 1, 1);
    expect(tab.doc.columnCount).toBe(4);
    expect(tab.doc.getValue(0, 3)).toBe('=A1+C1');
    expect(tab.doc.getDisplayValue(0, 3)).toBe('3');
    state.undo(tab);
    expect(tab.doc.columnCount).toBe(3);
    expect(tab.doc.getValue(0, 2)).toBe('=A1+B1');
    state.deleteCols(tab, 1, 1);
    expect(tab.doc.columnCount).toBe(2);
    expect(tab.doc.getValue(0, 1)).toBe('=A1+#REF!');
    expect(tab.doc.getDisplayValue(0, 1)).toBe('#REF!');
    state.undo(tab);
    expect(tab.doc.getValue(0, 2)).toBe('=A1+B1');
  });

  it('confirms before deleting non-empty rows through the command', async () => {
    const ui = stubUi({ confirm: vi.fn(async () => false) });
    const { state, commands, tab } = await converted('a,b\nc,d\n', ui);
    state.setSelection(tab, { row: 0, col: 0 }, null);
    await commands.run('sheet.deleteRows');
    expect(ui.confirm).toHaveBeenCalled();
    expect(tab.doc.rowCount).toBe(2); // declined
  });

  it('refuses to delete every row', async () => {
    const ui = stubUi();
    const { state, commands, tab } = await converted('a\nb\n', ui);
    state.setSelection(tab, { row: 1, col: 0 }, { row: 0, col: 0 });
    await commands.run('sheet.deleteRows');
    expect(tab.doc.rowCount).toBe(2);
    expect(ui.notify).toHaveBeenCalled();
  });

  it('structural commands on a CSV tab require conversion first', async () => {
    const ui = stubUi({ confirmConvert: vi.fn(async () => false) });
    const { state, commands, tab } = setup('a,b\nc,d\n', ui);
    state.setSelection(tab, { row: 0, col: 0 }, null);
    await commands.run('sheet.insertRowBelow');
    expect(ui.confirmConvert).toHaveBeenCalledWith('structure', 'data.csv');
    expect(tab.doc.kind).toBe('csv');
    expect(tab.doc.rowCount).toBe(2);
  });
});

describe('saving and exporting RCSV', () => {
  function interceptDownloads(): void {
    URL.createObjectURL = vi.fn(() => 'blob:fake') as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {});
  }

  it('explains the .rcsv format once, saves JSON, and clears the dirty state', async () => {
    interceptDownloads();
    const ui = stubUi();
    const { state, commands, tab } = await converted('a,b\n1,2\n', ui);
    state.editCell(tab, 0, 0, '=B2*2');
    expect(tab.doc.isDirty).toBe(true);
    const ok = await commands.save(tab, { encoding: 'keep', bom: 'keep', lineEnding: 'keep' });
    expect(ok).toBe(true);
    expect(ui.explainRcsvSave).toHaveBeenCalledTimes(1);
    expect(tab.doc.isDirty).toBe(false);
    // Second save skips the explanation.
    state.editCell(tab, 0, 1, 'x');
    await commands.save(tab, { encoding: 'keep', bom: 'keep', lineEnding: 'keep' });
    expect(ui.explainRcsvSave).toHaveBeenCalledTimes(1);
  });

  it('cancelling the .rcsv explanation cancels the save', async () => {
    const ui = stubUi({ explainRcsvSave: vi.fn(async () => false) });
    const { state, commands, tab } = await converted('a\n', ui);
    state.editCell(tab, 0, 0, 'x');
    const ok = await commands.save(tab, { encoding: 'keep', bom: 'keep', lineEnding: 'keep' });
    expect(ok).toBe(false);
    expect(tab.doc.isDirty).toBe(true);
  });

  it('CSV export requires explicit confirmation and never runs when cancelled', async () => {
    const ui = stubUi({ chooseExportCsv: vi.fn(async () => null) });
    const { commands, tab } = await converted('1,2\n', ui);
    const ok = await commands.exportCsv(tab);
    expect(ok).toBe(false);
    expect(ui.chooseExportCsv).toHaveBeenCalledWith('data.rcsv');
  });

  it('confirmed CSV export downloads calculated values', async () => {
    let captured: Blob | null = null;
    URL.createObjectURL = vi.fn((b: Blob) => {
      captured = b;
      return 'blob:fake';
    }) as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {});
    try {
      const ui = stubUi();
      const { state, commands, tab } = await converted('1,2\n', ui);
      state.editCell(tab, 0, 1, '=A1*10');
      const ok = await commands.exportCsv(tab);
      expect(ok).toBe(true);
      expect(captured).not.toBeNull();
      const text = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(captured as unknown as Blob);
      });
      expect(text).toBe('1,10\n');
      // The RCSV document itself is untouched (still holds the formula).
      expect(tab.doc.getValue(0, 1)).toBe('=A1*10');
    } finally {
      clickSpy.mockRestore();
    }
  });

  it('reopen/convert are disabled for RCSV; save-with-options opens the compression dialog', async () => {
    const { commands } = await converted('a\n');
    // Save with Options is the RCSV compression dialog, so it stays enabled.
    expect(commands.isEnabled('file.saveOptions')).toBe(true);
    expect(commands.isEnabled('file.reopen')).toBe(false);
    expect(commands.isEnabled('sheet.exportCsv')).toBe(true);
    expect(commands.isEnabled('sheet.convert')).toBe(false);
  });

  it('the RCSV Save dialog applies the chosen compression method', async () => {
    const ui = stubUi({ chooseRcsvSave: vi.fn(async () => RCSV_COMPRESSION_LZ4) });
    const { commands, tab } = await converted('a\n', ui);
    await commands.run('file.saveOptions');
    expect(ui.chooseRcsvSave).toHaveBeenCalledTimes(1);
    expect(tab.doc.kind).toBe('rcsv');
    if (tab.doc.kind === 'rcsv') {
      expect(tab.doc.compression).toBe(RCSV_COMPRESSION_LZ4);
    }
  });

  it('cancelling the RCSV Save dialog leaves the method unchanged', async () => {
    const ui = stubUi({ chooseRcsvSave: vi.fn(async () => null) });
    const { commands, tab } = await converted('a\n', ui);
    await commands.run('file.saveOptions');
    expect(ui.chooseRcsvSave).toHaveBeenCalledTimes(1);
    if (tab.doc.kind === 'rcsv') {
      // Never explicitly set → still the codec default (undefined marker).
      expect(tab.doc.compression).toBeUndefined();
    }
  });
});

describe('find/replace on RCSV documents', () => {
  it('replace-all edits raw inputs atomically', async () => {
    const { state, commands, tab } = await converted('cat,dog\ncat,cat\n');
    const { compileQuery } = await import('../src/core/search');
    const result = await commands.replaceAll(
      compileQuery({ text: 'cat', matchCase: false, regex: false }),
      'cow',
    );
    expect(result.count).toBe(3);
    expect(tab.doc.getValue(0, 0)).toBe('cow');
    state.undo(tab);
    expect(tab.doc.getValue(0, 0)).toBe('cat');
  });
});

describe('fill down and fill handle', () => {
  it('fills the top row down, adjusting relative formula references', async () => {
    const { state, commands, tab } = await converted('10,=A1\n0,0\n0,0\n');
    state.setSelection(tab, { row: 0, col: 1 }, { row: 2, col: 1 });
    const applied = await commands.fillDown(tab);
    expect(applied).toBe(true);
    expect(tab.doc.getValue(1, 1)).toBe('=A2');
    expect(tab.doc.getValue(2, 1)).toBe('=A3');
    // One undo reverses the whole fill.
    state.undo(tab);
    expect(tab.doc.getValue(1, 1)).toBe('0');
    expect(tab.doc.getValue(2, 1)).toBe('0');
  });

  it('requires explicit RCSV conversion before filling a plain CSV', async () => {
    const ui = stubUi();
    const { state, commands, tab } = setup('1,2\n3,4\n', ui);
    state.setSelection(tab, { row: 0, col: 0 }, { row: 1, col: 0 });
    const applied = await commands.fillDown(tab);
    expect(ui.confirmConvert).toHaveBeenCalledWith('fill', 'data.csv');
    expect(applied).toBe(true);
    expect(tab.doc.kind).toBe('rcsv');
    expect(tab.doc.getValue(1, 0)).toBe('1'); // the top cell filled down
  });

  it('declining conversion leaves the CSV untouched', async () => {
    const ui = stubUi({ confirmConvert: vi.fn(async () => false) });
    const { state, commands, tab } = setup('1\n2\n', ui);
    state.setSelection(tab, { row: 0, col: 0 }, { row: 1, col: 0 });
    expect(await commands.fillDown(tab)).toBe(false);
    expect(tab.doc.kind).toBe('csv');
    expect(tab.doc.getValue(1, 0)).toBe('2');
  });

  it('does nothing when only one row is selected', async () => {
    const { state, commands, tab } = await converted('1,2\n');
    state.setSelection(tab, { row: 0, col: 0 }, { row: 0, col: 1 });
    expect(await commands.fillDown(tab)).toBe(false);
  });

  it('a fill-handle drag can grow the grid, and undo removes the growth atomically', async () => {
    const { state, commands, tab } = await converted('7\n');
    expect(tab.doc.rowCount).toBe(1);
    const applied = await commands.applyFill(
      tab,
      { top: 0, bottom: 0, left: 0, right: 0 },
      { top: 0, bottom: 2, left: 0, right: 0 },
    );
    expect(applied).toBe(true);
    expect(tab.doc.rowCount).toBe(3);
    expect(tab.doc.getValue(2, 0)).toBe('7');
    state.undo(tab);
    expect(tab.doc.rowCount).toBe(1);
  });
});
