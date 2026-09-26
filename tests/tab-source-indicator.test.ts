// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/app/app-state';
import { Commands, type UiPort } from '../src/app/commands';
import { TabBar } from '../src/ui/tab-bar';
import { doc } from './helpers';

function stubUi(overrides: Partial<UiPort> = {}): UiPort {
  return {
    confirmValidation: vi.fn(async () => true),
    confirmUnsaved: vi.fn(async () => 'discard' as const),
    confirmChangedOnDisk: vi.fn(async () => 'overwrite' as const),
    chooseSaveOptions: vi.fn(async () => null),
    promptDriveName: async () => null,
    confirmUnrepresentable: vi.fn(async () => false),
    notifyNcr: vi.fn(async () => undefined),
    confirmUndecodableEdit: vi.fn(async () => true),
    chooseReopen: vi.fn(async () => null),
    confirmConvert: vi.fn(async () => true),
    explainRsfSave: vi.fn(async () => true),
    chooseExportCsv: vi.fn(async () => null),
    confirmExportXlsx: vi.fn(async () => true),
    confirmExportJson: vi.fn(async () => true),
    chooseInsertShift: vi.fn(async () => null),
    confirmFlashFill: vi.fn(async () => false),
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
    chooseVersionHistory: vi.fn(async () => null),
    confirmHistoryCapExceeded: vi.fn(async () => true),
    chooseTextColor: vi.fn(async () => null),
    chooseBackgroundColor: vi.fn(async () => null),
    chooseBorders: vi.fn(async () => null),
    chooseNumberFormat: vi.fn(async () => null),
    chooseRecentFile: vi.fn(async () => null),
    setBusy: vi.fn(),
    ...overrides,
  };
}

function setup() {
  const state = new AppState();
  const ui = stubUi();
  const commands = new Commands(state, ui, document);
  const bar = new TabBar(state, commands);
  state.subscribe(() => bar.render());
  document.body.append(bar.element);
  return { state, commands, bar };
}

beforeEach(() => {
  document.body.textContent = '';
});

describe('TabBar storage-source indicator', () => {
  it('marks a plain tab as local', () => {
    const { state, bar } = setup();
    state.addTab('local.csv', doc('a\n'), null);
    bar.render();
    const source = bar.element.querySelector('.tab .tab-source');
    expect(source?.getAttribute('aria-label')).toBe('Local file');
    expect(bar.element.querySelector('.tab')?.getAttribute('title')).toBe('local.csv — Local file');
  });

  it('marks a Drive-linked tab as Drive', () => {
    const { state, bar } = setup();
    const tab = state.addTab('drive.csv', doc('a\n'), null);
    tab.drive = { fileId: 'abc123', name: 'drive.csv' };
    bar.render();
    const source = bar.element.querySelector('.tab .tab-source');
    expect(source?.getAttribute('aria-label')).toBe('Google Drive file');
    expect(bar.element.querySelector('.tab')?.getAttribute('title')).toBe('drive.csv — Google Drive file');
  });

  it('appends the dirty marker after the source in the tooltip', () => {
    const { state, bar } = setup();
    const tab = state.addTab('local.csv', doc('a\n'), null);
    state.editCell(tab, 0, 0, 'edited');
    bar.render();
    expect(bar.element.querySelector('.tab')?.getAttribute('title')).toBe(
      'local.csv — Local file — Unsaved changes',
    );
  });
});
