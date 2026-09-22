---
type: ui-concept
title: Tabs and worksheet strip
description: The interaction model of the two independent tab strips — drag reorder with a drop indicator, keyboard equivalents, roving tabindex, dirty indicators, and the close-tab flow.
sources:
  - resource: ../../README.md
status: stable
generated:
  by: claude-code/claude-sonnet-5
  at: 2026-09-22T16:27:14Z
---

# Tabs and worksheet strip

Refrain Sheet has **two independent tab strips**: the document tab strip
above the grid (open _files_) and the worksheet strip below the grid (the
_worksheets inside the active workbook_). This file covers how each strip
is operated; for which data each strip owns and which application-state
surface backs it, see
[../architecture/system-overview.md](../architecture/system-overview.md)'s
"Workbooks and worksheets" section and its `TabBar` vs `SheetBar` table —
that data-ownership distinction is not repeated here.

## Document tabs (above the grid)

- Multiple files open as tabs; a newly opened file always becomes active.
- Unsaved tabs show a `●` dirty indicator.
- **F8** closes the active tab (the menu and the × button always work too).
  Ctrl+W and Ctrl+Tab are intentionally left to the browser, so switching
  tabs is done by clicking them in the tab bar.
- **Reorder** by dragging a tab (an accent bar shows the drop position),
  via **View > Move Tab Left / Right / to Start / to End**, or from a tab's
  right-click context menu. No shortcut is assigned by design: the
  remaining Ctrl/Alt+arrow-style combinations conflict with browser/OS tab
  and history shortcuts, and the commands stay fully keyboard-reachable
  through the menu. Moving a tab changes only its position — document,
  dirty state, selection, undo history, and file association all travel
  with it, the active tab stays active, and moves are announced to
  assistive technologies. Tab order lasts only for the session; it is not
  persisted.
- Closing a modified tab asks **Save / Discard / Cancel**. When leaving the
  page with modified tabs, browsers do not allow custom dialogs, so the
  browser's own standard leave-page confirmation appears instead.
- Closing the **last** tab returns the app to its welcome screen; see
  `README.md`'s "The initial screen" section for what state is cleared
  versus what application-level preference persists across that boundary.

## Worksheet strip (below the grid)

The worksheet strip is available from the **Sheet** menu, the strip's own
context menu (right-click a worksheet tab), and the keyboard:

| Action              | How                                                            |
| ------------------- | -------------------------------------------------------------- |
| Switch worksheet    | Click a tab, `←` / `→`, `Home` / `End`, or `F7` / `Shift+F7`   |
| Add worksheet       | The `+` button, or Sheet > Add Worksheet                       |
| Rename worksheet    | Double-click a tab, `F2`, or Sheet > Rename Worksheet…         |
| Duplicate worksheet | Sheet > Duplicate Worksheet…                                   |
| Delete worksheet    | Sheet > Delete Worksheet                                       |
| Reorder worksheet   | Drag a tab, `Alt`+`←` / `→`, `Alt`+`Home` / `End`, or the menu |

Drag-and-drop reordering is a **convenience only** — every reorder has a
keyboard and menu equivalent (`Alt`+arrows / `Alt`+`Home`/`End`), and the
strip announces the result to assistive technologies. Worksheet tabs use a
**roving tabindex**, so the whole strip is a single tab stop: Tab moves
focus into and out of the strip once, and arrow keys move among the tabs
inside it (see [accessibility.md](accessibility.md) for the general roving-
tabindex/keyboard-operability expectation).

**Worksheet names** are trimmed, at most 100 characters, unique within the
workbook (case-insensitively), and may not contain `:` `\` `/` `?` `*` `[`
`]` or control characters — the characters that would clash with
formula-reference syntax (`Sheet1!A1`). The rename dialog validates as you
type, reports the problem inline in the active language, and is IME-safe
(pressing Enter to commit a Japanese candidate never submits the dialog —
see [editing-and-ime.md](editing-and-ime.md) for the general IME-safety
architecture this reuses).

Plain CSV documents are single-sheet by definition: their worksheet strip
shows a short explanation instead of tabs, and worksheet commands are
disabled — converting to RSF is what unlocks multiple worksheets.

## Close-tab and delete-worksheet confirmation flows

- **Closing a document tab** with unsaved changes: **Save / Discard /
  Cancel**.
- **Deleting a worksheet** that holds content, a filter, or non-default
  display settings asks for confirmation first, and the confirmation
  states how many formulas elsewhere in the workbook will become `#REF!`.
  Adding, renaming, duplicating, deleting, and reordering a worksheet are
  each one atomic operation that Undo reverses completely — including a
  deleted worksheet's data and the formula rewrites the change implied
  (see [../architecture/invariants.md](../architecture/invariants.md)'s
  "Atomic history" bullet).
- Duplicating a very large worksheet runs in cooperative time slices behind
  a percentage progress indicator; the copy is built to the side and
  inserted only once complete, so cancelling (or switching documents)
  leaves the workbook exactly as it was.
