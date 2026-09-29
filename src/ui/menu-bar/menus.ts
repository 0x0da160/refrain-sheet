// SPDX-License-Identifier: MIT
/**
 * The application menus as data: every top-level menu, its items and
 * submenus, their commands, shortcut labels, and checked states. `MenuBar`
 * (./index.ts) renders them; the command catalog decides what each runs.
 */
import {
  CalendarClock,
  ClipboardPaste,
  Cloud,
  ArrowLeftRight,
  ClipboardCopy,
  ClipboardList,
  Contrast,
  Rows3,
  FileCog,
  FileDown,
  History,
  Layers,
  ListFilter,
  SwatchBook,
  Table,
  Type as TypeIcon,
  type IconNode,
  ZoomIn,
} from 'lucide';
import type { CommandId } from '../../app/commands';
import { getLocale } from '../../app/i18n';
import { getShiftPasteMode, SHEET_ZOOM_LEVELS, type ShiftPasteMode } from '../../app/settings';
import { displayShortcut, isMacPlatform } from '../../app/shortcuts';
import { SHEET_FONTS, sheetFontLabelKey, type SheetFontId } from '../../app/sheet-font';
import { DENSITIES, densityLabelKey, type DensityChoice } from '../../app/density';
import { THEMES, themeLabelKey, type ThemeChoice } from '../../app/theme';

/** Menu shortcut labels name Cmd instead of Ctrl on macOS. */
const IS_MAC = isMacPlatform();

export function shortcutLabel(shortcut: MenuItemDef['shortcut']): string {
  const keys = typeof shortcut === 'function' ? shortcut() : shortcut;
  return keys ? displayShortcut(keys, IS_MAC) : '';
}

/** Ctrl+Shift+V labels whichever Paste Special command the setting gives it. */
const shiftPasteShortcut = (mode: ShiftPasteMode) => (): string | undefined =>
  getShiftPasteMode() === mode ? 'Ctrl+Shift+V' : undefined;

export interface MenuItemDef {
  /**
   * Usually a fixed i18n key. Some items' wording depends on live state
   * (e.g. "Protect Book" flips to "Unprotect Book" once protected) rather
   * than just their checkmark — those pass a getter instead, evaluated fresh
   * on every render exactly like `checked` below (this whole tree is built
   * once, in the constructor, not rebuilt per render).
   */
  labelKey: string | (() => string);
  /** Omitted for a non-interactive group heading (see `heading`). */
  command?: CommandId;
  /** Written the Windows/Linux way; a getter when it depends on a setting. */
  shortcut?: string | (() => string | undefined);
  checked?: () => boolean;
  /** Render as a non-interactive group heading instead of a command item. */
  heading?: boolean;
  /**
   * A decorative leading icon (see `ICON_BY_COMMAND` for plain command
   * items — this is only needed to give a *submenu-parent* entry an icon,
   * since those have no `command` to key off of).
   */
  icon?: IconNode;
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
  stickyFirstColumn: () => boolean;
  /** Whether the active tab is frozen at a selected cell. */
  freezeAtSelection: () => boolean;
  sheetFont: () => SheetFontId;
  theme: () => ThemeChoice;
  /** The UI density choice (View > Density). */
  density: () => DensityChoice;
  /** The active tab's spreadsheet zoom percent (app default when no tab). */
  zoom: () => number;
  /** Whether editing-help tooltips are enabled. */
  editHints: () => boolean;
  /** Whether sheet tabs are listed down the left side (View menu). */
  sheetTabsVertical: () => boolean;
  /** Whether every other grid row is tinted (View > Banded Rows). */
  bandedRows: () => boolean;
  /** Whether lines are drawn between data cells (View > Gridlines). */
  gridlines: () => boolean;
  /** Whether the selected cell's row is tinted. */
  highlightRow: () => boolean;
  /** Whether the selected cell's column is tinted. */
  highlightCol: () => boolean;
  /** Whether opening a file auto-fits every column to its content. */
  autoFitOnOpen: () => boolean;
  /** Whether the app is shown full screen (View > Full Screen). */
  fullscreen: () => boolean;
  /** Whether Bold/Italic/Underline is "on" for the whole current selection. */
  formatActive: (key: 'bold' | 'italic' | 'underline') => boolean;
  /** Whether the active tab is read-only protected (see `Tab.readOnly`). */
  protectedDoc: () => boolean;
  /** Whether the active worksheet is locked (see `Worksheet.locked`). */
  sheetLocked: () => boolean;
  /** Whether the active sheet has a filter range (its header filter buttons are shown). */
  headerFilter: () => boolean;
  /**
   * Whether Google Drive sync exists in this build. False for the offline
   * build, which omits the whole Drive submenu rather than showing it disabled
   * — there is nothing the user could do to enable it there.
   */
  driveAvailable: () => boolean;
}

