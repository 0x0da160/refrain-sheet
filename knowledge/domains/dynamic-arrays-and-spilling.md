---
type: domain-concept
title: Dynamic arrays and spilling
description: Spill anchors and derived cells, the #SPILL! error, placement order when spills compete, why only the anchor formula is ever saved, and how arithmetic vs. comparisons interact with spilled ranges.
sources:
  - resource: ../../README.md
  - resource: ../../src/core/spill.ts
status: stable
generated:
  by: claude-code/claude-sonnet-5
  at: 2026-09-22T16:27:09Z
---

# Dynamic arrays and spilling

`FILTER`, `UNIQUE`, `SORT`, and `SEQUENCE` return a whole rectangle of
values. `XLOOKUP`, `INDEX`, and `IFERROR` can too, when asked for a whole
row or column. See
[formula-functions-and-errors.md](formula-functions-and-errors.md) for the
rest of the function inventory.

## Anchor and derived cells

The formula stays in **one** cell — the **spill anchor** — and the rest of
the rectangle is filled in automatically with **derived cells**.

- Derived cells are **not editable**. Editing, pasting into, filling, or
  clearing one is refused with a message naming the anchor to edit instead.
  The formula bar for a derived cell is empty, because it holds no input.
- If any cell in the rectangle is occupied, or the rectangle would run past
  the worksheet's last row or column, the anchor shows `#SPILL!` and writes
  **nothing at all** — never a partial result, all-or-nothing. Clearing the
  obstruction restores the spill immediately.

## Placement when spills compete

Several spills coexist; when two would overlap, they are placed in
row-major order and the first to claim a cell keeps it. A dynamic-array
formula reads other spills' derived cells as blank. All anchors are
evaluated before any is placed, so the result cannot depend on the order
two spills appear in, and a spill cannot feed itself.

Spilling never crosses a worksheet boundary, but a spill's **source** range
may be on another worksheet.

## Only the anchor is ever saved

Derived values are recomputed from the anchor's formula every time a
document loads or recalculates. This is why undo/redo, row and column
insertion, worksheet renames, filtering, find and replace, CSV export, and
the `.rsf` round trip all need no spill-specific handling — and why no
stale derived value can ever be written to a file. See
[undo-redo-and-history.md](undo-redo-and-history.md) for how this
interacts with the atomic history model.

## Arithmetic vs. comparisons

Arithmetic does not spread over an array: `=SEQUENCE(3)+1` is `#VALUE!`,
not three numbers. **Comparisons do**, because that is how a condition is
written: `=FILTER(A1:C9, B1:B9>5)` works as expected.

## `FILTER()` vs. Data > Filter

`FILTER()` is not the **Data > Filter** command. The function computes a
new list into empty cells and leaves the source untouched; the command
hides rows of the sheet you are looking at and is saved with the file
(see `../../README.md`'s "Filtering (RSF)" section). Filtering a sheet does
not change what `FILTER` returns.

## Bounds and the container format

The formula-evaluation bounds that keep a hostile spill from hanging the
tab (spill anchors per worksheet, spilled cells per worksheet, dynamic-array
rows/columns/cells, and the rest of the shared bounds table), and exactly
what the `.rsf` container stores for a spill anchor and why an older reader
degrades gracefully, are documented in
[`../formats/rsf/dynamic-arrays.md`](../formats/rsf/dynamic-arrays.md) —
not repeated here.
