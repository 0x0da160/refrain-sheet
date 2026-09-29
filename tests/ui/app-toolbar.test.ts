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
import { SHOW_DELAY_MS } from '../../src/ui/tooltip';
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
  alignActive: () => false,
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

describe('toolbar: which commands apply here', () => {
  it('turns cell formatting off on a Markdown sheet, saying why', () => {
    const { state, toolbar, tab } = setup(true);
    state.addMarkdownSheet(tab!, 'Notes');
    toolbar.render();
    const bold = toolbar.element.querySelector<HTMLButtonElement>('[data-command="format.bold"]')!;
    expect(bold.getAttribute('aria-disabled')).toBe('true');
    expect(bold.dataset.tooltip).toContain(t('menu.format.textSheetTooltip'));
    expect(bold.getAttribute('aria-description')).toBe(t('menu.format.textSheetTooltip'));
    // Cut/Copy/Paste stay on: there they act on the sheet's text editor.
    const cut = toolbar.element.querySelector<HTMLButtonElement>('[data-command="edit.cut"]')!;
    expect(cut.getAttribute('aria-disabled')).toBe('false');
    const sort = toolbar.element.querySelector<HTMLButtonElement>('[data-command="sheet.sort"]')!;
    expect(sort.getAttribute('aria-disabled')).toBe('true');
  });

  it('turns cell formatting off while a shape is picked', async () => {
    const { state, commands, toolbar, tab } = setup(true);
    await commands.run('insert.rectangle');
    const doc = tab!.doc as RsfDocument;
    state.objectSelection.select(tab!, [doc.objects[0].id]);
    toolbar.render();
    const bold = toolbar.element.querySelector<HTMLButtonElement>('[data-command="format.bold"]')!;
    expect(bold.getAttribute('aria-disabled')).toBe('true');
    expect(bold.dataset.tooltip).toContain(t('menu.format.objectsTooltip'));
    state.objectSelection.select(tab!, []);
    toolbar.render();
    expect(toolbar.element.querySelector('[data-command="format.bold"]')!.getAttribute('aria-disabled')).toBe(
      'false',
    );
  });
});

describe('toolbar: tooltips', () => {
  it('uses the quick tooltip instead of the browser title', () => {
    vi.useFakeTimers();
    try {
      const { toolbar } = setup(true);
      const bold = toolbar.element.querySelector<HTMLButtonElement>('[data-command="format.bold"]')!;
      expect(bold.hasAttribute('title')).toBe(false);
      bold.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
      const tip = () => document.querySelector<HTMLElement>('.app-tooltip');
      expect(tip()?.hidden ?? true).toBe(true);
      vi.advanceTimersByTime(SHOW_DELAY_MS);
      expect(tip()!.hidden).toBe(false);
      expect(tip()!.textContent).toContain(t('menu.format.bold'));
      // Moving straight to the next button shows its tooltip at once.
      const italic = toolbar.element.querySelector<HTMLButtonElement>('[data-command="format.italic"]')!;
      bold.dispatchEvent(new MouseEvent('pointerout', { bubbles: true, relatedTarget: italic }));
      italic.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
      expect(tip()!.textContent).toContain(t('menu.format.italic'));
      italic.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      expect(tip()!.hidden).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('toolbar: settings', () => {
  it('File > Settings… shows or hides the toolbar', async () => {
    const state = new AppState();
    const ui = new Proxy({} as UiPort, {
      get: (_, key) =>
        key === 'chooseSettings'
          ? vi.fn(async (current: { showToolbar: boolean }) => ({ ...current, showToolbar: false }))
          : vi.fn(async () => null),
    });
    const commands = new Commands(state, ui, document);
    expect(getToolbarShown()).toBe(true);
    await commands.run('app.settings');
    expect(getToolbarShown()).toBe(false);
  });
});

describe('toolbar: Customize Toolbar… drag', () => {
  it('drags a row by its grip to a new place', () => {
    const { toolbar } = setup();
    void customizeToolbar(toolbar.available, () => toolbar.render());
    const rows = [...document.querySelectorAll<HTMLElement>('.toolbar-customize-row')];
    rows.forEach((row, i) => {
      row.getBoundingClientRect = () => ({ top: i * 20, height: 20, bottom: i * 20 + 20 }) as DOMRect;
    });
    const grip = rows[0].querySelector<HTMLElement>('.toolbar-customize-grip')!;
    const pointer = (type: string, clientY: number) =>
      Object.assign(new MouseEvent(type, { bubbles: true, button: 0, clientY }), { pointerId: 1 });
    grip.dispatchEvent(pointer('pointerdown', 10));
    grip.dispatchEvent(pointer('pointermove', 55));
    expect(rows[2].classList.contains('drop-after')).toBe(true);
    grip.dispatchEvent(pointer('pointerup', 55));
    expect(getToolbarItems().slice(0, 3)).toEqual(['edit.undo', 'edit.redo', 'file.save']);
    expect(ids(toolbar).slice(0, 3)).toEqual(['edit.undo', 'edit.redo', 'file.save']);
  });

  it('Escape cancels a drag', () => {
    const { toolbar } = setup();
    void customizeToolbar(toolbar.available, () => toolbar.render());
    const rows = [...document.querySelectorAll<HTMLElement>('.toolbar-customize-row')];
    rows.forEach((row, i) => {
      row.getBoundingClientRect = () => ({ top: i * 20, height: 20, bottom: i * 20 + 20 }) as DOMRect;
    });
    const grip = rows[0].querySelector<HTMLElement>('.toolbar-customize-grip')!;
    const pointer = (type: string, clientY: number) =>
      Object.assign(new MouseEvent(type, { bubbles: true, button: 0, clientY }), { pointerId: 1 });
    grip.dispatchEvent(pointer('pointerdown', 10));
    grip.dispatchEvent(pointer('pointermove', 55));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    grip.dispatchEvent(pointer('pointerup', 55));
    expect(getToolbarItems()).toEqual(DEFAULT_TOOLBAR_ITEMS);
  });
});