/**
 * The Google Drive section of the File menu, present only in a build that has
 * Drive sync. Every entry is user-initiated; opening the menu contacts nothing.
 */
function driveMenuItems(checks: MenuChecks): Array<MenuItemDef | 'separator'> {
  if (!checks.driveAvailable()) return [];
  return [
    'separator',
    {
      labelKey: 'menu.file.drive',
      icon: Cloud,
      submenu: [
        { labelKey: 'menu.file.drive.open', command: 'drive.open' },
        { labelKey: 'menu.file.drive.save', command: 'drive.save' },
        { labelKey: 'menu.file.drive.saveAs', command: 'drive.saveAs' },
        'separator',
        { labelKey: 'menu.file.drive.signOut', command: 'drive.signOut' },
      ],
    },
  ];
}

export function defaultMenus(checks: MenuChecks): MenuDef[] {
  return [
    fileMenu(checks),
    editMenu(),
    searchMenu(),
    sheetMenu(checks),
    formatMenu(checks),
    dataMenu(),
    viewMenu(checks),
    helpMenu(),
  ];
}

function fileMenu(checks: MenuChecks): MenuDef {
  return {
    labelKey: 'menu.file',
    items: [
      // The File menu grew to roughly 14 flat entries as export formats,
      // Drive sync, and per-document actions were all added over time —
      // the item this issue's own report named as "long" (#518). The most
      // frequent actions (New/Open/Save) stay at the top level per that
      // report's own UX caveat; everything else now follows the same
      // family-submenu convention as Sheet/View below.
      { labelKey: 'menu.file.new', command: 'file.new' },
      { labelKey: 'menu.file.newCsv', command: 'file.newCsv' },
      { labelKey: 'menu.file.open', command: 'file.open', shortcut: 'Ctrl+O' },
      { labelKey: 'menu.file.openRecent', command: 'file.openRecent' },
      { labelKey: 'menu.file.importJsonTable', command: 'file.importJsonTable' },
      { labelKey: 'menu.file.save', command: 'file.save', shortcut: 'Ctrl+S' },
      'separator',
      { labelKey: 'menu.file.export', icon: FileDown, submenu: exportItems() },
      { labelKey: 'menu.file.document', icon: FileCog, submenu: documentItems(checks) },
      { labelKey: 'menu.file.print', command: 'file.print' },
      ...driveMenuItems(checks),
      'separator',
      { labelKey: 'menu.file.settings', command: 'app.settings' },
      'separator',
      { labelKey: 'menu.file.closeTab', command: 'file.closeTab' },
    ],
  };
}

