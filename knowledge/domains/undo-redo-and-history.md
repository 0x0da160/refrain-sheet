---
type: domain-concept
title: Undo/redo and history
description: What a person experiences pressing Ctrl+Z — one HistoryEntry per user-visible mutation, what rides bundled into a single entry, and what is deliberately not undoable (Sort).
sources:
  - resource: ../../README.md
  - resource: ../../src/core/history.ts
status: stable
generated:
  by: claude-code/claude-sonnet-5
  at: 2026-09-22T16:27:09Z
---

# Undo/redo and history

This is the user-facing companion to
[`../architecture/invariants.md`](../architecture/invariants.md)'s "Atomic
history" bullet, which states the implementation guarantee (one
`HistoryEntry` per user-visible mutation, structural edits bundling their
formula-reference rewrites). This file describes what pressing Ctrl+Z
actually does from the user's side.

## The basics

- **Ctrl+Z / Cmd+Z** undoes; **Ctrl+Y**, **Ctrl+Shift+Z**, or
  **Cmd+Shift+Z** redoes.
- Typing within one cell edit is grouped into a single undo step (one step
  per commit) — you don't get a separate undo for every keystroke.
- **Replace All** and **Revert All Edits** are atomic: one Undo reverses
  the whole operation, however many cells it touched.
- After a successful save, the saved bytes become the new baseline and
  history is cleared — you cannot undo past a save.

## What rides bundled into one entry

A single `HistoryEntry` can carry more than the edit you made, because
Refrain Sheet's rule is that anything the edit implies undoes with it, in
one step:

- **Structural edits and their formula-reference rewrites.** Inserting or
  deleting rows/columns rewrites references in the affected worksheet, and
  `Name!`-qualified references to it from every other worksheet, as part
  of the same entry — see
  [formulas-and-references.md](formulas-and-references.md).
- **Wrap-state changes.** If a committed value contains a line break and
  that automatically enables "Wrap long rows," the wrap-state change rides
  in the same entry as the edit, so one Undo restores both the value and
  the prior wrap state.
- **Worksheet lifecycle changes.** Add, rename, duplicate, delete, and
  reorder are each one atomic, undoable operation — a deleted worksheet's
  data travels inside its own entry, so Undo restores it completely. See
  [workbook-and-worksheet-lifecycle.md](workbook-and-worksheet-lifecycle.md).
- **Workbook-wide Replace All.** Replacing across every matching worksheet
  applies as **one** undoable step, even though it may touch many
  worksheets.

## What is not undoable

- **Sort** (`Sheet > Sort…`) is session-only view state, exactly like the
  current selection. It is never written to the `.rsf` container, is
  **not** an undoable `HistoryEntry`, and never marks the document dirty.
  Clearing the sort restores document order directly — there is no Undo
  step for it, because there was never a history entry to undo. Filtering
  is different: a filter **is** persisted in the container (though
  applying/clearing one is still an ordinary undoable operation, since it
  changes what the file will save).
- Row/column insertion or deletion drops the active sort outright (with a
  notification) rather than trying to keep it consistent with the new
  layout — since a sort was never in history to begin with, this is not
  an undo-related event, just a side effect of the structural edit.

See the README's "Undo / Redo" and "Sorting (RSF)" sections for the full
behavioral detail this file summarizes, and
[`../architecture/invariants.md`](../architecture/invariants.md) for the
"Sort = display order only, never mutate" and "Atomic history" guarantees
that make the above true.
