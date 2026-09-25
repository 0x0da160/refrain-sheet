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

**`ui/` domain added.** A new domain, not a migration of an existing
`docs/` file — no prior document covered interaction/presentation
behavior end to end. Ten concepts built primarily from `README.md`'s
~1960-line product spec: `editing-and-ime.md`, `selection-and-navigation.md`,
`copy-paste-fill-and-flash-fill.md`, `find-replace-and-goto.md`,
`column-resize-and-autofit.md`, `view-formatting-and-panels.md`,
`tabs-and-worksheet-strip.md`, `accessibility.md`, and
`theming-and-visual-system.md` link out to `architecture/` (command flow,
module boundaries, invariants) rather than repeating it. Two concepts
required grounding beyond the README:

- `mobile-and-touch.md` — the README barely mentions touch, so this concept
  is built directly from `src/styles/mobile-layout.css`, `src/ui/dom.ts`,
  `src/ui/grid.ts`'s pointer-event handling, and the mobile/touch test
  suite (`tests/grid-touch.test.ts`, `tests/mobile-input-focus.test.ts`,
  `tests/mobile-menu.test.ts`, `tests/mobile-zoom.test.ts`,
  `tests/side-panel-mobile-dock.test.ts`) rather than invented from thin
  prose; it is deliberately shorter than its siblings for that reason.
- `theming-and-visual-system.md` — while grounding the "Theme (light /
  dark)" section, found that `README.md` describes only System default /
  Light / Dark and says new users start on System default, but
  `src/app/theme.ts` defines a fourth `'hybrid'` choice that is actually
  `DEFAULT_THEME`, confirmed by CHANGELOG entries for issues #363 and
  #393. Documented from the code and CHANGELOG, with the README gap
  flagged in-file for a maintainer to reconcile, rather than silently
  fixed or silently dropped — same treatment as the branch-protection
  discrepancy above.

`view-formatting-and-panels.md` similarly flags, rather than resolves, a
second stale line: `README.md`'s own "Limitations" section still says
"Sorting and filtering are not available in this version," contradicting
the detailed Filtering (RSF) / Sorting (RSF) sections earlier in the same
document.

## 2026-09-22 (later)

**`references/` domain added.** A single reserved index,
`references/index.md`, not a multi-concept domain — there was not enough
distinct material to justify a split. It curates pointers rather than
prose: internal reference-shaped files (`docs/knip-baseline.md`,
`docs/release-automation-gap.md`, `docs/continuous-improvement-plan.md`,
`docs/csv-diff-review-proposal.md`, `CHANGELOG.md`,
`THIRD-PARTY-NOTICES.md`, and the seven `.claude/skills/*/SKILL.md`
agent-workflow skills) plus external specs/standards actually cited in the
codebase (Open Knowledge Format v0.2, Keep a Changelog, Semantic
Versioning, and Knip — each verified by grep before listing). Deliberately
left out: `sql.js`, already covered as a dependency in
`operations/security-supply-chain.md`; `cloc`, a stats tool rather than a
spec the project implements or follows; and routine GitHub/tooling config
(`.github/labels.yml`, `.github/ISSUE_TEMPLATE/`, `knip.jsonc`) that isn't
itself reference material.

**`decisions/` domain added — small, after an audit that mostly said
"already covered."** Five candidate decisions were investigated against
the standing bar of "only decisions that would otherwise be rediscovered
repeatedly, grounded in code/tests/an authoritative source, no filler":

- **No WASM formula evaluator / no formula worker** —
  `architecture/dependency-rules.md`'s own "Why no Rust/WASM formula
  evaluator, and no formula worker" section is already a self-contained
  decision record (what was considered, why rejected, where to look if
  profiling changes the answer). Adding a `decisions/` file would only
  restate it under a different `type:`. **Skipped, duplicate.**
- **WASM/JS boundary scope** —
  `operations/performance-principles.md`'s "Deliberate non-optimizations"
  and "WASM-offload candidates surveyed, not adopted (Issue #408)"
  sections already give per-candidate rationale in more detail than a
  general framework could add without restating them. **Skipped,
  duplicate.**