function editMenu(): MenuDef {
  return {
    labelKey: 'menu.edit',
    items: [
      { labelKey: 'menu.edit.undo', command: 'edit.undo', shortcut: 'Ctrl+Z' },
      { labelKey: 'menu.edit.redo', command: 'edit.redo', shortcut: 'Ctrl+Y' },
      'separator',
      { labelKey: 'menu.edit.cut', command: 'edit.cut', shortcut: 'Ctrl+X' },
      { labelKey: 'menu.edit.copy', command: 'edit.copy', shortcut: 'Ctrl+C' },
      // Copy Image and Copy as Markdown Table are alternate copy formats,
      // not the everyday Copy — grouped into their own submenu, the same
      // way Insert Copied's three variants are below (#518).
      { labelKey: 'menu.edit.copyAs', icon: ClipboardCopy, submenu: copyAsItems() },
      { labelKey: 'menu.edit.paste', command: 'edit.paste', shortcut: 'Ctrl+V' },
      {
        labelKey: 'menu.edit.pasteSpecial',
        icon: ClipboardPaste,
        submenu: [
          {
            labelKey: 'menu.edit.pasteValues',
            command: 'edit.pasteValues',
            shortcut: shiftPasteShortcut('values'),
          },
          {
            labelKey: 'menu.edit.pasteFormats',
            command: 'edit.pasteFormats',
            shortcut: shiftPasteShortcut('formats'),
          },
        ],
      },
      // Ctrl+A is owned only while the grid itself has focus (never inside
      // text fields or the rest of the page — the browser keeps it there).
      { labelKey: 'menu.edit.selectAll', command: 'edit.selectAll', shortcut: 'Ctrl+A' },
      'separator',
      // The three "insert copied X" commands share one submenu: they are a
      // single family (insert a prior copy as cells, whole rows, or whole
      // columns) and grouping them keeps the top-level Edit menu shorter,
      // matching the View > Spreadsheet Zoom precedent below.
      {
        labelKey: 'menu.edit.insertCopied',
        icon: ClipboardList,
        submenu: [
          { labelKey: 'menu.edit.insertCopiedCells', command: 'edit.insertCopiedCells' },
          { labelKey: 'menu.edit.insertCopiedRows', command: 'edit.insertCopiedRows' },
          { labelKey: 'menu.edit.insertCopiedCols', command: 'edit.insertCopiedCols' },
        ],
      },
      { labelKey: 'menu.edit.fillDown', command: 'edit.fillDown', shortcut: 'Ctrl+D' },
      { labelKey: 'menu.edit.flashFill', command: 'edit.flashFill', shortcut: 'Ctrl+E' },
      {
        labelKey: 'menu.edit.insertDateTime',
        icon: CalendarClock,
        submenu: [
          { labelKey: 'menu.edit.insertDate', command: 'edit.insertDate', shortcut: 'Ctrl+;' },
          { labelKey: 'menu.edit.insertTime', command: 'edit.insertTime', shortcut: 'Ctrl+Shift+;' },
        ],
      },
      // Move Selected Cells is the keyboard-accessible equivalent of dragging
      // the selection border; RSF-only (the command explains the required
      // conversion on a CSV tab). No shortcut by design — it opens a
      // target-entry dialog rather than acting in place.
      { labelKey: 'menu.edit.moveRange', command: 'edit.moveRange' },
      'separator',
      { labelKey: 'menu.edit.revert', icon: History, submenu: revertItems() },
    ],
  };
}

function searchMenu(): MenuDef {
  return {
    labelKey: 'menu.search',
    items: [
      { labelKey: 'menu.search.find', command: 'search.find', shortcut: 'Ctrl+F' },
      { labelKey: 'menu.search.replace', command: 'search.replace', shortcut: 'Ctrl+H' },
      'separator',
      { labelKey: 'menu.search.findNext', command: 'search.findNext', shortcut: 'F3' },
      { labelKey: 'menu.search.findPrev', command: 'search.findPrev', shortcut: 'Shift+F3' },
      'separator',
      { labelKey: 'menu.search.goToCell', command: 'search.goToCell', shortcut: 'Ctrl+G' },
    ],
  };
}

