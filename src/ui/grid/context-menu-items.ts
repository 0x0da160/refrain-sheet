// SPDX-License-Identifier: MIT
// What the grid's right-click menu offers: the command entries and the
// quick-format toolbar above them. The grid opens the menu (see Grid).
import { Grid3x3, PaintBucket, PencilLine, Table, type IconNode } from 'lucide';
import type { Tab } from '../../app/state';
import type { CommandId, Commands } from '../../app/commands';
import { t } from '../../app/i18n';
import { ICON_BY_COMMAND } from '../command-icons';
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
  submenu: Array<ContextMenuCommandDef | 'separator'>;
}

/**
 * The cell/header right-click menu. Copy, Paste, and Select All stay at the
 * top level as the three highest-frequency actions; every less-common family
 * is grouped into a submenu, the same "long flat menu → submenus by feature
 * group" treatment already applied to the top menu bar's Sheet/Edit/View
 * menus (see `menu-bar.ts`'s `rowsAndColumnsItems`/`sheetFontItems` and
 * #280) — reusing their exact group labels (`menu.edit`,
 * `menu.sheet.rowsAndColumns`) so the grouping reads the same way in both
 * places (#396).
 */
const CONTEXT_MENU_ITEMS: Array<ContextMenuCommandDef | ContextMenuGroupDef | 'separator'> = [
  { command: 'edit.cut', labelKey: 'menu.edit.cut', shortcut: 'Ctrl+X' },
  { command: 'edit.copy', labelKey: 'menu.edit.copy', shortcut: 'Ctrl+C' },
  { command: 'edit.paste', labelKey: 'menu.edit.paste', shortcut: 'Ctrl+V' },
  { command: 'edit.selectAll', labelKey: 'menu.edit.selectAll', shortcut: 'Ctrl+A' },
  'separator',
  {
    labelKey: 'menu.edit',
    icon: PencilLine,
    submenu: [
      { command: 'edit.copyScreenshot', labelKey: 'menu.edit.copyScreenshot' },
      { command: 'edit.copyAsMarkdown', labelKey: 'menu.edit.copyAsMarkdown' },
      { command: 'edit.insertCopiedCells', labelKey: 'menu.edit.insertCopiedCells' },
      { command: 'edit.insertCopiedRows', labelKey: 'menu.edit.insertCopiedRows' },
      { command: 'edit.insertCopiedCols', labelKey: 'menu.edit.insertCopiedCols' },
      { command: 'edit.flashFill', labelKey: 'menu.edit.flashFill' },
      { command: 'edit.moveRange', labelKey: 'menu.edit.moveRange' },
      { command: 'edit.revertCell', labelKey: 'menu.edit.revertCell' },
    ],
  },
  { command: 'data.comment', labelKey: 'menu.data.comment' },
  'separator',
  {
    command: 'sheet.headerFilter',
    labelKey: 'menu.sheet.headerFilter',
    checked: (commands, tab) => commands.hasFilter(tab),
  },
  { command: 'sheet.filter', labelKey: 'menu.sheet.filter' },
  { command: 'sheet.filterClear', labelKey: 'menu.sheet.filterClear' },
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
];

/**
 * Quick-access formatting toolbar shown above the right-click context menu
 * (#240): Bold/Italic/Underline plus the color and Borders dialogs, reusing
 * the same `format.*` commands the menu bar's Format menu already dispatches.
 * Buttons are disabled (never hidden) exactly when their command is, matching
 * the app's existing convention for RSF-only commands on a plain CSV tab.
 */
/** One menu definition as a live context-menu entry, enabled per the command's current state. */
function buildContextEntry(
  commands: Commands,
  tab: Tab,
  item: ContextMenuCommandDef | ContextMenuGroupDef | 'separator',
): ContextMenuEntry {
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
  return CONTEXT_MENU_ITEMS.map((item) => buildContextEntry(commands, tab, item));
}

export function formatToolbarItems(commands: Commands, tab: Tab): ContextMenuToolbarItem[] {
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
