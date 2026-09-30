// SPDX-License-Identifier: MIT
// What the grid's right-click menu offers: the command entries and the
// quick-format toolbar above them. The grid opens the menu (see Grid).
import {
  ArrowDownToLine,
  ClipboardCopy,
  ClipboardList,
  ClipboardPaste,
  Grid3x3,
  ListFilter,
  PaintBucket,
  Table,
  type IconNode,
} from 'lucide';
import type { Tab } from '../../app/state';
import type { CommandId, Commands } from '../../app/commands';
import { t } from '../../app/i18n';
import { ICON_BY_COMMAND } from '../command-icons';
import { isCommandAvailable } from '../../app/edition';
import { pruneItems } from '../menu-bar/prune';
import { copyAsItems, type MenuItemDef } from '../menu-bar/menus';
import type { ContextMenuEntry, ContextMenuToolbarItem } from '../context-menu';

interface ContextMenuCommandDef {
  command: CommandId;
  labelKey: string;
  shortcut?: string;
  /** Renders a checkable item whose state this returns for the active tab. */
  checked?: (commands: Commands, tab: Tab) => boolean;
}

interface ContextMenuGroupDef {
  labelKey: string;
  icon: IconNode;
  submenu: ContextMenuDef[];
}

type ContextMenuDef = ContextMenuCommandDef | ContextMenuGroupDef | 'separator';

/** Menu-bar items (plain labels, no live checks) as right-click entries, so both menus share one list. */
function fromMenuItems(items: ReadonlyArray<MenuItemDef | 'separator'>): ContextMenuDef[] {
  return items.map((item): ContextMenuDef => {
    if (item === 'separator') {
      return item;
    }
    const labelKey = typeof item.labelKey === 'string' ? item.labelKey : item.labelKey();
    if (item.submenu) {
      return { labelKey, icon: item.icon ?? ClipboardCopy, submenu: fromMenuItems(item.submenu) };
    }
    return { command: item.command!, labelKey };
  });
}

/**
 * The cell/header right-click menu, grouped the way the menu bar is (#396):
 * the clipboard actions first, with Copy As and Paste Special as the same
 * submenus as Edit's; then inserting and moving cells; then Rows & Columns
 * and Filter & Sort under the Sheet menu's group labels; then comments and
 * reverting. Each group is a submenu when it has more than a couple of
 * members, so the menu stays short enough to scan.
 */
const CONTEXT_MENU_ITEMS: ContextMenuDef[] = [
  { command: 'edit.cut', labelKey: 'menu.edit.cut', shortcut: 'Ctrl+X' },
  { command: 'edit.copy', labelKey: 'menu.edit.copy', shortcut: 'Ctrl+C' },
  { labelKey: 'menu.edit.copyAs', icon: ClipboardCopy, submenu: fromMenuItems(copyAsItems()) },
  { command: 'edit.paste', labelKey: 'menu.edit.paste', shortcut: 'Ctrl+V' },
  {
    labelKey: 'menu.edit.pasteSpecial',
    icon: ClipboardPaste,
    submenu: [
      { command: 'edit.pasteValues', labelKey: 'menu.edit.pasteValues' },
      { command: 'edit.pasteFormats', labelKey: 'menu.edit.pasteFormats' },
    ],
  },
  { command: 'edit.selectAll', labelKey: 'menu.edit.selectAll', shortcut: 'Ctrl+A' },
  'separator',
  {
    labelKey: 'menu.edit.insertCopied',
    icon: ClipboardList,
    submenu: [
      { command: 'edit.insertCopiedCells', labelKey: 'menu.edit.insertCopiedCells' },
      { command: 'edit.insertCopiedRows', labelKey: 'menu.edit.insertCopiedRows' },
      { command: 'edit.insertCopiedCols', labelKey: 'menu.edit.insertCopiedCols' },
    ],
  },
  {
    labelKey: 'menu.edit.fill',
    icon: ArrowDownToLine,
    submenu: [
      { command: 'edit.fillDown', labelKey: 'menu.edit.fillDown', shortcut: 'Ctrl+D' },
      { command: 'edit.flashFill', labelKey: 'menu.edit.flashFill', shortcut: 'Ctrl+E' },
    ],
  },
  { command: 'edit.moveRange', labelKey: 'menu.edit.moveRange' },
  'separator',
  {
    labelKey: 'menu.sheet.rowsAndColumns',
    icon: Table,
    submenu: [
      { command: 'sheet.insertRowAbove', labelKey: 'menu.sheet.insertRowAbove' },
      { command: 'sheet.insertRowBelow', labelKey: 'menu.sheet.insertRowBelow' },
      { command: 'sheet.deleteRows', labelKey: 'menu.sheet.deleteRows' },
      'separator',
      { command: 'sheet.insertColLeft', labelKey: 'menu.sheet.insertColLeft' },
      { command: 'sheet.insertColRight', labelKey: 'menu.sheet.insertColRight' },
      { command: 'sheet.deleteCols', labelKey: 'menu.sheet.deleteCols' },
      'separator',
      { command: 'sheet.autoFitCols', labelKey: 'menu.sheet.autoFitCols' },
    ],
  },
  {
    labelKey: 'menu.sheet.filterSort',
    icon: ListFilter,
    submenu: [
      {
        command: 'sheet.headerFilter',
        labelKey: 'menu.sheet.headerFilter',
        checked: (commands, tab) => commands.hasFilter(tab),
      },
      { command: 'sheet.filter', labelKey: 'menu.sheet.filter' },
      { command: 'sheet.filterClear', labelKey: 'menu.sheet.filterClear' },
      'separator',
      { command: 'sheet.sort', labelKey: 'menu.sheet.sort' },
      { command: 'sheet.sortClear', labelKey: 'menu.sheet.sortClear' },
    ],
  },
  'separator',
  { command: 'data.comment', labelKey: 'menu.data.comment' },
  { command: 'edit.revertCell', labelKey: 'menu.edit.revertCell' },
];

