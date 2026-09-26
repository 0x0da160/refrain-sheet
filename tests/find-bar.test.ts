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
  promptDriveName: async () => null,
  confirmUnrepresentable: async () => false,
  notifyNcr: async () => undefined,
  confirmUndecodableEdit: async () => true,
  chooseReopen: async () => null,
  confirmConvert: async () => true,
  explainRsfSave: async () => true,
  chooseExportCsv: async () => ({
    encoding: 'utf-8' as const,
    bom: false,
    lineEnding: 'lf' as const,
    delimiter: 'keep' as const,
    quoteStyle: 'minimal' as const,
  }),
  confirmExportXlsx: vi.fn(async () => true),
  confirmExportJson: vi.fn(async () => true),
  chooseInsertShift: async () => null,
  confirmFlashFill: async () => false,
  chooseFilter: async () => null,
  chooseColumnMenu: async () => null,
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
  chooseVersionHistory: async () => null,
  confirmHistoryCapExceeded: async () => true,
  chooseTextColor: async () => null,
  chooseBackgroundColor: async () => null,
  chooseBorders: async () => null,
  chooseNumberFormat: async () => null,
  chooseRecentFile: async () => null,
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
    expect(findBar.element.querySelector('.find-count')?.textContent).not.toContain('is not a match');
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
    expect(status).toContain('is not a match');
  });
});

describe('FindBar side panel', () => {
  it('shows the find and replace fields together in one panel', () => {
    const { findBar } = setup();
    findBar.open(false);
    expect(findBar.element.classList.contains('side-panel')).toBe(true);
    expect(findBar.element.hidden).toBe(false);
    const inputs = findBar.element.querySelectorAll<HTMLInputElement>('input[type="text"]');
    expect(inputs).toHaveLength(2);
    for (const input of inputs) {
      expect(input.closest('[hidden]')).toBeNull();
    }
  });

  it('puts the caret in the replace field for Replace once there is a query', () => {
    const { findBar, findInput, replaceInput } = setup();
    findBar.open(true);
    expect(document.activeElement).toBe(findInput);
    search(findInput, 'foo');
    findBar.open(true);
    expect(document.activeElement).toBe(replaceInput);
  });

  it('closes from the header close button, which keeps an accessible name', () => {
    const { findBar } = setup();
    findBar.open(false);
    const close = findBar.element.querySelector<HTMLButtonElement>('.side-panel-close-btn')!;
    expect(close.getAttribute('aria-label')).toBe('Close Find and Replace');
    close.click();
    expect(findBar.isOpen).toBe(false);
  });
});

describe('FindBar Find Next and Find All', () => {
  function buttonByText(findBar: FindBar, text: string): HTMLButtonElement {
    return Array.from(findBar.element.querySelectorAll('button')).find(
      (b) => b.textContent === text,
    ) as HTMLButtonElement;
  }

  it('Find Next moves the selection to the next matching cell', () => {
    const { state, tab, findBar, findInput } = setup();
    findBar.open(false);
    search(findInput, 'foo');
    state.setSelection(tab, { row: 0, col: 1 });
    buttonByText(findBar, 'Find Next').click();
    expect(tab.selection).toMatchObject({ row: 1, col: 0 });
  });

  it('Find All lists every matching cell, and a row jumps to its cell', () => {
    const { tab, findBar, findInput } = setup();
    findBar.open(false);
    search(findInput, 'foo');
    buttonByText(findBar, 'Find All').click();
    const rows = findBar.element.querySelectorAll<HTMLElement>('.find-result');
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector('.find-result-ref')?.textContent).toBe('A1');
    expect(rows[1].querySelector('.find-result-ref')?.textContent).toBe('A2');
    expect(rows[1].querySelector('.find-result-text')?.textContent).toBe('foo');
    rows[1].click();
    expect(tab.selection).toMatchObject({ row: 1, col: 0 });
    expect(rows[1].classList.contains('current')).toBe(true);
    expect(rows[1].getAttribute('aria-current')).toBe('true');
  });

  it('hides the list until Find All is pressed, and follows the query afterwards', () => {
    const { findBar, findInput } = setup();
    findBar.open(false);
    search(findInput, 'foo');
    const list = findBar.element.querySelector<HTMLElement>('.find-results')!;
    expect(list.hidden).toBe(true);
    buttonByText(findBar, 'Find All').click();
    expect(list.hidden).toBe(false);
    search(findInput, 'y');
    expect(findBar.element.querySelectorAll('.find-result')).toHaveLength(1);
    search(findInput, '');
    expect(list.hidden).toBe(true);
  });
});
