---
type: ui-concept
title: Copy, paste, fill, and Flash Fill
description: Clipboard formats, pattern-repeat paste tiling, Insert Copied Cells/Rows/Columns, the fill handle and numeric-series AutoFill, moving a selected range, and Flash Fill's safe-transformation preview/refusal model.
sources:
  - resource: ../../README.md
status: stable
generated:
  by: claude-code/claude-sonnet-5
  at: 2026-09-22T16:27:14Z
---

# Copy, paste, fill, and Flash Fill

## Copy and paste

**Copy (Ctrl+C)** of any rectangular selection — including many rows × many
columns — produces tab-separated, newline-separated text (displayed values,
so formulas contribute their computed results), pasteable into other
spreadsheet software. An **internal clipboard** additionally keeps the raw
inputs and the copy origin, so pasting within the app preserves formulas and
adjusts their relative references.

**Paste (Ctrl+V)** pastes a rectangular block starting at the active cell,
preserving its shape.

- **Pattern repeat.** When a larger destination range is selected and each
  of its dimensions is an exact multiple of the copied block's, the block
  tiles to fill the whole selection (references adjust per tile);
  otherwise the block is pasted once.
- In an RSF spreadsheet, a paste that reaches past the grid **grows it**
  (undoably, as part of the paste itself). A byte-preserving CSV never
  gains rows or columns silently — such pastes require the explicit RSF
  conversion (see [../formats/index.md](../formats/index.md)).

## Insert Copied Cells / Rows / Columns

- **Edit > Insert Copied Cells…** (also on the cell context menu) inserts
  the most recently copied block at the selection by **shifting existing
  cells right or down**. Shifting down inserts whole rows across the sheet;
  shifting right inserts whole columns — this keeps every formula
  consistent: existing references adjust exactly like Insert Rows/Columns,
  and relative references inside the inserted formulas shift by their
  offset from the copied location. The whole insertion (structure + formula
  rewrites + values) is **one atomic undo step**. Structural insertion is
  spreadsheet-only, so on a CSV document the command explains and offers the
  explicit RSF conversion first.
- **Edit > Insert Copied Rows** / **Insert Copied Columns** insert the
  copied block as whole rows or columns. The placement rule (also stated by
  the completion notification): copied **rows go above the selection's top
  row**; copied **columns go to the left of the selection's left column**.
  Copied cells keep the columns/rows they were copied from when the copy
  origin is known (in-app copies); a system-clipboard block of unknown
  origin starts at column A / row 1. Each insertion is **one atomic
  undo/redo step**; on a CSV document the commands require the explicit RSF
  conversion (declining leaves the document untouched).
- Large pastes and insertions (above the threshold documented in
  [../architecture/system-overview.md](../architecture/system-overview.md)'s
  "Long-running operations" section) run behind the loading indicator with
  percentage progress.

## The fill handle, Fill Down, and numeric-series AutoFill

The selection's bottom-right corner has a **fill handle**: drag it down or
right to copy the selected block, tiling its pattern and adjusting relative
references. **Ctrl+D / Cmd+D** (Fill Down) fills the selection from its top
row. Each fill is one atomic undo step.

**Numeric series (AutoFill).** A purely vertical or purely horizontal fill
whose seed lane holds **two or more** numbers forming an arithmetic
progression continues the series instead of merely repeating it: `1, 2, 3`
→ `4, 5, 6`; `2, 4` → `6, 8`; `10, 7` → `4, 1`. The step is inferred per
column (or per row) independently, and continuation values keep the seeds'
own decimal precision (`0.1, 0.2` → `0.3`, never float noise). The
documented fallbacks — never a guess:

- a **single** numeric seed copies its value,
- **formulas** keep relative-reference translation (never series
  inference), and
- **non-numeric, mixed, or non-linear** seeds keep the plain copy/tile
  behavior.

As with every structural fill, this applies in RSF mode only — a CSV
document is offered the explicit conversion first.

## Moving a selected range

Drag a selected rectangle's top-left **move handle** (or use **Edit > Move
Selected Cells…**, fully keyboard-driven, which asks for a destination) to
move the block elsewhere. A drag preview shows the source, the proposed
destination, and whether the drop is valid — an invalid drop is marked by an
outline and cursor, never color alone (see
[accessibility.md](accessibility.md) for that rule generally).

Moving carries values, formulas, and RSF-supported display state, and
rewrites references using a standard spreadsheet rule: **a reference to a
moved cell follows it to its new location — on the same worksheet or through
a cross-sheet reference — while every other reference is left as written**;
`$` absolute markers are preserved, and a range reference follows a move
only when it lies wholly inside the moved block (this reference-rewrite
guarantee is also recorded in
[../architecture/invariants.md](../architecture/invariants.md)). If the
destination already holds data, a confirmation states the target range and
the number of cells that would be replaced (Cancel is the default); an empty
destination moves without prompting. The whole move is one atomic, undoable
step; Escape cancels a drag before it commits; and it is RSF-only.

## Flash Fill

**Edit > Flash Fill…** (also on the cell context menu) fills a column by
inferring a pattern from examples already typed — entirely **offline and
deterministic**: no cloud service, no AI model, no telemetry, no dynamic
code (this determinism is also recorded as an invariant in
[../architecture/invariants.md](../architecture/invariants.md)).

- Type one or more example results at the top of a target column (e.g. a
  full name built from first-name and last-name columns), select a cell in
  that column, and run Flash Fill.
- The engine searches a fixed set of **safe text transformations** of the
  row's other columns: copying a column, joining columns with constant
  literal separators, taking a part of a delimiter-separated value (split),
  constant prefixes/suffixes, and simple casing normalization when the
  examples demonstrate it.
- A transformation is proposed **only** when it reproduces every example
  exactly _and_ every matching candidate agrees on every affected cell.
  Ambiguous examples (two patterns that would fill differently) change
  nothing — a localized explanation shows the conflicting outputs and asks
  for one more example instead of guessing.
- Before anything is applied, an **accessible preview** shows the inferred
  operation in plain words, the affected range, the cell count, a bounded
  before/after sample, and — when any non-empty cell would be overwritten —
  an explicit, counted overwrite warning. Applying requires pressing the
  confirm button; cancelling (or Escape) leaves the document untouched.
- Applying is **one atomic, undoable operation**. Large blocks are analyzed
  in cooperative time slices with an honest percentage, and the operation
  aborts cleanly — changing nothing — if the document changes meanwhile.
- Flash Fill is **RSF-only**; on a plain CSV document it explains the
  required conversion and changes nothing. No keyboard shortcut is claimed
  (the conventional Ctrl+E is browser-reserved); the command is fully
  keyboard-accessible through the menu and context menu.
