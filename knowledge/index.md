---
okf_version: '0.2'
---

# Refrain Sheet — knowledge bundle

Durable internal engineering knowledge for Refrain Sheet, in
[Open Knowledge Format v0.2](https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/main/SPEC.md).

This bundle is additive to, not a replacement for, `CLAUDE.md`: `CLAUDE.md`
stays the small operational entry point, and individual concept files here
are what it points into for durable domain knowledge. Read the relevant
domain index first, then open only the concept files a task actually needs —
do not read this whole bundle to make a local change.

## Domains

- [Architecture](architecture/index.md) — layers, dependency direction, the
  formula engine's internal structure, and cross-cutting invariants.
- [Operations](operations/index.md) — security threat model and
  supply-chain controls, and performance principles and measurements.
- [Formats](formats/index.md) — the `.rsf` file specification: the
  Zstandard container, the JSON document, cross-sheet formulas, the value
  model, dynamic arrays, and versioning/compatibility.
- [Agent loop](agent-loop/index.md) — the GitHub Issue-driven engineering
  loop: lifecycle, autonomous execution policy, bilingual communication,
  smartphone-first operation, notifications, configuration/permissions,
  budget/rollback/release, and a clearly-marked roadmap of features that
  are designed but **not** enabled.
- [Domains](domains/index.md) — user-facing spreadsheet/CSV-editor behavior:
  the preservation guarantee, workbook/worksheet lifecycle, formulas and
  references, the function and error inventory, dynamic arrays, undo/redo,
  import/export/conversion, and version history.
- [UI](ui/index.md) — interaction and presentation behavior: editing and
  IME safety, selection/navigation, copy/paste/fill/Flash Fill, find and
  replace, column resize/auto-fit, view/formatting/dockable panels, tabs
  and the worksheet strip, mobile and touch, accessibility, and theming.
- [References](references/index.md) — a curated index of internal reference
  docs and skills, and external specs/standards this repository relies on.
- [Decisions](decisions/index.md) — a small set of durable decision
  records for choices not already anchored to a domain concept file above,
  starting with why the UI layer uses no framework.

This bundle is the canonical home of the former `docs/*.md` architecture,
security, performance, RSF-format, and agent-operations documents.
`knowledge/log.md` records its history; you do not need it for a change.
