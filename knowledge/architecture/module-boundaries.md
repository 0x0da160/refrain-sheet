---
type: architecture-concept
title: Module boundaries
description: The inward-only dependency rule between UI, app, core, and infrastructure, what each layer may and may not do, and the one known exception.
sources:
  - resource: docs/architecture.md (migrated content; file removed after migration — see knowledge/log.md)
  - resource: ../../src/core/rsf-document.ts
  - resource: ../../src/app/version.ts
status: stable
generated:
  by: claude-code/claude-sonnet-5
  at: 2026-09-22T11:00:47Z
---

# Module boundaries

See [system-overview.md](system-overview.md) for the four-layer diagram.
The rules that diagram implies:

- **Core modules never import DOM or UI code.** Everything in `src/core/`
  runs unchanged in Node, which is what makes the unit/property tests and
  benchmarks deterministic and fast.
- **The UI never owns business logic.** UI surfaces render state and forward
  user intent to the command layer; every mutation goes through `AppState`
  so all surfaces observe the same state through its typed
  `subscribe`/`emit` events (`tabs` / `active` / `doc` / `selection` /
  `view` / `sheets`). `tabs` is about open _documents_; `sheets` is about the
  _worksheets inside_ the active workbook — two separate surfaces.
- One deliberate exception is measurement: column auto-fit needs real
  rendered text metrics, so `Commands` exposes a narrow `gridActions` port
  that the grid implements. The command still owns the flow; the grid only
  supplies DOM-dependent measurement.
- **Styling stays hand-written CSS, split by section under `src/styles/`**
  and loaded through `src/styles.css` — an ordered list of
  `@import './styles/*.css'` statements, one per section; order matters,
  since a later section can still override an earlier one at equal
  specificity, exactly as when this was one file — plus Tailwind utility
  classes for non-grid surfaces (menus, dialogs, panels, the welcome
  screen). The `tokens.css` section imports only `tailwindcss/theme.css` and
  `tailwindcss/utilities.css` — never the Preflight base layer — so Tailwind
  contributes utility classes without resetting any element's default
  styling. The `@theme` block bridges a subset of the semantic color tokens
  (e.g. `--accent`, `--surface`) so Tailwind classes such as `bg-accent`
  keep following the light/dark theme. The grid (`src/ui/grid.ts`) is intentionally left out of this
  migration to keep its rendering path unaffected; no framework (React,
  Vue, etc.) is used anywhere.

## Known exception (observed, not yet a documented decision)

`src/core/rsf-document.ts:53` imports `APP_NAME, APP_VERSION` from
`src/app/version.ts` to stamp application identity/version into saved
`.rsf` metadata. Read literally, this is a `core/` → `app/` import, which
the inward-only rule above forbids.

In practice `src/app/version.ts` has no dependencies of its own beyond
re-exporting `package.json`'s version string, so this isn't a real
business-logic layering violation — but it does contradict the rule as
written, and it was found by grepping actual `import ... from '../app'`
statements in `src/core/` (the only such import in the tree; verified
2026-09-22). This is recorded here as an honest discrepancy between
documentation and code, not resolved: the two reasonable fixes (move
`version.ts` to `src/core/`, or document this as a sanctioned exception)
are a maintainer decision, not one this audit makes unilaterally.
