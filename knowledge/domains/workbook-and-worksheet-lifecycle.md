---
type: domain-concept
title: Workbook and worksheet lifecycle
description: User-facing behavior of RSF workbooks and worksheets — worksheet kinds, add/rename/duplicate/delete/reorder as atomic undoable operations, naming rules, the two independent tab strips, and converting a CSV to a spreadsheet.
sources:
  - resource: ../../README.md
  - resource: ../../src/core/worksheet.ts
  - resource: ../../src/core/rsf-document.ts
status: stable
generated:
  by: claude-code/claude-sonnet-5
  at: 2026-09-22T16:27:09Z
---

# Workbook and worksheet lifecycle

This is the user-facing companion to
[`../architecture/system-overview.md`](../architecture/system-overview.md)'s
"Workbooks and worksheets" section, which covers the code-level model
(`Worksheet` owns data, `RsfDocument` owns evaluation, the `…On(sheetId, …)`
delegation pattern). This file covers what a person experiences.

## Workbooks and worksheets

An `.rsf` file is a **workbook** (ブック) that can hold several
**worksheets** (ワークシート / シート). Each worksheet keeps its own grid,
formulas, row/column structure, filter, zoom, column widths, and selection —
switching worksheets restores exactly where you were on that sheet. A new
workbook starts with one worksheet named `Sheet1` (`シート1` in Japanese),
and a workbook always keeps **at least one** worksheet: the last one cannot
be deleted.

Plain CSV documents are single-sheet by definition. Their worksheet strip
is hidden (#456), and the worksheet commands are
disabled — converting to RSF is what unlocks multiple worksheets.

## Worksheet kinds

A worksheet has a **kind**: `grid` (every worksheet before the field
existed, and the default), `markdown`, `json`, `yaml`, or `text`
(`WorksheetKind` in `src/core/worksheet.ts`). A non-`grid` kind holds one
document as its sole content — its raw source lives in cell A1 — and is
rendered by a docked source/preview surface in the spreadsheet area instead
of the grid while that worksheet is active (`markdown`/`json`/`yaml` also
get a syntax-highlighted preview; `json`/`yaml` additionally get an
explicit, button-triggered Format/pretty-print action that never runs
automatically or on save; `text` has no preview panel, since there is
nothing to render beyond the source itself). None of these four kinds ever
carries formulas, styles, a filter, or a sort, none is ever evaluated as a
formula, and all four are excluded from CSV export (CSV has no analog for a
whole-sheet document). How the file stores each kind (as its lines of
text) is covered by
[`../formats/rsf/json-document.md`](../formats/rsf/json-document.md) —
this file only describes what a worksheet kind means to the person editing
it.

## Worksheet operations

Everything is available from the **Sheet** menu, the worksheet strip's
context menu (right-click a worksheet tab), and the keyboard:

| Action              | How                                                            |
| ------------------- | -------------------------------------------------------------- |
| Switch worksheet    | Click a tab, `←` / `→`, `Home` / `End`, or `F7` / `Shift+F7`   |
| Add worksheet       | The `+` button, or Sheet > Add Worksheet                       |
| Rename worksheet    | Double-click a tab, `F2`, or Sheet > Rename Worksheet…         |
| Duplicate worksheet | Sheet > Duplicate Worksheet…                                   |
| Delete worksheet    | Sheet > Delete Worksheet                                       |
| Reorder worksheet   | Drag a tab, `Alt`+`←` / `→`, `Alt`+`Home` / `End`, or the menu |

Drag-and-drop reordering is a convenience only — every reorder has a
keyboard and menu equivalent, and the strip announces the result to
assistive technologies. Worksheet tabs use a roving tabindex, so the whole
strip is a single tab stop.

Adding, renaming, duplicating, deleting, and reordering a worksheet are each
**one atomic operation** that Undo reverses completely — including a
deleted worksheet's data and the formula rewrites the change implied. See
[undo-redo-and-history.md](undo-redo-and-history.md) for what "atomic"
means from the user's side, and
[`../architecture/invariants.md`](../architecture/invariants.md) for the
implementation guarantee. Deleting a worksheet that holds content, a
filter, or non-default display settings asks for confirmation first, and
the confirmation states how many formulas elsewhere in the workbook will
become `#REF!`.

Duplicating a very large worksheet runs in cooperative time slices behind a
percentage progress indicator; the copy is built to the side and inserted
only once complete, so cancelling (or switching documents) leaves the
workbook exactly as it was.

## Worksheet naming rules

Worksheet names are trimmed, at most 100 characters, unique within the
workbook (ignoring case), and may not contain `:` `\` `/` `?` `*` `[` `]` or
control characters — the characters that would clash with formula-reference
syntax (see [formulas-and-references.md](formulas-and-references.md) for
cross-sheet reference quoting). The rename dialog validates as you type,
reports the problem inline in your language, and is IME-safe (pressing
Enter to commit a Japanese candidate never submits the dialog).

## Two independent tab strips

Worksheets appear in their own strip below the grid, separate from the
document tab strip above it:

| Strip                    | Lists                                     | Owner                |
| ------------------------ | ----------------------------------------- | -------------------- |
| Document tab strip (top) | open **documents** (files)                | `AppState.tabs`      |
| Worksheet strip (bottom) | **worksheets** inside the active workbook | `RsfDocument.sheets` |

Reordering one strip never affects the other.

## Converting a CSV to a spreadsheet

There are two ways to convert, both explicit and confirmed. Either way the
result is a workbook with **one** worksheet populated from the CSV, and the
source `.csv` on disk is never modified:

- **File > Convert to Spreadsheet (RSF)…** converts up front. It uses the
  CSV's current (including unsaved) contents and opens the result in a
  **new** `.rsf` tab; the source CSV tab and the file on disk stay open and
  unchanged. The command is enabled only for a CSV document that has not
  already been converted, and it shows a loading indicator while the sheet
  is built.
- **Implicit conversion** happens when an edit needs it — entering a
  formula, pasting a block that must grow the grid, inserting or deleting
  rows/columns, or filling. After a confirmation, the current tab is
  converted in place: renamed to `.rsf` and detached from the original file
  handle, so the source `.csv` can never be silently overwritten.

Converting is always a **lossy** move from the byte-preserving CSV model to
the spreadsheet values-only model — never a byte-identical copy — as
detailed in
[csv-preservation-guarantee.md](csv-preservation-guarantee.md) and
[`../formats/rsf/compatibility.md`](../formats/rsf/compatibility.md).
