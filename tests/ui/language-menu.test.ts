// SPDX-License-Identifier: MIT
/**
 * The Language selector lives under the View menu (no top-level Language
 * menu). Runtime switching, persistence, and the English fallback are
 * unchanged and covered by i18n.test; here we assert the menu placement and
 * that the language commands are still reachable and reflect the active
 * locale.
 */
import { describe, expect, it } from 'vitest';
import { defaultMenus, type MenuChecks, type MenuDef, type MenuItemDef } from '../../src/ui/menu-bar/menus';
import { getLocale, setLocale } from '../../src/app/i18n';

function checks(): MenuChecks {
  return {
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
    formatActive: () => false,
    alignActive: () => false,
    driveAvailable: () => false,
    protectedDoc: () => false,
    sheetLocked: () => false,
    headerFilter: () => false,
  };
}

const items = (menu: MenuDef): MenuItemDef[] => menu.items.filter((i): i is MenuItemDef => i !== 'separator');

/** View > Language's entries. */
const languages = (menu: MenuDef): MenuItemDef[] =>
  (items(menu).find((i) => i.labelKey === 'menu.language')?.submenu ?? []).filter(
    (i): i is MenuItemDef => i !== 'separator',
  );

describe('Language menu placement', () => {
  it('has no top-level Language menu', () => {
    const menus = defaultMenus(checks());
    expect(menus.some((m) => m.labelKey === 'menu.language')).toBe(false);
  });

  it('exposes a Language submenu with both locales under View', () => {
    const view = defaultMenus(checks()).find((m) => m.labelKey === 'menu.view');
    expect(view).toBeDefined();
    expect(languages(view!).map((i) => i.command)).toEqual(['lang.en', 'lang.ja']);
  });

  it('the language items reflect the active locale', () => {
    const before = getLocale();
    try {
      setLocale('ja');
      const view = defaultMenus(checks()).find((m) => m.labelKey === 'menu.view')!;
      const ja = languages(view).find((i) => i.command === 'lang.ja')!;
      const en = languages(view).find((i) => i.command === 'lang.en')!;
      expect(ja.checked?.()).toBe(true);
      expect(en.checked?.()).toBe(false);
      setLocale('en');
      const view2 = defaultMenus(checks()).find((m) => m.labelKey === 'menu.view')!;
      expect(
        languages(view2)
          .find((i) => i.command === 'lang.en')!
          .checked?.(),
      ).toBe(true);
    } finally {
      setLocale(before);
    }
  });
});
