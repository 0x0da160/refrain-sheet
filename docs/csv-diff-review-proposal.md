# CSV Diff Review — integration proposal

**Status: proposal only. No feature code is implemented by this document.**

[Issue #255](https://github.com/0x0da160/refrain-sheet/issues/255) asked for an
entirely new "CSV Diff Review" tool: compare a baseline dataset against a
current one, show a synchronized left/right split-diff grid (added / modified
/ deleted / unchanged / key-invalid rows), run a deterministic data-quality
rule engine, support an approval workflow with notes, and produce SHA-256
hashed JSON/HTML audit trails plus a template import/export system — all
described as built on DuckDB WASM, across a 3-phase MVP roadmap.

That full spec does not fit as one change to this repository, for two
independent reasons the maintainer already confirmed when asked (see the
Issue thread):

1. **DuckDB WASM is not integrated here**, and re-introducing a WASM RDB
   dependency was already evaluated and rejected for this app — see
   [`architecture.md` § "The SQL query engine"](architecture.md#the-sql-query-engine).
   The reasons still apply unchanged: those engines' loading model (ES
   modules, dynamic Worker spin-up, multi-MB `.wasm` fetched at runtime)
   conflicts with a classic non-module script, a `connect-src 'none'` CSP, no
   Worker infrastructure, and the "exactly one production dependency" policy
   in [`security.md` § "Dependency policy"](security.md).
2. **The rest of the spec is a subsystem on the scale of the whole app** — a
   9-table data model, a 12+-type rule engine, a template store, a
   virtualized synchronized dual-pane grid, keyboard navigation, IndexedDB
   persistence, and dual-format audit reporting. It cannot become one small,
   reversible pull request under any interpretation.

The maintainer asked for a proposal on how a fitting version of this could
integrate with the existing architecture instead. This document is that
proposal: what would fit without a new dependency, and how the rest of the
original spec could be split into independently reviewable follow-up Issues.

## What already fits this app's architecture

Two existing modules solve adjacent problems the same way this proposal
would need to, and are the template to follow rather than invent from
scratch:

- **`src/core/sql-engine.ts`** is a hand-written, dependency-free
  `SELECT`-only SQL engine over one in-memory table (`SqlTable`: a header row
  plus string rows). `src/app/commands/sql.ts` adapts a `Tab`'s document into
  that shape, and `src/ui/dialogs/sql.ts` renders the result read-only in the
  existing dialog system. This is exactly the "compare two tables locally,
  no external engine" shape the Issue's own reference SQL (`FULL OUTER JOIN
... USING (order_id)`) needs — it demonstrates the join can be expressed as
  plain TypeScript instead of a database query.
- **`src/core/data-validation.ts`** already models per-cell rules
  (`ListValidationRule`, `NumberValidationRule`) with a severity-free
  pass/fail check (`checkValidationValue`). The Issue's rule engine
  (required, type, regex, allowed values, range, uniqueness, ...) is a
  generalization of the same idea — evaluated across two datasets and rows
  instead of one cell — not a new concept.

Neither module talks to the DOM, both are covered by ordinary Vitest unit
tests, and both stay entirely inside `src/core/`, consistent with the
layering in `architecture.md`.

## Proposed shape for a first slice

A first, shippable slice — small enough to be its own Issue and PR — would
look like:

- **`src/core/diff-engine.ts`** (new, `src/core/`, DOM-free, no new
  dependency): given two `SqlTable`-shaped inputs (reusing the existing
  adapter in `src/app/commands/sql.ts`), one or more key columns, and a list
  of compare columns, produce diff rows classified as `added` / `modified` /
  `deleted` / `unchanged` / `key_invalid` (null key, duplicate key, or
  partial composite key) — the same classification the Issue's reference SQL
  expresses with `COALESCE`/`IS DISTINCT FROM`/`CASE`, written as plain
  TypeScript comparisons instead. Value normalization (case, whitespace,
  full-width/half-width) can be a per-comparison option, matching the
  Issue's "template" idea without introducing persistent template storage
  yet.
- **A new dialog** (`src/ui/dialogs/`) analogous to `sql.ts`: pick a second
  CSV/worksheet to compare against the active tab, pick key column(s), and
  show a single filtered list of diff rows (defaulting to "changed only", as
  the Issue specifies) rather than a synchronized dual-pane virtualized
  grid — a full split view is a much larger UI investment (see below) and
  isn't required to deliver the core value ("what changed since last time").
- **Export** reusing `src/core/csv-export.ts` to write a diff CSV, satisfying
  the Issue's "output a diff CSV" requirement without new file-format code.

This slice deliberately excludes, as separate later work:

- Parquet input.
- The rule engine beyond a `data-validation.ts`-style required/type/regex/
  range/allowed-values/uniqueness set (referential integrity, aggregate
  reconciliation, and prior-run percent-change rules need more design and a
  notion of "previous audit run" to compare against).
- The synchronized, virtualized, keyboard-navigable left/right split grid —
  worth its own Issue given the amount of new UI and scroll-sync logic.
- Approval workflow, confirmation notes, and any persisted history —
  requires a decision on browser storage (IndexedDB) that is out of scope
  for a diff engine.
- SHA-256-hashed JSON/HTML audit trail generation.
- Template save/reuse/import/export.

## Suggested follow-up Issues

In rough dependency order, each independently reviewable and reversible:

1. Core diff engine + minimal "changed rows" list view + diff CSV export
   (the slice above).
2. Rule engine (required/type/regex/range/allowed-values/uniqueness),
   surfaced as error/warning badges on diff rows, plus an error CSV export.
3. Synchronized, virtualized left/right split-diff grid UI (keyboard
   navigation, scroll sync, key-column pinning).
4. Approval workflow (mark reviewed, add a note) with IndexedDB persistence.
5. Audit report generation (JSON and HTML), including input/output SHA-256
   hashing.
6. Templates (save, reuse, JSON import/export) once the shape of 1–5 has
   stabilized.
7. Parquet input, referential-integrity rules, and aggregate reconciliation
   — and, if by then a hand-written engine can no longer keep up, a fresh,
   explicit re-evaluation of a WASM RDB dependency. That re-evaluation is
   its own high-risk, human-approved decision under `CLAUDE.md` — nothing in
   this proposal pre-approves it.

## Non-goals of this document

This document does not implement any of the above. It records the design
decision needed before implementation starts, so that Issue #255 (or its
split-out successors) can be implemented as ordinary, reviewable changes
instead of one high-risk, unbounded one.
