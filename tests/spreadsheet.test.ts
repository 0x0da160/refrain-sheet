// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/app/app-state';
import { Commands, type UiPort } from '../src/app/commands';
import { ClipboardController } from '../src/app/clipboard-controller';
import { RSF_COMPRESSION_LZ4 } from '../src/core/csv-engine';
import type { RsfDocument } from '../src/core/rsf-document';
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
    explainRsfSave: vi.fn(async () => true),
    chooseRsfSave: vi.fn(async () => 2),
    chooseExportCsv: vi.fn(async () => ({
      encoding: 'utf-8' as const,
      bom: false,
      lineEnding: 'lf' as const,
    })),
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

function setup(csv = 'a,b,c\n1,2,3\n', ui: UiPort = stubUi()) {
  const state = new AppState();
  const commands = new Commands(state, ui, document);
  const tab = state.addTab('data.csv', doc(csv), null);
  return { state, commands, ui, tab };
}

async function converted(csv = 'a,b,c\n1,2,3\n', ui: UiPort = stubUi()) {
  const base = setup(csv, ui);
  const rcsv = await base.commands.ensureRsf(base.tab, 'structure');
  expect(rcsv).not.toBeNull();
  return { ...base, rcsv: rcsv as RsfDocument };
}

describe('explicit CSV -> RSF conversion', () => {
  it('entering a formula offers conversion; accepting converts and evaluates', async () => {
    const ui = stubUi();
    const { commands, tab } = setup('1,2\n3,4\n', ui);
    await commands.commitCellEdit(tab, 1, 1, '=A1+B1');
    expect(ui.confirmConvert).toHaveBeenCalledWith('formula', 'data.csv');
    expect(tab.doc.kind).toBe('rsf');
    expect(tab.name).toBe('data.rsf');
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

  it('conversion copies values, renames to .rsf, drops the handle, and clears history', async () => {
    const ui = stubUi();
    const { state, commands, tab } = setup('a,b\n1,2\n', ui);
    state.editCell(tab, 0, 0, 'edited');
    const rcsv = await commands.ensureRsf(tab, 'structure');
    expect(rcsv?.getValue(0, 0)).toBe('edited');
    expect(tab.name).toBe('data.rsf');
    expect(tab.history.canUndo).toBe(false);
    // Converting an already-RSF tab is a no-op.
    const again = await commands.ensureRsf(tab, 'structure');
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
    expect(tab.doc.kind).toBe('rsf');
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

  it('disables row insert/delete while a whole column is selected', async () => {
    const { state, commands, tab } = await converted('a,b\nc,d\n');
    state.setSelection(tab, { row: 1, col: 0 }, { row: 0, col: 0 }, 'col');
    expect(commands.isEnabled('sheet.insertRowAbove')).toBe(false);
    expect(commands.isEnabled('sheet.insertRowBelow')).toBe(false);
    expect(commands.isEnabled('sheet.deleteRows')).toBe(false);
    // Column operations stay meaningful for a column selection.
    expect(commands.isEnabled('sheet.insertColLeft')).toBe(true);
    expect(commands.isEnabled('sheet.insertColRight')).toBe(true);
    expect(commands.isEnabled('sheet.deleteCols')).toBe(true);
  });

  it('disables column insert/delete while a whole row is selected', async () => {
    const { state, commands, tab } = await converted('a,b\nc,d\n');
    state.setSelection(tab, { row: 0, col: 1 }, { row: 0, col: 0 }, 'row');
    expect(commands.isEnabled('sheet.insertColLeft')).toBe(false);
    expect(commands.isEnabled('sheet.insertColRight')).toBe(false);
    expect(commands.isEnabled('sheet.deleteCols')).toBe(false);
    // Row operations stay meaningful for a row selection.
    expect(commands.isEnabled('sheet.insertRowAbove')).toBe(true);
    expect(commands.isEnabled('sheet.insertRowBelow')).toBe(true);
    expect(commands.isEnabled('sheet.deleteRows')).toBe(true);
  });

  it('re-enables both axes once a plain cell/range is selected again', async () => {
    const { state, commands, tab } = await converted('a,b\nc,d\n');
    state.setSelection(tab, { row: 1, col: 0 }, { row: 0, col: 0 }, 'col');
    expect(commands.isEnabled('sheet.insertRowAbove')).toBe(false);
    state.setSelection(tab, { row: 0, col: 0 }, null);
    expect(commands.isEnabled('sheet.insertRowAbove')).toBe(true);
    expect(commands.isEnabled('sheet.insertColLeft')).toBe(true);
  });
});

describe('saving and exporting RSF', () => {
  function interceptDownloads(): void {
    URL.createObjectURL = vi.fn(() => 'blob:fake') as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {});
  }

  it('explains the .rsf format once, saves JSON, and clears the dirty state', async () => {
    interceptDownloads();
    const ui = stubUi();
    const { state, commands, tab } = await converted('a,b\n1,2\n', ui);
    state.editCell(tab, 0, 0, '=B2*2');
    expect(tab.doc.isDirty).toBe(true);
    const ok = await commands.save(tab, { encoding: 'keep', bom: 'keep', lineEnding: 'keep' });
    expect(ok).toBe(true);
    expect(ui.explainRsfSave).toHaveBeenCalledTimes(1);
    expect(tab.doc.isDirty).toBe(false);
    // Second save skips the explanation.
    state.editCell(tab, 0, 1, 'x');
    await commands.save(tab, { encoding: 'keep', bom: 'keep', lineEnding: 'keep' });
    expect(ui.explainRsfSave).toHaveBeenCalledTimes(1);
  });

  it('cancelling the .rsf explanation cancels the save', async () => {
    const ui = stubUi({ explainRsfSave: vi.fn(async () => false) });
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
    expect(ui.chooseExportCsv).toHaveBeenCalledWith('data.rsf');
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
      // The RSF document itself is untouched (still holds the formula).
      expect(tab.doc.getValue(0, 1)).toBe('=A1*10');
    } finally {
      clickSpy.mockRestore();
    }
  });

  it('reopen/convert are disabled for RSF; save-with-options opens the compression dialog', async () => {
    const { commands } = await converted('a\n');
    // Save with Options is the RSF compression dialog, so it stays enabled.
    expect(commands.isEnabled('file.saveOptions')).toBe(true);
    expect(commands.isEnabled('file.reopen')).toBe(false);
    expect(commands.isEnabled('sheet.exportCsv')).toBe(true);
    expect(commands.isEnabled('sheet.convert')).toBe(false);
  });

  it('the RSF Save dialog applies the chosen compression method', async () => {
    const ui = stubUi({ chooseRsfSave: vi.fn(async () => RSF_COMPRESSION_LZ4) });
    const { commands, tab } = await converted('a\n', ui);
    await commands.run('file.saveOptions');
    expect(ui.chooseRsfSave).toHaveBeenCalledTimes(1);
    expect(tab.doc.kind).toBe('rsf');
    if (tab.doc.kind === 'rsf') {
      expect(tab.doc.compression).toBe(RSF_COMPRESSION_LZ4);
    }
  });

  it('cancelling the RSF Save dialog leaves the method unchanged', async () => {
    const ui = stubUi({ chooseRsfSave: vi.fn(async () => null) });
    const { commands, tab } = await converted('a\n', ui);
    await commands.run('file.saveOptions');
    expect(ui.chooseRsfSave).toHaveBeenCalledTimes(1);
    if (tab.doc.kind === 'rsf') {
      // Never explicitly set → still the codec default (undefined marker).
      expect(tab.doc.compression).toBeUndefined();
    }
  });

  // ----- File System Access save picker ordering -----
  //
  // showSaveFilePicker() must run inside the user gesture, before the async
  // .rsf explanation and compression. These tests install a fake
  // showSaveFilePicker and assert the ordering and cancellation semantics.

  type WritableSink = { bytes: Uint8Array | null; closed: boolean };

  function fakeSaveHandle(sink: WritableSink): FileSystemFileHandle {
    return {
      createWritable: vi.fn(async () => ({
        write: vi.fn(async (data: Uint8Array) => {
          sink.bytes = data.slice();
        }),
        close: vi.fn(async () => {
          sink.closed = true;
        }),
      })),
    } as unknown as FileSystemFileHandle;
  }

  function withSavePicker(picker: unknown): () => void {
    const g = globalThis as { showSaveFilePicker?: unknown };
    const had = 'showSaveFilePicker' in g;
    const prev = g.showSaveFilePicker;
    g.showSaveFilePicker = picker;
    return () => {
      if (had) g.showSaveFilePicker = prev;
      else delete g.showSaveFilePicker;
    };
  }

  const KEEP = { encoding: 'keep', bom: 'keep', lineEnding: 'keep' } as const;

  it('a new RSF save opens the picker synchronously — before any encoding', async () => {
    const sink: WritableSink = { bytes: null, closed: false };
    const handle = fakeSaveHandle(sink);
    let resolvePicker!: (h: FileSystemFileHandle) => void;
    const picker = vi.fn(() => new Promise<FileSystemFileHandle>((resolve) => (resolvePicker = resolve)));
    const restore = withSavePicker(picker);
    try {
      const { commands, tab } = await converted('a,b\n1,2\n');
      expect(tab.handle).toBeNull();
      // Start the save but do NOT await it yet.
      const pending = commands.save(tab, KEEP);
      // The picker must already have been called synchronously, and nothing
      // may have been encoded or written yet (no async boundary crossed).
      expect(picker).toHaveBeenCalledTimes(1);
      expect(sink.bytes).toBeNull();
      // Now let the picker resolve; the rest of the save runs afterwards.
      resolvePicker(handle);
      expect(await pending).toBe(true);
      expect(sink.bytes).not.toBeNull();
      expect(sink.closed).toBe(true);
    } finally {
      restore();
    }
  });

  it('a successful picker result is retained and used to write the bytes', async () => {
    const sink: WritableSink = { bytes: null, closed: false };
    const handle = fakeSaveHandle(sink);
    const picker = vi.fn(async () => handle);
    const restore = withSavePicker(picker);
    try {
      const ui = stubUi();
      const { commands, tab } = await converted('a,b\n1,2\n', ui);
      const ok = await commands.save(tab, KEEP);
      expect(ok).toBe(true);
      expect(handle.createWritable).toHaveBeenCalledTimes(1);
      expect(sink.bytes).not.toBeNull();
      // The handle is retained so subsequent saves overwrite without a picker.
      expect(tab.handle).toBe(handle);
      expect(ui.notify).toHaveBeenCalledWith(expect.stringContaining('overwritten'), 'info');
    } finally {
      restore();
    }
  });

  it('cancelling the picker leaves the document dirty and unassociated', async () => {
    const picker = vi.fn(async () => {
      throw new DOMException('User cancelled', 'AbortError');
    });
    const restore = withSavePicker(picker);
    try {
      const ui = stubUi();
      const { state, commands, tab } = await converted('a\n', ui);
      state.editCell(tab, 0, 0, 'x');
      expect(tab.doc.isDirty).toBe(true);
      const ok = await commands.save(tab, KEEP);
      expect(ok).toBe(false);
      expect(picker).toHaveBeenCalledTimes(1);
      expect(tab.handle).toBeNull(); // association untouched
      expect(tab.doc.isDirty).toBe(true); // still unsaved
      // No misleading save-success notification.
      expect(ui.notify).not.toHaveBeenCalledWith(expect.stringContaining('overwritten'), 'info');
      expect(ui.notify).not.toHaveBeenCalledWith(expect.stringContaining('download'), 'info');
    } finally {
      restore();
    }
  });

  it('an existing associated handle saves without reopening the picker', async () => {
    const sink: WritableSink = { bytes: null, closed: false };
    const handle = fakeSaveHandle(sink);
    const picker = vi.fn(async () => {
      throw new Error('the picker must not be shown when a handle already exists');
    });
    const restore = withSavePicker(picker);
    try {
      const { commands, tab } = await converted('a\n');
      tab.handle = handle; // already associated with a file on disk
      tab.rsfSaveExplained = true; // opened/saved before
      const ok = await commands.save(tab, KEEP);
      expect(ok).toBe(true);
      expect(picker).not.toHaveBeenCalled();
      expect(handle.createWritable).toHaveBeenCalledTimes(1);
      expect(sink.bytes).not.toBeNull();
    } finally {
      restore();
    }
  });

  it('falls back to a download (reported as such) when the picker API is unavailable', async () => {
    interceptDownloads();
    const restore = withSavePicker(undefined); // File System Access API unavailable
    try {
      const ui = stubUi();
      const { commands, tab } = await converted('a\n', ui);
      const ok = await commands.save(tab, KEEP);
      expect(ok).toBe(true);
      // A download never associates a handle nor claims an overwrite.
      expect(tab.handle).toBeNull();
      expect(ui.notify).toHaveBeenCalledWith(expect.stringContaining('download'), 'info');
      // The overwrite notice ("…overwritten in place.") must not appear; the
      // download notice mentions "NOT overwritten", so match the unique phrase.
      expect(ui.notify).not.toHaveBeenCalledWith(expect.stringContaining('in place'), 'info');
    } finally {
      restore();
    }
  });
});

describe('find/replace on RSF documents', () => {
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

  it('requires explicit RSF conversion before filling a plain CSV', async () => {
    const ui = stubUi();
    const { state, commands, tab } = setup('1,2\n3,4\n', ui);
    state.setSelection(tab, { row: 0, col: 0 }, { row: 1, col: 0 });
    const applied = await commands.fillDown(tab);
    expect(ui.confirmConvert).toHaveBeenCalledWith('fill', 'data.csv');
    expect(applied).toBe(true);
    expect(tab.doc.kind).toBe('rsf');
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
