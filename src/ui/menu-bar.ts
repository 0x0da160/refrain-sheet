// SPDX-License-Identifier: MIT
import type { CommandId, Commands } from '../app/commands';
import { getLocale, t } from '../app/i18n';
import { SHEET_ZOOM_LEVELS } from '../app/settings';
import { SHEET_FONTS, sheetFontLabelKey, type SheetFontId } from '../app/sheet-font';
import { THEMES, themeLabelKey, type ThemeChoice } from '../app/theme';
import { createAppIcon } from './app-icon';
import { el, clearChildren } from './dom';
import { positionPopup, type AnchorRect } from './popup';

export interface MenuItemDef {
  labelKey: string;
  /** Omitted for a non-interactive group heading (see `heading`). */
  command?: CommandId;
  shortcut?: string;
  checked?: () => boolean;
  /** Render as a non-interactive group heading instead of a command item. */
  heading?: boolean;
  /**
   * Nested items. An entry with a submenu opens a second list beside itself
   * instead of running a command, keeping a long menu (View) short enough to
   * fit any viewport. The nested items are ordinary definitions dispatching
   * the same shared commands — nothing is duplicated.
   */
  submenu?: Array<MenuItemDef | 'separator'>;
}

export interface MenuDef {
  labelKey: string;
  items: Array<MenuItemDef | 'separator'>;
}

