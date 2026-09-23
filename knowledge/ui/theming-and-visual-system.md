---
type: ui-concept
title: Theming and the visual system
description: System/Light/Dark/Hybrid themes, live prefers-color-scheme tracking, spreadsheet font choice, vertical text centering, and conditional row-height wrapping.
sources:
  - resource: ../../README.md
  - resource: ../../src/app/theme.ts
  - resource: ../../CHANGELOG.md
  - resource: ../../src/styles/tailwind-token-bridge.css
status: stable
generated:
  by: claude-code/claude-sonnet-5
  at: 2026-09-22T16:27:14Z
---

# Theming and the visual system

## Theme choices: System, Light, Dark, and Hybrid

**View > Theme** offers four choices — **System default**, **Light**,
**Dark**, and **Hybrid**:

- **System default** follows the OS/browser `prefers-color-scheme` setting
  and updates **live** when the system theme changes (a `matchMedia`
  listener re-applies it).
- **Light** and **Dark** are explicit, fixed choices.
- **Hybrid** also follows `prefers-color-scheme` for the surrounding UI
  chrome, exactly like System default, but forces the **spreadsheet/grid
  area to stay light** even when the rest of the UI resolves to dark
  (`src/app/theme.ts`; `styles.css` scopes this override to
  `data-theme-choice="hybrid"`). **Hybrid is the default for new users**
  (`DEFAULT_THEME` in `src/app/theme.ts`).

> `README.md`'s "Theme (light / dark)" section describes only System
> default / Light / Dark, says new users start on System default, and does
> not mention Hybrid at all. This contradicts `src/app/theme.ts` (a fourth
> `'hybrid'` choice, `DEFAULT_THEME = 'hybrid'`) and multiple CHANGELOG
> entries (`#363` introducing Hybrid, `#393` making it the new-user
> default). Hybrid is documented here from the code and CHANGELOG directly,
> per this domain's grounding rule; the README gap is flagged rather than
> silently resolved, for a maintainer to reconcile.

The choice is persisted in `localStorage` and never transmitted anywhere.
The selected spreadsheet font (below) applies unchanged in every theme, and
switching theme is pure display state — it never alters CSV bytes, RSF
data, formulas, calculations, or document semantics.

The resolved theme is applied by setting one `data-theme` attribute
(`"light"` or `"dark"`) plus the matching `color-scheme` on the document
root, before first paint, so there is no flash of the wrong theme
(`src/app/theme.ts` resolves the choice and applies it; System and Hybrid
both resolve via `prefers-color-scheme`, Hybrid's grid-stays-light behavior
being a CSS override on top of the same resolved root theme, not a
separate root theme).

The **application icon** is theme-aware: the header logo and welcome-screen
icon use a light asset in the light theme and `icon-dark.svg` in the dark
one, switching live with a System-default (or Hybrid) theme when
`prefers-color-scheme` changes. Both variants are bundled locally, the icon
stays decorative (empty `alt`, `aria-hidden` — see
[accessibility.md](accessibility.md)), and switching only re-points the
same element, so its fixed dimensions never shift layout. The favicon
follows the OS/browser dark-mode preference too, via an embedded
`prefers-color-scheme` style, so no script has to run before the tab
paints it.

## The semantic token system

The theme is a **semantic CSS custom-property system**: one light palette
in `:root`, one dark palette under `:root[data-theme="dark"]`, and every
surface (app background, menus, dialogs, buttons, grid background,
alternating rows, grid lines, headers, cell/muted text, active cell and
selected range, formula-reference highlights, dirty/edited indicators,
errors/warnings/success, loading/progress UI, tooltips, context menus, and
scrollbars via `color-scheme`) reads its colors from those tokens — no
scattered hard-coded colors remain. Selection, formula errors, dirty state,
and warnings are never signaled by color alone (see
[accessibility.md](accessibility.md) for the specific non-color cues each
one pairs with).

For how `src/styles/` is physically split by section, loaded via
`src/styles.css`'s ordered `@import` list, and bridged to Tailwind utility
classes for non-grid surfaces, see
[../architecture/module-boundaries.md](../architecture/module-boundaries.md)'s
styling-architecture paragraph — that mechanical detail is not repeated
here.

## Spacing, radius, and bar-height tokens

Layout sizes follow the same rule as colors: one set of custom properties
on `:root` (`src/styles/tailwind-token-bridge.css`), used everywhere outside
the grid instead of scattered literals (#594).

- **Spacing** — `--space-1` … `--space-7` (2, 4, 6, 8, 12, 16, 24px). Every
  non-grid `padding`, `margin`, and `gap` uses this scale; 1px hairline
  offsets are the only literals left. Tailwind classes read it too, e.g.
  `gap-(--space-4)`.
- **Corner radius** — `--radius-sm` (4px: fields, buttons, menu items),
  `--radius-md` (6px: tabs, cards, dialogs), `--radius-lg` (12px).
- **Bars** — the menu bar, document tab row, formula bar, and worksheet
  strip share one outer height, `--bar-height` (32px, border included — the
  app is `box-sizing: border-box` throughout); the status bar uses the
  smaller `--status-bar-height` (24px). On a wide window the document tabs
  share the menu bar's row (see
  [tabs-and-worksheet-strip.md](tabs-and-worksheet-strip.md)). Their left content edges line up at
  `--space-4`.

