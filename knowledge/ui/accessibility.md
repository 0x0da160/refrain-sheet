---
type: ui-concept
title: Accessibility
description: Keyboard-only operability, ARIA labeling, focus management, never signaling state by color alone, and forced-colors/high-contrast support.
sources:
  - resource: ../../README.md
status: stable
generated:
  by: claude-code/claude-sonnet-5
  at: 2026-09-22T16:27:14Z
---

# Accessibility

Accessibility is not confined to a single "Accessibility" section — it runs
through nearly every feature documented elsewhere in this domain. This file
collects the cross-cutting rules; feature files cross-link here rather than
restating them.

## Keyboard-only operability

Core operations work with the keyboard alone: menus, grid navigation and
editing, find/replace, and dialogs. Concretely:

- Every command reachable from a menu is also reachable by keyboard
  shortcut, context menu, or direct grid interaction — shortcuts are
  optional accelerators, never the only path to a command (see
  `README.md`'s "Keyboard shortcuts" section).
- The worksheet strip and the (collapsed, mobile) menu row use **roving
  tabindex**, so a whole strip is a single tab stop and arrow keys move
  within it (see [tabs-and-worksheet-strip.md](tabs-and-worksheet-strip.md)).
- The top-left corner "Select all cells" control is focusable and
  activates on **Enter/Space**, not just pointer click/tap (see
  [selection-and-navigation.md](selection-and-navigation.md)).
- **Ctrl+A / Cmd+A** is owned only while the grid itself has focus — the
  browser's own Select All is never intercepted anywhere else on the page.
  This is the general shape of the app's shortcut-ownership rule: commands
  are handled via `KeyboardEvent.key` and modifier state (never the
  deprecated `keyCode`), only when the application owns the context, never
  during IME composition or ordinary text entry, and `preventDefault()` is
  called only for a recognized application command on a cancelable event.
  Keys a page cannot or must not take (new window/tab, close tab, reload,
  history navigation with Alt+Arrow, address bar, print, **zoom**, dev
  tools, browser tab switching with Ctrl+Tab / Ctrl+PageUp/PageDown /
  Ctrl+1–9) are never intercepted; zoom in particular stays the browser's
  because low-vision users depend on it.
- **Spreadsheet keys win over the browser's.** The conventional
  spreadsheet keys a page can take are always the app's, wherever focus is:
  **Ctrl+F** Find, **Ctrl+H** Replace (Cmd+Shift+H on macOS), **F3 /
  Shift+F3** Find Next / Previous, **Ctrl+G** Go to Cell, and **Ctrl+E**
  Flash Fill (Cmd on macOS). The virtualized grid does not render rows
  outside the viewport, so the browser's find could not search the sheet
  anyway. The browser's own page find stays reachable from the browser's
  menu, and every one of these commands is also on the app's menus.
- Tab / Shift+Tab move between cells inside the grid, but at the row's
  first or last field they fall through to the browser, so focus can
  always leave the grid by keyboard.
- **Shift+F11** inserts a worksheet, **Ctrl+/** opens the shortcut list,
  and **Ctrl+\\** clears formatting (Ctrl+¥ on Japanese keyboards).
- Menus show each shortcut the way the current platform types it (Cmd on
  macOS, Ctrl elsewhere; `displayShortcut` in `src/app/shortcuts.ts`).
- Grid-editing accelerators (Undo/Redo/Fill Down) are suppressed while a
  text field or the cell editor has focus, so ordinary text editing keeps
  its own behavior; Save and Open still work from anywhere.
- Formula and Function Help is a searchable, keyboard-accessible panel.
  Insert Copied … commands are fully keyboard-accessible through the menu
  and context menu even though they have no dedicated shortcut.

## ARIA labeling

- Dialogs use the native `<dialog>` element with **focus trapping**, and
  ARIA labels are provided throughout.
- The **busy/loading indicator** uses `role="status"`, `aria-live="polite"`,
  and `aria-busy`, with a localized operation label (opening/parsing a
  file, converting CSV to RSF, saving/compressing `.rsf`, exporting to CSV,
  Replace All). Selection statistics for a huge selection show the same
  `role="status"` "Calculating…" pattern while a background scan runs (see
  [../architecture/system-overview.md](../architecture/system-overview.md)'s
  "Long-running operations" section for the mechanism behind this).
- The **formula autocomplete listbox** carries ARIA labels; the ranges a
  formula references are exposed to assistive technologies as an
  accessible description of the formula field, not only as a visual
  highlight (see
  [copy-paste-fill-and-flash-fill.md](copy-paste-fill-and-flash-fill.md)
  and `README.md`'s "Formula-reference highlighting" section).
- The top-left corner "Select all cells" control has a **localized
  accessible name** (English and Japanese) and exposes its pressed state
  via `aria-pressed`.
- The application icon is purely decorative: empty `alt` and
  `aria-hidden`, so it never double-announces the brand name alongside the
  visible/hidden app-name text (see
  [theming-and-visual-system.md](theming-and-visual-system.md)).
- Structural operations — tab reorder, worksheet reorder/add/rename/
  duplicate/delete, zoom changes ("Spreadsheet zoom: 125%") — are announced
  to assistive technologies as they happen, not only reflected visually.
- Flash Fill's preview is explicitly documented as **accessible**: plain-
  words description of the operation, affected range, cell count, and a
  bounded before/after sample.

## Focus management

- Dialogs return focus and trap it while open (native `<dialog>` focus
  trapping, above).
- On a touch device, opening a dialog, popover, docked panel, or the
  Find and Replace panel autofocuses a field **without popping the on-screen
  keyboard** (`focusWithoutKeyboard`) — a focus-management concern that is
  also an accessibility concern: keyboard-driven focus should not have an
  unwanted side effect on a different input modality. See
  [mobile-and-touch.md](mobile-and-touch.md) for the mechanism.
- The grid's hidden "sink" textarea keeps keyboard focus during
  navigation so that starting to type — including starting an IME
  composition — never requires a focus transition mid-keystroke; see
  [editing-and-ime.md](editing-and-ime.md).

## Never signaling state by color alone

Selection, formula errors, dirty state, and warnings are never signaled by
color alone — each pairs a non-color cue:

- **Selection roles** (active cell / anchor / range / header highlight)
  are distinguished by outline style (solid vs. dashed) and fill, not
  color alone (see
  [selection-and-navigation.md](selection-and-navigation.md)).
- **Formula-reference highlights** cycle through four **color + pattern**
  pairs (solid, dashed, dotted, double borders with different background
  patterns), so distinct references are distinguishable without relying on
  color alone.
- **Formula cells** are shown upright, never italic (italic hurts CJK
  legibility), with a small non-italic corner marker; **error cells** show
  the literal error code (e.g. `#DIV/0!`) in bold — state is clear without
  relying on color or italic.
- **Dirty/edited cells** are tinted yellow but also expose the original
  value via a plain-text hover tooltip, and a document's dirty tab carries
  a `●` indicator, not only a color change.
- **An invalid drop target** while moving a selected range is marked by an
  outline and cursor change, not color alone (see
  [copy-paste-fill-and-flash-fill.md](copy-paste-fill-and-flash-fill.md)).
- **Conditional Formatting**'s color-based rules are themselves an
  intentional exception (their entire purpose is coloring cells by value),
  but they never replace an error/state signal elsewhere in the UI — they
  only affect the target cell's own background/text color.

## Forced-colors / high-contrast support

Because state is never signaled by color alone (above), the UI stays
legible in forced-colors / high-contrast modes: the non-color cues
(outline pattern, corner marker, bold error text, wavy underline) continue
to distinguish state even when the OS overrides the app's own color
tokens. See [theming-and-visual-system.md](theming-and-visual-system.md)
for how the semantic CSS custom-property token system this sits on top of
is structured.
