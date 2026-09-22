---
type: architecture-concept
title: Key invariants
description: The behavioral guarantees — CSV byte preservation, atomic undo history, RSF container safety, and others — that tests and code review exist to protect.
sources:
  - resource: docs/architecture.md (migrated content; file removed after migration — see knowledge/log.md)
status: stable
generated:
  by: claude-code/claude-sonnet-5
  at: 2026-09-22T11:00:47Z
---

# Key invariants

- **CSV byte preservation:** saving an unedited CSV writes the loaded bytes
  verbatim; edits reserialize only the affected field ranges. No performance
  or refactoring change may normalize or reserialize unaffected content
  (guarded by identity + fuzz tests).
- **Atomic history:** every user-visible mutation is exactly one
  `HistoryEntry`; undo/redo replays entries in reverse/forward order.
  Structural edits bundle their formula-reference rewrites into the same
  entry — including rewrites that land on _other_ worksheets, which is why
  an operation carries an optional `sheetId`. Worksheet lifecycle changes
  (add, rename, duplicate, delete, reorder) are ordinary entries too: a
  deleted worksheet travels inside its entry, so undo restores it with its
  data.
- **Presentational state rides with its edit:** enabling "wrap long rows"
  automatically because a committed value contains a line break is a `wrap`
  operation bundled into the **same** `HistoryEntry` as the edit, so one
  undo restores both the value and the prior wrap state. It is decided from
  the _displayed_ value (a formula's result, never its source), announced
  politely, and — for RSF — persisted per worksheet; it never marks a
  document dirty and never touches CSV bytes.
- **Range move rewrites references, never guesses:** moving a rectangle
  (`src/core/range-move.ts`, RSF-only) plans every cell write and formula
  rewrite from current values before touching the document, so the whole
  move is one atomic, undoable entry. A reference to a moved cell follows
  it; every other reference — and any range that only partially overlaps
  the move — is left exactly as written.
- **Workbook-wide recalculation:** any mutation to any worksheet clears the
  whole workbook memo, because a cross-sheet reference means a change
  anywhere can invalidate a formula anywhere. Recalculation stays lazy and
  memoized — there is no separate dependency graph.
- **RSF container safety:** magic/version are validated as a pair, the body
  CRC is checked, decompression is bounded by the declared length (512 MiB
  ceiling), and parsing never executes anything. Display settings (zoom,
  column widths) are presentational only — validated and clamped on load,
  never affect cell data, never mark a document dirty. A structurally
  readable but invalid filter is dropped (never guessed at) with a warning
  (see [formats/rsf/index.md](../formats/rsf/index.md)).
- **Filter = hide only, never mutate:** a filter (`src/core/filter.ts`) only
  computes a hidden-row set; it never deletes, reorders, or rewrites cells,
  and formula evaluation is unaffected. The virtualized grid collapses
  hidden rows to zero height in the row-height index — no DOM is
  materialized for them — and copy/fill/clear/Flash Fill/selection-stats
  and keyboard navigation all skip hidden rows consistently.
- **Sort = display order only, never mutate:** a sort (`src/core/sort.ts`)
  only computes a display-order mapping; it never deletes, reorders, or
  rewrites cells. Unlike a filter, a sort is session-only view state — never
  persisted, not an undoable `HistoryEntry`, and never marks the document
  dirty; editing inside a sorted range is refused until the sort is cleared.
- **One zoom sizing model:** the grid's per-tab zoom scales one set of JS
  metrics (row height, header width, wrap line box) and drives the CSS via
  inline custom properties set from those same values, so the element
  height and CSS line box cannot diverge at any zoom level
  (`tests/zoom-alignment.test.ts`). Column widths are stored at 100% zoom.
- **Deterministic Flash Fill:** pattern inference (`src/core/flash-fill.ts`)
  is a bounded, deterministic search over closed data structures — no
  network, no model, no dynamic code — and a fill is proposed only when
  every matching candidate agrees on every affected cell; anything else is
  refused as ambiguous with an explanation.
- **Formula index:** `RsfDocument` maintains a per-row formula-cell count in
  parallel with the data so formula enumeration skips formula-free rows;
  consistency with the data is enforced by a property-based test
  (`tests/formula-index.test.ts`).
- **Offline runtime:** no runtime network access of any kind — no CDNs,
  remote fonts, analytics, or fetches. `npm run check:dist` asserts the
  production bundle is self-contained (verified passing as of this
  concept's `generated` timestamp).
- **IME safety:** the grid's keyboard target is a persistent hidden sink
  textarea that is promoted in place into the cell editor, so composition
  never starts in a non-editable element and no printable character is
  ever synthesized from `keydown` (`tests/ime-composition.test.ts`).
- **Single version source:** `package.json` is the only place the app
  version is written; `src/app/version.ts` imports it and
  `scripts/check-versions.mjs` gates drift. See
  [module-boundaries.md](module-boundaries.md) for the one place this
  module is imported from `src/core/`.
