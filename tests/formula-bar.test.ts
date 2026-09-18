// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * The formula bar's own unit-level behavior. Its per-sheet-kind chrome
 * decision itself lives in `src/main.ts`'s `refreshSourceSheetViews` (which
 * sets `.formula-bar`'s `hidden` attribute for a Markdown/JSON worksheet —
 * not independently unit-testable, since `main.ts`'s `bootstrap()` is never
 * invoked from a test); what belongs here is `FormulaBar.refresh()`'s own
 * contract once hidden: it must never pull a hidden worksheet's document
 * text into the textarea just because some other event triggered a refresh.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/app/app-state';
import { Commands, type UiPort } from '../src/app/commands';
import { RsfDocument } from '../src/core/rsf-document';
import { FormulaBar } from '../src/ui/formula-bar';

function stubUi(overrides: Partial<UiPort> = {}): UiPort {
  return {
    confirmValidation: vi.fn(async () => true),
    confirmUnsaved: vi.fn(async () => 'discard' as const),
    chooseSaveOptions: vi.fn(async () => null),
    promptDriveName: async () => null,
    confirmUnrepresentable: vi.fn(async () => false),
    notifyNcr: vi.fn(async () => undefined),
    confirmUndecodableEdit: vi.fn(async () => true),
    chooseReopen: vi.fn(async () => null),
    confirmConvert: vi.fn(async () => true),
    explainRsfSave: vi.fn(async () => true),
    chooseRsfSave: vi.fn(async () => 2),
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
    setBusy: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  document.body.textContent = '';
});

describe('FormulaBar.refresh on a hidden bar (Markdown/JSON worksheet)', () => {
  it('never pulls the worksheet document text into the textarea while hidden', () => {
    const state = new AppState();
    const commands = new Commands(state, stubUi(), document);
    const workbook = RsfDocument.empty('book.rsf', 3, 3, 'Sheet1');
    const tab = state.addTab('book.rsf', workbook, null);
    const sheet = state.addJsonSheet(tab, 'Data')!;
    state.setActiveSheet(tab, sheet.id);
    state.editCell(tab, 0, 0, '{"a":1}'); // the JSON worksheet's whole-document text

    const bar = new FormulaBar(state, commands, () => undefined);
    document.body.append(bar.element);
    bar.element.hidden = true;
    bar.refresh(true);

    const textarea = bar.element.querySelector('textarea')!;
    expect(textarea.value).toBe('');
    expect(bar.element.querySelector('.cell-ref')!.textContent).toBe('');
  });

  it('resumes showing the selection once unhidden again', () => {
    const state = new AppState();
    const commands = new Commands(state, stubUi(), document);
    const workbook = RsfDocument.empty('book.rsf', 3, 3, 'Sheet1');
    const tab = state.addTab('book.rsf', workbook, null);
    state.editCell(tab, 0, 0, '42');

    const bar = new FormulaBar(state, commands, () => undefined);
    document.body.append(bar.element);
    bar.element.hidden = true;
    bar.refresh(true);
    expect(bar.element.querySelector('textarea')!.value).toBe('');

    bar.element.hidden = false;
    bar.refresh(true);
    expect(bar.element.querySelector('textarea')!.value).toBe('42');
  });
});
