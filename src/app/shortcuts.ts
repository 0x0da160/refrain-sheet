// SPDX-License-Identifier: MIT
/**
 * Keyboard shortcut routing.
 *
 * Design goals (see README "Keyboard shortcuts"):
 *
 * - **Never fight the browser, OS, or assistive technology.** Application
 *   shortcuts never take the keys a page cannot or must not override: new
 *   window/tab (Ctrl+N/T), close tab/window (Ctrl+W), reload (Ctrl+R/F5),
 *   history navigation (Alt+Arrow), address bar (Ctrl+L), print (Ctrl+P),
 *   zoom (Ctrl +/-/0 — low-vision users depend on it), dev tools (F12), and
 *   browser tab switching (Ctrl+Tab, Ctrl+PageUp/Down, Ctrl+1–9).
 *   {@link resolveShortcut} returns `null` for them so the browser handles
 *   them normally.
 * - **Spreadsheet keys win over the browser's.** The conventional
 *   spreadsheet keys that a page *can* take from the browser are always the
 *   app's, wherever focus is (text fields included): Ctrl+F (Find), Ctrl+H
 *   (Replace), F3 / Shift+F3 (Find Next / Previous), Ctrl+G (Go to Cell), and
 *   Ctrl+E (Flash Fill). The grid is virtualized, so the browser's own find
 *   cannot see rows outside the viewport anyway; the browser's find stays
 *   reachable from its own menu.
 * - Commands whose conventional key the browser keeps (New, Close File)
 *   have no shortcut rather than an unusual one; sheet switching uses
 *   Ctrl+Alt+PageDown/PageUp because plain Ctrl+PageDown/PageUp is browser
 *   tab switching. See
 *   `knowledge/references/spreadsheet-shortcut-comparison.md` for how other
 *   spreadsheets bind them.
 * - Every command is also available from the menus, so keyboard shortcuts are
 *   optional accelerators, never the only path.
 * - Shortcuts use `KeyboardEvent.key` / modifier state, never the deprecated
 *   `keyCode`, and are never triggered during IME composition or plain text
 *   entry.
 *
 * This module is a pure function so shortcut routing is unit-testable without a
 * DOM. `main.ts` computes the context and calls `preventDefault()` + runs the
 * command only when a command is returned and the event is cancelable.
 */
import { dateStamp, type DateStampKind } from '../core/date-stamp';
import type { CommandId } from './commands';

export interface ShortcutContext {
  /**
   * Focus is inside an editable text control (formula bar, inline cell
   * editor, a dialog field). Grid-editing accelerators (Undo/Redo/Fill Down)
   * are suppressed here so the field/browser keeps standard text editing.
   */
  inTextField: boolean;
  /**
   * An IME composition is in progress (or the event is a composition
   * keystroke). No application shortcut fires — the keystroke belongs to text
   * composition.
   */
  isComposing: boolean;
  /**
   * The spreadsheet grid itself has focus (and no cell editor is open).
   * Ctrl+A / Cmd+A selects all cells only in this context; anywhere else —
   * text fields, dialogs, the rest of the page — the browser's own Select
   * All is never intercepted.
   */
  inGrid?: boolean;
  /**
   * What Ctrl+Shift+V pastes (the user's setting): only the formatting
   * (default) or only the values.
   */
  shiftPaste?: 'formats' | 'values';
}

/** The subset of `KeyboardEvent` the resolver reads (keeps it DOM-free/testable). */
export interface ShortcutKey {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  /**
   * Physical-key code (`KeyboardEvent.code`), used only for the spreadsheet
   * zoom shortcuts: with Shift held, `key` becomes layout-dependent
   * punctuation, while `code` names the physical `Period`/`Comma`/`Digit0`
   * keys on every layout.
   */
  code?: string;
}

/**
 * Resolve a keystroke to an application command, or `null` when the app should
 * not handle it (including every browser-reserved combination). Callers must
 * only `preventDefault()` when a non-null command is returned.
 */
