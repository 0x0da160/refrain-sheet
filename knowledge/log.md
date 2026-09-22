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
