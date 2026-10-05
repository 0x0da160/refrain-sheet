// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * Column schema in the UI: the data-validation panel's new kinds and options
 * (whole numbers, text length, dates, blanks not allowed, whole columns),
 * and the Data > Check Data panel that lists values breaking their rule.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppState } from '../../src/app/state';
import { Commands, type DataValidationDialogInput, type UiPort } from '../../src/app/commands';
import { getLocale, setLocale, t } from '../../src/app/i18n';
import { RsfDocument } from '../../src/core/workbook/rsf-document';
import { chooseDataValidation } from '../../src/ui/dialogs/data-validation-dialog';
import { Grid } from '../../src/ui/grid';
import { ValidationCheckPanel } from '../../src/ui/validation-check-panel';
import { doc as csvDoc } from '../helpers';

const noopUi: UiPort = {
  confirmValidation: async () => true,
  confirmUnsaved: async () => 'discard',
  confirmChangedOnDisk: async () => 'overwrite',
  chooseSaveOptions: async () => null,
  promptDriveName: async () => null,
  confirmUnrepresentable: async () => false,
  notifyNcr: async () => undefined,
  confirmUndecodableEdit: async () => true,
  chooseReopen: async () => null,
  confirmConvert: async () => true,
  explainRsfSave: async () => true,
  chooseExportCsv: async () => null,
  confirmExportXlsx: async () => true,
  confirmExportJson: async () => true,
  chooseInsertShift: async () => null,
  confirmFlashFill: async () => false,
  chooseFilter: async () => null,
  chooseColumnMenu: async () => null,
  chooseSort: async () => null,
  chooseDataValidation: async () => null,
  chooseConditionalFormat: async () => null,
  chooseCellComment: async () => null,
  promptSheetName: async () => null,
  chooseSheetTabColor: async () => null,
  promptFolderName: async () => null,
  chooseFolder: async () => null,
  confirmDeleteSheet: async () => true,
  chooseExportSheet: async () => null,
  confirmReplaceAllWorkbook: async () => true,
  confirmRangeMoveOverwrite: async () => true,
  promptMoveTarget: async () => null,
  promptGoToCell: async () => null,
  promptRowHeight: async () => null,
  confirm: async () => true,
  showMessage: async () => undefined,
  notify: () => undefined,
  openFindBar: () => undefined,
  findNext: () => undefined,
  showAbout: () => undefined,
  showFormulaHelp: () => undefined,
  showSqlQuery: async () => undefined,
  showDiff: async () => undefined,
  chooseSettings: async () => null,
  chooseTimezone: async () => null,
  chooseDisplayLanguage: async () => null,
  chooseVersionHistory: async () => null,
  confirmHistoryCapExceeded: async () => true,
  chooseTextColor: async () => null,
  chooseBackgroundColor: async () => null,
  chooseBorders: async () => null,
  chooseNumberFormat: async () => null,
  chooseFont: async () => null,
  chooseRecentFile: async () => null,
  setBusy: () => undefined,
};

function button(panel: HTMLElement, label: string): HTMLButtonElement {
  const found = Array.from(panel.querySelectorAll('button')).find((b) => b.textContent === label);
  if (!found) {
    throw new Error(`button "${label}" not found`);
  }
  return found;
}

function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function tick(input: HTMLInputElement): void {
  input.click();
}

/** The checkbox whose label reads `text`. */
function checkbox(panel: HTMLElement, text: string): HTMLInputElement {
  const label = Array.from(panel.querySelectorAll('label')).find((l) => l.textContent?.includes(text));
  const input = label?.querySelector('input');
  if (!input) {
    throw new Error(`checkbox "${text}" not found`);
  }
  return input;
}

const locale = getLocale();
beforeEach(() => {
  document.body.textContent = '';
  setLocale('en');
  vi.stubGlobal('innerWidth', 1000);
  vi.stubGlobal('innerHeight', 800);
});
afterEach(() => {
  setLocale(locale);
  vi.unstubAllGlobals();
});