function sheetMenu(checks: MenuChecks): MenuDef {
  return {
    labelKey: 'menu.sheet',
    items: [
      // The Sheet menu grew to roughly 25 flat entries as worksheet
      // management, row/column editing, and filter/sort were all added
      // over time. Each related family now lives in its own submenu (same
      // pattern as View > Spreadsheet Zoom below), so the top-level menu
      // stays scannable.
      { labelKey: 'menu.sheet.worksheet', icon: Layers, submenu: worksheetItems(checks) },
      { labelKey: 'menu.sheet.rowsAndColumns', icon: Table, submenu: rowsAndColumnsItems() },
      { labelKey: 'menu.sheet.filterSort', icon: ListFilter, submenu: filterSortItems(checks) },
      'separator',
      // The only way a volatile formula (TODAY, NOW) updates without an
      // edit: there is deliberately no background recalculation timer.
      { labelKey: 'menu.sheet.recalculate', command: 'sheet.recalculate', shortcut: 'F9' },
      { labelKey: 'menu.sheet.timezone', command: 'sheet.timezone' },
      { labelKey: 'menu.sheet.displayLanguage', command: 'sheet.displayLanguage' },
      { labelKey: 'menu.sheet.versionHistory', command: 'sheet.versionHistory' },
      { labelKey: 'menu.sheet.clearVersionHistory', command: 'sheet.clearVersionHistory' },
    ],
  };
}

function formatMenu(checks: MenuChecks): MenuDef {
  return {
    labelKey: 'menu.format',
    items: [
      // Cell/range visual formatting, RSF-only (like Filter/Sort above),
      // disabled outright on a plain CSV document rather than explaining
      // the required conversion — see `Commands.isEnabled`.
      {
        labelKey: 'menu.format.bold',
        command: 'format.bold',
        shortcut: 'Ctrl+B',
        checked: () => checks.formatActive('bold'),
      },
      {
        labelKey: 'menu.format.italic',
        command: 'format.italic',
        shortcut: 'Ctrl+I',
        checked: () => checks.formatActive('italic'),
      },
      {
        labelKey: 'menu.format.underline',
        command: 'format.underline',
        shortcut: 'Ctrl+U',
        checked: () => checks.formatActive('underline'),
      },
      { labelKey: 'menu.format.font', command: 'format.font' },
      'separator',
      { labelKey: 'menu.format.colorAndBorders', icon: SwatchBook, submenu: colorAndBordersItems() },
      { labelKey: 'menu.format.numberFormat', command: 'format.numberFormat' },
      { labelKey: 'menu.format.presetNumber', command: 'format.presetNumber', shortcut: 'Ctrl+Shift+1' },
      {
        labelKey: 'menu.format.presetCurrency',
        command: 'format.presetCurrency',
        shortcut: 'Ctrl+Shift+4',
      },
      { labelKey: 'menu.format.presetPercent', command: 'format.presetPercent', shortcut: 'Ctrl+Shift+5' },
      'separator',
      { labelKey: 'menu.format.conditionalFormatting', command: 'format.conditionalFormatting' },
      'separator',
      { labelKey: 'menu.format.clear', command: 'format.clear', shortcut: 'Ctrl+\\' },
    ],
  };
}

function dataMenu(): MenuDef {
  return {
    labelKey: 'menu.data',
    items: [
      { labelKey: 'menu.data.runQuery', command: 'data.runSqlQuery' },
      { labelKey: 'menu.data.compareDiff', command: 'data.compareDiff' },
      'separator',
      { labelKey: 'menu.data.validation', command: 'data.validation' },
      { labelKey: 'menu.data.checkValidation', command: 'data.checkValidation' },
      { labelKey: 'menu.data.comment', command: 'data.comment' },
    ],
  };
}

