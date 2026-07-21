// SPDX-License-Identifier: MIT
/**
 * The Language selector lives under the View menu (no top-level Language
 * menu). Runtime switching, persistence, and the English fallback are
 * unchanged and covered by i18n.test; here we assert the menu placement and
 * that the language commands are still reachable and reflect the active
 * locale.
 */
import { describe, expect, it } from 'vitest';
import { defaultMenus, type MenuChecks, type MenuDef, type MenuItemDef } from '../src/ui/menu-bar';
import { getLocale, setLocale } from '../src/app/i18n';

function checks(): MenuChecks {
  return {
    wrap: () => false,
    stickyFirstRow: () => false,
    sheetFont: () => 'biz-ud',
    theme: () => 'system',
    zoom: () => 100,
    editHints: () => true,
  };
}

const items = (menu: MenuDef): MenuItemDef[] => menu.items.filter((i): i is MenuItemDef => i !== 'separator');

describe('Language menu placement', () => {
  it('has no top-level Language menu', () => {
    const menus = defaultMenus(checks());
    expect(menus.some((m) => m.labelKey === 'menu.language')).toBe(false);
  });

  it('exposes a Language group with both locales under View', () => {
    const view = defaultMenus(checks()).find((m) => m.labelKey === 'menu.view');
    expect(view).toBeDefined();
    const viewItems = items(view!);
    // A localized "Language" heading precedes the two language items.
    expect(viewItems.some((i) => i.labelKey === 'menu.language' && i.heading)).toBe(true);
    expect(viewItems.some((i) => i.command === 'lang.en')).toBe(true);
    expect(viewItems.some((i) => i.command === 'lang.ja')).toBe(true);
  });

  it('the language items reflect the active locale', () => {
    const before = getLocale();
    try {
      setLocale('ja');
      const view = defaultMenus(checks()).find((m) => m.labelKey === 'menu.view')!;
      const ja = items(view).find((i) => i.command === 'lang.ja')!;
      const en = items(view).find((i) => i.command === 'lang.en')!;
      expect(ja.checked?.()).toBe(true);
      expect(en.checked?.()).toBe(false);
      setLocale('en');
      const view2 = defaultMenus(checks()).find((m) => m.labelKey === 'menu.view')!;
      expect(
        items(view2)
          .find((i) => i.command === 'lang.en')!
          .checked?.(),
      ).toBe(true);
    } finally {
      setLocale(before);
    }
  });
});
