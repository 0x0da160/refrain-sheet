// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * The grid's cell/header right-click menu was reorganized into submenus by
 * feature group (#396), the same "long flat menu → submenus" treatment
 * already applied to the top menu bar (#280, see `menu-reorg.test.ts`) —
 * Copy/Paste/Select All stay at the top level as the highest-frequency
 * actions, and the rest is grouped into an "Edit" submenu and a
 * "Rows & Columns" submenu (reusing the top menu bar's exact group labels).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/app/app-state';
import { Commands, type UiPort } from '../src/app/commands';
import { t } from '../src/app/i18n';
import { Grid } from '../src/ui/grid';
import { doc } from './helpers';

function stubUi(): UiPort {
  const noop = vi.fn();
  const asyncNoop = vi.fn(async () => undefined);
  return {
    confirmValidation: vi.fn(async () => true),
    confirmUnsaved: vi.fn(async () => 'discard' as const),
    chooseSaveOptions: vi.fn(async () => null),
    promptDriveName: async () => null,
    confirmUnrepresentable: vi.fn(async () => false),
    notifyNcr: asyncNoop,
    confirmUndecodableEdit: vi.fn(async () => true),
    chooseReopen: vi.fn(async () => null),
    confirmConvert: vi.fn(async () => true),
    explainRsfSave: vi.fn(async () => true),
    chooseExportCsv: vi.fn(async () => ({
      encoding: 'utf-8' as const,
      bom: false,
      lineEnding: 'lf' as const,
      delimiter: 'keep' as const,
      quoteStyle: 'minimal' as const,
    })),
    confirmExportXlsx: vi.fn(async () => true),
    confirmExportJson: vi.fn(async () => true),
    chooseInsertShift: vi.fn(async () => null),
    confirmFlashFill: vi.fn(async () => false),
    chooseFilter: vi.fn(async () => null),
    chooseColumnMenu: vi.fn(async () => null),
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
    showMessage: asyncNoop,
    notify: noop,
    openFindBar: noop,
    findNext: noop,
    showAbout: noop,
    showFormulaHelp: noop,
    showSqlQuery: vi.fn(async () => undefined),
    showDiff: vi.fn(async () => undefined),
    chooseSettings: vi.fn(async () => null),
    chooseTimezone: vi.fn(async () => null),
    chooseDisplayLanguage: vi.fn(async () => null),
    chooseVersionHistory: vi.fn(async () => null),
    confirmHistoryCapExceeded: vi.fn(async () => true),
    chooseTextColor: vi.fn(async () => null),
    chooseRichText: vi.fn(async () => null),
    chooseBackgroundColor: vi.fn(async () => null),
    chooseBorders: vi.fn(async () => null),
    chooseNumberFormat: vi.fn(async () => null),
    chooseRecentFile: vi.fn(async () => null),
    setBusy: noop,
  };
}

function grid3x3() {
  const state = new AppState();
  const commands = new Commands(state, stubUi(), document);
  const grid = new Grid(state, commands);
  Object.defineProperty(grid.element, 'clientHeight', { value: 520, configurable: true });
  Object.defineProperty(grid.element, 'clientWidth', { value: 900, configurable: true });
  document.body.append(grid.element);
  const tab = state.addTab('s.csv', doc('a,b,c\nd,e,f\ng,h,i\n'), null);
  grid.refresh();
  return { state, commands, grid, tab };
}

function openCellContextMenu(grid: Grid, row = 0, col = 0): void {
  const cell = grid.element.querySelector<HTMLElement>(`[data-row="${row}"][data-col="${col}"]`)!;
  cell.dispatchEvent(
    new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }),
  );
}

function topLevelLabels(): (string | null)[] {
  return Array.from(document.querySelectorAll('.context-menu:not(.submenu) > .menu-item .label')).map(
    (el) => el.textContent,
  );
}

function openSubmenu(label: string): void {
  const parent = Array.from(document.querySelectorAll<HTMLButtonElement>('.context-menu > .menu-item')).find(
    (b) => b.querySelector('.label')?.textContent === label,
  )!;
  parent.click();
}

function submenuLabels(): (string | null)[] {
  return Array.from(document.querySelectorAll('.context-menu.submenu > .menu-item .label')).map(
    (el) => el.textContent,
  );
}

beforeEach(() => {
  document.body.textContent = '';
});

describe('the grid right-click menu (#396)', () => {
  it('keeps Cut/Copy/Paste/Select All at the top level and groups the rest into Edit / Rows & Columns', () => {
    const { state, grid, tab } = grid3x3();
    state.setSelection(tab, { row: 0, col: 0 }, null);
    openCellContextMenu(grid);

    expect(topLevelLabels()).toEqual([
      t('menu.edit.cut'),
      t('menu.edit.copy'),
      t('menu.edit.paste'),
      t('menu.edit.selectAll'),
      t('menu.edit'),
      t('menu.data.comment'),
      t('menu.sheet.filter'),
      t('menu.sheet.filterClear'),
      t('menu.sheet.rowsAndColumns'),
    ]);
  });

  it('shows a leading icon on every item, submenu parents included, like the menu bar', () => {
    const { state, grid, tab } = grid3x3();
    state.setSelection(tab, { row: 0, col: 0 }, null);
    openCellContextMenu(grid);
    const items = Array.from(document.querySelectorAll('.context-menu:not(.submenu) > .menu-item'));
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.querySelector('.check .item-icon'), item.textContent ?? '').not.toBeNull();
    }
    openSubmenu(t('menu.sheet.rowsAndColumns'));
    const subItems = Array.from(document.querySelectorAll('.context-menu.submenu > .menu-item'));
    for (const item of subItems) {
      expect(item.querySelector('.check .item-icon'), item.textContent ?? '').not.toBeNull();
    }
  });

  it('reaches every previously-flat edit command inside the Edit submenu', () => {
    const { state, grid, tab } = grid3x3();
    state.setSelection(tab, { row: 0, col: 0 }, null);
    openCellContextMenu(grid);

    openSubmenu(t('menu.edit'));
    expect(submenuLabels()).toEqual([
      t('menu.edit.copyScreenshot'),
      t('menu.edit.copyAsMarkdown'),
      t('menu.edit.insertCopiedCells'),
      t('menu.edit.insertCopiedRows'),
      t('menu.edit.insertCopiedCols'),
      t('menu.edit.flashFill'),
      t('menu.edit.moveRange'),
      t('menu.edit.revertCell'),
    ]);
  });

  it('reaches every previously-flat row/column command inside the Rows & Columns submenu', () => {
    const { state, grid, tab } = grid3x3();
    state.setSelection(tab, { row: 0, col: 0 }, null);
    openCellContextMenu(grid);

    openSubmenu(t('menu.sheet.rowsAndColumns'));
    expect(submenuLabels()).toEqual([
      t('menu.sheet.insertRowAbove'),
      t('menu.sheet.insertRowBelow'),
      t('menu.sheet.deleteRows'),
      t('menu.sheet.insertColLeft'),
      t('menu.sheet.insertColRight'),
      t('menu.sheet.deleteCols'),
      t('menu.sheet.autoFitCols'),
    ]);
  });

  it('still runs the underlying command when a grouped item is clicked', () => {
    const { state, grid, commands, tab } = grid3x3();
    state.setSelection(tab, { row: 0, col: 0 }, null);
    const run = vi.spyOn(commands, 'run');
    openCellContextMenu(grid);

    openSubmenu(t('menu.edit'));
    // Revert Cell stays disabled (the cell was never edited), so exercise an
    // always-enabled grouped command instead: Copy as Markdown only needs a
    // selection, like the top-level Copy button does.
    const copyAsMarkdown = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.context-menu.submenu > .menu-item'),
    ).find((b) => b.querySelector('.label')?.textContent === t('menu.edit.copyAsMarkdown'))!;
    expect(copyAsMarkdown.disabled).toBe(false);
    copyAsMarkdown.click();

    expect(run).toHaveBeenCalledWith('edit.copyAsMarkdown');
    // The whole context menu (including the submenu) closes after a selection.
    expect(document.querySelector('.context-menu')).toBeNull();
  });
});
