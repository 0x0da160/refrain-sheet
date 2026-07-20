// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { AppState, type Selection } from '../src/app/app-state';
import { Commands, type UiPort } from '../src/app/commands';
import { RsfDocument } from '../src/core/rsf-document';
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
    chooseInsertShift: vi.fn(async () => 'down' as const),
    confirmFlashFill: vi.fn(async () => false),
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

function rcsvSetup(values: string[][], ui: UiPort = stubUi()) {
  const state = new AppState();
  const commands = new Commands(state, ui, document);
  const doc = RsfDocument.empty('data.rcsv', values.length, values[0].length);
  for (let r = 0; r < values.length; r++) {
    for (let c = 0; c < values[r].length; c++) {
      doc.setCell(r, c, values[r][c]);
    }
  }
  doc.markSaved();
  const tab = state.addTab('data.rcsv', doc, null);
  return { state, commands, tab, doc, ui };
}

function withCopied(commands: Commands, matrix: string[][], origin: Selection | null): void {
  commands.clipboardActions = {
    copy: async () => undefined,
    paste: async () => undefined,
    getCopied: async () => ({ matrix, origin }),
  };
}

describe('paste pattern repeat (tiling)', () => {
  it('repeats the source into a larger selected destination when dimensions are exact multiples', async () => {
    const { state, commands, tab } = rcsvSetup([
      ['', '', ''],
      ['', '', ''],
      ['', '', ''],
      ['', '', ''],
    ]);
    // Destination: rows 0-3 × cols 0-1 (4×2). Source: 2×1 → tiles 2× down, 2× right.
    state.setSelection(tab, { row: 0, col: 0 }, { row: 3, col: 1 });
    const applied = await commands.applyPaste(tab, [['x'], ['y']], null);
    expect(applied).toBe(true);
    expect(tab.doc.getValue(0, 0)).toBe('x');
    expect(tab.doc.getValue(1, 0)).toBe('y');
    expect(tab.doc.getValue(2, 0)).toBe('x');
    expect(tab.doc.getValue(3, 1)).toBe('y');
    // The untouched third column stays empty.
    expect(tab.doc.getValue(0, 2)).toBe('');
  });

  it('pastes once at the active cell when the destination is not an exact multiple', async () => {
    const { state, commands, tab } = rcsvSetup([
      ['', '', ''],
      ['', '', ''],
      ['', '', ''],
    ]);
    // 3×1 destination, 2×1 source: 3 % 2 !== 0 → no tiling.
    state.setSelection(tab, { row: 0, col: 0 }, { row: 2, col: 0 });
    await commands.applyPaste(tab, [['x'], ['y']], null);
    expect(tab.doc.getValue(0, 0)).toBe('x');
    expect(tab.doc.getValue(1, 0)).toBe('y');
    expect(tab.doc.getValue(2, 0)).toBe('');
  });

  it('adjusts relative formula references per tile', async () => {
    const { state, commands, tab } = rcsvSetup([
      ['1', ''],
      ['2', ''],
    ]);
    // Copy B1 (=A1*2) into B1:B2 — the second tile references A2.
    state.setSelection(tab, { row: 0, col: 1 }, { row: 1, col: 1 });
    await commands.applyPaste(tab, [['=A1*2']], { row: 0, col: 1 });
    expect(tab.doc.getValue(0, 1)).toBe('=A1*2');
    expect(tab.doc.getValue(1, 1)).toBe('=A2*2');
    expect(tab.doc.getDisplayValue(1, 1)).toBe('4');
  });

  it('a tiled paste is one atomic undo step', async () => {
    const { state, commands, tab } = rcsvSetup([
      ['', ''],
      ['', ''],
    ]);
    state.setSelection(tab, { row: 0, col: 0 }, { row: 1, col: 1 });
    await commands.applyPaste(tab, [['v']], null);
    expect(tab.doc.getValue(1, 1)).toBe('v');
    state.undo(tab);
    expect(tab.doc.getValue(0, 0)).toBe('');
    expect(tab.doc.getValue(1, 1)).toBe('');
  });
});

