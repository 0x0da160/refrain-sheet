# Architecture

Engineering map of Refrain Sheet: the layers, the direction dependencies are
allowed to flow, how data moves through the app, and the invariants every
change must preserve. Migrated from `docs/architecture.md`; see that file
for content not yet split into concepts here.

- [System overview](system-overview.md) — the four layers, command flow,
  document/workbook data flow, the WASM boundary, the SQL engine, and
  long-running-operation slicing.
- [Module boundaries](module-boundaries.md) — the inward-only dependency
  rule, what each layer may and may not do, and the one known exception.
- [Formula engine dependency rules](dependency-rules.md) — the formula
  engine's internal, acyclic module graph and why there is no WASM formula
  evaluator.
- [Key invariants](invariants.md) — the behavioral guarantees (CSV byte
  preservation, atomic undo history, RSF container safety, and others) that
  tests and code review exist to protect.
