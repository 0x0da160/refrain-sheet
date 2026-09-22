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