function viewMenu(checks: MenuChecks): MenuDef {
  return {
    labelKey: 'menu.view',
    items: [
      { labelKey: 'menu.view.wrap', command: 'view.wrap', checked: checks.wrap },
      {
        labelKey: 'menu.view.stickyFirstRow',
        command: 'view.stickyFirstRow',
        checked: checks.stickyFirstRow,
      },
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
      { labelKey: 'menu.view.bandedRows', command: 'view.bandedRows', checked: checks.bandedRows },
      { labelKey: 'menu.view.gridlines', command: 'view.gridlines', checked: checks.gridlines },
      { labelKey: 'menu.view.highlightRow', command: 'view.highlightRow', checked: checks.highlightRow },
      { labelKey: 'menu.view.highlightCol', command: 'view.highlightCol', checked: checks.highlightCol },
      { labelKey: 'menu.view.editHints', command: 'view.editHints', checked: checks.editHints },
      {
        labelKey: 'menu.view.autoFitOnOpen',
        command: 'view.autoFitOnOpen',
        checked: checks.autoFitOnOpen,
      },
      {
        labelKey: 'menu.view.sheetTabsVertical',
        command: 'view.sheetTabsVertical',
        checked: checks.sheetTabsVertical,
      },
      { labelKey: 'menu.view.commentsPanel', command: 'view.commentsPanel' },
      // Menu only: F11 stays the browser's own full screen, which a page
      // cannot reliably take over in every browser.
      { labelKey: 'menu.view.fullscreen', command: 'view.fullscreen', checked: checks.fullscreen },
      'separator',
      // Spreadsheet zoom, Spreadsheet Font, and Theme each live in their own
      // submenu: grouping every choice family this way (rather than a
      // heading followed by its options inline) keeps the top-level View
      // menu to one line per family instead of growing with every added
      // choice. They dispatch the identical shared commands as the
      // shortcuts and Ctrl/Cmd + wheel.
      { labelKey: 'menu.view.zoom', icon: ZoomIn, submenu: zoomItems(checks) },
      { labelKey: 'menu.view.sheetFont', icon: TypeIcon, submenu: sheetFontItems(checks) },
      { labelKey: 'menu.view.theme', icon: Contrast, submenu: themeItems(checks) },
      { labelKey: 'menu.view.density', icon: Rows3, submenu: densityItems(checks) },
      'separator',
      // Tab movement stays menu/context-menu driven: every remaining
      // Ctrl/Alt+arrow-style accelerator conflicts with browser or OS tab
      // and history shortcuts, so no shortcut is assigned by design.
      { labelKey: 'menu.view.moveTab', icon: ArrowLeftRight, submenu: moveTabItems() },
      'separator',
      // Language lives under View (no top-level Language menu). Switching
      // is immediate, persisted locally, and initialized from the browser
      // language with an English fallback — unchanged behavior.
      { labelKey: 'menu.language', heading: true },
      { labelKey: 'English', command: 'lang.en', checked: () => getLocale() === 'en' },
      { labelKey: '日本語', command: 'lang.ja', checked: () => getLocale() === 'ja' },
    ],
  };
}

function helpMenu(): MenuDef {
  return {
    labelKey: 'menu.help',
    items: [
      { labelKey: 'menu.help.formula', command: 'help.formula' },
      { labelKey: 'menu.help.shortcuts', command: 'help.shortcuts', shortcut: 'Ctrl+/' },
      { labelKey: 'menu.help.about', command: 'help.about' },
    ],
  };
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
    'noto-sans-jp': 'view.sheetFont.notoSansJp',
    'meiryo-ui': 'view.sheetFont.meiryoUi',
    'yu-gothic-ui': 'view.sheetFont.yuGothicUi',
  };
  return SHEET_FONTS.map((id) => ({
    labelKey: sheetFontLabelKey(id),
    command: font2command[id],
    checked: () => checks.sheetFont() === id,
  }));
}

