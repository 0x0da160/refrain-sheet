// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * The main toolbar and View > Customize Toolbar…: which commands it can
 * hold (menu commands with an icon), what it shows by default, its button
 * states, and that choosing, reordering, removing and resetting are kept in
 * this browser's storage only.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppState } from '../../src/app/state';
import { Commands, type UiPort } from '../../src/app/commands';
import { t } from '../../src/app/i18n';
import {
  DEFAULT_TOOLBAR_ITEMS,
  getToolbarItems,
  getToolbarShown,
  setToolbarItems,
  setToolbarShown,
} from '../../src/app/toolbar-prefs';
import { RsfDocument } from '../../src/core/workbook/rsf-document';
import { AppToolbar, toolbarCommands } from '../../src/ui/app-toolbar';
import { customizeToolbar } from '../../src/ui/dialogs/toolbar-customize';
import { defaultMenus, type MenuChecks } from '../../src/ui/menu-bar/menus';

const checks = (bold = false): MenuChecks => ({
  wrap: () => false,
  stickyFirstRow: () => false,
  sheetTabsVertical: () => false,
  stickyFirstColumn: () => false,
  freezeAtSelection: () => false,
  sheetFont: () => 'biz-ud',
  theme: () => 'system',
  density: () => 'standard',
  bandedRows: () => false,
  gridlines: () => true,
  highlightRow: () => true,
  highlightCol: () => false,
  zoom: () => 100,
  editHints: () => true,
  toolbar: () => true,
  autoFitOnOpen: () => true,
  fullscreen: () => false,
  formatActive: (key) => bold && key === 'bold',
  driveAvailable: () => false,
  protectedDoc: () => false,
  sheetLocked: () => false,
  headerFilter: () => false,
});

function setup(withDoc = true, bold = false) {
  const state = new AppState();
  const ui = new Proxy({} as UiPort, { get: () => vi.fn(async () => null) });
  const commands = new Commands(state, ui, document);
  const toolbar = new AppToolbar(commands, defaultMenus(checks(bold)));
  document.body.append(toolbar.element);
  let tab = null;
  if (withDoc) {
    tab = state.addTab('t.rsf', RsfDocument.empty('t.rsf', 3, 3), null);
    state.setSelection(tab, { row: 0, col: 0 }, { row: 0, col: 0 });
    toolbar.render();
  }
  return { state, commands, toolbar, tab };
}

const ids = (toolbar: AppToolbar) =>
  [...toolbar.element.querySelectorAll<HTMLElement>('[data-command]')].map((b) => b.dataset.command);

beforeEach(() => {
  document.body.textContent = '';
  localStorage.clear();
});

describe('toolbar: the commands it can hold', () => {
  it('offers every menu command with an icon, once, grouped by menu', () => {
    const available = toolbarCommands(defaultMenus(checks()));
    const byId = new Map(available.map((c) => [c.id, c]));
    expect(byId.get('format.bold')?.menuKey).toBe('menu.format');
    expect(byId.get('edit.undo')?.menuKey).toBe('menu.edit');
    expect(new Set(available.map((c) => c.id)).size).toBe(available.length);
    // Checkable View items without an icon stay menu-only.
    expect(byId.has('view.wrap')).toBe(true);
    expect(byId.has('view.bandedRows')).toBe(false);
    for (const id of DEFAULT_TOOLBAR_ITEMS) {
      expect(byId.has(id), id).toBe(true);
    }
  });
});

