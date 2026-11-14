// SPDX-License-Identifier: MIT
/**
 * The data model of the application menus: one menu item, one menu, and the
 * checked states the menus read from the app. `menus.ts` declares every menu
 * with these types and re-exports them, so importers are unchanged. They live
 * here only to keep `menus.ts` within the layout line budget. Type-only: this
 * module has no runtime code.
 */
import type { IconNode } from 'lucide';
import type { CommandId } from '../../app/commands';
import type { DensityChoice } from '../../app/density';
import type { SheetFontId } from '../../app/sheet-font';
import type { ThemeChoice } from '../../app/theme';

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
  /** The font the active worksheet shows; null when a text worksheet shows the interface font. */
  sheetFont: () => SheetFontId | null;
  /** Whether the active worksheet is a Markdown/JSON/YAML/text sheet (its source shows instead of the grid). */
  textSheet?: () => boolean;
  /** Whether the active worksheet shows a proportional font (View > Proportional Font). */
  proportionalFont?: () => boolean;
  theme: () => ThemeChoice;
  /** The UI density choice (View > Density). */
  density: () => DensityChoice;
  /** The active tab's spreadsheet zoom percent (app default when no tab). */
  zoom: () => number;
  /** Whether editing-help tooltips are enabled. */
  editHints: () => boolean;
  /** Whether the toolbar is shown (View menu). */
  toolbar: () => boolean;
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
  /** Whether the whole current selection sits at `align`. */
  alignActive: (align: 'left' | 'center' | 'right') => boolean;
  /** Whether the whole current selection sits at `align` up and down. */
  verticalAlignActive?: (align: 'top' | 'middle' | 'bottom') => boolean;
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
  /**
   * Whether the AI assistant exists here: the hosted build, served over
   * http(s). Elsewhere its menu item is left out, like the Drive submenu.
   */
  aiAvailable?: () => boolean;
}
