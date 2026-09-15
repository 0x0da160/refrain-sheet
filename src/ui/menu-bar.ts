// SPDX-License-Identifier: MIT
import {
  ArrowDown,
  Cloud,
  CloudDownload,
  CloudUpload,
  LogOut,
  ArrowDownAZ,
  ArrowDownToLine,
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  Check,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Clock,
  ClipboardList,
  ClipboardPaste,
  Columns,
  Contrast,
  Copy,
  CopyPlus,
  Database,
  Eraser,
  FileCode,
  FilePenLine,
  FilePlus,
  FilePlus2,
  FileSpreadsheet,
  FileText,
  Filter,
  FilterX,
  FolderOpen,
  FunctionSquare,
  Globe,
  GitCompare,
  Hash,
  History,
  Image,
  Info,
  Keyboard,
  Layers,
  ListFilter,
  Locate,
  Menu,
  MessageSquare,
  Move,
  PaintBucket,
  Palette,
  Pencil,
  Plus,
  Redo2,
  RefreshCw,
  Replace,
  RotateCcw,
  Ruler,
  Save,
  Search,
  Settings,
  Sparkles,
  Table,
  TextSelect,
  Trash2,
  Type as TypeIcon,
  type IconNode,
  Undo2,
  Wand2,
  X,
  ZoomIn,
} from 'lucide';
import type { CommandId, Commands } from '../app/commands';
import { getLocale, t } from '../app/i18n';
import { SHEET_ZOOM_LEVELS } from '../app/settings';
import { SHEET_FONTS, sheetFontLabelKey, type SheetFontId } from '../app/sheet-font';
import { THEMES, themeLabelKey, type ThemeChoice } from '../app/theme';
import { createAppIcon } from './app-icon';
import { el, clearChildren } from './dom';
import { createIcon } from './icon';
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

/**
 * Leading icons for plain (non-checkable) command items, filling the same
 * reserved left-hand column the checkmark uses for toggle/radio items (#393)
 * — the two are mutually exclusive per item, so no extra width is added.
 * Checkable items (Bold/Italic/Underline, wrap, zoom levels, theme, etc.)
 * intentionally have no entry here: their checkmark already communicates
 * state in that same slot. Not every command has an obvious icon; those are
 * simply omitted; the slot stays empty, exactly as it was before.
 */
const ICON_BY_COMMAND: Partial<Record<CommandId, IconNode>> = {
  'file.new': FilePlus,
  'file.newCsv': FilePlus2,
  'file.open': FolderOpen,
  'drive.open': CloudDownload,
  'drive.save': CloudUpload,
  'drive.saveAs': CloudUpload,
  'drive.signOut': LogOut,
  'file.reopen': RotateCcw,
  'sheet.convert': FileCode,
  'file.save': Save,
  'file.saveOptions': Settings,
  'file.markdownEditor': FilePenLine,
  'sheet.exportCsv': FileText,
  'sheet.exportXlsx': FileSpreadsheet,
  'app.settings': Settings,
  'file.closeTab': X,
  'edit.undo': Undo2,
  'edit.redo': Redo2,
  'edit.copy': Copy,
  'edit.copyScreenshot': Image,
  'edit.copyAsMarkdown': FileCode,
  'edit.paste': ClipboardPaste,
  'edit.selectAll': TextSelect,
  'edit.insertCopiedCells': ClipboardList,
  'edit.insertCopiedRows': Table,
  'edit.insertCopiedCols': Columns,
  'edit.fillDown': ArrowDownToLine,
  'edit.flashFill': Wand2,
  'edit.moveRange': Move,
  'edit.revertCell': RotateCcw,
  'edit.revertAll': History,
  'search.find': Search,
  'search.replace': Replace,
  'search.findNext': ChevronRight,
  'search.findPrev': ChevronLeft,
  'search.goToCell': Locate,
  'sheet.recalculate': RefreshCw,
  'sheet.timezone': Clock,
  'sheet.displayLanguage': Globe,
  'worksheet.add': Plus,
  'worksheet.addMarkdown': FilePenLine,
  'worksheet.rename': Pencil,
  'worksheet.duplicate': CopyPlus,
  'worksheet.delete': Trash2,
  'worksheet.next': ChevronRight,
  'worksheet.prev': ChevronLeft,
  'worksheet.moveFirst': ChevronsLeft,
  'worksheet.moveLeft': ArrowLeft,
  'worksheet.moveRight': ArrowRight,
  'worksheet.moveLast': ChevronsRight,
  'sheet.insertRowAbove': ArrowUp,
  'sheet.insertRowBelow': ArrowDown,
  'sheet.deleteRows': Trash2,
  'sheet.insertColLeft': ArrowLeft,
  'sheet.insertColRight': ArrowRight,
  'sheet.deleteCols': Trash2,
  'sheet.autoFitCols': Ruler,
  'sheet.filter': Filter,
  'sheet.filterClear': FilterX,
  'sheet.sort': ArrowDownAZ,
  'sheet.sortClear': ArrowUpDown,
  'format.textColor': Palette,
  'format.backgroundColor': PaintBucket,
  'format.borders': Table,
  'format.numberFormat': Hash,
  'format.conditionalFormatting': Sparkles,
  'format.clear': Eraser,
  'data.runSqlQuery': Database,
  'data.compareDiff': GitCompare,
  'data.validation': CheckSquare,
  'data.comment': MessageSquare,
  'help.formula': FunctionSquare,
  'help.shortcuts': Keyboard,
  'help.about': Info,
};

