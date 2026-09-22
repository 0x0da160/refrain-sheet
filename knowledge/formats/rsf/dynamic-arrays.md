---
type: format-concept
title: RSF dynamic arrays (spill)
description: Why nothing derived is ever stored on disk, spill placement rules, and the formula-evaluation bounds that keep a hostile file from hanging the tab.
sources:
  - resource: ../../../docs/rsf-format.md
  - resource: ../../../src/core/spill.ts
status: stable
generated:
  by: claude-code/claude-sonnet-5
  at: 2026-09-22T12:09:14Z
---

# Dynamic arrays (spill) — nothing derived is ever stored

A formula returning a rectangular array writes it across the worksheet
starting at the formula cell. That cell is the **spill anchor**; the rest
are **derived cells**.

**The container stores the anchor's formula and nothing else.** There is
no spill record, no cached result, and no format-version change: a
worksheet holds exactly the inputs the user typed, and the spill is
recomputed from them on load. Consequences that fall out of that one
decision:

- No derived value can go stale on disk.
- Undo/redo, row and column insertion, worksheet rename and delete,
  filtering, find and replace, and CSV export need no spill-specific
  handling, because they all operate on inputs or on displayed values.
- A file written by this version is readable by **any** version that
  understands the container: an older reader sees an ordinary formula
  cell whose function name it does not know, and evaluates it to
  `#NAME?`. It does not fail to open, and it does not lose data — the
  formula text is preserved and works again in a newer reader.

## Placement rules

Applied in row-major order with first claim winning:

1. The rectangle must fit inside the worksheet's existing rows and
   columns — spilling never grows the grid.
2. Every covered cell other than the anchor must be empty.
3. No covered cell may already belong to an earlier spill.

Failing any of these blocks the anchor: it shows `#SPILL!` and writes
**nothing at all**, never a partial rectangle.

A dynamic-array formula reads other spills' derived cells as **blank**.
All anchors are evaluated before any is placed, so the result cannot
depend on the order two spills appear in and a spill cannot feed itself.
Ordinary formulas see spilled values normally. To chain arrays, reference
the anchor cell.

## Bounds and validation added for formulas

Every one of these is enforced at evaluation time, so a hostile formula in
an untrusted `.rsf` file cannot hang the tab or exhaust memory:

| Bound                                | Value                        |
| ------------------------------------ | ---------------------------- |
| Formula source length                | 8,192                        |
| Arguments in one call                | 255                          |
| Parser nesting depth                 | 400 units                    |
| Cells visited by one range argument  | 2,000,000                    |
| Dynamic-array rows / columns / cells | 100,000 / 16,384 / 1,000,000 |
| Spill anchors per worksheet          | 512                          |
| Spilled cells per worksheet          | 1,000,000                    |
| Text result length                   | 32,767                       |
| Criteria string length               | 512                          |
| Criteria pairs per call              | 32                           |
| Sort keys per `SORT`                 | 8                            |

Exceeding a bound produces an ordinary formula error (`#NUM!`, `#VALUE!`,
or `#SPILL!`) in that one cell. A function that throws unexpectedly is
caught and reported as `#VALUE!` in its cell rather than propagating.
