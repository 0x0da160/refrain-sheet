---
type: ui-concept
title: Column resize and auto-fit
description: Manual drag-resize, double-click and multi-column auto-fit, what auto-fit actually measures, and the virtualized sampling strategy for huge sheets.
sources:
  - resource: ../../README.md
status: stable
generated:
  by: claude-code/claude-sonnet-5
  at: 2026-09-22T16:27:14Z
---

# Column resize and auto-fit

## Manual resize and single-column auto-fit

Drag a column-header boundary to resize; **double-click** it to auto-fit.
Auto-fit recalculates the width from current content and **can make a
column narrower or wider** — it is not grow-only, and nothing is cached
between invocations, so a stale historic maximum can never prevent
narrowing.

## Multi-column auto-fit

Auto-fit applies to **every selected column**, not just the one under the
pointer:

- When whole columns are selected (column headers, header dragging,
  Shift+Click, or any selection spanning every row — including Select All)
  and the user double-clicks a boundary inside the selection, **all
  selected columns fit**.
- **Sheet > Auto-Fit Column Width** (also on the context menu) fits every
  column intersecting the current selection.
- Each column is measured **independently** with its own header and
  values, so columns shrink and grow on their own — a wide column next to a
  narrow one is not averaged or clamped by its neighbor.
- The selection model is contiguous, so the target is always a contiguous
  column span; there is no non-adjacent multi-selection to support (see
  [selection-and-navigation.md](selection-and-navigation.md)).
- Fitting many columns of a large sheet runs column by column with yields
  to the browser and a **"N of M columns measured" + percentage** busy
  label (see the progress-reporting pattern in
  [../architecture/system-overview.md](../architecture/system-overview.md)'s
  "Long-running operations" section). If the document changes mid-run the
  operation aborts and applies **no width at all** — all-or-nothing, never
  a partial result.
- Column widths are per-tab **view state**, not document content: auto-fit
  never modifies plain CSV bytes and is deliberately outside the document
  undo history (undo remains reserved for data changes).

## What auto-fit actually measures

Auto-fit measures **real rendered pixel widths**, never character counts or
average-width guesses:

- `CanvasRenderingContext2D.measureText` is configured from the *computed
  style* of an actual cell — the active sheet font family, size, weight,
  upright style, and letter spacing (see
  [theming-and-visual-system.md](theming-and-visual-system.md) for the
  spreadsheet-font choice this reads).
- Cell padding and borders are read from the computed style and added
  separately.
- The **column header is included** in the measurement.
- Formula cells contribute their **displayed calculated values**, never
  their hidden formula source.

Because everything is recomputed on demand, edits, recalculation,
sheet-font changes, and locale changes are all reflected on the next
auto-fit automatically — there is no stale cache to invalidate.

## Virtualized sampling for huge sheets

Virtualized large sheets never render or measure the whole column
synchronously. The documented strategy: every currently materialized
(on-screen) row is measured, plus a deterministic, **evenly spaced sample
of up to 1000 off-screen rows** whose display values are read straight from
the document model (no DOM work). When the fit is based on a sample, a
notification says so honestly — the result is never presented as an exact
measurement of the whole column. The result is clamped to the configured
minimum/maximum widths.

Manual drag-resizing always works exactly the same regardless of sheet
size. Widths are per-document for the session; plain CSV bytes are never
mutated by resizing or auto-fit, and RSF spreadsheet documents persist
widths in their container (see [../formats/index.md](../formats/index.md)).
