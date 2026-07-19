// SPDX-License-Identifier: MIT
import type { CommandId, Commands } from '../app/commands';
import { getLocale, t } from '../app/i18n';
import { SHEET_FONTS, sheetFontLabelKey, type SheetFontId } from '../app/sheet-font';
import { el, clearChildren } from './dom';

export interface MenuItemDef {
  labelKey: string;
  /** Omitted for a non-interactive group heading (see `heading`). */
  command?: CommandId;
  shortcut?: string;
  checked?: () => boolean;
  /** Render as a non-interactive group heading instead of a command item. */
  heading?: boolean;
}

export interface MenuDef {
  labelKey: string;
  items: Array<MenuItemDef | 'separator'>;
}

export interface MenuChecks {
  wrap: () => boolean;
  stickyFirstRow: () => boolean;
  sheetFont: () => SheetFontId;
}

export function defaultMenus(checks: MenuChecks): MenuDef[] {
  return [
    {
      labelKey: 'menu.file',
      items: [
        { labelKey: 'menu.file.new', command: 'file.new', shortcut: 'F4' },
        { labelKey: 'menu.file.open', command: 'file.open', shortcut: 'Ctrl+O' },
        { labelKey: 'menu.file.reopen', command: 'file.reopen' },
        'separator',
        { labelKey: 'menu.sheet.convert', command: 'sheet.convert' },
        'separator',
        { labelKey: 'menu.file.save', command: 'file.save', shortcut: 'Ctrl+S' },
        { labelKey: 'menu.file.saveOptions', command: 'file.saveOptions', shortcut: 'Ctrl+Shift+S' },
        { labelKey: 'menu.sheet.exportCsv', command: 'sheet.exportCsv' },
        'separator',
        { labelKey: 'menu.file.settings', command: 'app.settings' },
        'separator',
        { labelKey: 'menu.file.closeTab', command: 'file.closeTab', shortcut: 'F8' },
      ],
    },
    {
      labelKey: 'menu.edit',
      items: [
        { labelKey: 'menu.edit.undo', command: 'edit.undo', shortcut: 'Ctrl+Z' },
        { labelKey: 'menu.edit.redo', command: 'edit.redo', shortcut: 'Ctrl+Y' },
        'separator',
        { labelKey: 'menu.edit.copy', command: 'edit.copy', shortcut: 'Ctrl+C' },
        { labelKey: 'menu.edit.paste', command: 'edit.paste', shortcut: 'Ctrl+V' },
        // Ctrl+A is owned only while the grid itself has focus (never inside
        // text fields or the rest of the page — the browser keeps it there).
        { labelKey: 'menu.edit.selectAll', command: 'edit.selectAll', shortcut: 'Ctrl+A' },
        { labelKey: 'menu.edit.insertCopiedCells', command: 'edit.insertCopiedCells' },
        { labelKey: 'menu.edit.insertCopiedRows', command: 'edit.insertCopiedRows' },
        { labelKey: 'menu.edit.insertCopiedCols', command: 'edit.insertCopiedCols' },
        { labelKey: 'menu.edit.fillDown', command: 'edit.fillDown', shortcut: 'Ctrl+D' },
        'separator',
        { labelKey: 'menu.edit.revertCell', command: 'edit.revertCell' },
        { labelKey: 'menu.edit.revertAll', command: 'edit.revertAll' },
      ],
    },
    {
      labelKey: 'menu.search',
      items: [
        { labelKey: 'menu.search.find', command: 'search.find', shortcut: 'Ctrl+Shift+F' },
        { labelKey: 'menu.search.replace', command: 'search.replace', shortcut: 'Ctrl+Shift+H' },
        'separator',
        { labelKey: 'menu.search.findNext', command: 'search.findNext' },
        { labelKey: 'menu.search.findPrev', command: 'search.findPrev' },
      ],
    },
    {
      labelKey: 'menu.sheet',
      items: [
        { labelKey: 'menu.sheet.insertRowAbove', command: 'sheet.insertRowAbove' },
        { labelKey: 'menu.sheet.insertRowBelow', command: 'sheet.insertRowBelow' },
        { labelKey: 'menu.sheet.deleteRows', command: 'sheet.deleteRows' },
        'separator',
        { labelKey: 'menu.sheet.insertColLeft', command: 'sheet.insertColLeft' },
        { labelKey: 'menu.sheet.insertColRight', command: 'sheet.insertColRight' },
        { labelKey: 'menu.sheet.deleteCols', command: 'sheet.deleteCols' },
        'separator',
        { labelKey: 'menu.sheet.autoFitCols', command: 'sheet.autoFitCols' },
        'separator',
        { labelKey: 'menu.sheet.exportCsv', command: 'sheet.exportCsv' },
      ],
    },
    {
      labelKey: 'menu.view',
      items: [
        { labelKey: 'menu.view.wrap', command: 'view.wrap', checked: checks.wrap },
        {
          labelKey: 'menu.view.stickyFirstRow',
          command: 'view.stickyFirstRow',
          checked: checks.stickyFirstRow,
        },
        'separator',
        { labelKey: 'menu.view.sheetFont', heading: true },
        ...sheetFontItems(checks),
        'separator',
        // Tab movement stays menu/context-menu driven: every remaining
        // Ctrl/Alt+arrow-style accelerator conflicts with browser or OS tab
        // and history shortcuts, so no shortcut is assigned by design.
        { labelKey: 'menu.view.moveTabLeft', command: 'tab.moveLeft' },
        { labelKey: 'menu.view.moveTabRight', command: 'tab.moveRight' },
        { labelKey: 'menu.view.moveTabFirst', command: 'tab.moveFirst' },
        { labelKey: 'menu.view.moveTabLast', command: 'tab.moveLast' },
      ],
    },
    {
      labelKey: 'menu.language',
      items: [
        { labelKey: 'English', command: 'lang.en', checked: () => getLocale() === 'en' },
        { labelKey: '日本語', command: 'lang.ja', checked: () => getLocale() === 'ja' },
      ],
    },
    {
      labelKey: 'menu.help',
      items: [
        { labelKey: 'menu.help.formula', command: 'help.formula' },
        { labelKey: 'menu.help.about', command: 'help.about' },
      ],
    },
  ];
}

