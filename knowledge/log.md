# Bundle log

## 2026-09-22

**Creation.** Bundle root and the `architecture/` domain created, migrating
`docs/architecture.md` into four focused concepts: `system-overview.md`,
`module-boundaries.md`, `dependency-rules.md`, and `invariants.md`.
`docs/architecture.md` itself was left in place, unedited — it remains the
source of record until a follow-up change adds a transition pointer and
updates in-repo cross-references, per the repository's documentation
migration policy (`CLAUDE.md`).

**`operations/` domain added.** `docs/security.md` migrated into two
concepts (`security-threat-model.md`, `security-supply-chain.md`) and
`docs/performance.md` into two more (`performance-principles.md`,
`performance-measurements.md`, the latter carrying a `stale_after` date
since it holds dated benchmark numbers). Both source docs left in place,
unedited, same as `docs/architecture.md` above.

**`formats/` domain added.** `docs/rsf-format.md` (the largest doc in the
repo, 1399 lines) migrated into `formats/rsf/`: `overview.md` (design
goals, compression, container header, workbook/worksheet model),
`grammar-single-sheet-body.md` and `grammar-workbook-body.md` (the two
container bodies' full version-gated field layouts),
`cross-sheet-references.md`, `values.md` (the formula value model, error
set, date serials), `dynamic-arrays.md` (spill), and `compatibility.md`
(versioning history). While transcribing `compatibility.md`'s version-bump
table, found that the source document's own narrative "Older container
revisions" section skips three real version bumps (wrap-long-rows at body
version 5, and the border-style/comments bumps at versions 10–11) that its
own earlier version-selection sections do document correctly — the table
here is built from those authoritative version-selection sections instead
of the narrative prose, and includes all of them. `docs/rsf-format.md`
itself was left in place, unedited, same as the other migrated docs.

**`agent-loop/` domain added.** `docs/agent-operations.md` (961 lines)
migrated into `knowledge/agent-loop/` — **not** a straight port, unlike
the three domains above. The source document mixes four different kinds
of content under one flat heading structure: durable policy (what Claude
may decide on its own, the bilingual-communication contract), an
operational runbook (how a human runs the loop from a phone), reference
configuration (workflow permissions, model/auth selection), and a
roadmap of features that are explicitly documented as **not enabled**
(auto-merge criteria, scheduled autonomous research). Splitting by kind
rather than by source heading order produced eight concepts:
`lifecycle.md`, `autonomous-execution-policy.md`,
`bilingual-communication.md`, `smartphone-operation.md`,
`notifications.md`, `configuration-and-permissions.md`,
`budget-rollback-and-release.md`, and `roadmap-not-enabled.md`. The last
one carries `status: proposed` rather than `stable` — every other concept
in this bundle so far has described shipped, current behavior, and this
is the bundle's first concept that deliberately does not, so its status
field says so rather than leaving a reader to infer it from the title.
`configuration-and-permissions.md` also carries forward, without
resolving, a discrepancy already recorded in the source document itself:
`main` currently has no branch protection configured, contradicting the
setup steps the same document describes — flagged for the maintainer,
not silently fixed or silently dropped. `docs/agent-operations.md` itself
was left in place, unedited, same as the other migrated docs.

**Transition banners added**, then **legacy docs deleted.** A later change
added a `> **Migrated.**` banner to the top of each of the five source
docs, pointing readers at its `knowledge/` replacement. Once the banners
had been live for a review cycle, a follow-up audit re-verified each
domain against its source doc, closed the handful of real content gaps it
found (the SQL-engine specifics and `@theme` bridging sentence in
`architecture/`, the "Before / after" measurement table and the
`statsAggregate` note in `operations/`, and the label-creation commands
and the "safely testing the loop" walkthrough in `agent-loop/` —
`formats/rsf/` had none), updated every in-repo cross-reference that
pointed at a `docs/*.md` path, and then deleted `docs/architecture.md`,
`docs/security.md`, `docs/performance.md`, `docs/rsf-format.md`, and
`docs/agent-operations.md`. This bundle is now the sole source for that
knowledge; `sources:` frontmatter across these concepts keeps citing the
removed doc paths as historical provenance, not as live links.

**`domains/` domain added.** A new domain, not a migration of an existing
`docs/*.md` file: `README.md` (the current, exhaustively maintained
product spec) is the primary source for eight concepts covering
user-facing spreadsheet/CSV-editor behavior that `architecture/`,
`operations/`, and `formats/rsf/` don't already own —
`csv-preservation-guarantee.md`, `workbook-and-worksheet-lifecycle.md`,
`formulas-and-references.md`, `formula-functions-and-errors.md`,
`dynamic-arrays-and-spilling.md`, `undo-redo-and-history.md`,
`import-export-and-conversion.md`, and
`version-history-and-snapshots.md`. Each claim was cross-checked against
the relevant `src/core/` module (`lossless-document.ts`/`serializer.ts`/
`encoding.ts`, `worksheet.ts`/`rsf-document.ts`, `formula.ts` and the
`formula-*.ts` family, `spill.ts`, `history.ts`, `csv-export.ts`/
`json-import.ts`/`json-export.ts`/`xlsx-import.ts`/`xlsx-export.ts`)
rather than transcribed from the README alone; the XLSX import/export and
version-history Preview behavior predate this repo's `CHANGELOG.md`
window or were added after the README's original migrated-docs baseline,
so those two concepts also cite `CHANGELOG.md` entries and the export
source modules directly. Several concepts deliberately link outward
instead of duplicating: worksheet kinds and the two tab strips defer to
`architecture/system-overview.md`'s existing "Workbooks and worksheets"
section for the code-level model; the spill bounds table and RSF
body-version tables defer to `formats/rsf/dynamic-arrays.md` and
`formats/rsf/compatibility.md`; the atomic-history and sort-is-view-state
guarantees defer to `architecture/invariants.md`. `domains/index.md` is a
reserved index with no frontmatter, matching `architecture/index.md`'s
pattern.
