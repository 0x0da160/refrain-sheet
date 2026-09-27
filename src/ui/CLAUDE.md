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
  `src/locales/en.json` and `ja.json` (`tests/app/i18n.test.ts` checks the key
  sets are identical). Write and review the wording itself by
  `knowledge/ui/ui-writing-and-wording.md` (action-first labels, the
  target/impact/next-step rule for save, convert, discard, and encoding
  changes, and the recommended terms).
- **Grid.** `grid/index.ts` is the `Grid` facade: the public surface the
  shell and tests use. Its shared state lives in `GridCore` (`grid/core.ts`),
  and each concern is a collaborator that reaches that state through
  `this.core`: rendering (`renderer.ts`, `cell-builder.ts`,
  `wrap-layout.ts`), selection painting (`selection-view.ts`), in-cell
  editing (`edit-session.ts`), pointer and keyboard input
  (`pointer-input.ts`, `navigation.ts`), drags (`drag-operations.ts`), and
  auto-fit (`auto-fitter.ts`). Stateless pieces sit beside them: pixel
  metrics and pinned panes (`metrics.ts`), drag-edge auto-scroll
  (`auto-scroll.ts`), touch gestures (`touch-gestures.ts`), on-screen
  keyboard handling (`keyboard-viewport.ts`), per-cell painting
  (`cell-paint.ts`), auto-fit measuring (`autofit-measure.ts`,
  `autofit.ts`), and pure helpers. Collaborators import `GridCore` as a
  type only; put new logic in the collaborator that owns the concern, never
  back into the facade.
- **Shell.** `src/main.ts` only calls `startApp()`; the composition root is
  `shell/` (`index.ts` wires, `surfaces.ts` builds, `ui-port.ts` implements
  `UiPort`, `refresh.ts`/`layout.ts`/`input.ts`/`preferences.ts` handle the
  rest). Menus are declared per menu in `menu-bar/menus.ts`; every catalog
  command must be reachable from a menu, a shortcut, or a UI surface
  (`tests/app/command-catalog.test.ts`).
- **Styling** is hand-written CSS under `src/styles/`, loaded in order by
  `src/styles/index.css`, using the design tokens; see
  `knowledge/ui/theming-and-visual-system.md`. `npm run check:contrast`
  gates color pairs.
- **Familiar operation, original expression.** Excel-like operation is
  fine; Excel's screens, icons, wording, layout, and assets are not. Specify
  UI changes from the user's goal, never "same as Excel", and escalate the
  cases listed in `knowledge/decisions/ip-risk-policy.md` §5.
- **Shortcuts.** Key routing lives in `src/app/shortcuts.ts`; never take a key
  the browser needs (tab/window keys, reload, zoom, print, dev tools).
  Spreadsheet keys the browser also uses (Ctrl+F/H/G/E, F3) are always the
  app's. Menu labels go through `displayShortcut` (Cmd on macOS). For how
  other spreadsheets bind a key, see
  `knowledge/references/spreadsheet-shortcut-comparison.md` — background
  only; adopting a key is its own decision on an Issue/PR.
- For a visible change, also run `npm run ui:check` after `npm run build`.
