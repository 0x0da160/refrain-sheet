// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * The right-side comments panel: sheet-scope vs. workbook-scope listing,
 * click-to-jump (including cross-worksheet navigation), and the plain-CSV
 * explanation. Mirrors `find-bar.test.ts` and `sheet-bar.test.ts`.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { AppState } from '../src/app/app-state';
import { Commands, type UiPort } from '../src/app/commands';
import { t } from '../src/app/i18n';
import { RsfDocument } from '../src/core/rsf-document';
import { CommentsPanel } from '../src/ui/comments-panel';
import { Grid } from '../src/ui/grid';
import { doc as csvDoc } from './helpers';

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
  chooseRsfSave: async () => 2,
  chooseExportCsv: async () => null,
  confirmExportXlsx: async () => true,
  confirmExportJson: async () => true,
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
  showSqlQuery: async () => undefined,
  showDiff: async () => undefined,
  chooseSettings: async () => null,
  chooseTimezone: async () => null,
  chooseDisplayLanguage: async () => null,
  chooseVersionHistoryEnabled: async () => null,
  chooseTextColor: async () => null,
  chooseBackgroundColor: async () => null,
  chooseBorders: async () => null,
  chooseNumberFormat: async () => null,
  setBusy: () => undefined,
};

function setupWorkbook() {
  const state = new AppState();
  const commands = new Commands(state, noopUi, document);
  const grid = new Grid(state, commands);
  document.body.append(grid.element);
  const workbook = RsfDocument.empty('book.rsf', 4, 4, 'Sheet1');
  const tab = state.addTab('book.rsf', workbook, null);
  const sheet1 = workbook.sheets[0];
  // addSheet activates the newly created worksheet; switch back to Sheet1 so
  // every test starts from a known active sheet.
  const sheet2 = state.addSheet(tab, 'Sheet2');
  state.setActiveSheet(tab, sheet1.id);
  const panel = new CommentsPanel(state, grid);
  document.body.append(panel.element);
  return { state, commands, grid, tab, workbook, sheet1, sheet2, panel };
}

beforeEach(() => {
  document.body.textContent = '';
});