/** The three spreadsheet-font choices as checkable menu items (View > Spreadsheet Font). */
function sheetFontItems(checks: MenuChecks): MenuItemDef[] {
  const font2command: Record<SheetFontId, CommandId> = {
    'biz-ud': 'view.sheetFont.bizUd',
    ms: 'view.sheetFont.ms',
    'ms-ui': 'view.sheetFont.msUi',
  };
  return SHEET_FONTS.map((id) => ({
    labelKey: sheetFontLabelKey(id),
    command: font2command[id],
    checked: () => checks.sheetFont() === id,
  }));
}

/**
 * Desktop-style menu bar. Fully keyboard operable: Enter/Space or ArrowDown
 * opens a menu, arrows navigate, Esc closes, Left/Right switch menus.
 * Every item simply runs a command; the command layer is shared with
 * context menus, shortcuts, and drag-and-drop.
 */
export class MenuBar {
  readonly element: HTMLElement;
  private menus: MenuDef[];
  private openIndex: number | null = null;

  constructor(
    private readonly commands: Commands,
    checks: MenuChecks,
  ) {
    this.menus = defaultMenus(checks);
    this.element = el('div', { className: 'menu-bar', attrs: { role: 'menubar' } });
    document.addEventListener('mousedown', (event) => {
      if (this.openIndex !== null && !this.element.contains(event.target as Node)) {
        this.closeMenu();
      }
    });
    this.render();
  }

