# src/ui/CLAUDE.md

Local rules for the UI layer. The root [`CLAUDE.md`](../../CLAUDE.md) still
governs; this adds only what is specific to `src/ui/`.

- **Text, never HTML.** Render cell values and any user or file content with
  `textContent` / `el(...)` (`dom.ts`), never `innerHTML`. No `eval` /
  `new Function`.
- **No business logic here.** A user action calls `Commands.run(...)`; the
  command layer drives dialogs back through `UiPort`
  (`src/app/ui-port.ts`), which the UI implements. `src/app/` must never
  import `src/ui/` (lint-enforced).
- **Every string is localized.** Use `t('key')` and add the key to both
  `src/locales/en.json` and `ja.json` (`tests/i18n.test.ts` checks the key
  sets are identical).
- **Grid.** `grid.ts` is the virtualized renderer; its pure helpers
  (geometry, auto-fit planning, formula-reference overlay, context-menu
  items) live in `grid/` and are unit-tested without a DOM. Keep new pure
  logic there, not in the `Grid` class.
- **Styling** is hand-written CSS under `src/styles/`, loaded in order by
  `src/styles.css`, using the design tokens; see
  `knowledge/ui/theming-and-visual-system.md`. `npm run check:contrast`
  gates color pairs.
- **Familiar operation, original expression.** Excel-like operation is
  fine; Excel's screens, icons, wording, layout, and assets are not. Specify
  UI changes from the user's goal, never "same as Excel", and escalate the
  cases listed in `knowledge/decisions/ip-risk-policy.md` §5.
- For a visible change, also run `npm run ui:check` after `npm run build`.
