---
type: ui-concept
title: Theming and the visual system
description: System/Light/Dark/Hybrid themes, live prefers-color-scheme tracking, spreadsheet font choice, vertical text centering, and conditional row-height wrapping.
sources:
  - resource: ../../README.md
  - resource: ../../src/app/theme.ts
  - resource: ../../CHANGELOG.md
  - resource: ../../src/styles/tailwind-token-bridge.css
  - resource: ../../design-system/2.0.0/docs/migration.md
  - resource: ../../src/styles/virtualized-grid.css
  - resource: ../../src/ui/command-icons.ts
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
  (`src/app/theme.ts` sets the design system's `data-theme="hybrid"`: a
  dark shell around a light canvas). **Hybrid is the default for new users**
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
(`"light"`, `"dark"`, or `"hybrid"` when a Hybrid choice resolves dark) plus
the matching `color-scheme` on the document root, before first paint, so
there is no flash of the wrong theme (`src/app/theme.ts` resolves the choice
and applies it; System and Hybrid both resolve via `prefers-color-scheme`,
and a Hybrid choice on a light system is simply light). The root also
carries `data-theme-choice` with the raw choice.

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

The theme is a **semantic CSS custom-property system** taken from the
Refrain Sheet Design System v2.0.0 (`design-system/2.0.0/`), whose generated
token CSS `src/styles.css` loads first: `foundations.css` holds the shell
colours (`--bg-*`, `--fg-*`, `--border-*`, `--accent-*`, status colours,
`--inverse-*`, `--overlay`, `--shadow-*`) for light and dark, and
`app-tokens.css` adds the **canvas** colours (`--canvas-*`, `--state-*`,
`--ref-*`) and the hybrid theme. The app defines no colour values of its own.
The grid and the source editors are canvas and use only canvas tokens; the
shell (bars, menus, dialogs, panels) uses only shell tokens — mixing them is
what would make text unreadable in Hybrid. `npm run check:contrast` checks
the text/background pairs the app composes, in all three themes. Every
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

## Spacing, radius, and density tokens

Layout sizes follow the same rule as colors: the design system's custom
properties, used everywhere outside the grid instead of scattered literals
(#594).

- **Spacing** — the design system's 4px scale with half-steps:
  `--space-0-5` (2px), `--space-1` (4), `--space-1-5` (6), `--space-2` (8),
  `--space-3` (12), `--space-4` (16), `--space-6` (24), in rem so they
  follow the browser's font size. Every non-grid `padding`, `margin`, and
  `gap` uses this scale; 1px hairline offsets are the only literals left.
  Tailwind classes read it too, e.g. `gap-(--space-2)`.
- **Corner radius** — `--radius-sm` (4px: fields, buttons, menu items),
  `--radius-md` (6px: tabs, cards, dialogs), `--radius-xl` (12px).
- **Bars and controls follow the density** — **View > Density** offers
  Compact, Standard (default) and Comfortable (`src/app/density.ts`), stored
  on this device only and applied as `data-density` on the document root.
  The menu bar, document tab row, formula bar, and worksheet strip share one
  outer height, `--bar-h` (28 / 32 / 40px, border included — the app is
  `box-sizing: border-box` throughout); the status bar uses
  `--statusbar-h` (24 / 24 / 32px); inline controls and menu items
  `--control-h` (24 / 28 / 32px); fields and buttons in dialogs and panels
  `--field-h` (28 / 32 / 40px); dialog insets `--inset` (8 / 12 / 16px).
  A coarse pointer (touch) raises bars to 48px and controls to 44px whatever
  the choice. Density never changes text size or the grid's geometry. On a wide window the document tabs
  share the menu bar's row (see
  [tabs-and-worksheet-strip.md](tabs-and-worksheet-strip.md)). Their left content edges line up at
  `--space-2` (8px).

The grid's own cell geometry (`src/styles/virtualized-grid.css`) is
deliberately outside this scale: `grid.ts` measures cell padding and keeps
row height in sync with `--grid-row-height`. Touch-target floors in the
mobile layout (36–44px `min-height`) are also literals, since they are
accessibility minimums rather than spacing.

## Stacking order