/**
 * Quick-access formatting toolbar shown above the right-click context menu
 * (#240): Bold/Italic/Underline plus the color and Borders dialogs, reusing
 * the same `format.*` commands the menu bar's Format menu already dispatches.
 * Buttons are disabled (never hidden) exactly when their command is, matching
 * the app's existing convention for RSF-only commands on a plain CSV tab.
 */
/** One menu definition as a live context-menu entry, enabled per the command's current state. */
function buildContextEntry(commands: Commands, tab: Tab, item: ContextMenuDef): ContextMenuEntry {
  if (item === 'separator') {
    return 'separator';
  }
  if ('submenu' in item) {
    return {
      label: t(item.labelKey),
      icon: item.icon,
      submenu: item.submenu.map((sub) => buildContextEntry(commands, tab, sub)),
    };
  }
  return {
    label: t(item.labelKey),
    icon: ICON_BY_COMMAND[item.command],
    shortcut: item.shortcut,
    checked: item.checked?.(commands, tab),
    disabled: !commands.isEnabled(item.command),
    onSelect: () => void commands.run(item.command),
  };
}

/** The right-click menu's entries ({@link CONTEXT_MENU_ITEMS}) for the current command state. */
export function contextMenuEntries(commands: Commands, tab: Tab): ContextMenuEntry[] {
  return pruneItems(CONTEXT_MENU_ITEMS, isCommandAvailable).map((item) =>
    buildContextEntry(commands, tab, item),
  );
}

/** The quick-format toolbar above the right-click menu; none in an edition without formatting. */
export function formatToolbarItems(commands: Commands, tab: Tab): ContextMenuToolbarItem[] {
  if (!isCommandAvailable('format.bold')) {
    return [];
  }
  const toggle = (
    command: CommandId,
    icon: string,
    className: string,
    labelKey: string,
    key: 'bold' | 'italic' | 'underline',
  ): ContextMenuToolbarItem => ({
    icon,
    label: t(labelKey),
    className,
    checked: commands.isFormatActive(tab, key),
    disabled: !commands.isEnabled(command),
    disabledReason: commands.disabledReason(command),
    onSelect: () => void commands.run(command),
  });
  const action = (
    command: CommandId,
    icon: ContextMenuToolbarItem['icon'],
    labelKey: string,
  ): ContextMenuToolbarItem => ({
    icon,
    label: t(labelKey),
    disabled: !commands.isEnabled(command),
    disabledReason: commands.disabledReason(command),
    onSelect: () => void commands.run(command),
  });
  return [
    toggle('format.bold', 'B', 'icon-bold', 'menu.format.bold', 'bold'),
    toggle('format.italic', 'I', 'icon-italic', 'menu.format.italic', 'italic'),
    toggle('format.underline', 'U', 'icon-underline', 'menu.format.underline', 'underline'),
    action('format.textColor', 'A', 'menu.format.textColor'),
    // Distinct Lucide icons (#294) — the previous `▨`/`▦` hatch glyphs were
    // nearly indistinguishable at toolbar size.
    action('format.backgroundColor', PaintBucket, 'menu.format.backgroundColor'),
    action('format.borders', Grid3x3, 'menu.format.borders'),
  ];
}