export function resolveShortcut(event: ShortcutKey, ctx: ShortcutContext): CommandId | null {
  // Never interfere with IME composition or its committing keystrokes.
  if (ctx.isComposing || event.key === 'Process' || event.key === 'Dead') {
    return null;
  }

  const mod = event.ctrlKey || event.metaKey;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;

  // Worksheet switching: Ctrl+Alt+PageDown/PageUp. Plain Ctrl+PageUp/Down is
  // browser tab switching, which a page cannot take. PageUp/PageDown produce
  // no character, so this Ctrl+Alt pair cannot collide with AltGr typing.
  if (
    event.ctrlKey &&
    event.altKey &&
    !event.shiftKey &&
    !event.metaKey &&
    !ctx.inTextField &&
    (event.key === 'PageDown' || event.key === 'PageUp')
  ) {
    return event.key === 'PageDown' ? 'worksheet.next' : 'worksheet.prev';
  }

  // ----- Modifier combinations (Ctrl/Cmd based). Alt is never part of an
  // application accelerator, so AltGr and OS combinations are left alone. -----
  if (mod && !event.altKey) {
    // Save / Save with Options — widely accepted app overrides of "save page".
    if (key === 's') {
      return event.shiftKey ? 'file.saveOptions' : 'file.save';
    }
    // Open a file. Works whether or not a field has focus.
    if (key === 'o' && !event.shiftKey) {
      return 'file.open';
    }
    // Find / Replace (Ctrl+F / Ctrl+H; the older Ctrl+Shift+F / Ctrl+Shift+H
    // still work), Go to Cell (Ctrl+G), and Flash Fill (Ctrl+E): always the
    // app's, taking precedence over the browser's find, history, find-next,
    // and search-box keys (see the module note).
    if (key === 'f') {
      return 'search.find';
    }
    if (key === 'h') {
      return 'search.replace';
    }
    if (key === 'g' && !event.shiftKey) {
      return 'search.goToCell';
    }
    if (key === 'e' && !event.shiftKey) {
      return 'edit.flashFill';
    }
    // Today's date (Ctrl+;) / the current time (Ctrl+Shift+;) into the
    // active cell, while the grid has focus. The cell editor and formula bar
    // insert them at the caret themselves (see `dateStampKeyOf`); everywhere
    // else the key stays the browser's (on a Japanese layout Ctrl+; is also
    // a zoom-in key).
    const stamp = dateStampKeyOf(event);
    if (stamp && ctx.inGrid === true && !ctx.inTextField) {
      return stamp === 'date' ? 'edit.insertDate' : 'edit.insertTime';
    }
    // Paste Formatting / Paste Values (Ctrl+Shift+V, per the user's
    // setting), while the grid has focus. Text fields keep the browser's
    // paste-as-plain-text.
    if (key === 'v' && event.shiftKey && ctx.inGrid === true && !ctx.inTextField) {
      return ctx.shiftPaste === 'values' ? 'edit.pasteValues' : 'edit.pasteFormats';
    }
    // Keyboard shortcut list (Ctrl+/). Not a browser key; works anywhere.
    if (key === '/' && !event.shiftKey) {
      return 'help.shortcuts';
    }
    // Spreadsheet zoom: Ctrl+Shift+Period (in) / Ctrl+Shift+Comma (out) /
    // Ctrl+Shift+0 (reset). Deliberately NOT the browser's zoom keys
    // (Ctrl +/-/0), which are never intercepted. Matched on the physical key
    // (`code`) so Shift-shifted layouts (>, <) resolve identically, and
    // suppressed in text fields so typing punctuation is never disturbed.
    if (event.shiftKey && !ctx.inTextField) {
      if (event.code === 'Period') {
        return 'view.zoom.in';
      }
      if (event.code === 'Comma') {
        return 'view.zoom.out';
      }
      if (event.code === 'Digit0') {
        return 'view.zoom.reset';
      }
      // Number format presets: Ctrl+Shift+1 (number), 4 (currency),
      // 5 (percent), matched on the physical digit key for every layout.
      if (event.code === 'Digit1') {
        return 'format.presetNumber';
      }
      if (event.code === 'Digit4') {
        return 'format.presetCurrency';
      }
      if (event.code === 'Digit5') {
        return 'format.presetPercent';
      }
    }
    // Select All Cells: owned only while the grid itself is focused, so the
    // browser's global Ctrl+A (page text, text inputs) is never suppressed.
    if (key === 'a' && !event.shiftKey && ctx.inGrid === true && !ctx.inTextField) {
      return 'edit.selectAll';
    }
    // Grid-editing accelerators: only when not editing text, so text fields
    // and the browser keep their own undo/redo and typing.
    if (!ctx.inTextField) {
      if (key === 'z') {
        return event.shiftKey ? 'edit.redo' : 'edit.undo';
      }
      if (key === 'y' && !event.shiftKey) {
        return 'edit.redo';
      }
      if (key === 'd' && !event.shiftKey) {
        return 'edit.fillDown';
      }
      // Bold/Italic/Underline: the conventional word-processor accelerators.
      // Unlike Ctrl+Shift+B (the browser's bookmarks-bar toggle), plain
      // Ctrl+B/I/U are not browser-reserved, so they are safe to own here.
      if (!event.shiftKey && key === 'b') {
        return 'format.bold';
      }
      if (!event.shiftKey && key === 'i') {
        return 'format.italic';
      }
      if (!event.shiftKey && key === 'u') {
        return 'format.underline';
      }
      // Clear formatting (Ctrl+\). On Japanese keyboards the same key may
      // report the yen sign.
      if (!event.shiftKey && (key === '\\' || key === '\u00a5')) {
        return 'format.clear';
      }
    }
    return null;
  }

  // Find next/previous: F3 / Shift+F3, always the app's (opening the Find
  // and Replace panel if it is closed), over the browser's find-next.
  if (!mod && !event.altKey && event.key === 'F3') {
    return event.shiftKey ? 'search.findPrev' : 'search.findNext';
  }

  // ----- Unmodified function keys (avoid F1/F5/F6/F11/F12 which browsers
  // reserve). Suppressed in text fields to avoid surprising an active edit. -----
  if (!mod && !event.altKey && !event.shiftKey && !ctx.inTextField) {
    // Recalculate formulas (spreadsheet convention; not a browser key).
    if (event.key === 'F9') {
      return 'sheet.recalculate';
    }
  }

  // Insert a worksheet: Shift+F11 (plain F11 stays the browser's full screen).
  if (!mod && !event.altKey && event.shiftKey && !ctx.inTextField && event.key === 'F11') {
    return 'worksheet.add';
  }

  return null;
}