/** The four color-theme choices as checkable menu items (View > Theme). */
function themeItems(checks: MenuChecks): MenuItemDef[] {
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
function densityItems(checks: MenuChecks): MenuItemDef[] {
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
function moveTabItems(): Array<MenuItemDef | 'separator'> {
  return [
    { labelKey: 'menu.view.moveTabFirst', command: 'tab.moveFirst' },
    { labelKey: 'menu.view.moveTabLeft', command: 'tab.moveLeft' },
    { labelKey: 'menu.view.moveTabRight', command: 'tab.moveRight' },
    { labelKey: 'menu.view.moveTabLast', command: 'tab.moveLast' },
  ];
}

/**
 * Worksheet add/rename/duplicate/delete/reorder inside the active RSF
 * workbook (Sheet > Worksheet). These are the same commands the worksheet
 * tab strip and its context menu dispatch, so every one is reachable
 * without a pointer.
 */
function worksheetItems(checks: MenuChecks): Array<MenuItemDef | 'separator'> {
  return [
    { labelKey: 'menu.sheet.addSheet', command: 'worksheet.add', shortcut: 'Shift+F11' },
    { labelKey: 'menu.sheet.addMarkdownSheet', command: 'worksheet.addMarkdown' },
    { labelKey: 'menu.sheet.addJsonSheet', command: 'worksheet.addJson' },
    { labelKey: 'menu.sheet.addYamlSheet', command: 'worksheet.addYaml' },
    { labelKey: 'menu.sheet.addTextSheet', command: 'worksheet.addText' },
    { labelKey: 'menu.sheet.renameSheet', command: 'worksheet.rename' },
    { labelKey: 'menu.sheet.tabColor', command: 'worksheet.tabColor' },
    { labelKey: 'menu.sheet.newFolder', command: 'worksheet.newFolder' },
    { labelKey: 'menu.sheet.moveToFolder', command: 'worksheet.moveToFolder' },
    { labelKey: 'menu.sheet.duplicateSheet', command: 'worksheet.duplicate' },
    { labelKey: 'menu.sheet.deleteSheet', command: 'worksheet.delete' },
    'separator',
    {
      // The label itself carries the Lock/Unlock distinction (not just the
      // checkmark) so the state reads clearly even where the checkmark
      // alone might be missed — see the sheet-tab context menu (#541), and
      // "sheet lock" is worded distinctly from "book protect" below so the
      // two concepts are never confused with each other.
      labelKey: () => (checks.sheetLocked() ? 'menu.sheet.unlockSheet' : 'menu.sheet.lockSheet'),
      command: 'worksheet.toggleLock',
      checked: checks.sheetLocked,
    },
    'separator',
    { labelKey: 'menu.sheet.nextSheet', command: 'worksheet.next', shortcut: 'Ctrl+Alt+PageDown' },
    { labelKey: 'menu.sheet.prevSheet', command: 'worksheet.prev', shortcut: 'Ctrl+Alt+PageUp' },
    'separator',
    { labelKey: 'menu.sheet.moveSheetFirst', command: 'worksheet.moveFirst' },
    { labelKey: 'menu.sheet.moveSheetLeft', command: 'worksheet.moveLeft' },
    { labelKey: 'menu.sheet.moveSheetRight', command: 'worksheet.moveRight' },
    { labelKey: 'menu.sheet.moveSheetLast', command: 'worksheet.moveLast' },
  ];
}

/** Row and column insert/delete/auto-fit (Sheet > Rows & Columns). */
function rowsAndColumnsItems(): Array<MenuItemDef | 'separator'> {
  return [
    { labelKey: 'menu.sheet.insertRowAbove', command: 'sheet.insertRowAbove' },
    { labelKey: 'menu.sheet.insertRowBelow', command: 'sheet.insertRowBelow' },
    { labelKey: 'menu.sheet.deleteRows', command: 'sheet.deleteRows' },
    'separator',
    { labelKey: 'menu.sheet.insertColLeft', command: 'sheet.insertColLeft' },
    { labelKey: 'menu.sheet.insertColRight', command: 'sheet.insertColRight' },
    { labelKey: 'menu.sheet.deleteCols', command: 'sheet.deleteCols' },
    'separator',
    { labelKey: 'menu.sheet.autoFitCols', command: 'sheet.autoFitCols' },
  ];
}

/**
 * Filtering and sorting (Sheet > Filter & Sort), both RSF-only view
 * operations: running either on a CSV tab explains the required conversion,
 * and sort never reorders, deletes, or rewrites cell data (see
 * knowledge/architecture/index.md), so it combines cleanly with an active filter. No
 * shortcuts by design: no browser-safe conventional key exists for either,
 * and the menu, context menu, and (for Filter) the header filter buttons all
 * dispatch these same commands.
 */
function filterSortItems(checks: MenuChecks): Array<MenuItemDef | 'separator'> {
  return [
    { labelKey: 'menu.sheet.headerFilter', command: 'sheet.headerFilter', checked: checks.headerFilter },
    { labelKey: 'menu.sheet.filter', command: 'sheet.filter' },
    { labelKey: 'menu.sheet.filterClear', command: 'sheet.filterClear' },
    'separator',
    { labelKey: 'menu.sheet.sort', command: 'sheet.sort' },
    { labelKey: 'menu.sheet.sortClear', command: 'sheet.sortClear' },
  ];
}

/**
 * Writing the document out in a different format (File > Export): choosing
 * options for the current format, or converting to one of the other
 * supported file types. Distinct from File > This File > Convert to RSF Spreadsheet…,
 * which changes the *document's* underlying kind rather than writing a copy.
 */
function exportItems(): MenuItemDef[] {
  return [
    { labelKey: 'menu.file.saveOptions', command: 'file.saveOptions', shortcut: 'Ctrl+Shift+S' },
    { labelKey: 'menu.sheet.exportCsv', command: 'sheet.exportCsv' },
    { labelKey: 'menu.sheet.exportXlsx', command: 'sheet.exportXlsx' },
    { labelKey: 'menu.sheet.exportJson', command: 'sheet.exportJson' },
  ];
}

/**
 * Per-document actions that are not everyday file I/O (File > This File):
 * reopening with a different encoding, toggling read-only protection, and
 * converting a CSV tab to an RSF spreadsheet.
 */
function documentItems(checks: MenuChecks): MenuItemDef[] {
  return [
    { labelKey: 'menu.file.reopen', command: 'file.reopen' },
    {
      // "Book" (not "Document") to read distinctly from the worksheet-level
      // "Lock Sheet"/"Unlock Sheet" above — the two are different scopes
      // (the whole workbook vs. one worksheet) and were easy to conflate
      // when both used generic wording.
      labelKey: () => (checks.protectedDoc() ? 'menu.file.unprotectBook' : 'menu.file.protectBook'),
      command: 'file.toggleProtect',
      checked: checks.protectedDoc,
    },
    { labelKey: 'menu.sheet.convert', command: 'sheet.convert' },
  ];
}

/** Alternate copy formats (Edit > Copy As), distinct from the everyday Copy. */
function copyAsItems(): MenuItemDef[] {
  return [
    { labelKey: 'menu.edit.copyScreenshot', command: 'edit.copyScreenshot' },
    { labelKey: 'menu.edit.copyAsMarkdown', command: 'edit.copyAsMarkdown' },
  ];
}

/** Discarding edits back to the original value (Edit > Revert), one cell or the whole document. */
function revertItems(): MenuItemDef[] {
  return [
    { labelKey: 'menu.edit.revertCell', command: 'edit.revertCell' },
    { labelKey: 'menu.edit.revertAll', command: 'edit.revertAll' },
  ];
}

/** Cell/range color and border formatting (Format > Color & Borders), RSF-only like the rest of Format. */
function colorAndBordersItems(): MenuItemDef[] {
  return [
    { labelKey: 'menu.format.textColor', command: 'format.textColor' },
    { labelKey: 'menu.format.backgroundColor', command: 'format.backgroundColor' },
    { labelKey: 'menu.format.borders', command: 'format.borders' },
  ];
}
