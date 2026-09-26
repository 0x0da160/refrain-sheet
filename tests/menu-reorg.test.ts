// SPDX-License-Identifier: MIT
/**
 * The Sheet, Edit, and View menus were reorganized into grouped submenus
 * (#280) once they grew long enough to be hard to scan. This locks in the
 * new top-level shape and confirms every original command is still reachable
 * — nested one level deeper, but with the exact same `command` id, so no
 * caller (shortcuts, context menu, tests) needs to change.
 *
 * The File, Edit, and Format menus got the same treatment in #518: File in
 * particular had grown to ~14 flat entries (the "long" menu the issue named
 * explicitly), so its export variants and per-document actions (reopen,
 * protect, convert) were grouped into Export/Document submenus, mirroring
 * the Sheet/View precedent above. Edit and Format each had one small,
 * clearly-related family (alternate copy formats; revert actions; color and
 * border formatting) pulled into their own submenu for the same reason.
 */
import { describe, expect, it } from 'vitest';
import { defaultMenus, type MenuChecks, type MenuDef, type MenuItemDef } from '../src/ui/menu-bar';

function checks(): MenuChecks {
  return {
    wrap: () => false,
    stickyFirstRow: () => false,
    stickyFirstColumn: () => false,
    freezeAtSelection: () => false,
    sheetFont: () => 'biz-ud',
    theme: () => 'system',
    density: () => 'standard',
    zoom: () => 100,
    editHints: () => true,
    autoFitOnOpen: () => true,
    commentsPanel: () => false,
    formatActive: () => false,
    driveAvailable: () => false,
    protectedDoc: () => false,
    sheetLocked: () => false,
    headerFilter: () => false,
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
    // No longer directly on the top-level Sheet menu.
    expect(topLevel.some((i) => i.command === 'worksheet.add')).toBe(false);
    expect(topLevel.some((i) => i.command === 'sheet.insertRowAbove')).toBe(false);
    expect(topLevel.some((i) => i.command === 'sheet.filter')).toBe(false);
    // The Sheet menu's own Export CSV/XLSX entries were removed as an exact
    // duplicate of the File menu's (#393); they still exist there, now
    // nested inside File > Export (#518 — see the File menu describe block
    // below for the full Export submenu assertion).
    expect(topLevel.some((i) => i.command === 'sheet.exportCsv')).toBe(false);
    expect(topLevel.some((i) => i.command === 'sheet.exportXlsx')).toBe(false);
    const fileExport = submenuOf(menu('menu.file'), 'menu.file.export');
    expect(fileExport.some((i) => i.command === 'sheet.exportCsv')).toBe(true);
    expect(fileExport.some((i) => i.command === 'sheet.exportXlsx')).toBe(true);
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

  it('flips the Lock Sheet item label between its two states, distinct from book-protect wording', () => {
    const resolve = (item: MenuItemDef): string =>
      typeof item.labelKey === 'function' ? item.labelKey() : item.labelKey;

    const unlocked = submenuOf(menu('menu.sheet'), 'menu.sheet.worksheet').find(
      (i) => i.command === 'worksheet.toggleLock',
    )!;
    expect(resolve(unlocked)).toBe('menu.sheet.lockSheet');

    const locked = submenuOf(
      defaultMenus({ ...checks(), sheetLocked: () => true }).find((m) => m.labelKey === 'menu.sheet')!,
      'menu.sheet.worksheet',
    ).find((i) => i.command === 'worksheet.toggleLock')!;
    expect(resolve(locked)).toBe('menu.sheet.unlockSheet');
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
      'sheet.headerFilter',
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

  it('groups the alternate copy formats into a Copy As submenu, leaving Copy itself at the top level (#518)', () => {
    const copyAs = submenuOf(menu('menu.edit'), 'menu.edit.copyAs');
    expect(copyAs.map((i) => i.command)).toEqual(['edit.copyScreenshot', 'edit.copyAsMarkdown']);
    const topLevel = items(menu('menu.edit'));
    expect(topLevel.some((i) => i.command === 'edit.copy')).toBe(true);
    expect(topLevel.some((i) => i.command === 'edit.copyScreenshot')).toBe(false);
  });

  it('groups Revert Cell and Revert All into a Revert submenu (#518)', () => {
    const revert = submenuOf(menu('menu.edit'), 'menu.edit.revert');
    expect(revert.map((i) => i.command)).toEqual(['edit.revertCell', 'edit.revertAll']);
    expect(items(menu('menu.edit')).some((i) => i.command === 'edit.revertCell')).toBe(false);
  });
});

describe('File menu reorganization (#518)', () => {
  it('keeps New, New CSV, Open, and Save at the top level and groups the rest into submenus', () => {
    const file = menu('menu.file');
    const topLevel = items(file);
    for (const command of ['file.new', 'file.newCsv', 'file.open', 'file.save']) {
      expect(topLevel.some((i) => i.command === command)).toBe(true);
    }
    expect(topLevel.find((i) => i.labelKey === 'menu.file.export')?.submenu).toBeDefined();
    expect(topLevel.find((i) => i.labelKey === 'menu.file.document')?.submenu).toBeDefined();
    // No longer directly on the top-level File menu.
    expect(topLevel.some((i) => i.command === 'file.reopen')).toBe(false);
    expect(topLevel.some((i) => i.command === 'file.toggleProtect')).toBe(false);
    expect(topLevel.some((i) => i.command === 'sheet.convert')).toBe(false);
    expect(topLevel.some((i) => i.command === 'file.saveOptions')).toBe(false);
    expect(topLevel.some((i) => i.command === 'sheet.exportCsv')).toBe(false);
    // Settings and Close Tab remain top-level, single-item actions.
    expect(topLevel.some((i) => i.command === 'app.settings')).toBe(true);
    expect(topLevel.some((i) => i.command === 'file.closeTab')).toBe(true);
  });

  it('keeps every export command reachable inside the Export submenu', () => {
    const exportSub = submenuOf(menu('menu.file'), 'menu.file.export');
    expect(exportSub.map((i) => i.command)).toEqual([
      'file.saveOptions',
      'sheet.exportCsv',
      'sheet.exportXlsx',
      'sheet.exportJson',
    ]);
  });

  it('keeps every per-document command reachable inside the Document submenu', () => {
    const documentSub = submenuOf(menu('menu.file'), 'menu.file.document');
    expect(documentSub.map((i) => i.command)).toEqual(['file.reopen', 'file.toggleProtect', 'sheet.convert']);
  });

  it('flips the Protect Book item label between its two states, distinct from worksheet-lock wording', () => {
    const resolve = (item: MenuItemDef): string =>
      typeof item.labelKey === 'function' ? item.labelKey() : item.labelKey;

    const unprotected = submenuOf(menu('menu.file'), 'menu.file.document').find(
      (i) => i.command === 'file.toggleProtect',
    )!;
    expect(resolve(unprotected)).toBe('menu.file.protectBook');

    const protectedItem = submenuOf(
      defaultMenus({ ...checks(), protectedDoc: () => true }).find((m) => m.labelKey === 'menu.file')!,
      'menu.file.document',
    ).find((i) => i.command === 'file.toggleProtect')!;
    expect(resolve(protectedItem)).toBe('menu.file.unprotectBook');
  });

  it('keeps the Google Drive submenu when Drive sync is available', () => {
    const drive = defaultMenus({ ...checks(), driveAvailable: () => true }).find(
      (m) => m.labelKey === 'menu.file',
    );
    const topLevel = items(drive!);
    expect(topLevel.find((i) => i.labelKey === 'menu.file.drive')?.submenu).toBeDefined();
  });
});

describe('Format menu reorganization (#518)', () => {
  it('groups Text Color, Background Color, and Borders into a Color & Borders submenu', () => {
    const colorAndBorders = submenuOf(menu('menu.format'), 'menu.format.colorAndBorders');
    expect(colorAndBorders.map((i) => i.command)).toEqual([
      'format.textColor',
      'format.backgroundColor',
      'format.borders',
    ]);
    const topLevel = items(menu('menu.format'));
    expect(topLevel.some((i) => i.command === 'format.textColor')).toBe(false);
    // Bold/Italic/Underline (the most frequently used Format commands) and
    // the other single-item entries are unaffected.
    expect(topLevel.some((i) => i.command === 'format.bold')).toBe(true);
    expect(topLevel.some((i) => i.command === 'format.numberFormat')).toBe(true);
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

  it('offers the hybrid theme choice alongside system/light/dark (#363)', () => {
    const themeSub = submenuOf(menu('menu.view'), 'menu.view.theme');
    const hybrid = themeSub.find((i) => i.command === 'view.theme.hybrid');
    expect(hybrid).toBeDefined();
    expect(hybrid?.labelKey).toBe('theme.hybrid');
    expect(hybrid?.checked?.()).toBe(false);
  });

  it('offers the three densities in a View > Density submenu, standard checked (design system D-04)', () => {
    const densitySub = submenuOf(menu('menu.view'), 'menu.view.density');
    expect(densitySub.map((i) => i.command)).toEqual([
      'view.density.compact',
      'view.density.standard',
      'view.density.comfortable',
    ]);
    expect(densitySub.map((i) => i.labelKey)).toEqual([
      'density.compact',
      'density.standard',
      'density.comfortable',
    ]);
    expect(densitySub.filter((i) => i.checked?.()).map((i) => i.command)).toEqual(['view.density.standard']);
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