/**
 * Ctrl+; (today's date) or Ctrl+Shift+; (the current time), read from the
 * character the key produces: `;` for the date, `:` for the time. On a US
 * layout `:` is Shift+; and on a Japanese layout it has its own key, so both
 * get the conventional pair. Ctrl+Shift+; on a Japanese layout produces `+`
 * and stays the browser's zoom-in.
 */
export function dateStampKeyOf(event: ShortcutKey): DateStampKind | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) {
    return null;
  }
  if (event.key === ';') {
    // Some browsers report the unshifted character while Cmd is held.
    return event.shiftKey ? 'time' : 'date';
  }
  return event.key === ':' ? 'time' : null;
}

/** Today's date or the current time on this device's clock, as cell text. */
export function localDateStamp(kind: DateStampKind, now: Date = new Date()): string {
  return dateStamp(kind, now.getTime(), -now.getTimezoneOffset() * 60_000);
}

/** One row of the keyboard shortcut list (Help > Keyboard Shortcuts). */
interface ShortcutDoc {
  /** Alternative keys, written the Windows/Linux way (see {@link displayShortcutKeys}). */
  keys: readonly string[];
  descKey: string;
}

/** A titled group of rows in the keyboard shortcut list. */
export interface ShortcutGroup {
  titleKey: string;
  items: readonly ShortcutDoc[];
}

