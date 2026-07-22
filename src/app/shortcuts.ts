// SPDX-License-Identifier: MIT
/**
 * Keyboard shortcut routing.
 *
 * Design goals (see README "Keyboard shortcuts"):
 *
 * - **Never fight the browser, OS, or assistive technology.** Application
 *   shortcuts deliberately avoid browser-reserved and commonly essential
 *   combinations: new window/tab (Ctrl+N/T), close tab/window (Ctrl+W), reload
 *   (Ctrl+R/F5), history (Ctrl+H, Alt+Arrow), address bar (Ctrl+L), browser
 *   find (Ctrl+F, F3), print (Ctrl+P), zoom (Ctrl +/-/0), dev tools (F12),
 *   and browser tab switching (Ctrl+Tab, Ctrl+PageUp/Down). None of those are
 *   intercepted — {@link resolveShortcut} returns `null` for them so the
 *   browser handles them normally.
 * - Commands that would otherwise collide (New, Close Tab, Find, Replace) use
 *   safe alternatives (function keys or unreserved Ctrl+Shift combinations).
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
    // Find / Replace use Ctrl+Shift+F / Ctrl+Shift+H because plain Ctrl+F is
    // the browser's find and Ctrl+H is browser history.
    if (event.shiftKey && key === 'f') {
      return 'search.find';
    }
    if (event.shiftKey && key === 'h') {
      return 'search.replace';
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
    }
    return null;
  }

  // ----- Unmodified function keys (avoid F1/F3/F5/F6/F11/F12 which browsers
  // reserve). Suppressed in text fields to avoid surprising an active edit. -----
  if (!mod && !event.altKey && !event.shiftKey && !ctx.inTextField) {
    if (event.key === 'F4') {
      return 'file.new';
    }
    if (event.key === 'F8') {
      return 'file.closeTab';
    }
  }

  // Worksheet switching inside the active workbook. F7 / Shift+F7 are used
  // because the conventional Ctrl+PageUp/PageDown is browser tab switching and
  // Alt is never part of an application accelerator (see the module note).
  if (!mod && !event.altKey && !ctx.inTextField && event.key === 'F7') {
    return event.shiftKey ? 'worksheet.prev' : 'worksheet.next';
  }

  return null;
}

/** One row of the human-readable shortcut reference (About dialog, README, Help). */
export interface ShortcutDoc {
  keys: string;
  descKey: string;
}

/**
 * The canonical shortcut map, shown in the About dialog and mirrored in the
 * README. Copy/Paste are handled through native clipboard events (not the
 * resolver) but are listed here for completeness.
 */
export const SHORTCUT_DOCS: readonly ShortcutDoc[] = [
  { keys: 'F4', descKey: 'shortcut.new' },
  { keys: 'Ctrl+O / Cmd+O', descKey: 'shortcut.open' },
  { keys: 'Ctrl+S / Cmd+S', descKey: 'shortcut.save' },
  { keys: 'Ctrl+Shift+S / Cmd+Shift+S', descKey: 'shortcut.saveOptions' },
  { keys: 'F8', descKey: 'shortcut.closeTab' },
  { keys: 'F7', descKey: 'shortcut.nextSheet' },
  { keys: 'Shift+F7', descKey: 'shortcut.prevSheet' },
  { keys: 'Ctrl+Z / Cmd+Z', descKey: 'shortcut.undo' },
  { keys: 'Ctrl+Y, Ctrl+Shift+Z / Cmd+Shift+Z', descKey: 'shortcut.redo' },
  { keys: 'Ctrl+C / Cmd+C', descKey: 'shortcut.copy' },
  { keys: 'Ctrl+V / Cmd+V', descKey: 'shortcut.paste' },
  { keys: 'Ctrl+A / Cmd+A', descKey: 'shortcut.selectAll' },
  { keys: 'Ctrl+D / Cmd+D', descKey: 'shortcut.fillDown' },
  { keys: 'Ctrl+Shift+F / Cmd+Shift+F', descKey: 'shortcut.find' },
  { keys: 'Ctrl+Shift+H / Cmd+Shift+H', descKey: 'shortcut.replace' },
  { keys: 'Ctrl+Shift+. / Cmd+Shift+.', descKey: 'shortcut.zoomIn' },
  { keys: 'Ctrl+Shift+, / Cmd+Shift+,', descKey: 'shortcut.zoomOut' },
  { keys: 'Ctrl+Shift+0 / Cmd+Shift+0', descKey: 'shortcut.zoomReset' },
  { keys: 'Ctrl+Wheel / Cmd+Wheel', descKey: 'shortcut.zoomWheel' },
  { keys: 'Enter / Shift+Enter', descKey: 'shortcut.findNextPrev' },
  { keys: 'F2', descKey: 'shortcut.editCell' },
  { keys: 'Enter', descKey: 'shortcut.commitDown' },
  { keys: 'Shift+Arrows', descKey: 'shortcut.extendSelection' },
  { keys: 'Esc', descKey: 'shortcut.cancelEdit' },
];
