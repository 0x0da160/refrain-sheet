// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/app/app-state';
import { Commands, type UiPort } from '../src/app/commands';
import { Grid } from '../src/ui/grid';
import { FindBar } from '../src/ui/find-bar';
import { doc } from './helpers';

const noopUi: UiPort = {
  confirmValidation: async () => true,
  confirmUnsaved: async () => 'discard',
  chooseSaveOptions: async () => null,
  confirmUnrepresentable: async () => false,
  notifyNcr: async () => undefined,
  confirmUndecodableEdit: async () => true,
  chooseReopen: async () => null,
  confirmConvert: async () => true,
  explainRsfSave: async () => true,
  chooseRsfSave: async () => 2,
  chooseExportCsv: async () => ({ encoding: 'utf-8' as const, bom: false, lineEnding: 'lf' as const }),
  confirmExportXlsx: vi.fn(async () => true),
  chooseInsertShift: async () => null,
  confirmFlashFill: async () => false,
  chooseFilter: async () => null,
  chooseSort: async () => null,
  chooseDataValidation: async () => null,
  chooseConditionalFormat: async () => null,
  chooseCellComment: async () => null,
  promptSheetName: async () => null,
  confirmDeleteSheet: async () => true,
  chooseExportSheet: async () => null,
  confirmReplaceAllWorkbook: async () => true,
  confirmRangeMoveOverwrite: async () => true,
  promptMoveTarget: async () => null,
  promptGoToCell: async () => null,
  confirm: async () => true,
  showMessage: async () => undefined,
  notify: () => undefined,
  openFindBar: () => undefined,
  findNext: () => undefined,
  showAbout: () => undefined,
  showFormulaHelp: () => undefined,
  showSqlQuery: vi.fn(async () => undefined),
  showDiff: vi.fn(async () => undefined),
  chooseSettings: async () => null,
  chooseTimezone: async () => null,
  chooseDisplayLanguage: async () => null,
  chooseTextColor: async () => null,
  chooseBackgroundColor: async () => null,
  chooseBorders: async () => null,
  chooseNumberFormat: async () => null,
  setBusy: () => undefined,
};

function setup() {
  const state = new AppState();
  const commands = new Commands(state, noopUi, document);
  const grid = new Grid(state, commands);
  document.body.append(grid.element);
  const tab = state.addTab('data.csv', doc('foo,x\nfoo,y\n'), null);
  const findBar = new FindBar(state, commands, grid);
  document.body.append(findBar.element);
  const textInputs = findBar.element.querySelectorAll('input[type="text"]');
  const findInput = textInputs[0] as HTMLInputElement;
  const replaceInput = textInputs[1] as HTMLInputElement;
  const replaceButton = Array.from(findBar.element.querySelectorAll('button')).find(
    (b) => b.textContent === 'Replace',
  ) as HTMLButtonElement;
  return { state, commands, grid, tab, findBar, findInput, replaceInput, replaceButton };
}

function search(findInput: HTMLInputElement, text: string) {
  findInput.value = text;
  findInput.dispatchEvent(new Event('input'));
  vi.advanceTimersByTime(200);
}

beforeEach(() => {
  document.body.textContent = '';
  vi.useFakeTimers();
});

describe('FindBar replaceCurrent', () => {
  it('replaces the cell when the selection sits exactly on a recorded match', () => {
    const { state, tab, findBar, findInput, replaceInput, replaceButton } = setup();
    findBar.open(true);
    search(findInput, 'foo');
    replaceInput.value = 'bar';
    state.setSelection(tab, { row: 0, col: 0 });

    replaceButton.click();

    expect(tab.doc.getValue(0, 0)).toBe('bar');
    expect(findBar.element.querySelector('.find-count')?.textContent).not.toContain('not on a match');
  });

  it('does not edit the cell and reports a distinct status when the selection is off a match', () => {
    const { state, tab, findBar, findInput, replaceInput, replaceButton } = setup();
    findBar.open(true);
    search(findInput, 'foo');
    replaceInput.value = 'bar';
    // Selection sits on a cell that is not one of the recorded matches (col 1
    // never matched "foo").
    state.setSelection(tab, { row: 0, col: 1 });

    replaceButton.click();

    expect(tab.doc.getValue(0, 0)).toBe('foo');
    expect(tab.doc.getValue(1, 0)).toBe('foo');
    const status = findBar.element.querySelector('.find-count')?.textContent ?? '';
    expect(status).toContain('not on a match');
  });
});
