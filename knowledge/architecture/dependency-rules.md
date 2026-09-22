---
type: architecture-concept
title: Formula engine dependency rules
description: The formula engine's internal, acyclic module graph, its two governing rules, and why there is no WASM formula evaluator or worker.
sources:
  - resource: ../../docs/architecture.md
  - resource: ../../src/core/formula-value.ts
  - resource: ../../src/core/formula-functions.ts
  - resource: ../../src/core/formula.ts
status: stable
generated:
  by: claude-code/claude-sonnet-5
  at: 2026-09-22T11:00:47Z
---

# Formula engine dependency rules

The formula engine is split so that each module has one job and the
dependency graph stays acyclic. Every module is DOM-free and testable in
isolation (see [module-boundaries.md](module-boundaries.md)).

```text
formula-value.ts    value model, error set, coercion rules, documented limits
      ↑
      ├── formula-criteria.ts   criteria parsing, safe wildcard matching
      ├── formula-date.ts       the UTC date-serial scale, DATEDIF
      ├── formula-text.ts       code-point-safe text helpers
      ├── formula-text-format.ts   TEXT()'s Excel-compatible format-code subset
      ↑
formula-functions.ts   the function registry: one FunctionDef per function
      ↑
formula.ts             tokenizer, parser, evaluator, reference rewriting
      ↑
spill.ts               dynamic-array placement (pure; takes a SpillSource)
      ↑
rsf-document.ts        the workbook: memo, spill maps, clock, cross-sheet eval
```

Two rules keep this honest:

- **The registry is the single source of truth.** `formula-functions.ts`
  drives which names the parser accepts, argument-count validation,
  evaluation, autocomplete, the help dialog's function table, and the
  localization key each function needs. A function cannot be implemented
  without being documented, or documented without being implemented;
  `tests/formula-help.test.ts` and the i18n parity test enforce both
  directions.
- **`formula.ts` owns plumbing, not semantics.** It turns AST nodes into
  lazy, memoized `FnArg` accessors and hands them to the registry. Laziness
  is a correctness requirement, not an optimization: `IF` and `IFERROR`
  must be able to leave a branch unevaluated whose evaluation would raise
  the very error the formula exists to avoid.

`spill.ts` is pure and knows nothing about worksheets: it receives a
`SpillSource` (dimensions, a cell reader, and the already-evaluated array
results) and returns a placement map. `RsfDocument` owns the impure parts —
when to rebuild, the evaluation memo, and the workbook-wide clock that
volatile functions read.

## Why no Rust/WASM formula evaluator, and no formula worker

The WASM crate accelerates CSV parsing, compression, and bulk scans —
data-parallel work with one obvious implementation. Formula evaluation is
neither. A second implementation would have to agree with the TypeScript
one bit for bit on coercion, rounding, comparison ordering, and every error
case, or a workbook would compute different values depending on whether
WASM loaded; that divergence risk is a poor trade for work that is already
lazy and memoized (only cells the grid actually displays are ever
evaluated). The same reasoning applies to moving evaluation into a worker:
the engine has no worker infrastructure, and the existing cooperative
time-slicer (`scheduler.ts`) is the established pattern for keeping long
_scans_ responsive. If profiling later shows a real bottleneck,
`docs/performance.md` records the measurements to argue from.
