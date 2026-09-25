---
type: ui-concept
title: Selection and navigation
description: Selecting cells, rows, columns, and ranges; the four visually distinct selection roles; Select All; Go to Cell; and the cell-reference box.
sources:
  - resource: ../../README.md
status: stable
generated:
  by: claude-code/claude-sonnet-5
  at: 2026-09-22T16:27:14Z
---

# Selection and navigation

## Selecting cells, rows, columns, and ranges

- **Drag** across cells to select any rectangular range (many rows × many
  columns). **Shift+Click** extends the range from the anchor;
  **Shift+Arrows** extends it a cell at a time.
- Click a **row header** to select the whole row, or a **column header** for
  the whole column. Drag across row/column headers to select several, and
  **Shift+Click** a header extends the row/column selection.
- The selected rectangle feeds copy, paste, the fill handle,
  formula-reference insertion, selection statistics, and the row/column
  commands unchanged. Structural row/column operations still require an
  explicit CSV → RSF conversion (see [../formats/index.md](../formats/index.md)).

## Four visually distinct selection roles

Selection state is rendered as four visually distinct roles, never
overlapping in meaning:

| Role                                     | Rendering                                                      |
| ---------------------------------------- | -------------------------------------------------------------- |
| **Active cell**                          | solid outline                                                  |
| **Anchor** (opposite corner of the drag) | dashed outline                                                 |
| **Range**                                | tinted fill                                                    |
| **Whole row/column selection**           | the fill above, plus the row/column header is also highlighted |

Selection rendering is virtualization-correct: the selected rectangle is
tracked in application state, not by DOM presence, so it stays correct when
it extends beyond the currently rendered viewport (see "Command flow" and
the state model in
[../architecture/system-overview.md](../architecture/system-overview.md)).

## Moving with Enter and Tab

With a cell selected (no editor open), **Enter / Shift+Enter** move down /
up and **Tab / Shift+Tab** move right / left, the same as while editing
(where the key applies the edit first). After typing across a row with Tab,
Enter returns to the column where that row began. At the row's first or
last field, Tab / Shift+Tab are left to the browser, so keyboard users can
always Tab out of the grid (no keyboard trap; see
[accessibility.md](accessibility.md)).

## Jumping to the data edge

**Ctrl+Arrow / Cmd+Arrow** jumps along the row or column: from a filled
cell next to another filled cell it goes to the last filled cell of that
block; otherwise it goes to the next filled cell, or to the end of the row
or sheet when nothing further is filled. **Ctrl+Shift+Arrow** extends the
selection to the same place. Vertical jumps walk only visible rows, in the
order shown, so filtered-out rows are skipped and a sorted view is followed
as displayed. The rule lives in `src/ui/grid/data-edge.ts`.

## Select All

**Edit > Select All Cells** selects the **used range** of the active
document — the whole logical grid for a new RSF document, or a clear
no-data message for an empty CSV. **Ctrl+A / Cmd+A** triggers the same
command, but **only while the grid itself has focus**: inside text fields,
dialogs, or anywhere else on the page the browser's own Select All is never
intercepted (see [accessibility.md](accessibility.md) for the general
keyboard-shortcut-ownership rule).

Whole-sheet selection renders through the virtualized window — no DOM is
created for off-screen cells. Statistics for huge selections show a
"Calculating…" state while a background scan fills them in (see the
time-slicing pattern in
[../architecture/system-overview.md](../architecture/system-overview.md)'s
"Long-running operations" section). The selection then feeds copy, fill,
auto-fit of the selected columns, and the row/column commands like any
other range.

### The top-left corner control

The cell at the intersection of the row and column headers is an interactive
**"Select all cells" button** (localized _Select all cells_ / _すべてのセル
を選択_). Click or tap it — or focus it with the keyboard and press
**Enter/Space** — to run the same Select All command. While the whole sheet
is selected the corner reads as pressed (`aria-pressed`), a state kept
visually distinct from the active cell, an ordinary range, whole-row/
whole-column selections, and formula-reference highlighting (see
[../ui/copy-paste-fill-and-flash-fill.md](copy-paste-fill-and-flash-fill.md)
for formula-reference highlighting's own visual language).

## Go to Cell

**Search > Go to Cell…** jumps the selection straight to any cell reference
you type (e.g. `B12`), like Excel's Name Box or Ctrl+G. The field is seeded
with the current cell, validates on every keystroke, and Enter confirms. It
works on both CSV and RSF tabs and only moves the selection — nothing is
written to the document. **Ctrl+G / Cmd+G** opens it from anywhere, taking
precedence over the browser's "Find Again" (see
[accessibility.md](accessibility.md)).

## The cell-reference box

The cell-reference box (top-left of the formula bar) shows the **whole
current selection**, not just the active cell:

- a single address (`A1`),
- the normalized range regardless of drag direction (`A1:B2`),
- whole-row (`1:3`) and whole-column (`A:C`) forms,
- the concrete used range for Select All (`A1:Z100`).

The display is presentation only — active-cell, anchor, and range semantics
are unchanged by it — and it updates immediately after pointer drags,
Shift+Click / Shift+Arrow, header selection, Select All, filter changes, tab
changes, undo/redo, and programmatic selection restoration.
