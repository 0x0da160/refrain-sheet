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

This bundle is a work in progress: `docs/architecture.md`, `docs/security.md`,
and `docs/performance.md` have been migrated into the domains above (each old
file is left in place, unedited, as the pre-migration source — see
`knowledge/log.md`). `docs/rsf-format.md` remains the source of record and is
not yet migrated.