describe('the data-validation panel', () => {
  const input: DataValidationDialogInput = {
    rangeLabel: 'B2:B2',
    existing: null,
    columns: { label: 'B:B', checked: false, headerRow: true },
  };

  it('builds a required whole-number rule for entire columns below the header', async () => {
    const promise = chooseDataValidation(input);
    const panel = document.querySelector<HTMLElement>('.side-panel')!;
    tick(panel.querySelector<HTMLInputElement>('#validation-kind-number')!);
    type(
      panel.querySelector<HTMLInputElement>(`input[aria-label="${t('dialog.dataValidation.min')}"]`)!,
      '1',
    );
    tick(checkbox(panel, t('dialog.dataValidation.integer')));
    tick(checkbox(panel, t('dialog.dataValidation.required')));
    tick(checkbox(panel, t('dialog.dataValidation.wholeColumns', { columns: 'B:B' })));
    expect(panel.querySelector('.panel-lead')?.textContent).toBe(
      t('dialog.dataValidation.columnsRange', { columns: 'B:B' }),
    );
    button(panel, t('dialog.dataValidation.apply')).click();
    expect(await promise).toEqual({
      action: 'apply',
      rule: { kind: 'number', min: 1, max: null, integer: true },
      required: true,
      columns: { headerRow: true },
    });
  });

  it('asks for a text-length bound, and rejects dates in the wrong order', async () => {
    const promise = chooseDataValidation(input);
    const panel = document.querySelector<HTMLElement>('.side-panel')!;
    const apply = button(panel, t('dialog.dataValidation.apply'));
    tick(panel.querySelector<HTMLInputElement>('#validation-kind-textLength')!);
    expect(apply.disabled).toBe(true);
    expect(panel.querySelector('.dialog-error')?.textContent).toBe(
      t('dialog.dataValidation.incomplete.textLength'),
    );
    type(
      panel.querySelector<HTMLInputElement>(`input[aria-label="${t('dialog.dataValidation.maxLength')}"]`)!,
      '10',
    );
    expect(apply.disabled).toBe(false);

    tick(panel.querySelector<HTMLInputElement>('#validation-kind-date')!);
    expect(apply.disabled).toBe(false); // any date
    type(
      panel.querySelector<HTMLInputElement>(`input[aria-label="${t('dialog.dataValidation.minDate')}"]`)!,
      '2026-12-01',
    );
    type(
      panel.querySelector<HTMLInputElement>(`input[aria-label="${t('dialog.dataValidation.maxDate')}"]`)!,
      '2026-01-01',
    );
    expect(apply.disabled).toBe(true);
    type(
      panel.querySelector<HTMLInputElement>(`input[aria-label="${t('dialog.dataValidation.maxDate')}"]`)!,
      '2026-12-31',
    );
    apply.click();
    expect(await promise).toEqual({
      action: 'apply',
      rule: { kind: 'date', min: '2026-12-01', max: '2026-12-31' },
    });
  });

  it('preloads an existing column rule', async () => {
    const promise = chooseDataValidation({
      ...input,
      existing: { kind: 'textLength', min: 2, max: null },
      required: true,
      columns: { label: 'B:B', checked: true, headerRow: false },
    });
    const panel = document.querySelector<HTMLElement>('.side-panel')!;
    expect(panel.querySelector<HTMLInputElement>('#validation-kind-textLength')!.checked).toBe(true);
    expect(checkbox(panel, t('dialog.dataValidation.required')).checked).toBe(true);
    expect(checkbox(panel, t('dialog.dataValidation.skipHeader')).checked).toBe(false);
    button(panel, t('dialog.dataValidation.apply')).click();
    expect(await promise).toEqual({
      action: 'apply',
      rule: { kind: 'textLength', min: 2, max: null },
      required: true,
      columns: { headerRow: false },
    });
  });
});

describe('ValidationCheckPanel', () => {
  function setup() {
    const state = new AppState();
    const commands = new Commands(state, noopUi, document);
    const grid = new Grid(state, commands);
    document.body.append(grid.element);
    const workbook = RsfDocument.empty('book.rsf', 4, 2, 'Sheet1');
    const tab = state.addTab('book.rsf', workbook, null);
    const panel = new ValidationCheckPanel(state, grid);
    document.body.append(panel.element);
    return { state, tab, workbook, panel };
  }

  const items = (panel: ValidationCheckPanel) =>
    Array.from(panel.element.querySelectorAll('.comment-item')).map((li) => [
      li.querySelector('.comment-item-ref')?.textContent,
      li.querySelector('.comment-item-text')?.textContent,
    ]);

  it('lists the cells that break their rule and drops a cell once it is fixed', () => {
    const { state, tab, workbook, panel } = setup();
    workbook.setCell(0, 0, 'x');
    workbook.setCell(1, 0, '5');
    workbook.setCell(2, 1, 'y');
    workbook.setValidationsOn(undefined, [
      {
        top: 0,
        left: 0,
        bottom: 3,
        right: 0,
        rule: { kind: 'number', min: null, max: null },
        required: true,
      },
    ]);
    panel.open();
    expect(items(panel)).toEqual([
      ['A1', t('panel.checkData.entry', { value: 'x', reason: t('validation.problem.notNumber') })],
      ['A3', t('validation.problem.required')],
    ]);
    // Values set before the rule can be replaced by valid ones; the list follows.
    expect(state.editCell(tab, 0, 0, '1')).toBe(true);
    panel.render();
    expect(items(panel).map(([ref]) => ref)).toEqual(['A3']);
  });

  it('clicking an entry selects its cell', () => {
    const { state, tab, workbook, panel } = setup();
    workbook.setCell(3, 1, 'too long');
    workbook.setValidationsOn(undefined, [
      { top: 0, left: 1, bottom: 3, right: 1, rule: { kind: 'textLength', min: null, max: 3 } },
    ]);
    panel.open();
    panel.element.querySelector<HTMLElement>('.comment-item')!.click();
    expect(state.activeTab?.selection).toMatchObject({ row: 3, col: 1 });
    expect(tab.doc).toBe(workbook);
  });

  it('says when there are no rules, when everything is valid, and on a CSV tab', () => {
    const { state, workbook, panel } = setup();
    panel.open();
    const message = () => panel.element.querySelector('.comments-empty')?.textContent;
    expect(message()).toBe(t('panel.checkData.noRules'));
    workbook.setValidationsOn(undefined, [
      { top: 0, left: 0, bottom: 0, right: 0, rule: { kind: 'list', values: ['a'] } },
    ]);
    panel.render();
    expect(message()).toBe(t('panel.checkData.allValid'));
    state.addTab('plain.csv', csvDoc('a,b\n'), null);
    panel.render();
    expect(message()).toBe(t('panel.checkData.csvOnly'));
  });
});
