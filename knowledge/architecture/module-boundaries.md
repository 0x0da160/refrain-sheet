---
type: architecture-concept
title: Module boundaries
description: The inward-only dependency rule between UI, app, core, and infrastructure, what each layer may and may not do, and how the rule is enforced.
sources:
  - resource: docs/architecture.md (migrated content; file removed after migration — see knowledge/log.md)
  - resource: ../../src/core/rsf-document.ts
  - resource: ../../src/core/app-identity.ts
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

## Enforcement

The inward-only rule has no exceptions and is enforced mechanically:
`eslint.config.js` forbids `src/core/` from importing `src/app/` or
`src/ui/` (and from using DOM globals), and `src/app/` from importing
`src/ui/`; `tests/architecture.test.ts` fails on any runtime import cycle
in `src/`. The application identity that `.rsf` metadata records
(`APP_NAME`, `APP_VERSION`) lives in `src/core/app-identity.ts` for this
reason — it was previously imported by `rsf-document.ts` from
`src/app/version.ts`, the tree's only `core/` → `app/` import.