export interface MenuChecks {
  wrap: () => boolean;
  stickyFirstRow: () => boolean;
  sheetFont: () => SheetFontId;
  theme: () => ThemeChoice;
  /** The active tab's spreadsheet zoom percent (app default when no tab). */
  zoom: () => number;
  /** Whether editing-help tooltips are enabled. */
  editHints: () => boolean;
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
        // No keyboard shortcut by design: Ctrl+E (the conventional Flash Fill
        // key) is a browser-reserved address-bar shortcut. The command stays
        // keyboard-accessible through the menu and context menu.
        { labelKey: 'menu.edit.flashFill', command: 'edit.flashFill' },
        // Move Selected Cells is the keyboard-accessible equivalent of dragging
        // the selection border; RSF-only (the command explains the required
        // conversion on a CSV tab). No shortcut by design — it opens a
        // target-entry dialog rather than acting in place.
        { labelKey: 'menu.edit.moveRange', command: 'edit.moveRange' },
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
        // Worksheets inside the active RSF workbook. These are the same
        // commands the worksheet tab strip and its context menu dispatch, so
        // every one is reachable without a pointer.
        { labelKey: 'menu.sheet.addSheet', command: 'worksheet.add' },
        { labelKey: 'menu.sheet.renameSheet', command: 'worksheet.rename' },
        { labelKey: 'menu.sheet.duplicateSheet', command: 'worksheet.duplicate' },
        { labelKey: 'menu.sheet.deleteSheet', command: 'worksheet.delete' },
        'separator',
        { labelKey: 'menu.sheet.nextSheet', command: 'worksheet.next', shortcut: 'F7' },
        { labelKey: 'menu.sheet.prevSheet', command: 'worksheet.prev', shortcut: 'Shift+F7' },
        { labelKey: 'menu.sheet.moveSheetFirst', command: 'worksheet.moveFirst' },
        { labelKey: 'menu.sheet.moveSheetLeft', command: 'worksheet.moveLeft' },
        { labelKey: 'menu.sheet.moveSheetRight', command: 'worksheet.moveRight' },
        { labelKey: 'menu.sheet.moveSheetLast', command: 'worksheet.moveLast' },
        'separator',
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
        // Filtering is RSF-only; running the command on a CSV tab explains
        // the required conversion. No shortcut by design (no browser-safe
        // conventional key exists); menu, context menu, and the header
        // filter buttons all dispatch this same command.
        { labelKey: 'menu.sheet.filter', command: 'sheet.filter' },
        { labelKey: 'menu.sheet.filterClear', command: 'sheet.filterClear' },
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
        { labelKey: 'menu.view.editHints', command: 'view.editHints', checked: checks.editHints },
        'separator',
        // Spreadsheet zoom lives in its own submenu: the presets plus Zoom
        // In/Out/Reset are eleven entries that made the View menu longer than
        // a small viewport could show. They dispatch the identical shared
        // commands as the shortcuts and Ctrl/Cmd + wheel.
        { labelKey: 'menu.view.zoom', submenu: zoomItems(checks) },
        'separator',
        { labelKey: 'menu.view.sheetFont', heading: true },
        ...sheetFontItems(checks),
        'separator',
        { labelKey: 'menu.view.theme', heading: true },
        ...themeItems(checks),
        'separator',
        // Tab movement stays menu/context-menu driven: every remaining
        // Ctrl/Alt+arrow-style accelerator conflicts with browser or OS tab
        // and history shortcuts, so no shortcut is assigned by design.
        { labelKey: 'menu.view.moveTabLeft', command: 'tab.moveLeft' },
        { labelKey: 'menu.view.moveTabRight', command: 'tab.moveRight' },
        { labelKey: 'menu.view.moveTabFirst', command: 'tab.moveFirst' },
        { labelKey: 'menu.view.moveTabLast', command: 'tab.moveLast' },
        'separator',
        // Language lives under View (no top-level Language menu). Switching
        // is immediate, persisted locally, and initialized from the browser
        // language with an English fallback — unchanged behavior.
        { labelKey: 'menu.language', heading: true },
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

/**
 * The spreadsheet-zoom presets plus Reset Zoom (View > Spreadsheet Zoom).
 * This is application-level zoom for the spreadsheet area only — browser
 * zoom and its keyboard shortcuts are never touched or intercepted.
 */
function zoomItems(checks: MenuChecks): MenuItemDef[] {
  const levels: Array<{ level: (typeof SHEET_ZOOM_LEVELS)[number]; command: CommandId }> =
    SHEET_ZOOM_LEVELS.map((level) => ({ level, command: `view.zoom.${level}` as CommandId }));
  return [
    // Zoom In/Out step through the presets; their shortcuts (and Ctrl/Cmd +
    // mouse wheel) drive the same shared commands, so the menu remains a
    // complete alternative. Browser zoom keys are never intercepted.
    { labelKey: 'menu.view.zoomIn', command: 'view.zoom.in', shortcut: 'Ctrl+Shift+.' },
    { labelKey: 'menu.view.zoomOut', command: 'view.zoom.out', shortcut: 'Ctrl+Shift+,' },
    ...levels.map(({ level, command }) => ({
      labelKey: `${level}%`,
      command,
      checked: () => checks.zoom() === level,
    })),
    { labelKey: 'menu.view.zoomReset', command: 'view.zoom.reset' as CommandId, shortcut: 'Ctrl+Shift+0' },
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

/** The three color-theme choices as checkable menu items (View > Theme). */
function themeItems(checks: MenuChecks): MenuItemDef[] {
  const theme2command: Record<ThemeChoice, CommandId> = {
    system: 'view.theme.system',
    light: 'view.theme.light',
    dark: 'view.theme.dark',
  };
  return THEMES.map((id) => ({
    labelKey: themeLabelKey(id),
    command: theme2command[id],
    checked: () => checks.theme() === id,
  }));
}

/**
 * Desktop-style menu bar. Fully keyboard operable: Enter/Space or ArrowDown
 * opens a menu, arrows navigate, Esc closes, Left/Right switch menus, and
 * ArrowRight/ArrowLeft open and close a submenu. Every item simply runs a
 * command; the command layer is shared with context menus, shortcuts, and
 * drag-and-drop.
 *
 * Both the drop-down and any open submenu are placed by the shared
 * viewport-aware helper (`positionPopup`), so they flip or clamp instead of
 * being clipped near a window edge, and become scrollable rather than
 * overflowing when the viewport is shorter than the menu. Placement is
 * recomputed on every render — which is what a locale switch, a zoom change,
 * or opening a submenu triggers — and on window/visual-viewport resize.
 */
export class MenuBar {
  readonly element: HTMLElement;
  private menus: MenuDef[];
  private openIndex: number | null = null;
  /** `labelKey` of the item whose submenu is open in the current menu. */
  private openSubmenuKey: string | null = null;
  /** The mounted submenu list (in `document.body`, so it is never clipped). */
  private submenuEl: HTMLElement | null = null;

  constructor(
    private readonly commands: Commands,
    checks: MenuChecks,
  ) {
    this.menus = defaultMenus(checks);
    this.element = el('div', { className: 'menu-bar', attrs: { role: 'menubar' } });
    document.addEventListener('mousedown', (event) => {
      const target = event.target as Node | null;
      if (
        this.openIndex !== null &&
        !this.element.contains(target) &&
        !(this.submenuEl && target && this.submenuEl.contains(target))
      ) {
        this.closeMenu();
      }
    });
    // The open menu must stay inside the viewport when it changes size.
    const replace = (): void => {
      if (this.openIndex !== null) {
        this.placePopups();
      }
    };
    window.addEventListener('resize', replace);
    globalThis.visualViewport?.addEventListener('resize', replace);
    this.render();
  }

  render(): void {
    // The submenu lives in document.body, so it must be torn down explicitly
    // before the list that owns it is rebuilt.
    this.submenuEl?.remove();
    this.submenuEl = null;
    clearChildren(this.element);
    // Decorative: the adjacent product name conveys the brand, so the icon is
    // hidden from assistive technology. Explicit width/height reserve space so
    // it never shifts layout or stretches; the SVG stays crisp at any DPI and
    // swaps to the dark-theme variant with the theme.
    this.element.append(
      createAppIcon('app-icon', 20),
      el('span', { className: 'app-name', text: t('app.title') }),
    );
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
        wrapper.append(this.buildList(menu.items, index));
      }
      this.element.append(wrapper);
    });
    if (this.openIndex !== null) {
      this.placePopups();
    }
  }

