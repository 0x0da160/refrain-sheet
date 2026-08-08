// SPDX-License-Identifier: MIT
/**
 * The Sheet, Edit, and View menus were reorganized into grouped submenus
 * (#280) once they grew long enough to be hard to scan. This locks in the
 * new top-level shape and confirms every original command is still reachable
 * — nested one level deeper, but with the exact same `command` id, so no
 * caller (shortcuts, context menu, tests) needs to change.
 */
import { describe, expect, it } from 'vitest';
import { defaultMenus, type MenuChecks, type MenuDef, type MenuItemDef } from '../src/ui/menu-bar';

function checks(): MenuChecks {
  return {
    wrap: () => false,
    stickyFirstRow: () => false,
    stickyFirstColumn: () => false,
    sheetFont: () => 'biz-ud',
    theme: () => 'system',
    zoom: () => 100,
    editHints: () => true,
    formatActive: () => false,
  };
}

const items = (menu: MenuDef): MenuItemDef[] => menu.items.filter((i): i is MenuItemDef => i !== 'separator');

function menu(labelKey: string): MenuDef {
  const found = defaultMenus(checks()).find((m) => m.labelKey === labelKey);
  if (!found) throw new Error(`menu not found: ${labelKey}`);
  return found;
}

function submenuOf(menuDef: MenuDef, labelKey: string): MenuItemDef[] {
  const parent = items(menuDef).find((i) => i.labelKey === labelKey);
  if (!parent?.submenu) throw new Error(`no submenu for ${labelKey}`);
  return parent.submenu.filter((i): i is MenuItemDef => i !== 'separator');
}

describe('Sheet menu reorganization', () => {
  it('groups worksheet, row/column, and filter/sort commands into submenus', () => {
    const sheet = menu('menu.sheet');
    const topLevel = items(sheet);
    expect(topLevel.find((i) => i.labelKey === 'menu.sheet.worksheet')?.submenu).toBeDefined();
    expect(topLevel.find((i) => i.labelKey === 'menu.sheet.rowsAndColumns')?.submenu).toBeDefined();
    expect(topLevel.find((i) => i.labelKey === 'menu.sheet.filterSort')?.submenu).toBeDefined();
    // Commands that stayed at the top level (not grouped into a submenu).
    expect(topLevel.some((i) => i.command === 'sheet.recalculate')).toBe(true);
    expect(topLevel.some((i) => i.command === 'sheet.exportCsv')).toBe(true);
    expect(topLevel.some((i) => i.command === 'sheet.exportXlsx')).toBe(true);
    // No longer directly on the top-level Sheet menu.
    expect(topLevel.some((i) => i.command === 'worksheet.add')).toBe(false);
    expect(topLevel.some((i) => i.command === 'sheet.insertRowAbove')).toBe(false);
    expect(topLevel.some((i) => i.command === 'sheet.filter')).toBe(false);
  });

  it('keeps every worksheet command reachable inside the Worksheet submenu', () => {
    const worksheet = submenuOf(menu('menu.sheet'), 'menu.sheet.worksheet');
    const commands = worksheet.map((i) => i.command);
    expect(commands).toEqual(
      expect.arrayContaining([
        'worksheet.add',
        'worksheet.rename',
        'worksheet.duplicate',
        'worksheet.delete',
        'worksheet.next',
        'worksheet.prev',
        'worksheet.moveFirst',
        'worksheet.moveLeft',
        'worksheet.moveRight',
        'worksheet.moveLast',
      ]),
    );
  });

  it('keeps every row/column command reachable inside the Rows & Columns submenu', () => {
    const rowsAndColumns = submenuOf(menu('menu.sheet'), 'menu.sheet.rowsAndColumns');
    const commands = rowsAndColumns.map((i) => i.command);
    expect(commands).toEqual(
      expect.arrayContaining([
        'sheet.insertRowAbove',
        'sheet.insertRowBelow',
        'sheet.deleteRows',
        'sheet.insertColLeft',
        'sheet.insertColRight',
        'sheet.deleteCols',
        'sheet.autoFitCols',
      ]),
    );
  });

  it('keeps every filter/sort command reachable inside the Filter & Sort submenu', () => {
    const filterSort = submenuOf(menu('menu.sheet'), 'menu.sheet.filterSort');
    expect(filterSort.map((i) => i.command)).toEqual([
      'sheet.filter',
      'sheet.filterClear',
      'sheet.sort',
      'sheet.sortClear',
    ]);
  });
});

describe('Edit menu reorganization', () => {
  it('groups the three "insert copied" commands into an Insert Copied submenu', () => {
    const edit = menu('menu.edit');
    const topLevel = items(edit);
    const insertCopied = topLevel.find((i) => i.labelKey === 'menu.edit.insertCopied');
    expect(insertCopied?.submenu).toBeDefined();
    expect(topLevel.some((i) => i.command === 'edit.insertCopiedCells')).toBe(false);

    const nested = insertCopied!.submenu!.filter((i): i is MenuItemDef => i !== 'separator');
    expect(nested.map((i) => i.command)).toEqual([
      'edit.insertCopiedCells',
      'edit.insertCopiedRows',
      'edit.insertCopiedCols',
    ]);
    // Unrelated Edit commands are unaffected.
    expect(topLevel.some((i) => i.command === 'edit.undo')).toBe(true);
    expect(topLevel.some((i) => i.command === 'edit.fillDown')).toBe(true);
  });
});

describe('View menu reorganization', () => {
  it('turns Spreadsheet Font, Theme, and Move Tab into submenus alongside Zoom', () => {
    const view = menu('menu.view');
    const topLevel = items(view);
    for (const key of ['menu.view.zoom', 'menu.view.sheetFont', 'menu.view.theme', 'menu.view.moveTab']) {
      const entry = topLevel.find((i) => i.labelKey === key);
      expect(entry?.submenu, `${key} should have a submenu`).toBeDefined();
      expect(entry?.heading).toBeFalsy();
    }
    // Font and theme choices are no longer flattened directly into View.
    expect(topLevel.some((i) => i.command === 'view.sheetFont.bizUd')).toBe(false);
    expect(topLevel.some((i) => i.command === 'view.theme.system')).toBe(false);
    expect(topLevel.some((i) => i.command === 'tab.moveLeft')).toBe(false);
  });

  it('keeps the checked sheet-font and theme choices reachable in their submenus', () => {
    const view = menu('menu.view');
    const fontSub = submenuOf(view, 'menu.view.sheetFont');
    const bizUd = fontSub.find((i) => i.command === 'view.sheetFont.bizUd');
    expect(bizUd?.checked?.()).toBe(true);

    const themeSub = submenuOf(view, 'menu.view.theme');
    const system = themeSub.find((i) => i.command === 'view.theme.system');
    expect(system?.checked?.()).toBe(true);
  });

  it('keeps every tab-movement command reachable inside the Move Tab submenu', () => {
    const moveTab = submenuOf(menu('menu.view'), 'menu.view.moveTab');
    expect(moveTab.map((i) => i.command)).toEqual([
      'tab.moveFirst',
      'tab.moveLeft',
      'tab.moveRight',
      'tab.moveLast',
    ]);
  });

  it('the Language group stays a top-level heading, not folded into a submenu', () => {
    const topLevel = items(menu('menu.view'));
    expect(topLevel.some((i) => i.labelKey === 'menu.language' && i.heading)).toBe(true);
  });
});
