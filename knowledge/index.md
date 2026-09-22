---
okf_version: '0.2'
---

# Refrain Sheet — knowledge bundle

Durable internal engineering knowledge for Refrain Sheet, in
[Open Knowledge Format v0.2](https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/main/SPEC.md).

This bundle is additive to, not a replacement for, `CLAUDE.md` and the docs
under `docs/`: `CLAUDE.md` stays the small operational entry point, and
individual concept files here are what it points into for durable domain
knowledge. Read the relevant domain index first, then open only the concept
files a task actually needs — do not read this whole bundle to make a local
change.

## Domains

- [Architecture](architecture/index.md) — layers, dependency direction, the
  formula engine's internal structure, and cross-cutting invariants.
- [Operations](operations/index.md) — security threat model and
  supply-chain controls, and performance principles and measurements.
- [Formats](formats/index.md) — the `.rsf` binary container specification:
  framing, body grammar (single-sheet and workbook), cross-sheet formulas,
  the value model, dynamic arrays, and versioning/compatibility.
- [Agent loop](agent-loop/index.md) — the GitHub Issue-driven engineering
  loop: lifecycle, autonomous execution policy, bilingual communication,
  smartphone-first operation, notifications, configuration/permissions,
  budget/rollback/release, and a clearly-marked roadmap of features that
  are designed but **not** enabled.
- [Domains](domains/index.md) — user-facing spreadsheet/CSV-editor behavior:
  the preservation guarantee, workbook/worksheet lifecycle, formulas and
  references, the function and error inventory, dynamic arrays, undo/redo,
  import/export/conversion, and version history.

This bundle is a work in progress: `docs/architecture.md`, `docs/security.md`,
`docs/performance.md`, `docs/rsf-format.md`, and `docs/agent-operations.md`
have all been migrated into the domains above (each old file is left in
place, unedited, as the pre-migration source — see `knowledge/log.md`).
