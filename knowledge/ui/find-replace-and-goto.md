---
type: ui-concept
title: Find, Replace, and Go to Cell
description: The Find/Replace bar, match case, bounded regex mode, Replace vs Replace All, and RSF's workbook-wide search scope.
sources:
  - resource: ../../README.md
status: stable
generated:
  by: claude-code/claude-sonnet-5
  at: 2026-09-22T16:27:14Z
---

# Find, Replace, and Go to Cell

## Opening Find/Replace

**Ctrl+Shift+F / Cmd+Shift+F** opens Find; **Ctrl+Shift+H / Cmd+Shift+H**
opens Replace. These are deliberately **not** the browser's own Ctrl+F /
Ctrl+H — those stay reserved for the browser's own find/history (see
[accessibility.md](accessibility.md) and the shortcut-ownership rule it
describes). Both commands are also reachable from the Search menu.

Next / Previous navigate with wrap-around; match counts (occurrences and
matching cells) update live as you type. Search operates on **current cell
values** — i.e. formula results, not formula source text.

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
reference (e.g. `B12`), like Excel's Name Box or Ctrl+G. See
[selection-and-navigation.md](selection-and-navigation.md) for its full
behavior — it is covered there alongside the cell-reference box it shares a
row with, rather than duplicated here.