describe('toolbar: the bar', () => {
  it('shows the default commands, with dividers between menus', () => {
    const { toolbar } = setup();
    expect(ids(toolbar)).toEqual(DEFAULT_TOOLBAR_ITEMS);
    expect(toolbar.element.querySelectorAll('.app-toolbar-divider').length).toBeGreaterThan(0);
    expect(toolbar.element.getAttribute('role')).toBe('toolbar');
  });

  it('marks unavailable commands and runs available ones', async () => {
    const { toolbar, commands, tab } = setup(true);
    const bold = toolbar.element.querySelector<HTMLButtonElement>('[data-command="format.bold"]')!;
    expect(bold.getAttribute('aria-disabled')).toBe('false');
    bold.click();
    await Promise.resolve();
    expect(commands.isFormatActive(tab!, 'bold')).toBe(true);
    const { toolbar: empty } = setup(false);
    const save = empty.element.querySelector<HTMLButtonElement>('[data-command="format.bold"]')!;
    expect(save.getAttribute('aria-disabled')).toBe('true');
  });

  it('shows a checked command as pressed', () => {
    const { toolbar } = setup(true, true);
    expect(toolbar.element.querySelector('[data-command="format.bold"]')!.getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('can be hidden from the View menu', async () => {
    const { toolbar, commands } = setup();
    await commands.run('view.toolbar');
    expect(getToolbarShown()).toBe(false);
    toolbar.render();
    expect(toolbar.element.hidden).toBe(true);
    setToolbarShown(true);
    toolbar.render();
    expect(toolbar.element.hidden).toBe(false);
  });

  it('keeps stored commands in order and skips ones it does not know', () => {
    setToolbarItems(['sheet.sort', 'no.such.command', 'edit.undo']);
    const { toolbar } = setup();
    expect(ids(toolbar)).toEqual(['sheet.sort', 'edit.undo']);
    localStorage.setItem('refrain-csv-html.toolbarItems', '{not json');
    expect(getToolbarItems()).toEqual(DEFAULT_TOOLBAR_ITEMS);
  });
});

describe('toolbar: Customize Toolbar…', () => {
  const open = () => {
    const { toolbar } = setup();
    const onChange = vi.fn(() => toolbar.render());
    void customizeToolbar(toolbar.available, onChange);
    const rows = () =>
      [...document.querySelectorAll<HTMLElement>('.toolbar-customize-row')].map((r) => r.dataset.command);
    const tool = (id: string, control: string) =>
      document.querySelector<HTMLButtonElement>(
        `.toolbar-customize-row[data-command="${id}"] [data-control="${control}"]`,
      )!;
    return { toolbar, onChange, rows, tool };
  };

  it('moves, removes and adds commands, saving each change at once', () => {
    const { toolbar, onChange, rows, tool } = open();
    expect(rows()).toEqual(DEFAULT_TOOLBAR_ITEMS);
    expect(tool('file.save', 'up').disabled).toBe(true);
    tool('edit.undo', 'up').click();
    expect(rows().slice(0, 2)).toEqual(['edit.undo', 'file.save']);
    expect(getToolbarItems().slice(0, 2)).toEqual(['edit.undo', 'file.save']);
    expect(ids(toolbar).slice(0, 2)).toEqual(['edit.undo', 'file.save']);
    tool('file.save', 'remove').click();
    expect(rows()).not.toContain('file.save');
    const add = document.querySelector<HTMLSelectElement>('#toolbar-customize-add')!;
    add.value = 'data.runSqlQuery';
    [...document.querySelectorAll<HTMLButtonElement>('.side-panel button')]
      .find((b) => b.textContent === t('dialog.toolbar.add'))!
      .click();
    expect(getToolbarItems()[getToolbarItems().length - 1]).toBe('data.runSqlQuery');
    expect(ids(toolbar)).toContain('data.runSqlQuery');
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it('Reset goes back to the default set', () => {
    const { rows, tool } = open();
    tool('sheet.filter', 'remove').click();
    [...document.querySelectorAll<HTMLButtonElement>('.side-panel button')]
      .find((b) => b.textContent === t('dialog.toolbar.reset'))!
      .click();
    expect(localStorage.getItem('refrain-csv-html.toolbarItems')).toBeNull();
    expect(rows()).toEqual(DEFAULT_TOOLBAR_ITEMS);
  });
});