  /**
   * Place the open drop-down (and any submenu) against the visual viewport.
   * Runs after every render, because a render is exactly what a locale change,
   * a state change, or opening a submenu produces.
   */
  private placePopups(): void {
    const list = this.element.querySelector<HTMLElement>('.menu > .menu-list');
    const button = list?.parentElement?.querySelector('button');
    if (list && button) {
      positionPopup(list, { kind: 'below', rect: rectOf(button) });
    }
    const parentItem = this.element.querySelector<HTMLElement>('.menu-item[aria-expanded="true"]');
    if (this.submenuEl && parentItem) {
      positionPopup(this.submenuEl, { kind: 'beside', rect: rectOf(parentItem) });
    }
  }

  private buildList(items: Array<MenuItemDef | 'separator'>, menuIndex: number, nested = false): HTMLElement {
    const list = el('div', {
      className: nested ? 'menu-list submenu' : 'menu-list',
      attrs: { role: 'menu' },
    });
    for (const item of items) {
      if (item === 'separator') {
        list.append(el('hr', { className: 'menu-separator' }));
        continue;
      }
      const label = item.labelKey.includes('.') ? t(item.labelKey) : item.labelKey;
      if (item.submenu && item.submenu.length > 0) {
        list.append(this.buildSubmenuParent(item, item.submenu, list, menuIndex, label));
        continue;
      }
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
      button.addEventListener('mouseenter', () => {
        // Moving onto a plain item dismisses a sibling's open submenu.
        if (!nested && this.openSubmenuKey !== null) {
          this.setOpenSubmenu(null);
        }
      });
      button.addEventListener('keydown', (event) =>
        this.onItemKeyDown(event, list, button, menuIndex, nested),
      );
      list.append(button);
    }
    return list;
  }

