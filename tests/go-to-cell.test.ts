// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * "Go to Cell…" (Search menu): jump the selection straight to a typed cell
 * reference, on both CSV and RSF tabs, with live validation and no document
 * mutation (see #236).
 */
import { describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/app/app-state';
import { Commands, type UiPort } from '../src/app/commands';
import { RsfDocument } from '../src/core/rsf-document';
import { Grid } from '../src/ui/grid';
import { doc } from './helpers';

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
    chooseInsertShift: vi.fn(async () => null),
    confirmFlashFill: vi.fn(async () => false),
    chooseFilter: vi.fn(async () => null),
    chooseSort: vi.fn(async () => null),
    chooseDataValidation: vi.fn(async () => null),
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

function gridSetup(ui: UiPort) {
  const state = new AppState();
  const commands = new Commands(state, ui, document);
  const grid = new Grid(state, commands);
  commands.gridActions = {
    autoFitSelectedColumns: () => grid.autoFitSelectedColumns(),
    goToCell: (row, col) => grid.reveal(row, col),
  };
  Object.defineProperty(grid.element, 'clientHeight', { value: 520, configurable: true });
  Object.defineProperty(grid.element, 'clientWidth', { value: 900, configurable: true });
  document.body.append(grid.element);
  return { state, commands, grid };
}

describe('Go to Cell', () => {
  it('is disabled with no tab open, enabled once a tab is open', () => {
    const state = new AppState();
    const commands = new Commands(state, stubUi(), document);
    expect(commands.isEnabled('search.goToCell')).toBe(false);
    state.addTab('s.csv', doc('a,b\nc,d\n'), null);
    expect(commands.isEnabled('search.goToCell')).toBe(true);
  });

  it('moves the selection to the typed reference on a CSV tab', async () => {
    const prompt = vi.fn(async () => 'B2');
    const { state, commands } = gridSetup(stubUi({ promptGoToCell: prompt }));
    const tab = state.addTab('s.csv', doc('a,b\nc,d\n'), null);
    state.setSelection(tab, { row: 0, col: 0 }, null);
    await commands.run('search.goToCell');
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(tab.selection).toEqual({ row: 1, col: 1 });
  });

  it('moves the selection on an RSF tab too — pure navigation is not RSF-only', async () => {
    const prompt = vi.fn(async () => 'A2');
    const { state, commands } = gridSetup(stubUi({ promptGoToCell: prompt }));
    const rsf = RsfDocument.empty('book', 3, 2, 'Sheet1');
    const tab = state.addTab('book.rsf', rsf, null);
    state.setSelection(tab, { row: 0, col: 0 }, null);
    await commands.run('search.goToCell');
    expect(tab.selection).toEqual({ row: 1, col: 0 });
  });

  it('seeds the prompt with the current cell and does nothing when cancelled', async () => {
    const prompt = vi.fn(async () => null);
    const { state, commands } = gridSetup(stubUi({ promptGoToCell: prompt }));
    const tab = state.addTab('s.csv', doc('a,b\nc,d\n'), null);
    state.setSelection(tab, { row: 1, col: 0 }, null);
    await commands.run('search.goToCell');
    expect(prompt).toHaveBeenCalledWith('A2', expect.any(Function));
    expect(tab.selection).toEqual({ row: 1, col: 0 });
  });

  it('validate() rejects an unparsable reference and one outside the worksheet', async () => {
    let validate: ((text: string) => string | null) | undefined;
    const prompt = vi.fn(async (_suggestion: string, v: (text: string) => string | null) => {
      validate = v;
      return null;
    });
    const { state, commands } = gridSetup(stubUi({ promptGoToCell: prompt }));
    const tab = state.addTab('s.csv', doc('a,b\nc,d\n'), null);
    state.setSelection(tab, { row: 0, col: 0 }, null);
    await commands.run('search.goToCell');
    expect(validate).toBeDefined();
    expect(validate!('not a ref')).not.toBeNull();
    expect(validate!('Z100')).not.toBeNull();
    expect(validate!('B2')).toBeNull();
  });
});
