---
type: architecture-concept
title: Module boundaries
description: The inward-only dependency rule between UI, app, core, and infrastructure, what each layer may and may not do, and how the rule is enforced.
sources:
  - resource: docs/architecture.md (migrated content; file removed after migration — see knowledge/log.md)
  - resource: ../../src/core/workbook/rsf-document.ts
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
  and loaded through `src/styles/index.css` — an ordered list of `@import`
  statements: first the Refrain Sheet Design System's generated token CSS
  (`design-system/v2/foundations/css/foundations.css` and
  `app/css/app-tokens.css`, the single source of every colour, spacing,
  radius, shadow and layer value), then one `./styles/*.css` per section; order matters,
  since a later section can still override an earlier one at equal
  specificity, exactly as when this was one file — plus Tailwind utility
  classes for non-grid surfaces (menus, dialogs, panels, the welcome
  screen). Tailwind scans only the app's own sources (`src/**/*.ts` and
  `index.html`, via `source(none)` + `@source` in `tokens.css`), so editing
  docs or other prose can never change the shipped CSS. The `tokens.css`
  section imports only `tailwindcss/theme.css` and
  `tailwindcss/utilities.css` — never the Preflight base layer — so Tailwind
  contributes utility classes without resetting any element's default
  styling. The `@theme` block bridges a subset of the design-system colour
  tokens (e.g. `--accent`, `--bg-raised`) so Tailwind classes such as
  `bg-accent` keep following the theme. The grid (`src/ui/grid/index.ts`) is intentionally left out of this
  migration to keep its rendering path unaffected; no framework (React,
  Vue, etc.) is used anywhere.

## Enforcement

The inward-only rule has no exceptions and is enforced mechanically:
`eslint.config.js` forbids `src/core/` from importing `src/app/` or
`src/ui/` (and from using DOM globals), and `src/app/` from importing
`src/ui/`; `tests/tooling/architecture.test.ts` fails on any runtime import cycle
in `src/`. The application identity that `.rsf` metadata records
(`APP_NAME`, `APP_VERSION`) lives in `src/core/app-identity.ts` for this
reason — it was previously imported by `rsf-document.ts` from
`src/app/version.ts`, the tree's only `core/` → `app/` import.

## Layout and naming

The directory structure itself is part of the contract, enforced by
`npm run check:layout` (`scripts/check/layout.mjs`):

- A module is a file **or** a directory, never both. When a module grows
  helpers, it becomes `x/index.ts` plus siblings (`src/app/commands/`,
  `src/app/state/`, `src/ui/grid/`, `src/ui/dialogs/`), so a directory's
  entry point is always its `index.ts`.
- Stylesheets are named after the UI module they style
  (`src/ui/tab-bar.ts` → `src/styles/tab-bar.css`) and are all loaded, in
  order, by `src/styles/index.css`.
- Tests mirror the layer they exercise: `tests/core/`, `tests/app/`,
  `tests/ui/`, plus `tests/tooling/` (scripts, workflows, repository rules)
  and `tests/site/` (the landing site). Scripts are grouped by role:
  `scripts/build/`, `scripts/check/`, `scripts/release/`, `scripts/lib/`,
  `scripts/ui-check/`.
- File names are kebab-case; generated output lives in `src/generated/`.
