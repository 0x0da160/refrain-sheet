// SPDX-License-Identifier: MIT
/**
 * The View menu's submenus (see `viewMenu` in ./menus.ts): each a family of
 * checkable choices or related toggles, kept here so the menu data file
 * stays readable.
 */
import type { CommandId } from '../../app/commands';
import { SHEET_ZOOM_LEVELS } from '../../app/settings';
import { isMonospaceSheetFont, SHEET_FONTS, sheetFontLabelKey, type SheetFontId } from '../../app/sheet-font';
import { DENSITIES, densityLabelKey, type DensityChoice } from '../../app/density';
import { THEMES, themeLabelKey, type ThemeChoice } from '../../app/theme';
import type { MenuChecks, MenuItemDef } from './menus';

/** View > Sticky Rows & Columns: which rows and columns stay put while scrolling. */
export function freezeItems(checks: MenuChecks): MenuItemDef[] {
  return [
    { labelKey: 'menu.view.stickyFirstRow', command: 'view.stickyFirstRow', checked: checks.stickyFirstRow },
    {
      labelKey: 'menu.view.stickyFirstColumn',
      command: 'view.stickyFirstColumn',
      checked: checks.stickyFirstColumn,
    },
    {
      labelKey: 'menu.view.freezeAtSelection',
      command: 'view.freezeAtSelection',
      checked: checks.freezeAtSelection,
    },
  ];
}

/** View > Grid Look: the grid's bands, lines, and selected row/column tint. */
export function gridLookItems(checks: MenuChecks): MenuItemDef[] {
  return [
    { labelKey: 'menu.view.bandedRows', command: 'view.bandedRows', checked: checks.bandedRows },
    { labelKey: 'menu.view.gridlines', command: 'view.gridlines', checked: checks.gridlines },
    { labelKey: 'menu.view.highlightRow', command: 'view.highlightRow', checked: checks.highlightRow },
    { labelKey: 'menu.view.highlightCol', command: 'view.highlightCol', checked: checks.highlightCol },
  ];
}

/** View > Toolbar & Status Bar: showing the toolbar and choosing what both bars hold. */
export function barItems(checks: MenuChecks): MenuItemDef[] {
  return [
    { labelKey: 'menu.view.toolbar', command: 'view.toolbar', checked: checks.toolbar },
    { labelKey: 'menu.view.customizeToolbar', command: 'view.customizeToolbar' },
    { labelKey: 'menu.view.customizeStatusBar', command: 'view.customizeStatusBar' },
  ];
}

/**
 * The spreadsheet-zoom presets plus Reset Zoom (View > Spreadsheet Zoom).
 * This is application-level zoom for the spreadsheet area only — browser
 * zoom and its keyboard shortcuts are never touched or intercepted.
 */
export function zoomItems(checks: MenuChecks): MenuItemDef[] {
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
export function sheetFontItems(checks: MenuChecks): MenuItemDef[] {
  const font2command: Record<SheetFontId, CommandId> = {
    'biz-ud': 'view.sheetFont.bizUd',
    ms: 'view.sheetFont.ms',
    'ms-ui': 'view.sheetFont.msUi',
    'noto-sans-jp': 'view.sheetFont.notoSansJp',
    'meiryo-ui': 'view.sheetFont.meiryoUi',
    'yu-gothic-ui': 'view.sheetFont.yuGothicUi',
  };
  const item = (id: SheetFontId): MenuItemDef => ({
    labelKey: sheetFontLabelKey(id),
    command: font2command[id],
    checked: () => checks.sheetFont() === id,
  });
  // Grouped so it is clear which fonts line characters up in columns.
  return [
    { labelKey: 'menu.view.sheetFont.monospace', heading: true },
    ...SHEET_FONTS.filter(isMonospaceSheetFont).map(item),
    { labelKey: 'menu.view.sheetFont.proportional', heading: true },
    ...SHEET_FONTS.filter((id) => !isMonospaceSheetFont(id)).map(item),
  ];
}

/** The four color-theme choices as checkable menu items (View > Theme). */
export function themeItems(checks: MenuChecks): MenuItemDef[] {
  const theme2command: Record<ThemeChoice, CommandId> = {
    system: 'view.theme.system',
    light: 'view.theme.light',
    dark: 'view.theme.dark',
    hybrid: 'view.theme.hybrid',
  };
  return THEMES.map((id) => ({
    labelKey: themeLabelKey(id),
    command: theme2command[id],
    checked: () => checks.theme() === id,
  }));
}

/** The three UI densities as checkable menu items (View > Density). */
export function densityItems(checks: MenuChecks): MenuItemDef[] {
  const density2command: Record<DensityChoice, CommandId> = {
    compact: 'view.density.compact',
    standard: 'view.density.standard',
    comfortable: 'view.density.comfortable',
  };
  return DENSITIES.map((id) => ({
    labelKey: densityLabelKey(id),
    command: density2command[id],
    checked: () => checks.density() === id,
  }));
}

/**
 * Tab movement (View > Move Tab): reordering the open-file tab strip itself,
 * distinct from worksheet reordering inside a workbook (Sheet > Worksheet).
 */
export function moveTabItems(): Array<MenuItemDef | 'separator'> {
  return [
    { labelKey: 'menu.view.moveTabFirst', command: 'tab.moveFirst' },
    { labelKey: 'menu.view.moveTabLeft', command: 'tab.moveLeft' },
    { labelKey: 'menu.view.moveTabRight', command: 'tab.moveRight' },
    { labelKey: 'menu.view.moveTabLast', command: 'tab.moveLast' },
  ];
}