/**
 * The keyboard shortcut list, grouped by task. Cut/Copy/Paste are handled
 * through native clipboard events (not the resolver) and the movement keys
 * by the grid, but all are listed so the list is complete.
 */
export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    titleKey: 'shortcut.group.file',
    items: [
      { keys: ['Ctrl+O'], descKey: 'shortcut.open' },
      { keys: ['Ctrl+S'], descKey: 'shortcut.save' },
      { keys: ['Ctrl+Shift+S'], descKey: 'shortcut.saveOptions' },
    ],
  },
  {
    titleKey: 'shortcut.group.edit',
    items: [
      { keys: ['F2'], descKey: 'shortcut.editCell' },
      { keys: ['Enter', 'Shift+Enter'], descKey: 'shortcut.commitDown' },
      { keys: ['Tab', 'Shift+Tab'], descKey: 'shortcut.moveRightLeft' },
      { keys: ['Ctrl+Enter'], descKey: 'shortcut.commitStay' },
      { keys: ['Alt+Enter'], descKey: 'shortcut.newLine' },
      { keys: ['Esc'], descKey: 'shortcut.cancelEdit' },
      { keys: ['F4'], descKey: 'shortcut.refToggle' },
      { keys: ['Delete', 'Backspace'], descKey: 'shortcut.clearCells' },
      { keys: ['Ctrl+;'], descKey: 'shortcut.insertDate' },
      { keys: ['Ctrl+Shift+;'], descKey: 'shortcut.insertTime' },
      { keys: ['Ctrl+Z'], descKey: 'shortcut.undo' },
      { keys: ['Ctrl+Y', 'Ctrl+Shift+Z'], descKey: 'shortcut.redo' },
      { keys: ['Ctrl+X'], descKey: 'shortcut.cut' },
      { keys: ['Ctrl+C'], descKey: 'shortcut.copy' },
      { keys: ['Ctrl+V'], descKey: 'shortcut.paste' },
      { keys: ['Ctrl+Shift+V'], descKey: 'shortcut.pasteSpecial' },
      { keys: ['Ctrl+D'], descKey: 'shortcut.fillDown' },
      { keys: ['Ctrl+E'], descKey: 'shortcut.flashFill' },
    ],
  },
  {
    titleKey: 'shortcut.group.move',
    items: [
      { keys: ['Arrows'], descKey: 'shortcut.moveCell' },
      { keys: ['Shift+Arrows'], descKey: 'shortcut.extendSelection' },
      { keys: ['Ctrl+Arrows'], descKey: 'shortcut.dataEdge' },
      { keys: ['Home', 'End'], descKey: 'shortcut.rowStartEnd' },
      { keys: ['Ctrl+Home'], descKey: 'shortcut.jumpToStart' },
      { keys: ['Ctrl+End'], descKey: 'shortcut.jumpToEnd' },
      { keys: ['PageUp', 'PageDown'], descKey: 'shortcut.page' },
      { keys: ['Ctrl+A'], descKey: 'shortcut.selectAll' },
      { keys: ['Ctrl+G'], descKey: 'shortcut.goToCell' },
    ],
  },
  {
    titleKey: 'shortcut.group.format',
    items: [
      { keys: ['Ctrl+B'], descKey: 'shortcut.bold' },
      { keys: ['Ctrl+I'], descKey: 'shortcut.italic' },
      { keys: ['Ctrl+U'], descKey: 'shortcut.underline' },
      { keys: ['Ctrl+Shift+1'], descKey: 'shortcut.formatNumber' },
      { keys: ['Ctrl+Shift+4'], descKey: 'shortcut.formatCurrency' },
      { keys: ['Ctrl+Shift+5'], descKey: 'shortcut.formatPercent' },
      { keys: ['Ctrl+\\'], descKey: 'shortcut.clearFormatting' },
    ],
  },
  {
    titleKey: 'shortcut.group.search',
    items: [
      { keys: ['Ctrl+F'], descKey: 'shortcut.find' },
      { keys: ['Ctrl+H'], descKey: 'shortcut.replace' },
      { keys: ['F3', 'Shift+F3'], descKey: 'shortcut.findNextPrevKeys' },
      { keys: ['Enter', 'Shift+Enter'], descKey: 'shortcut.findNextPrev' },
    ],
  },
  {
    titleKey: 'shortcut.group.sheet',
    items: [
      { keys: ['Ctrl+Alt+PageDown'], descKey: 'shortcut.nextSheet' },
      { keys: ['Ctrl+Alt+PageUp'], descKey: 'shortcut.prevSheet' },
      { keys: ['Shift+F11'], descKey: 'shortcut.addSheet' },
      { keys: ['F9'], descKey: 'shortcut.recalculate' },
    ],
  },
  {
    titleKey: 'shortcut.group.view',
    items: [
      { keys: ['Ctrl+Shift+.'], descKey: 'shortcut.zoomIn' },
      { keys: ['Ctrl+Shift+,'], descKey: 'shortcut.zoomOut' },
      { keys: ['Ctrl+Shift+0'], descKey: 'shortcut.zoomReset' },
      { keys: ['Ctrl+Wheel'], descKey: 'shortcut.zoomWheel' },
      { keys: ['Ctrl+/'], descKey: 'shortcut.list' },
    ],
  },
];

