---
type: ui-concept
title: Tabs and worksheet strip
description: The interaction model of the two independent tab strips — drag reorder with a drop indicator, keyboard equivalents, roving tabindex, dirty indicators, and the close-tab flow.
sources:
  - resource: ../../src/ui/shell/tab-row-fit.ts
  - resource: ../../src/app/recent-files.ts
  - resource: ../../tests/ui/tab-row-fit.test.ts
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

**Where the document tab strip sits.** On a desktop-width window it shares
the menu bar's row, to the right of the menu names, whenever at least
240px is left there (#596); otherwise — a narrow window, or one narrowed by
a left/right-docked side panel — it takes its own row below the menu bar.
`updateShellLayout` (`src/ui/shell/tab-row-fit.ts`) decides this from `#app`'s
content width and the menu bar's natural width, and sets
`.tabs-in-menu-row` on `#app`; a `ResizeObserver` re-runs it on window
resizes and language switches, and docking a side panel re-runs it
synchronously. Phones always give the tabs their own row at the top.

## Document tabs (above the grid)

- Multiple files open as tabs; a newly opened file always becomes active.
- **File > Open Recent…** (also **Show All…** on the home screen, which
  lists the five newest recent files itself) lists the
  last 10 files opened or saved through the File System Access API, newest
  first, and opens the one picked after the browser grants read permission
  again; a file that has been moved or deleted is dropped from the list.
  Browsers without that API (Safari, Firefox) cannot reopen a file, so the
  command is disabled there. In the hosted build with Google Drive, the
  dialog also lists the Drive files last opened or saved, under their own
  heading (**On This Device** / **Google Drive**; no headings when only one
  kind is listed), and opens one again with no Picker; the command is then
  enabled in every browser. A Drive file that is gone is dropped. See
  [../operations/security-threat-model.md](../operations/security-threat-model.md)
  for what the list stores.
- Unsaved tabs show a `●` dirty indicator.
- Close a tab with its × button or **File > Close File**; there is no
  keyboard shortcut, because Ctrl+W and Ctrl+Tab are intentionally left to
  the browser (switching tabs is done by clicking them in the tab bar).
- **Reorder** by dragging a tab (an accent bar shows the drop position),
  via **View > Move File Tab Left / Right / to Start / to End**, or from a tab's
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
- Closing the **last** tab returns the app to its home screen: an **Open**
  group (Open File…, Open from Google Drive… in the hosted build, Import
  JSON as Table…), a **New** group (Spreadsheet, CSV, Markdown, JSON, YAML,
  Plain Text — the same kinds as File > New), the recent files, and the
  drop hint (`src/ui/welcome-screen.ts`); see
  `README.md`'s "The initial screen" section for what state is cleared
  versus what application-level preference persists across that boundary.

## Worksheet strip (below the grid)

The worksheet strip is available from the **Sheet** menu, the strip's own
context menu (right-click a worksheet tab), and the keyboard:

| Action              | How                                                                                |
| ------------------- | ---------------------------------------------------------------------------------- |
| Switch worksheet    | Click a tab, `←` / `→`, `Home` / `End`, or `Ctrl+Alt+PageDown` / `Ctrl+Alt+PageUp` |
| Add worksheet       | The `+` button, or Sheet > Manage Sheets > New Sheet; from a CSV file too (below)  |
| Rename worksheet    | Double-click a tab or `F2` (typed on the tab), or Sheet > Rename Worksheet…        |
| Duplicate worksheet | Sheet > Duplicate Worksheet…                                                       |
| Delete worksheet    | Sheet > Delete Worksheet                                                           |
| Reorder worksheet   | Drag a tab, `Alt`+`←` / `→`, `Alt`+`Home` / `End`, or the menu                     |

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

**Renaming on the tab.** A double-click on a tab or a folder header, or
`F2` on it, puts a text field in place of its name (`SheetBar.editName`).
Enter keeps the name as one undoable step, Escape puts the old one back; a
name that cannot be used keeps the field open, marked invalid, with the
reason as its tooltip and announced, and leaving the field then gives up.
A click redraws the strip (it activates a worksheet or opens a folder), so
the browser's own `dblclick` never reaches the new tab: the strip treats a
second click on the same tab or folder within 500 ms as the double-click,
and a folder double-clicked is left open or closed as it was.

**Adding sheets from CSV files.** Sheet > Manage Sheets > New Sheet > Add Sheet from CSV File… (also
the Add Sheet dialog's From a CSV File… button) adds each chosen CSV file
as a new worksheet after the active one, named after the file and
de-duplicated like any new name, one undoable step per file. The file is
read with the same encoding detection and warnings as opening it, and its
values go in as Convert to RSF puts them; the file itself is never linked
to the workbook or changed (`FileOpening.addCsvSheets`).

**Tab colors.** Sheet > Sheet Tab Color… (also in the tab's context menu)
gives the active worksheet's tab a color, drawn as a bar along the tab's
edge so the name keeps the theme's own colors. The dialog is the shared
color picker (`src/ui/color-picker.ts`); **No Color** removes it. A tab color is document data like a
cell color: the same in every theme, saved in the RSF file as the
worksheet's `tabColor`, kept by Duplicate, and one undoable change. Like
renaming, it is allowed on a locked worksheet.

**Tabs on the left.** View > Sheet Tabs on the Left (a browser setting,
`getSheetTabsVertical` in `src/app/settings.ts`, not document data) sets
`.sheet-tabs-vertical` on `#app`, which stands the strip as a column
beside `#app-content` (`src/styles/sheet-bar.css`), 180px wide until the
edge on its right is dragged (or moved with the arrow keys; a double-click
goes back to 180px). The width is a browser setting too, kept between 120
and 480px (`getSheetTabsWidth`), applied as `--sheet-tabs-width`. The tabs are the row's
look turned a quarter: attached to the grid on their right edge, with the
tab color and the active marker on the far edge. Up/Down mirror Left/Right
(Alt reorders), drops use the pointer's height, and the strip reports
`aria-orientation`. The strip reads its orientation from the layout rather
than the setting, because a window at or below 43.75em (phones) keeps the
row. A top/bottom-docked side panel insets the column through
`--dock-inset-top`/`--dock-inset-bottom` on `#app`, and the column adds
nothing to a bottom dock's offset (`reserveAppEdge` and `sheetBarHeight`
in `src/ui/dialogs/side-panel.ts`).

**Sheet folders.** Worksheets can be grouped in folders, nested to any
depth; a worksheet is in at most one folder. Sheet > Manage Sheets > Sheet Folders > New Folder…
(or the icon-only folder button next to `+`) creates an empty folder at the
top level, and worksheets are dragged into it; Move to New Folder… puts the
active worksheet into a new folder where it is (so inside its current
folder), and Move to Folder… moves it to any folder or out
of all of them. A folder's header in the strip opens and closes it (a
closed folder hides all its worksheets, the active one too: its header is
then marked active, and the arrow keys on it move to the tabs beside it;
open/closed is not saved),
takes a dropped worksheet, and has its own context menu: Rename, Move
(never into itself), Remove Folder, Keep Sheets (its contents move up a
level), and Delete Folder and Its Sheets (confirmed; formulas pointing at
those sheets become #REF!, as for deleting a sheet; refused when it would
leave the file no sheet). A new worksheet joins the active worksheet's
folder, a duplicate stays in its source's, and dropping a tab next to
another puts it in that one's folder. Every change is one undoable step:
`SheetFoldersState` (`src/app/state/sheet-folders.ts`) records the whole
organization (folders, worksheet order, each worksheet's folder) before
and after, as the `organize` sheets operation. The tree is derived from
the worksheet order (`src/core/workbook/sheet-folders.ts`); the file keeps
the folders as `folders` and each worksheet's `folder`
([json-document.md](../formats/rsf/json-document.md)). Beside the grid the
folders are indented; in the row, each folder's group is outlined.

Plain CSV documents are single-sheet by definition: their worksheet strip
is hidden, so no empty band sits under the grid (#456), and worksheet commands are
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