export interface MenuDef {
  labelKey: string;
  items: Array<MenuItemDef | 'separator'>;
}

export interface MenuChecks {
  wrap: () => boolean;
  stickyFirstRow: () => boolean;
  stickyFirstColumn: () => boolean;
  sheetFont: () => SheetFontId;
  theme: () => ThemeChoice;
  /** The active tab's spreadsheet zoom percent (app default when no tab). */
  zoom: () => number;
  /** Whether editing-help tooltips are enabled. */
  editHints: () => boolean;
  /** Whether the right-side cell comments panel is open. */
  commentsPanel: () => boolean;
  /** Whether Bold/Italic/Underline is "on" for the whole current selection. */
  formatActive: (key: 'bold' | 'italic' | 'underline') => boolean;
  /** Whether the active tab is read-only protected (see `Tab.readOnly`). */
  protectedDoc: () => boolean;
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
    {
      labelKey: 'menu.file',
      items: [
        { labelKey: 'menu.file.new', command: 'file.new', shortcut: 'F4' },
        { labelKey: 'menu.file.newCsv', command: 'file.newCsv' },
        { labelKey: 'menu.file.open', command: 'file.open', shortcut: 'Ctrl+O' },
        { labelKey: 'menu.file.reopen', command: 'file.reopen' },
        {
          labelKey: 'menu.file.protect',
          command: 'file.toggleProtect',
          checked: checks.protectedDoc,
        },
        'separator',
        { labelKey: 'menu.file.markdownEditor', command: 'file.markdownEditor' },
        'separator',
        { labelKey: 'menu.sheet.convert', command: 'sheet.convert' },
        'separator',
        { labelKey: 'menu.file.save', command: 'file.save', shortcut: 'Ctrl+S' },
        { labelKey: 'menu.file.saveOptions', command: 'file.saveOptions', shortcut: 'Ctrl+Shift+S' },
        { labelKey: 'menu.sheet.exportCsv', command: 'sheet.exportCsv' },
        { labelKey: 'menu.sheet.exportXlsx', command: 'sheet.exportXlsx' },
        ...driveMenuItems(checks),
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
        { labelKey: 'menu.edit.copyScreenshot', command: 'edit.copyScreenshot' },
        { labelKey: 'menu.edit.copyAsMarkdown', command: 'edit.copyAsMarkdown' },
        { labelKey: 'menu.edit.paste', command: 'edit.paste', shortcut: 'Ctrl+V' },
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
        'separator',
        // No shortcut by design: the conventional Ctrl+G is Firefox's "Find
        // Again" and Ctrl+Shift+G its "Find Previous", so both are reserved.
        // The command stays keyboard-accessible through the menu.
        { labelKey: 'menu.search.goToCell', command: 'search.goToCell' },
      ],
    },
    {
      labelKey: 'menu.sheet',
      items: [
        // The Sheet menu grew to roughly 25 flat entries as worksheet
        // management, row/column editing, and filter/sort were all added
        // over time. Each related family now lives in its own submenu (same
        // pattern as View > Spreadsheet Zoom below), so the top-level menu
        // stays scannable.
        { labelKey: 'menu.sheet.worksheet', icon: Layers, submenu: worksheetItems() },
        { labelKey: 'menu.sheet.rowsAndColumns', icon: Table, submenu: rowsAndColumnsItems() },
        { labelKey: 'menu.sheet.filterSort', icon: ListFilter, submenu: filterSortItems() },
        'separator',
        // The only way a volatile formula (TODAY, NOW) updates without an
        // edit: there is deliberately no background recalculation timer.
        { labelKey: 'menu.sheet.recalculate', command: 'sheet.recalculate' },
        { labelKey: 'menu.sheet.timezone', command: 'sheet.timezone' },
        { labelKey: 'menu.sheet.displayLanguage', command: 'sheet.displayLanguage' },
      ],
    },
    {
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
        'separator',
        { labelKey: 'menu.format.textColor', command: 'format.textColor' },
        { labelKey: 'menu.format.backgroundColor', command: 'format.backgroundColor' },
        { labelKey: 'menu.format.borders', command: 'format.borders' },
        'separator',
        { labelKey: 'menu.format.numberFormat', command: 'format.numberFormat' },
        'separator',
        { labelKey: 'menu.format.conditionalFormatting', command: 'format.conditionalFormatting' },
        'separator',
        { labelKey: 'menu.format.clear', command: 'format.clear' },
      ],
    },
    {
      labelKey: 'menu.data',
      items: [
        { labelKey: 'menu.data.runQuery', command: 'data.runSqlQuery' },
        { labelKey: 'menu.data.compareDiff', command: 'data.compareDiff' },
        'separator',
        { labelKey: 'menu.data.validation', command: 'data.validation' },
        { labelKey: 'menu.data.comment', command: 'data.comment' },
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
        {
          labelKey: 'menu.view.stickyFirstColumn',
          command: 'view.stickyFirstColumn',
          checked: checks.stickyFirstColumn,
        },
        { labelKey: 'menu.view.editHints', command: 'view.editHints', checked: checks.editHints },
        {
          labelKey: 'menu.view.commentsPanel',
          command: 'view.commentsPanel',
          checked: checks.commentsPanel,
        },
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
    },
    {
      labelKey: 'menu.help',
      items: [
        { labelKey: 'menu.help.formula', command: 'help.formula' },
        { labelKey: 'menu.help.shortcuts', command: 'help.shortcuts' },
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
function worksheetItems(): Array<MenuItemDef | 'separator'> {
  return [
    { labelKey: 'menu.sheet.addSheet', command: 'worksheet.add' },
    { labelKey: 'menu.sheet.addMarkdownSheet', command: 'worksheet.addMarkdown' },
    { labelKey: 'menu.sheet.renameSheet', command: 'worksheet.rename' },
    { labelKey: 'menu.sheet.duplicateSheet', command: 'worksheet.duplicate' },
    { labelKey: 'menu.sheet.deleteSheet', command: 'worksheet.delete' },
    'separator',
    { labelKey: 'menu.sheet.nextSheet', command: 'worksheet.next', shortcut: 'F7' },
    { labelKey: 'menu.sheet.prevSheet', command: 'worksheet.prev', shortcut: 'Shift+F7' },
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
 * docs/architecture.md), so it combines cleanly with an active filter. No
 * shortcuts by design: no browser-safe conventional key exists for either,
 * and the menu, context menu, and (for Filter) the header filter buttons all
 * dispatch these same commands.
 */
function filterSortItems(): Array<MenuItemDef | 'separator'> {
  return [
    { labelKey: 'menu.sheet.filter', command: 'sheet.filter' },
    { labelKey: 'menu.sheet.filterClear', command: 'sheet.filterClear' },
    'separator',
    { labelKey: 'menu.sheet.sort', command: 'sheet.sort' },
    { labelKey: 'menu.sheet.sortClear', command: 'sheet.sortClear' },
  ];
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
  /**
   * Mobile only (hidden by desktop-width CSS): the hamburger button that
   * expands `.menu-row` below the logo row. A separate top-level element
   * from `.element` — rather than a child of it, as it used to be — purely
   * so the mobile grid (`@media (max-width: 700px)` in styles.css) can place
   * it in its own trailing column, past the status bar, in a three-column
   * `[app icon | status bar | hamburger]` layout (#478). The caller mounts
   * it as a sibling of `.element` and `StatusBar.element`; `MenuBar` still
   * owns all of its state and behavior.
   */
  readonly toggleElement: HTMLButtonElement;
  private menus: MenuDef[];
  private openIndex: number | null = null;
  /** `labelKey` of the item whose submenu is open in the current menu. */
  private openSubmenuKey: string | null = null;
  /** The mounted submenu list (in `document.body`, so it is never clipped). */
  private submenuEl: HTMLElement | null = null;
  /**
   * Mobile only: whether `.menu-row` (File / Edit / …) is expanded below the
   * logo row. Toggled by `.menu-bar-toggle`, ignored by desktop-width CSS
   * where the row stays inline as before.
   */
  private mobileMenuOpen = false;

  constructor(
    private readonly commands: Commands,
    checks: MenuChecks,
  ) {
    this.menus = defaultMenus(checks);
    this.element = el('div', { className: 'menu-bar', attrs: { role: 'menubar' } });
    // Mobile only (hidden by desktop-width CSS): expands `.menu-row` below
    // the logo row instead of it scrolling horizontally beside the logo. The
    // old horizontal-scroll strip combined with iOS Safari dispatching a
    // synthetic click at the finger's original touch coordinates after
    // inertial scroll, so a tap could open a different item than the one
    // touched (#267); replacing the scroll interaction removes that failure
    // mode entirely rather than trying to compensate for it. Built once
    // (rather than rebuilt every `render()`, like the rest of the bar) so
    // moving it to its own grid column (#478) doesn't cost a detach/reattach
    // on every open/close; only its `aria-expanded`/label attributes below
    // need to track state or locale changes.
    this.toggleElement = el(
      'button',
      {
        className: 'menu-bar-toggle',
        attrs: { type: 'button', 'aria-controls': 'menu-bar-row' },
      },
      [createIcon(Menu, 'menu-bar-toggle-icon', 18)],
    );
    this.toggleElement.addEventListener('click', () => {
      this.mobileMenuOpen = !this.mobileMenuOpen;
      this.render();
    });
    document.addEventListener('mousedown', (event) => {
      const target = event.target as Node | null;
      const insideBar = this.element.contains(target) || this.toggleElement.contains(target);
      const insideSubmenu = Boolean(this.submenuEl && target && this.submenuEl.contains(target));
      if (insideBar || insideSubmenu) {
        return;
      }
      if (this.openIndex !== null || this.mobileMenuOpen) {
        this.openIndex = null;
        this.openSubmenuKey = null;
        this.mobileMenuOpen = false;
        this.render();
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
    // Mobile only: lets the mobile layout (`@media (max-width: 700px)` in
    // styles.css) grow `.menu-bar` to the full width of its shared row with
    // `.status-bar` and hide that row's sibling while the row expands, via a
    // plain CSS sibling selector — desktop-width CSS never reads this class.
    this.element.classList.toggle('mobile-menu-open', this.mobileMenuOpen);
    // Decorative: the adjacent product name conveys the brand, so the icon is
    // hidden from assistive technology. Explicit width/height reserve space so
    // it never shifts layout or stretches; the SVG stays crisp at any DPI and
    // swaps to the dark-theme variant with the theme.
    this.element.append(
      createAppIcon('app-icon', 20),
      el('span', { className: 'app-name', text: t('app.title') }),
    );
    // `toggleElement` is a persistent sibling element (built once in the
    // constructor, see there for why), so only its state/locale-dependent
    // attributes are refreshed here.
    this.toggleElement.setAttribute('aria-expanded', this.mobileMenuOpen ? 'true' : 'false');
    this.toggleElement.setAttribute('aria-label', t('menu.toggle'));
    this.toggleElement.title = t('menu.toggle');
    const row = el('div', {
      className: this.mobileMenuOpen ? 'menu-row open' : 'menu-row',
      attrs: { id: 'menu-bar-row' },
    });
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
      row.append(wrapper);
    });
    this.element.append(row);
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
      // A checkable item's checkmark and a plain item's decorative icon
      // share the same reserved left-hand column — never both at once — so
      // adding icons never widens the menu (#393).
      const icon = checked === null ? (item.icon ?? ICON_BY_COMMAND[command]) : undefined;
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
          el(
            'span',
            { className: 'check', attrs: { 'aria-hidden': 'true' } },
            checked ? [createIcon(Check, 'check-icon', 14)] : icon ? [createIcon(icon, 'item-icon', 14)] : [],
          ),
          el('span', { className: 'label', text: label }),
          el('span', { className: 'shortcut', text: item.shortcut ?? '' }),
        ],
      );
      button.disabled = !this.commands.isEnabled(command);
      const disabledReason = button.disabled ? this.commands.disabledReason(command) : null;
      if (disabledReason) {
        button.title = disabledReason;
      }
      button.addEventListener('click', () => {
        // Also collapses the mobile expand-below-logo panel: on desktop-width
        // CSS this is a no-op, since the row stays inline there regardless.
        this.mobileMenuOpen = false;
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
        el(
          'span',
          { className: 'check', attrs: { 'aria-hidden': 'true' } },
          item.icon ? [createIcon(item.icon, 'item-icon', 14)] : [],
        ),
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
    const items = Array.from(list.querySelectorAll<HTMLButtonElement>('.menu-item')).filter(
      (item) => !item.disabled,
    );
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