/** Menu shortcut labels whose macOS key is not a plain Ctrl→Cmd swap. */
const MAC_SHORTCUT_OVERRIDES: Readonly<Record<string, string>> = {
  // macOS redo convention; Cmd+Y is not bound on a Mac.
  'Ctrl+Y': 'Cmd+Shift+Z',
  // macOS reserves Cmd+H (Hide), so Replace uses Cmd+Shift+H there.
  'Ctrl+H': 'Cmd+Shift+H',
  // macOS takes Cmd+Shift+4 / 5 for screenshots, so the number format
  // presets keep the Control key there.
  'Ctrl+Shift+1': 'Ctrl+Shift+1',
  'Ctrl+Shift+4': 'Ctrl+Shift+4',
  'Ctrl+Shift+5': 'Ctrl+Shift+5',
  // The Mac keyboard names the Alt key Option.
  'Alt+Enter': 'Option+Enter',
};

/** True on macOS (and iPadOS with a hardware keyboard), where Cmd replaces Ctrl. */
export function isMacPlatform(
  nav: Pick<Navigator, 'platform' | 'userAgent'> | undefined = globalThis.navigator,
): boolean {
  if (!nav) {
    return false;
  }
  return /Mac|iPhone|iPad|iPod/.test(nav.platform || nav.userAgent || '');
}

/**
 * The shortcut label a menu shows for `keys` (written the Windows/Linux way,
 * e.g. `Ctrl+Shift+F`) on the current platform, so the menus always name the
 * key {@link resolveShortcut} actually accepts: on macOS `Ctrl+` becomes
 * `Cmd+`, except in Ctrl+Alt combinations, which use the Control key there
 * too.
 */
export function displayShortcut(keys: string, mac: boolean): string {
  if (!mac) {
    return keys;
  }
  const override = MAC_SHORTCUT_OVERRIDES[keys];
  if (override) {
    return override;
  }
  return keys.startsWith('Ctrl+Alt+') ? keys : keys.replace(/^Ctrl\+/, 'Cmd+');
}

/**
 * A shortcut-list row's keys as shown on the current platform: each
 * alternative through {@link displayShortcut}, duplicates (two Windows keys
 * that are the same key on a Mac) dropped, joined with " / ".
 */
export function displayShortcutKeys(keys: readonly string[], mac: boolean): string {
  return Array.from(new Set(keys.map((k) => displayShortcut(k, mac)))).join(' / ');
}
