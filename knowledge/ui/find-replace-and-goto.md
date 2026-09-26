---
type: ui-concept
title: Find, Replace, and Go to Cell
description: The Find and Replace side panel, Find Next / Find All with its result list, match case, bounded regex mode, Replace vs Replace All, and RSF's workbook-wide search scope.
sources:
  - resource: ../../README.md
status: stable
generated:
  by: claude-code/claude-sonnet-5
  at: 2026-09-22T16:27:14Z
---

# Find, Replace, and Go to Cell

## Opening Find and Replace

Find and Replace is **one dockable side panel** (the same `.side-panel`
chrome, docking, and resizing as the comments and Filter/Sort panels — see
[view-formatting-and-panels.md](view-formatting-and-panels.md)) holding both
the find and the replace fields. **Ctrl+F / Cmd+F** opens it with the caret
in the find field; **Ctrl+H** (**Cmd+Shift+H** on macOS, where Cmd+H hides
the app) opens it with the caret in the replace field once there is a query.
The older Ctrl+Shift+F / Ctrl+Shift+H still work. These keys are always the
app's, wherever focus is, and take precedence over the browser's own find
and history keys: the grid is virtualized, so the browser's find cannot see
rows outside the viewport anyway (see [accessibility.md](accessibility.md)).
Both commands are also on the Search menu. Escape or the header's × closes
the panel.

## Find Next, Find Previous, and Find All

- **Find Next / Find Previous** (buttons, **F3 / Shift+F3** from anywhere,
  or Enter / Shift+Enter in the find field) move the selection to the
  next/previous matching cell with wrap-around, starting from the current
  selection. F3 opens the panel if it is closed.
- **Find All** lists every matching cell under the buttons: its reference,
  its worksheet in workbook scope, and its text. Clicking a row (or Enter /
  Space on it) selects and reveals that cell; the current match is marked
  in the list. After Find All the list follows the query as you edit it,
  until the query is cleared. The list shows the first 1,000 matching cells
  and says so when there are more; the count line always reports the total.
- Match counts (occurrences and matching cells) update live as you type.
- Moving to a match is a view change only, never an edit, so it is not on
  the undo history.
- Search looks at each cell's **input**: the formula text for a formula
  cell, not its calculated result, so a replacement can only rewrite text
  the user typed.

## Match case and regex mode

- **Match case** is an option; case-insensitive search safely folds at
  least ASCII.
- **Regular expression** mode uses JavaScript regex syntax. Replacement
  supports `$1`–`$9`, `${name}`, `$&`, and `$$`. Invalid patterns show the
  compile error inline instead of crashing.
- **Safeguard against catastrophic backtracking:** patterns are limited to
  **1024 characters**, and a search stops with a warning if it exceeds a
  time budget. This mirrors the same bounded-search discipline the formula
  engine's wildcard matcher uses (see `README.md`'s "Criteria" section for
  formulas) — regex is never allowed to hang the UI on adversarial input.

## Replace vs. Replace All

**Replace** replaces the occurrences in the currently selected matching
cell, then advances to the next match. **Replace All** replaces every match
in scope as **one undoable operation**.

## Workbook-wide scope (RSF)

RSF workbooks can search the **Current Sheet** (the default) or the
**Entire Workbook**. A plain CSV document is single-sheet by definition, so
the scope selector is disabled there with an explanation.

In workbook scope:

- Match counts name how many worksheets contain matches.
- Next / Previous activate the worksheet a match lives on before revealing
  it, and wrapping past the last match back to the first is announced.
- Workbook-wide **Replace All** first shows a confirmation stating how many
  worksheets and cells it will change, applies across every matching
  worksheet as **one** undoable step, and reports any cells skipped because
  they changed during the operation.
- Navigation resolves worksheets by a **stable id**, so a rename, reorder,
  or deletion after a search can never send the user to the wrong place —
  the same stable-id discipline the worksheet strip uses (see
  [tabs-and-worksheet-strip.md](tabs-and-worksheet-strip.md)).

## Go to Cell

**Search > Go to Cell…** jumps the selection straight to a typed cell
reference (e.g. `B12`); **Ctrl+G / Cmd+G** opens it from anywhere. See
[selection-and-navigation.md](selection-and-navigation.md) for its full
behavior — it is covered there alongside the cell-reference box it shares a
row with, rather than duplicated here.
