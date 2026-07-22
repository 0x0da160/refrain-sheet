// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * AutoFill numeric series: the inference core (ascending/descending/decimal,
 * precision, fallbacks) and the command-level fill flow (vertical and
 * horizontal continuation, formula reference translation, one-seed copy,
 * non-numeric/ambiguous fallback, undo/redo, and the CSV-mode restriction).
 */
import { describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/app/app-state';
import { Commands, type UiPort } from '../src/app/commands';
import { inferLinearSeries, seriesValueAt } from '../src/core/fill-series';
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
    confirmFlashFill: vi.fn(async () => true),
    chooseFilter: vi.fn(async () => null),
    promptSheetName: vi.fn(async () => null),
    confirmDeleteSheet: vi.fn(async () => true),
    chooseExportSheet: vi.fn(async () => null),
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

function rsfSheet(values: string[][], ui: UiPort = stubUi()) {
  const state = new AppState();
  const commands = new Commands(state, ui, document);
  const doc = RsfDocument.empty('t.rsf', Math.max(values.length, 8), Math.max(values[0].length, 8));
  for (let r = 0; r < values.length; r++) {
    for (let c = 0; c < values[r].length; c++) {
      doc.setCell(r, c, values[r][c]);
    }
  }
  doc.markSaved();
  const tab = state.addTab('t.rsf', doc, null);
  return { state, commands, tab, doc };
}

describe('linear series inference', () => {
  it('infers +1 from 1,2,3 and continues it', () => {
    const spec = inferLinearSeries(['1', '2', '3']);
    expect(spec).not.toBeNull();
    expect(spec!.step).toBe(1);
    expect(seriesValueAt(spec!, 1)).toBe('4');
    expect(seriesValueAt(spec!, 3)).toBe('6');
  });

  it('infers +2 from 2,4 and -3 from 10,7', () => {
    expect(inferLinearSeries(['2', '4'])!.step).toBe(2);
    const down = inferLinearSeries(['10', '7'])!;
    expect(down.step).toBe(-3);
    expect(seriesValueAt(down, 1)).toBe('4');
    expect(seriesValueAt(down, 2)).toBe('1');
    expect(seriesValueAt(down, 3)).toBe('-2');
  });

  it('preserves decimal precision (0.1, 0.2 → 0.3, not float noise)', () => {
    const spec = inferLinearSeries(['0.1', '0.2'])!;
    expect(seriesValueAt(spec, 1)).toBe('0.3');
    expect(seriesValueAt(spec, 8)).toBe('1.0');
  });

  it('requires at least two seeds and a constant step', () => {
    expect(inferLinearSeries(['5'])).toBeNull(); // one seed: no series
    expect(inferLinearSeries(['1', '2', '4'])).toBeNull(); // non-constant step
    expect(inferLinearSeries(['a', 'b'])).toBeNull(); // non-numeric
    expect(inferLinearSeries(['1', 'x'])).toBeNull(); // mixed
  });
});

describe('AutoFill command (RSF)', () => {
  it('continues a vertical numeric series instead of copying', async () => {
    const { commands, tab, doc } = rsfSheet([['1'], ['2'], ['3']]);
    // Source = the three seeds; destination extends to row 5.
    await commands.applyFill(
      tab,
      { top: 0, left: 0, bottom: 2, right: 0 },
      { top: 0, left: 0, bottom: 5, right: 0 },
    );
    expect(doc.getValue(3, 0)).toBe('4');
    expect(doc.getValue(4, 0)).toBe('5');
    expect(doc.getValue(5, 0)).toBe('6');
  });

  it('continues a horizontal numeric series', async () => {
    const { commands, tab, doc } = rsfSheet([['2', '4']]);
    await commands.applyFill(
      tab,
      { top: 0, left: 0, bottom: 0, right: 1 },
      { top: 0, left: 0, bottom: 0, right: 4 },
    );
    expect(doc.getValue(0, 2)).toBe('6');
    expect(doc.getValue(0, 3)).toBe('8');
    expect(doc.getValue(0, 4)).toBe('10');
  });

  it('one numeric seed copies its value (no implicit series)', async () => {
    const { commands, tab, doc } = rsfSheet([['7']]);
    await commands.applyFill(
      tab,
      { top: 0, left: 0, bottom: 0, right: 0 },
      { top: 0, left: 0, bottom: 3, right: 0 },
    );
    expect(doc.getValue(1, 0)).toBe('7');
    expect(doc.getValue(3, 0)).toBe('7');
  });

  it('formula sequences keep reference translation, never numeric-series inference', async () => {
    const { commands, tab, doc } = rsfSheet([
      ['', '=A1'],
      ['', '=A2'],
    ]);
    await commands.applyFill(
      tab,
      { top: 0, left: 1, bottom: 1, right: 1 },
      { top: 0, left: 1, bottom: 3, right: 1 },
    );
    expect(doc.getValue(2, 1)).toBe('=A3');
    expect(doc.getValue(3, 1)).toBe('=A4');
  });

  it('non-numeric seeds fall back to copy/tile', async () => {
    const { commands, tab, doc } = rsfSheet([['x'], ['y']]);
    await commands.applyFill(
      tab,
      { top: 0, left: 0, bottom: 1, right: 0 },
      { top: 0, left: 0, bottom: 3, right: 0 },
    );
    // The two-row pattern tiles: x, y, x, y.
    expect(doc.getValue(2, 0)).toBe('x');
    expect(doc.getValue(3, 0)).toBe('y');
  });

  it('is a single undoable operation', async () => {
    const { commands, state, tab, doc } = rsfSheet([['1'], ['2']]);
    await commands.applyFill(
      tab,
      { top: 0, left: 0, bottom: 1, right: 0 },
      { top: 0, left: 0, bottom: 4, right: 0 },
    );
    expect(doc.getValue(4, 0)).toBe('5');
    state.undo(tab);
    expect(doc.getValue(2, 0)).toBe('');
    expect(doc.getValue(4, 0)).toBe('');
  });

  it('CSV documents require conversion before a structural fill', async () => {
    const ui = stubUi({ confirmConvert: vi.fn(async () => false) });
    const state = new AppState();
    const commands = new Commands(state, ui, document);
    const tab = state.addTab('t.csv', csvDoc('1\n2\n3\n4\n'), null);
    const applied = await commands.applyFill(
      tab,
      { top: 0, left: 0, bottom: 1, right: 0 },
      { top: 0, left: 0, bottom: 3, right: 0 },
    );
    expect(applied).toBe(false); // conversion declined: nothing filled
    expect(tab.doc.kind).toBe('csv');
  });
});