Inside the grid canvas, rows and cells create no stacking context of their
own, so every layer competes directly; `virtualized-grid.css` documents the
order next to `.vgrid-canvas`. Bottom to top: data cells and the sticky
first column; the selection handles (fill and move); the copy-source
outline; the inline cell editor; the row numbers; the sticky first row; the
column-header row. Anything scrolled under the row numbers, the sticky row,
or the column headers is therefore covered by them — a selection handle
never shows on top of a header.

Across the app, bottom to top, using the design system's layer tokens: the
formula-reference note (`--z-raised`, 10); docked side panels, floating
dialogs, and the filter popover (`--z-panel`, 100); the formula
autocomplete (`--z-popover`, 120); menu-bar drop-downs and context menus
(`--z-menu` 150, `--z-submenu` 160), so a menu opened next to a docked panel
is never drawn under it; the drag-and-drop overlay (`--z-modal`, 200); the
loading overlay (`--z-overlay`, 250); toasts (`--z-toast`, 300), shown at
the top-right on every screen size.

## Menu icons

Menu items put a decorative icon in the same left-hand column a checkable
item uses for its checkmark. `ICON_BY_COMMAND` (`src/ui/command-icons.ts`)
maps each command to its icon and is shared by the menu bar and every
context menu (grid, document tabs, worksheet strip), so a command shows the
same icon everywhere; submenu parents carry their own icon.

## Spreadsheet font

Two CSS variables define the type roles: `--font-ui` for the menu bar,
menus, dialogs, and general application chrome, and `--font-sheet` for the
grid, headers, cell values, the formula bar, the inline editor, and
selection overlays — the **spreadsheet font**.

**View > Spreadsheet Font** chooses one family for the whole spreadsheet UI
by updating the single `--font-sheet` variable; the current choice is
shown with a checkmark. Six local families are offered:

- **BIZ UD Gothic** / BIZ UDゴシック — the default
- **MS Gothic** / ＭＳ ゴシック
- **MS UI Gothic**
- **Noto Sans JP**
- **Meiryo UI**
- **Yu Gothic UI**

Windows 11 Chrome/Edge is the primary target, so the defaults are the
Windows-bundled BIZ UD pair: **BIZ UDGothic** (fixed-pitch — full-width
kana/kanji, half-width Latin and digits) for the grid and **BIZ UDPGothic**
(proportional) for `--font-ui`. Both chains end in `sans-serif` and include
Hiragino (macOS/iOS) and Noto CJK (Android/Linux) so other platforms need
no extra fonts. The grid chain keeps fixed-pitch Windows families first
(MS Gothic), then families whose kana/kanji stay full-width but whose Latin
is proportional (Meiryo, Yu Gothic, Hiragino, Noto CJK); the UI-condensed
families (Meiryo UI, Yu Gothic UI, MS UI Gothic), whose kana are narrowed,
appear only in the UI chain. Row numbers set
`font-variant-numeric: tabular-nums` (equal-width digits only — it does not
make a font fixed-pitch); data cells do not, because auto-fit measures them
with canvas `measureText`, which cannot apply it. MS Gothic and MS UI Gothic
keep a `monospace` fallback; the #396 proportional families fall back to
`sans-serif`.

There is **no per-cell font selection** in this version. The choice is an
application-level preference stored in `localStorage`; RSF documents carry
no per-document sheet-font override, so the application preference always
applies with no document-vs-application precedence conflict to resolve.
Changing the sheet font is pure display state — it never alters CSV bytes
and never triggers a CSV → RSF conversion. No font is fetched from a CDN or
bundled; when a preferred family is not installed, the declared local
fallback chain (finally `sans-serif`, or `monospace` for MS Gothic / MS UI
Gothic) is used, matching the
offline-only guarantee in
[../operations/index.md](../operations/index.md).

## Vertical text centering

Cell text is **vertically centered** by one explicit typography model, not
by browser baseline behavior: every grid row is exactly
`--grid-row-height` (24px at 100% zoom, kept in sync with the
virtualization constant; the default column is 104px), cells use
border-box sizing with their single shared 1px grid line (right and bottom
border only) inside that box, pad 6px left/right and 3px top/bottom (both
scaled with the sheet zoom), and the single-line `line-height` equals the
remaining content height — so the line box itself centers the glyphs. The
inline cell editor offsets its 2px border against the same padding so
typed and IME-composed text starts exactly where the cell text is drawn.
`npm run ui:check` measures all of this in headless Chromium at every zoom
level (`scripts/ui-check-grid.mjs`). Because this depends on the line box rather
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