describe('CommentsPanel', () => {
  it('starts closed and shows nothing until opened', () => {
    const { panel } = setupWorkbook();
    expect(panel.isOpen).toBe(false);
    expect(panel.element.hidden).toBe(true);
  });

  it('lists the active sheet’s comments, sorted, in sheet scope', () => {
    const { sheet1, panel } = setupWorkbook();
    sheet1.setComment(2, 0, 'second');
    sheet1.setComment(0, 1, 'first');
    panel.open();

    const items = panel.element.querySelectorAll('.comment-item');
    expect(items).toHaveLength(2);
    expect(items[0].querySelector('.comment-item-ref')?.textContent).toBe('B1');
    expect(items[0].querySelector('.comment-item-text')?.textContent).toBe('first');
    expect(items[1].querySelector('.comment-item-ref')?.textContent).toBe('A3');
  });

  it('shows an empty message when the active sheet has no comments', () => {
    const { panel } = setupWorkbook();
    panel.open();
    expect(panel.element.querySelector('.comments-list')?.children).toHaveLength(0);
    expect((panel.element.querySelector('.comments-empty') as HTMLElement).hidden).toBe(false);
  });

  it('workbook scope lists comments from every worksheet, labeled by sheet', () => {
    const { sheet1, sheet2, panel } = setupWorkbook();
    if (!sheet2) throw new Error('expected addSheet to succeed');
    sheet1.setComment(0, 0, 'on sheet1');
    sheet2.setComment(1, 1, 'on sheet2');
    panel.open();

    const scopeSelect = panel.element.querySelector('.comments-scope') as HTMLSelectElement;
    scopeSelect.value = 'workbook';
    scopeSelect.dispatchEvent(new Event('change'));

    const items = panel.element.querySelectorAll('.comment-item');
    expect(items).toHaveLength(2);
    expect(items[0].querySelector('.comment-item-sheet')?.textContent).toBe('Sheet1');
    expect(items[1].querySelector('.comment-item-sheet')?.textContent).toBe('Sheet2');
  });

  it('clicking an item on the active sheet selects and reveals that cell', () => {
    const { state, tab, sheet1, panel } = setupWorkbook();
    sheet1.setComment(1, 2, 'note');
    panel.open();

    const item = panel.element.querySelector('.comment-item') as HTMLElement;
    item.click();

    expect(state.activeTab).toBe(tab);
    expect(tab.selection).toEqual({ row: 1, col: 2 });
  });

  it('clicking a workbook-scope item on another sheet switches sheets first, then reveals', () => {
    const { state, tab, sheet1, sheet2, panel } = setupWorkbook();
    if (!sheet2) throw new Error('expected addSheet to succeed');
    sheet2.setComment(3, 0, 'on sheet2');
    state.setActiveSheet(tab, sheet1.id);
    panel.open();

    const scopeSelect = panel.element.querySelector('.comments-scope') as HTMLSelectElement;
    scopeSelect.value = 'workbook';
    scopeSelect.dispatchEvent(new Event('change'));

    const item = panel.element.querySelector('.comment-item') as HTMLElement;
    item.click();

    expect(tab.doc.kind === 'rsf' && tab.doc.activeSheetId).toBe(sheet2.id);
    expect(tab.selection).toEqual({ row: 3, col: 0 });
  });

  it('explains that comments need RSF on a plain CSV tab, and disables the scope selector', () => {
    const state = new AppState();
    const commands = new Commands(state, noopUi, document);
    const grid = new Grid(state, commands);
    document.body.append(grid.element);
    state.addTab('data.csv', csvDoc('a,b\n1,2\n'), null);
    const panel = new CommentsPanel(state, grid);
    document.body.append(panel.element);

    panel.open();

    expect(panel.element.querySelectorAll('.comment-item')).toHaveLength(0);
    expect((panel.element.querySelector('.comments-empty') as HTMLElement).hidden).toBe(false);
    const scopeSelect = panel.element.querySelector('.comments-scope') as HTMLSelectElement;
    expect(scopeSelect.disabled).toBe(true);
  });

  it('toggle() flips open/closed state', () => {
    const { panel } = setupWorkbook();
    expect(panel.isOpen).toBe(false);
    panel.toggle();
    expect(panel.isOpen).toBe(true);
    panel.toggle();
    expect(panel.isOpen).toBe(false);
  });

  describe('dockable side panel chrome (#399)', () => {
    it('is a dockable, resizable side panel like Filter/Sort/Format/SQL Query', () => {
      const { panel } = setupWorkbook();
      expect(panel.element.classList.contains('side-panel')).toBe(true);
      // Four dock-position buttons (top/right/bottom/left) plus a resize handle.
      const positions = ['top', 'right', 'bottom', 'left'] as const;
      for (const position of positions) {
        expect(
          panel.element.querySelector(`[title="${t(`dialog.sidePanel.position.${position}`)}"]`),
        ).not.toBeNull();
      }
      expect(panel.element.querySelector('.side-panel-resize-handle')).not.toBeNull();
    });

    it('reserves app-edge space only while open, and releases it on close', () => {
      const { panel } = setupWorkbook();
      const app = document.createElement('div');
      app.id = 'app';
      const appBody = document.createElement('div');
      appBody.id = 'app-body';
      app.append(appBody);
      document.body.append(app);

      panel.open();
      // Force a known dock side, independent of whatever a previous test in
      // this run left the shared (session-remembered) position at.
      panel.element
        .querySelector<HTMLButtonElement>(`[title="${t('dialog.sidePanel.position.right')}"]`)!
        .click();
      expect(app.style.paddingRight).not.toBe('');

      panel.close();
      expect(app.style.paddingRight).toBe('');

      // Reopening re-applies whatever dock side/size was last chosen.
      panel.open();
      expect(app.style.paddingRight).not.toBe('');
    });
  });
});