describe('Insert Copied Cells…', () => {
  it('shift-down inserts whole rows and writes the copied values', async () => {
    const { state, commands, tab } = rcsvSetup([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    withCopied(commands, [['X', 'Y']], null);
    state.setSelection(tab, { row: 1, col: 0 }, null);
    const applied = await commands.insertCopiedCells(tab);
    expect(applied).toBe(true);
    expect(tab.doc.rowCount).toBe(3);
    expect(tab.doc.getValue(0, 0)).toBe('a');
    expect(tab.doc.getValue(1, 0)).toBe('X');
    expect(tab.doc.getValue(1, 1)).toBe('Y');
    // The former second row shifted down.
    expect(tab.doc.getValue(2, 0)).toBe('c');
  });

  it('shift-right inserts whole columns and writes the copied values', async () => {
    const ui = stubUi({ chooseInsertShift: vi.fn(async () => 'right' as const) });
    const { state, commands, tab } = rcsvSetup(
      [
        ['a', 'b'],
        ['c', 'd'],
      ],
      ui,
    );
    withCopied(commands, [['X'], ['Y']], null);
    state.setSelection(tab, { row: 0, col: 1 }, null);
    expect(await commands.insertCopiedCells(tab)).toBe(true);
    expect(tab.doc.columnCount).toBe(3);
    expect(tab.doc.getValue(0, 0)).toBe('a');
    expect(tab.doc.getValue(0, 1)).toBe('X');
    expect(tab.doc.getValue(1, 1)).toBe('Y');
    // The former second column shifted right.
    expect(tab.doc.getValue(0, 2)).toBe('b');
  });

  it('updates existing formula references like Insert Rows does', async () => {
    const { state, commands, tab } = rcsvSetup([
      ['1', '=A3'],
      ['2', ''],
      ['3', ''],
    ]);
    withCopied(commands, [['N']], null);
    state.setSelection(tab, { row: 1, col: 0 }, null);
    expect(await commands.insertCopiedCells(tab)).toBe(true);
    // A3 moved to A4; the formula (itself unmoved in row 0) follows it.
    expect(tab.doc.getValue(0, 1)).toBe('=A4');
    expect(tab.doc.getDisplayValue(0, 1)).toBe('3');
  });

  it('adjusts relative references in the inserted formulas by the copy offset', async () => {
    const { state, commands, tab } = rcsvSetup([
      ['5', '=A1*2'],
      ['7', ''],
    ]);
    // Copied from B1; inserting at B2 → reference shifts down one row.
    withCopied(commands, [['=A1*2']], { row: 0, col: 1 });
    state.setSelection(tab, { row: 1, col: 1 }, null);
    expect(await commands.insertCopiedCells(tab)).toBe(true);
    expect(tab.doc.getValue(1, 1)).toBe('=A2*2');
  });

  it('is one atomic undo/redo step', async () => {
    const { state, commands, tab } = rcsvSetup([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    withCopied(commands, [['X', 'Y']], null);
    state.setSelection(tab, { row: 0, col: 0 }, null);
    await commands.insertCopiedCells(tab);
    expect(tab.doc.rowCount).toBe(3);
    state.undo(tab);
    expect(tab.doc.rowCount).toBe(2);
    expect(tab.doc.getValue(0, 0)).toBe('a');
    state.redo(tab);
    expect(tab.doc.rowCount).toBe(3);
    expect(tab.doc.getValue(0, 0)).toBe('X');
  });

  it('on a CSV document requires the explicit RSF conversion; declining changes nothing', async () => {
    const ui = stubUi({ confirmConvert: vi.fn(async () => false) });
    const state = new AppState();
    const commands = new Commands(state, ui, document);
    const tab = state.addTab('plain.csv', csvDoc('a,b\nc,d\n'), null);
    state.setSelection(tab, { row: 0, col: 0 }, null);
    withCopied(commands, [['X']], null);
    expect(await commands.insertCopiedCells(tab)).toBe(false);
    expect(ui.confirmConvert).toHaveBeenCalled();
    expect(tab.doc.kind).toBe('csv');
    expect(tab.doc.getValue(0, 0)).toBe('a');
    expect(tab.doc.isDirty).toBe(false);
  });

  it('warns when nothing has been copied', async () => {
    const ui = stubUi();
    const { state, commands, tab } = rcsvSetup([['a']], ui);
    commands.clipboardActions = {
      copy: async () => undefined,
      paste: async () => undefined,
      getCopied: async () => null,
    };
    state.setSelection(tab, { row: 0, col: 0 }, null);
    expect(await commands.insertCopiedCells(tab)).toBe(false);
    expect(ui.notify).toHaveBeenCalled();
  });

  it('cancelling the direction dialog changes nothing', async () => {
    const ui = stubUi({ chooseInsertShift: vi.fn(async () => null) });
    const { state, commands, tab } = rcsvSetup([['a']], ui);
    withCopied(commands, [['X']], null);
    state.setSelection(tab, { row: 0, col: 0 }, null);
    expect(await commands.insertCopiedCells(tab)).toBe(false);
    expect(tab.doc.getValue(0, 0)).toBe('a');
    expect(tab.doc.isDirty).toBe(false);
  });

  it('a large insertion runs behind the loading indicator', async () => {
    const ui = stubUi();
    const { state, commands, tab } = rcsvSetup([['a']], ui);
    // 30,000 cells crosses the progress-UI threshold.
    const matrix = Array.from({ length: 300 }, () => new Array<string>(100).fill('v'));
    withCopied(commands, matrix, null);
    state.setSelection(tab, { row: 0, col: 0 }, null);
    expect(await commands.insertCopiedCells(tab)).toBe(true);
    const busyCalls = (ui.setBusy as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(busyCalls.some((label) => typeof label === 'string')).toBe(true);
    expect(busyCalls[busyCalls.length - 1]).toBeNull();
    expect(tab.doc.rowCount).toBe(301);
  });

  it('a large paste runs behind the loading indicator', async () => {
    const ui = stubUi();
    const { state, commands, tab } = rcsvSetup([['']], ui);
    const matrix = Array.from({ length: 300 }, () => new Array<string>(100).fill('v'));
    state.setSelection(tab, { row: 0, col: 0 }, null);
    expect(await commands.applyPaste(tab, matrix, null)).toBe(true);
    const busyCalls = (ui.setBusy as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(busyCalls.some((label) => typeof label === 'string')).toBe(true);
    expect(tab.doc.rowCount).toBe(300);
    expect(tab.doc.columnCount).toBe(100);
  });
});

describe('Insert Copied Rows / Insert Copied Columns', () => {
  it('inserts copied rows as whole rows above the selection, keeping the source columns', async () => {
    const { state, commands, tab } = rcsvSetup([
      ['a', 'b', 'c'],
      ['d', 'e', 'f'],
    ]);
    // Two rows copied from columns B..C (origin col 1).
    withCopied(
      commands,
      [
        ['X1', 'Y1'],
        ['X2', 'Y2'],
      ],
      { row: 0, col: 1 },
    );
    state.setSelection(tab, { row: 1, col: 0 }, null);
    expect(await commands.insertCopiedAxis(tab, 'rows')).toBe(true);
    expect(tab.doc.rowCount).toBe(4);
    // Row 0 untouched; the copied rows sit above the former row 1, in the
    // columns they were copied from.
    expect(tab.doc.getValue(0, 0)).toBe('a');
    expect(tab.doc.getValue(1, 0)).toBe('');
    expect(tab.doc.getValue(1, 1)).toBe('X1');
    expect(tab.doc.getValue(2, 2)).toBe('Y2');
    // The former second row shifted down without data loss.
    expect(tab.doc.getValue(3, 0)).toBe('d');
  });

  it('inserts copied columns as whole columns to the left of the selection', async () => {
    const { state, commands, tab } = rcsvSetup([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    withCopied(commands, [['X'], ['Y']], { row: 0, col: 0 });
    state.setSelection(tab, { row: 0, col: 1 }, null);
    expect(await commands.insertCopiedAxis(tab, 'cols')).toBe(true);
    expect(tab.doc.columnCount).toBe(3);
    expect(tab.doc.getValue(0, 0)).toBe('a');
    expect(tab.doc.getValue(0, 1)).toBe('X');
    expect(tab.doc.getValue(1, 1)).toBe('Y');
    // The former second column shifted right without data loss.
    expect(tab.doc.getValue(0, 2)).toBe('b');
  });

  it('a system-clipboard range of unknown origin starts at column A / row 1 (documented rule)', async () => {
    const { state, commands, tab } = rcsvSetup([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    withCopied(commands, [['P', 'Q']], null);
    state.setSelection(tab, { row: 1, col: 1 }, null);
    expect(await commands.insertCopiedAxis(tab, 'rows')).toBe(true);
    expect(tab.doc.getValue(1, 0)).toBe('P');
    expect(tab.doc.getValue(1, 1)).toBe('Q');
  });

  it('updates existing formula references and range spans consistently', async () => {
    const { state, commands, tab } = rcsvSetup([
      ['1', '=SUM(A1:A3)'],
      ['2', ''],
      ['3', '=A3'],
    ]);
    withCopied(commands, [['']], null);
    state.setSelection(tab, { row: 1, col: 0 }, null);
    expect(await commands.insertCopiedAxis(tab, 'rows')).toBe(true);
    // The range expands across the insertion point; the plain reference follows
    // its shifted target (the formula itself moved from row 2 to row 3).
    expect(tab.doc.getValue(0, 1)).toBe('=SUM(A1:A4)');
    expect(tab.doc.getValue(3, 1)).toBe('=A4');
    expect(tab.doc.getDisplayValue(0, 1)).toBe('6');
  });

  it('adjusts relative references inside the inserted formulas by the copy offset', async () => {
    const { state, commands, tab } = rcsvSetup([
      ['5', '=A1*2'],
      ['7', ''],
    ]);
    // Copied from row 0; inserted above row 1 → the formula shifts down one
    // row, exactly like pasting it at the new location would.
    withCopied(commands, [['', '=A1*2']], { row: 0, col: 0 });
    state.setSelection(tab, { row: 1, col: 0 }, null);
    expect(await commands.insertCopiedAxis(tab, 'rows')).toBe(true);
    expect(tab.doc.getValue(1, 1)).toBe('=A2*2');
  });

  it('each insertion is one atomic undo/redo step', async () => {
    const { state, commands, tab } = rcsvSetup([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    withCopied(commands, [['X', 'Y']], { row: 0, col: 0 });
    state.setSelection(tab, { row: 0, col: 0 }, null);
    await commands.insertCopiedAxis(tab, 'rows');
    expect(tab.doc.rowCount).toBe(3);
    state.undo(tab);
    expect(tab.doc.rowCount).toBe(2);
    expect(tab.doc.getValue(0, 0)).toBe('a');
    state.redo(tab);
    expect(tab.doc.rowCount).toBe(3);
    expect(tab.doc.getValue(0, 0)).toBe('X');
  });

  it('on a CSV document requires the explicit RSF conversion; declining rolls back to nothing', async () => {
    const ui = stubUi({ confirmConvert: vi.fn(async () => false) });
    const state = new AppState();
    const commands = new Commands(state, ui, document);
    const tab = state.addTab('plain.csv', csvDoc('a,b\nc,d\n'), null);
    state.setSelection(tab, { row: 0, col: 0 }, null);
    withCopied(commands, [['X']], null);
    expect(await commands.insertCopiedAxis(tab, 'rows')).toBe(false);
    expect(await commands.insertCopiedAxis(tab, 'cols')).toBe(false);
    expect(tab.doc.kind).toBe('csv');
    expect(tab.doc.isDirty).toBe(false);
  });

  it('warns when nothing has been copied', async () => {
    const ui = stubUi();
    const { state, commands, tab } = rcsvSetup([['a']], ui);
    commands.clipboardActions = {
      copy: async () => undefined,
      paste: async () => undefined,
      getCopied: async () => null,
    };
    state.setSelection(tab, { row: 0, col: 0 }, null);
    expect(await commands.insertCopiedAxis(tab, 'rows')).toBe(false);
    expect(ui.notify).toHaveBeenCalled();
    expect(tab.doc.isDirty).toBe(false);
  });

  it('the commands are enabled with a selection and reachable through run()', async () => {
    const { state, commands, tab } = rcsvSetup([['a']]);
    withCopied(commands, [['X']], null);
    state.setSelection(tab, { row: 0, col: 0 }, null);
    expect(commands.isEnabled('edit.insertCopiedRows')).toBe(true);
    expect(commands.isEnabled('edit.insertCopiedCols')).toBe(true);
    await commands.run('edit.insertCopiedRows');
    expect(tab.doc.rowCount).toBe(2);
  });

  it('a large row insertion reports percentage progress and stays atomic', async () => {
    const ui = stubUi();
    const { state, commands, tab } = rcsvSetup([['a']], ui);
    // 30,000 cells crosses the progress threshold.
    const matrix = Array.from({ length: 300 }, () => new Array<string>(100).fill('v'));
    withCopied(commands, matrix, { row: 0, col: 0 });
    state.setSelection(tab, { row: 0, col: 0 }, null);
    expect(await commands.insertCopiedAxis(tab, 'rows')).toBe(true);
    const busyCalls = (ui.setBusy as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as string | null);
    const percentLabels = busyCalls.filter((l) => typeof l === 'string' && /\(\d+%\)/.test(l));
    expect(percentLabels.length).toBeGreaterThan(0);
    // 100% never appears while work remains.
    for (const label of percentLabels) {
      expect(Number(/\((\d+)%\)/.exec(label as string)![1])).toBeLessThan(100);
    }
    expect(busyCalls[busyCalls.length - 1]).toBeNull();
    expect(tab.doc.rowCount).toBe(301);
    state.undo(tab);
    expect(tab.doc.rowCount).toBe(1);
  });

  it('a large column insertion reports percentage progress', async () => {
    const ui = stubUi();
    const { state, commands, tab } = rcsvSetup([['a']], ui);
    const matrix = Array.from({ length: 300 }, () => new Array<string>(100).fill('v'));
    withCopied(commands, matrix, { row: 0, col: 0 });
    state.setSelection(tab, { row: 0, col: 0 }, null);
    expect(await commands.insertCopiedAxis(tab, 'cols')).toBe(true);
    const busyCalls = (ui.setBusy as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as string | null);
    expect(busyCalls.some((l) => typeof l === 'string' && /\(\d+%\)/.test(l))).toBe(true);
    expect(tab.doc.columnCount).toBe(101);
    expect(busyCalls[busyCalls.length - 1]).toBeNull();
  });
});