  /** A menu entry that opens a nested list (e.g. View > Spreadsheet Zoom). */
  private buildSubmenuParent(
    item: MenuItemDef,
    submenu: Array<MenuItemDef | 'separator'>,
    list: HTMLElement,
    menuIndex: number,
    label: string,
  ): HTMLButtonElement {
    const expanded = this.openSubmenuKey === item.labelKey;
    const button = el(
      'button',
      {
        className: 'menu-item has-submenu',
        attrs: {
          type: 'button',
          role: 'menuitem',
          'aria-haspopup': 'menu',
          'aria-expanded': String(expanded),
        },
      },
      [
        el('span', { className: 'check', text: '', attrs: { 'aria-hidden': 'true' } }),
        el('span', { className: 'label', text: label }),
        el('span', { className: 'submenu-arrow', attrs: { 'aria-hidden': 'true' } }),
      ],
    );
    const open = (focusFirst: boolean): void => {
      this.setOpenSubmenu(item.labelKey, focusFirst);
    };
    button.addEventListener('click', () => open(false));
    button.addEventListener('mouseenter', () => open(false));
    button.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowRight' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        open(true);
        return;
      }
      this.onItemKeyDown(event, list, button, menuIndex, false);
    });
    if (expanded) {
      // Mounted in document.body so a scrollable parent list cannot clip it;
      // positioned (and mirrored when needed) after the render completes.
      this.submenuEl = this.buildList(submenu, menuIndex, true);
      document.body.append(this.submenuEl);
    }
    return button;
  }

  private onItemKeyDown(
    event: KeyboardEvent,
    list: HTMLElement,
    button: HTMLButtonElement,
    menuIndex: number,
    nested: boolean,
  ): void {
    const items = Array.from(list.querySelectorAll<HTMLButtonElement>('.menu-item'));
    const current = items.indexOf(button);
    const focusAt = (index: number): void => {
      const target = items[(index + items.length) % items.length];
      target?.focus();
      // Keeps the focused entry visible when the list had to become scrollable.
      target?.scrollIntoView?.({ block: 'nearest' });
    };
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusAt(current + 1);
        return;
      case 'ArrowUp':
        event.preventDefault();
        focusAt(current - 1);
        return;
      case 'Home':
        event.preventDefault();
        focusAt(0);
        return;
      case 'End':
        event.preventDefault();
        focusAt(items.length - 1);
        return;
      case 'Escape':
        event.preventDefault();
        if (nested) {
          // Escape leaves the submenu first, never the whole menu.
          this.setOpenSubmenu(null, false, true);
          return;
        }
        this.closeMenu();
        this.focusTopButton(menuIndex);
        return;
      case 'ArrowRight':
        if (nested) {
          return; // no deeper level exists
        }
        this.openMenu(menuIndex + 1);
        return;
      case 'ArrowLeft':
        if (nested) {
          event.preventDefault();
          this.setOpenSubmenu(null, false, true);
          return;
        }
        this.openMenu(menuIndex - 1);
        return;
      default:
        return;
    }
  }

  /**
   * Open (or close) a submenu and re-render. `focusFirst` moves focus into the
   * submenu for keyboard users; `focusParent` returns it to the parent item
   * when the submenu is dismissed with Escape / ArrowLeft.
   */
  private setOpenSubmenu(labelKey: string | null, focusFirst = false, focusParent = false): void {
    if (this.openSubmenuKey === labelKey && !focusFirst) {
      return;
    }
    const previous = this.openSubmenuKey;
    this.openSubmenuKey = labelKey;
    this.render();
    if (focusFirst && this.submenuEl) {
      this.submenuEl.querySelector<HTMLButtonElement>('.menu-item:not(:disabled)')?.focus();
      return;
    }
    if (focusParent && previous !== null) {
      this.element.querySelector<HTMLButtonElement>('.menu-item.has-submenu')?.focus();
    }
  }

  private openMenu(index: number): void {
    const wrapped = (index + this.menus.length) % this.menus.length;
    this.openIndex = wrapped;
    this.openSubmenuKey = null;
    this.render();
    const first = this.element.querySelector<HTMLButtonElement>('.menu-item:not(:disabled)');
    first?.focus();
  }

  private closeMenu(): void {
    this.openIndex = null;
    this.openSubmenuKey = null;
    this.render();
  }

  private focusTopButton(index: number): void {
    const buttons = this.element.querySelectorAll<HTMLButtonElement>('.menu > button');
    if (buttons.length === 0) return;
    const wrapped = (index + buttons.length) % buttons.length;
    buttons[wrapped].focus();
  }
}

function rectOf(node: Element): AnchorRect {
  const r = node.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}
