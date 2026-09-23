---
type: decision-concept
title: Why no UI framework
description: Why the UI layer is hand-written TypeScript/DOM rather than React, Vue, or a similar framework, and what evidence that decision is actually grounded in.
sources:
  - resource: ../../knowledge/architecture/module-boundaries.md
  - resource: ../../knowledge/operations/security-supply-chain.md
  - resource: ../../knowledge/operations/performance-principles.md
  - resource: ../../src/ui/grid.ts
  - resource: ../../package.json
status: stable
generated:
  by: claude-code/claude-sonnet-5
  at: 2026-09-22T17:46:02Z
---

# Why no UI framework

## The decision

`src/ui/` is hand-written TypeScript over the DOM: no React, Vue, Svelte,
or any other UI framework or virtual-DOM library is used anywhere in the
app (confirmed by `package.json`'s dependency list — four zero-transitive
production dependencies, none of them a UI framework — and by
[module-boundaries.md](../architecture/module-boundaries.md), which
records the fact directly: "no framework (React, Vue, etc.) is used
anywhere"). This has held since before this knowledge bundle existed; no
Issue or PR ever proposed adopting one.

No single source states this as a one-time, deliberated choice with a
recorded alternatives list — unlike, say, the `ruzstd`-over-`zstd` codec
choice in [formats/rsf/overview.md](../formats/rsf/overview.md), which
carries its own explicit "why" callout. This file is therefore a synthesis
of the two real, standing policies that make adopting one a live decision
this project would have to consciously reverse, not a transcription of a
single rationale doc:

- **Dependency minimalism is an explicit, general policy, not
  framework-specific.**
  [security-supply-chain.md](../operations/security-supply-chain.md)
  states it directly: "Keep the count minimal. Do not add a dependency for
  convenience; prefer a platform/browser API or a small local
  implementation," backed by an audit-before-adding requirement and a
  runtime dependency list of exactly four packages, chosen individually
  for a capability the platform genuinely lacks (`encoding-japanese` for
  Shift_JIS/EUC-JP, `lucide` for tree-shaken icon artwork, `sql.js` for
  real SQL semantics, `yaml` because "a
  hand-rolled parser was rejected as a correctness/maintenance risk"). A UI
  framework is a convenience dependency by this policy's own test: the DOM
  already gives the app everything a framework would add (rendering,
  events, state-to-view sync), just without the abstraction.
- **The grid's rendering path is deliberately hand-rolled for performance
  control a diffing framework would work against.**
  [performance-principles.md](../operations/performance-principles.md)'s
  "What is optimized where" table describes grid rendering as
  "Virtualization (visible window + overscan), in-place repaint unless a
  layout input changed" — a `LayoutSignature`-gated repaint
  (`src/ui/grid.ts`), not a virtual-DOM reconciliation pass. This is the
  same reason `module-boundaries.md` gives for excluding the grid from the
  Tailwind CSS migration: "to keep its rendering path unaffected." A
  component framework's render/diff cycle is a different, coarser-grained
  model than a hand-tuned repaint keyed on exactly which layout inputs
  changed, for the one surface in the app (a virtualized spreadsheet grid,
  potentially tens of thousands of visible cells) where that distinction is
  performance-critical.

Neither point is a framework-specific rationale on its own — the first is
a general policy that a framework would simply be one more instance of,
and the second only explains the grid, not the menus/dialogs/panels that
could in principle use one without touching the grid's rendering path at
all. Together, though, they are why nothing has ever made adopting a
framework worth reopening: the general policy raises the bar for any new
dependency, and the one surface with a real performance argument for
framework-free control (the grid) is also the one surface most central to
the app, so a framework would only ever cover the _other_ UI, at the cost
of two different rendering models coexisting in the same codebase.

## What would change this

This is not a claim that a framework is prohibited outright — nothing in
`CLAUDE.md` or the architecture docs forbids one. It is recorded here so
that the next time adopting one is proposed (e.g. for a complex new panel
or dialog), the discussion starts from these two real constraints instead
of re-deriving them, and is explicit about which one actually applies:
a framework confined to non-grid surfaces only has the dependency-policy
argument to answer, not the rendering-performance one.

See [module-boundaries.md](../architecture/module-boundaries.md) for where
the current hand-written UI layer sits in the dependency graph, and
[system-overview.md](../architecture/system-overview.md) for the command
flow every UI surface, framework or not, would still have to go through.