- **RSF versioning/compatibility policy** —
  `formats/rsf/compatibility.md` and `formats/rsf/overview.md` already
  state the "reject-don't-guess" and "keep the common case maximally
  compatible" rationale inline, and the bump-only-when-triggering-data
  pattern is documented, not just observed. **Skipped, duplicate.**
- **sql.js over a hand-written SQL parser** — the replacement and its
  reason (joins/subqueries/real SQL functions while staying local) are
  already recorded in `CHANGELOG.md`'s 0.7.11 entry and
  `architecture/system-overview.md`'s SQL engine section in enough detail
  that a decision record would add little. **Skipped, duplicate.**
- **No UI framework** — genuinely not stated as a decision anywhere;
  `architecture/module-boundaries.md` only records the fact in passing.
  Grounded instead by combining two real, separately-documented policies —
  `operations/security-supply-chain.md`'s general dependency-minimalism
  policy, and the grid's hand-rolled `LayoutSignature`-gated repaint path
  in `src/ui/grid.ts` (the same reason `module-boundaries.md` gives for
  excluding the grid from the Tailwind migration) — since neither doc
  states the UI-framework question directly. **Added** as
  `decisions/no-ui-framework.md`.

`decisions/index.md` is a reserved index with no frontmatter, matching the
other domain indexes, and explicitly says most rationale already lives
inline in the other domains rather than here.

## 2026-09-23

**Repository structural cleanup.** Corrected the production-dependency
count (four, including `lucide`) in `operations/security-supply-chain.md`
and `decisions/no-ui-framework.md`. Resolved the one documented layering
exception in `architecture/module-boundaries.md` (the app identity moved to
`src/core/app-identity.ts`) and recorded how the layering rule is now
enforced. Documented the frozen `.rsf` fixture corpus in
`formats/rsf/compatibility.md`, that the Drive client is compiled out of the
offline build in `operations/security-threat-model.md`, and `UiPort`'s new
home in `architecture/system-overview.md`. Removed the repeated "migrated
from `docs/…`" notes from the root and domain indexes (history stays here),
so the files every task reads first carry only navigation.
`scripts/check-knowledge-frontmatter.mjs` now also checks relative links,
repository paths, and `stale_after` dates.

**Workflow cleanup.** Removed the dormant Issue-driven agent-loop workflows
(`issue-triage`, `prepare-issue-spec`, `implement-issue`, `review-pr`,
`close-loop`) and `code-stats.yml`; noted the removal in
`agent-loop/index.md` and `agent-loop/lifecycle.md` and updated the CI
permission model and pinning policy in `operations/security-supply-chain.md`.
Release commits now carry the CHANGELOG.md section and README code
statistics; the manual `release-docs.yml` workflow catches either up.

## 2026-09-25

**IP risk policy added.** A Japanese-language policy on pursuing an
Excel-familiar feel without reproducing Excel's visual expression, assets,
branding, or proprietary behavior was edited into
`decisions/ip-risk-policy.md` (English summary, canonical Japanese text):
unresolvable citation markers were replaced with a numbered reference list,
the landing-page reference was pointed at `site/template.html`, and the
escalation conditions were tied to the root `CLAUDE.md` "High-risk changes"
rule, which now names third-party IP risk. Linked from `decisions/index.md`,
the bundle root, `ui/index.md`, and `src/ui/CLAUDE.md`.

**Spreadsheet shortcut comparison added.** A Japanese design memo comparing
Excel for the web and LibreOffice Calc keyboard shortcuts was edited into
`references/spreadsheet-shortcut-comparison.md` (English summary, canonical
Japanese text). It is a reference note, not a decision, so it went under
`references/` rather than `decisions/`; the references index now allows such
notes alongside its links. The edit dropped references to a local text file
and to an earlier draft, carries a `stale_after` date because the vendor pages
change, and adds how the table relates to the shipped shortcut rules in
`src/app/shortcuts.ts` and to `decisions/ip-risk-policy.md`. Linked from the
references index, the bundle root, `ui/index.md`, and `src/ui/CLAUDE.md`.