  render(): void {
    clearChildren(this.element);
    this.element.append(el('span', { className: 'app-name', text: t('app.title') }));
    this.menus.forEach((menu, index) => {
      const wrapper = el('div', { className: 'menu' });
      const label = menu.labelKey.includes('.') ? t(menu.labelKey) : menu.labelKey;
      const button = el('button', {
        text: label,
        attrs: {
          type: 'button',
          'aria-haspopup': 'true',
          'aria-expanded': this.openIndex === index ? 'true' : 'false',
        },
      });
      button.addEventListener('click', () => {
        if (this.openIndex === index) {
          this.closeMenu();
        } else {
          this.openMenu(index);
        }
      });
      button.addEventListener('mouseenter', () => {
        if (this.openIndex !== null && this.openIndex !== index) {
          this.openMenu(index);
        }
      });
      button.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          this.openMenu(index);
        } else if (event.key === 'ArrowRight') {
          this.focusTopButton(index + 1);
        } else if (event.key === 'ArrowLeft') {
          this.focusTopButton(index - 1);
        }
      });
      wrapper.append(button);
      if (this.openIndex === index) {
        wrapper.append(this.buildList(menu, index));
      }
      this.element.append(wrapper);
    });
  }

  private buildList(menu: MenuDef, menuIndex: number): HTMLElement {
    const list = el('div', { className: 'menu-list', attrs: { role: 'menu' } });
    for (const item of menu.items) {
      if (item === 'separator') {
        list.append(el('hr', { className: 'menu-separator' }));
        continue;
      }
      const label = item.labelKey.includes('.') ? t(item.labelKey) : item.labelKey;
      if (item.heading || !item.command) {
        // Non-interactive group heading (e.g. "Spreadsheet Font"). Skipped by
        // arrow-key navigation, which only visits `.menu-item` buttons.
        list.append(
          el('div', {
            className: 'menu-heading',
            text: label,
            attrs: { role: 'presentation' },
          }),
        );
        continue;
      }
      const command = item.command;
      const checked = item.checked ? item.checked() : null;
      const button = el(
        'button',
        {
          className: 'menu-item',
          attrs: {
            type: 'button',
            role: checked === null ? 'menuitem' : 'menuitemcheckbox',
            ...(checked === null ? {} : { 'aria-checked': String(checked) }),
          },
        },
        [
          el('span', {
            className: 'check',
            text: checked ? '✓' : '',
            attrs: { 'aria-hidden': 'true' },
          }),
          el('span', { className: 'label', text: label }),
          el('span', { className: 'shortcut', text: item.shortcut ?? '' }),
        ],
      );
      button.disabled = !this.commands.isEnabled(command);
      button.addEventListener('click', () => {
        this.closeMenu();
        void this.commands.run(command);
      });
      button.addEventListener('keydown', (event) => {
        const items = Array.from(list.querySelectorAll<HTMLButtonElement>('.menu-item'));
        const current = items.indexOf(button);
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          items[(current + 1) % items.length]?.focus();
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          items[(current - 1 + items.length) % items.length]?.focus();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          this.closeMenu();
          this.focusTopButton(menuIndex);
        } else if (event.key === 'ArrowRight') {
          this.openMenu(menuIndex + 1);
        } else if (event.key === 'ArrowLeft') {
          this.openMenu(menuIndex - 1);
        }
      });
      list.append(button);
    }
    return list;
  }

  private openMenu(index: number): void {
    const wrapped = (index + this.menus.length) % this.menus.length;
    this.openIndex = wrapped;
    this.render();
    const first = this.element.querySelector<HTMLButtonElement>('.menu-item:not(:disabled)');
    first?.focus();
  }

  private closeMenu(): void {
    this.openIndex = null;
    this.render();
  }

  private focusTopButton(index: number): void {
    const buttons = this.element.querySelectorAll<HTMLButtonElement>('.menu > button');
    if (buttons.length === 0) return;
    const wrapped = (index + buttons.length) % buttons.length;
    buttons[wrapped].focus();
  }
}
