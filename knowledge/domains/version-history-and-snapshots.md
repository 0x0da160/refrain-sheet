---
type: domain-concept
title: Version history and snapshots
description: Per-file on-by-default snapshot recording on every successful save, the retained-snapshot cap and its custom/unlimited override, Restore vs. read-only Preview, and Clear Version History.
sources:
  - resource: ../../README.md
  - resource: ../../CHANGELOG.md
status: stable
generated:
  by: claude-code/claude-sonnet-5
  at: 2026-09-22T16:27:09Z
---

# Version history and snapshots

Not to be confused with [Undo/Redo](undo-redo-and-history.md), whose
history is in-memory only and clears on save: version history is a
per-file, **on by default** setting that records a **snapshot** of the
file's content on every successful save, stored inside the `.rsf`
container itself, so past states survive after save and reload.

## How snapshots are stored

Snapshots are stored inside the file's JSON, in its `history` section
(each one a readable copy of the workbook as it was), and compressed
together with the rest of it with Zstandard (see
[`../formats/rsf/json-document.md`](../formats/rsf/json-document.md#history)).
There is no separate
history file and no extra compression pass to configure, and because
save-to-save content is usually very similar, this gives noticeably better
compression than storing each snapshot on its own would. A snapshot holds
the same kind of inert cell/style/formula data the live document itself
stores — never code, macros, or anything executable, consistent with the
container's general "inert data only" guarantee (see
[`../operations/security-threat-model.md`](../operations/security-threat-model.md)).

## Retained-snapshot cap

Up to 20 snapshots are kept by default, oldest dropped first once a save
would exceed the cap. The cap is configurable per file: it can be raised
to a custom number or set to **unlimited**, from **Sheet > File Version
History…**. When a save would exceed a finite limit, a confirmation shows
before the save happens (with a "don't show this warning again" option,
saved locally in the browser); it never blocks a save when the limit is
unlimited. Turning history off stops recording _new_ snapshots but keeps
the ones already saved.

## Restore and Preview

- **Restore** replaces the file's current content with the chosen
  snapshot's. It asks for confirmation first, since — like Sort clearing
  or any other explicit content replacement — it is **not itself
  undoable**.
- **Preview** opens a snapshot's content full-screen in the same real,
  virtualized grid and worksheet-tab strip the live app itself uses —
  evaluated values, every worksheet, no row/column cap — so it can be
  checked before committing to Restore. Preview is **read-only throughout**
  and commits nothing; it exists purely so a person can confirm which
  snapshot they want before taking the irreversible Restore step.

**Sheet > Clear Version History** deletes every recorded snapshot for the
current file, with a confirmation, since it can't be undone.

## In the file

The `history` section records whether history is on, the per-file cap
(`limit`, or `null` for unlimited), and the snapshots, oldest first — see
[`../formats/rsf/json-document.md`](../formats/rsf/json-document.md#history).
A file left on the defaults (history on, no custom cap, no snapshots yet)
has no `history` section at all.