The grid's own cell geometry (`src/styles/virtualized-grid.css`) is
deliberately outside this scale: `grid.ts` measures cell padding and keeps
row height in sync with `--grid-row-height`. Touch-target floors in the
mobile layout (36–44px `min-height`) are also literals, since they are
accessibility minimums rather than spacing.

## Spreadsheet font

Two CSS variables define the type roles: `--font-ui` for the menu bar,
menus, dialogs, and general application chrome, and `--font-sheet` for the
grid, headers, cell values, the formula bar, the inline editor, and
selection overlays — the **spreadsheet font**.

**View > Spreadsheet Font** chooses one family for the whole spreadsheet UI
by updating the single `--font-sheet` variable; the current choice is
shown with a checkmark. Six local Windows/Office families are offered
(monospace fallback for the first three, sans-serif for the rest):

- **BIZ UD Gothic** / BIZ UDゴシック
- **MS Gothic** / ＭＳ ゴシック
- **MS UI Gothic**
- **Noto Sans JP** — the default
- **Meiryo UI**
- **Yu Gothic UI**

There is **no per-cell font selection** in this version. The choice is an
application-level preference stored in `localStorage`; RSF documents carry
no per-document sheet-font override, so the application preference always
applies with no document-vs-application precedence conflict to resolve.
Changing the sheet font is pure display state — it never alters CSV bytes
and never triggers a CSV → RSF conversion. No font is fetched from a CDN or
bundled; when a preferred family is not installed, the declared local
fallback chain (finally `monospace` or `sans-serif`) is used, matching the
offline-only guarantee in
[../operations/index.md](../operations/index.md).

## Vertical text centering

Cell text is **vertically centered** by one explicit typography model, not
by browser baseline behavior: every grid row is exactly
`--grid-row-height` (26px, kept in sync with the virtualization constant),
cells use border-box sizing with horizontal padding only, and the
single-line `line-height` equals the cell's content height — so the line
box itself centers the glyphs. Because this depends on the line box rather
than any font's baseline or half-leading metrics, it holds identically for
every offered spreadsheet font and fallback stack, and for Japanese,
Latin, numeric, formula-result, error, and mixed-script values.

Row/column headers, the pinned first row, and formula-result cells share
the same model; the inline cell editor is a native input (vertically
centered by the browser) laid over the same box; selection outlines, fill
handles, and formula-reference highlights attach to the unchanged cell
box. Wrapped rows (below) opt into a multi-line box that is **still
vertically centered** (via flex), so centering holds whatever a row's
height becomes. This adjustment is pure CSS — no CSV/RSF content,
formulas, stored values, or row structure change because of it. See
[../architecture/invariants.md](../architecture/invariants.md)'s "One zoom
sizing model" bullet for how this interacts with per-tab spreadsheet zoom.

## Conditional row-height wrapping

**View > Wrap Long Cell Text** wraps long content, but grows **only the
rows that actually need more than one visual line** — a row whose cells
all fit their current column widths keeps the normal single-line height.
Whether a row wraps is decided from the **rendered display value**,
measured under the active sheet font and the live column width (a formula
cell is measured from its _calculated result_, never its source), honoring
explicit newlines (`\n`), normal word-break opportunities, and long
unbroken text that must break to avoid overflow.

Wrapping also turns **on automatically** the moment a cell edit commits a
value containing a line break — from Alt+Enter in the inline editor or
formula bar (see [editing-and-ime.md](editing-and-ime.md)), a pasted
multiline value, or a formula whose _result_ contains a newline. The change
is announced politely (never a blocking dialog) and travels in the **same
undoable step** as the edit that caused it — this bundling is recorded as
an invariant in
[../architecture/invariants.md](../architecture/invariants.md) ("Presenta-
tional state rides with its edit"). For RSF documents it is persisted per
worksheet in the container's display metadata; in plain CSV it is local
view state only and never changes the file's bytes.

Only affected row heights are recomputed after a cell edit, formula
recalculation, column-width change or auto-fit, sheet-font change, locale
change, wrap toggle, row/column insertion or deletion, and large
paste/fill/conversion operations.

**Time-sliced measurement for virtualized rows.** For virtualized
documents the visible rows are measured immediately, and off-screen rows
are filled in **incrementally in cooperative time slices** (with a
percentage progress label if the pass is long-running), so the grid never
blocks on a synchronous full-document loop — the same slicing discipline
documented generally in
[../architecture/system-overview.md](../architecture/system-overview.md)'s
"Long-running operations" section. A **row-height index** (a sparse
prefix-sum of the rows that grew) keeps scroll offsets, the virtualization
window, keyboard navigation, and the pinned sticky row correct as heights
vary; the pinned first row itself stays single-line so the pinned area
keeps a stable height.

Turning wrapping off restores every row to the single-line height. Row
heights are **derived view state** recomputed from content, column widths,
and font — never persisted into CSV bytes or the RSF container — and a
value containing explicit newlines is preserved unchanged when wrapping is
off (it simply displays clipped to the first line, with the full value
visible in the formula bar).
