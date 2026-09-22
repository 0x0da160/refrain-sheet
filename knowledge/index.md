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

This bundle is a work in progress: only the domains above have been migrated
so far. `docs/architecture.md`, `docs/security.md`, `docs/performance.md`,
and `docs/rsf-format.md` remain the source of record for everything not yet
migrated here.
