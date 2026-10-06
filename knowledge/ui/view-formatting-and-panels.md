---
type: ui-concept
title: View, formatting, and dockable panels
description: Filter, Sort, Data Validation, Conditional Formatting, and Cell Formatting as a functional group — what's saved vs session-only — plus the shared dockable-panel chrome those and other panels use.
sources:
  - resource: ../../README.md
  - resource: ../../CHANGELOG.md
  - resource: ../../src/ui/dialogs/shared.ts
  - resource: ../../src/ui/dialogs/side-panel.ts
  - resource: ../../src/ui/dialogs/form-layout.ts
  - resource: ../../src/ui/dialogs/help-panels.ts
  - resource: ../../design-system/v2/docs/decisions.md
status: stable
generated:
  by: claude-code/claude-sonnet-5
  at: 2026-09-22T16:27:14Z
---

# View, formatting, and dockable panels

Five RSF-only commands — **Filter**, **Sort**, **Data Validation**,
**Conditional Formatting**, and **Cell Formatting** — share a menu location
(Sheet/Format/Data) and a UI shell (the dockable side panel, below), but
differ sharply in one dimension: **what survives a save**.

| Feature                    | Saved to `.rsf`?                    | Undoable?                                                         | Marks document dirty? |
| -------------------------- | ----------------------------------- | ----------------------------------------------------------------- | --------------------- |
| **Filter**                 | Yes (the worksheet's `filter`)      | Yes (as one atomic step; clearing it via structural edits is too) | Yes                   |
| **Cell Formatting**        | Yes                                 | Yes (one atomic history entry per change)                         | Yes                   |
| **Sort**                   | No — session-only view state        | No                                                                | No                    |
| **Data Validation**        | Yes (the worksheet's `validations`) | Yes (one atomic history entry per change)                         | Yes                   |
| **Conditional Formatting** | No — session-only view state        | No                                                                | No                    |

This split is deliberate and recorded as an invariant in
[../architecture/invariants.md](../architecture/invariants.md) ("Filter =
hide only, never mutate" and "Sort = display order only, never mutate"):
Filter, Cell Formatting, and Data Validation change what reopens with the
file; Sort and Conditional Formatting are purely how the current session
looks at the data, cleared the moment the sort/rules are cleared or the tab
closes.

All five are **RSF only** — on a plain CSV document each explains that it
requires converting to RSF first and changes nothing (see
[../formats/index.md](../formats/index.md) for the CSV → RSF conversion
model).

> `README.md`'s own "Limitations" section still says "Sorting and filtering
> are not available in this version," which contradicts the detailed
> Filtering (RSF) and Sorting (RSF) sections earlier in the same document —
> an apparent stale leftover from before those features shipped. This is
> flagged here as an honest discrepancy in the source document, not silently
> resolved or hidden.

## Filter

**Sheet > Filter…** (also the ▼ button in a filtered range's column header,
and the grid context menu) hides rows that do not match criteria —
**visually only**; row identity, formulas, references, widths, heights, and
undo/redo are all preserved.

- **Range and header.** The filter covers the selected rectangle, or the
  detected data block around the active cell; the first row is treated as
  a header (never hidden) by default, shown and changeable in the dialog.
- **Criteria.** Text (contains / does not contain / equals / does not
  equal / begins with / ends with / blank / not blank), numeric (=, ≠, >,
  ≥, <, ≤, between), and a searchable, bounded list of the column's
  distinct displayed values. Conditions within one column combine with a
  documented AND/OR choice (the value list is an extra AND clause);
  different columns always combine with AND.
- **Hidden-row safety.** Copy, fill, clear, Flash Fill, and selection
  statistics operate on visible rows only; keyboard navigation skips
  hidden rows. Row/column insertion or deletion clears the active filter
  as one atomic, undoable step.

## Sort

**Sheet > Sort…** reorders how rows _display_ by up to **8 compound sort
levels** (column + ascending/descending) — visually only, exactly like
Filter's hide-only model, but never persisted. Numbers compare numerically;
everything else compares by code-point order; blanks always sort last;
ties keep original relative order (a stable sort). Only rows the active
filter leaves visible participate. **Editing is disabled inside the sorted
range** while a sort is active (the header stays editable) — clear the sort
to edit again. Row/column insertion or deletion drops the sort outright.

## Data Validation

**Data > Data Validation…** restricts which values a cell accepts: a
**list** rule (allowed values, one per line), a **number** rule (optional
min/max, optionally whole numbers only), a **text length** rule (fewest
and/or most characters), or a **date** rule (`YYYY-MM-DD`, optional
earliest/latest). A blank cell is valid unless **Don't allow blank cells**
is ticked. **Apply to all of columns …** turns the rule into a column rule
(a simple column schema): it covers the selected columns from row 1, or
from row 2 when the header row is skipped, to the last row, including rows
added later; selecting any cell in those columns reopens it. Editing a cell
covered by a list rule shows a keyboard-accessible dropdown popup below the
cell; typing narrows it. Invalid edits are refused with the reason, the
same refusal pattern as editing inside a sorted range. Up to 64 rules per
worksheet, up to 500 values in one list rule; overlapping ranges resolve to
the most recently applied rule.

**Data > Check Data…** opens a dockable panel (like the comments panel)
listing every cell whose value breaks its rule — values that got in before
the rule, or blanks in a required column — on the sheet or the whole file,
down to the last row with data and at most 1,000 at a time. Selecting an
entry goes to the cell; the list updates as cells are fixed. It only
reports; nothing is changed.

Rules are saved with the file (the worksheet's `validations`, see
[../formats/rsf/json-document.md](../formats/rsf/json-document.md)), and
applying or clearing one is undoable. They follow row and column insertion,
deletion, and moves the way a formula's range does: an insert inside a
rule's range grows it, a delete shrinks it, and a rule whose cells are all
deleted goes away (undo brings it back).

## Conditional Formatting

**Format > Conditional Formatting…** colors cells automatically from their
computed value: a **cell value** rule (comparison against an entered
value), a **duplicate values** rule, or a **color scale** rule (two-color
gradient by where a value falls between the range's min/max). It is purely
presentational — never changes a value, formula result, or sort/filter
behavior. When a conditional rule and manual Cell Formatting both apply to
one cell, the conditional rule's color wins.

## Cell Formatting

The **Format** menu's Bold/Italic/Underline/Text Color/Background
Color/Borders/Number Format/Clear Formatting apply visual formatting to the
selection — purely presentational, but (unlike the four above) **undoable
and saved**: every change is one atomic history entry. Bold/Italic/
Underline follow the usual spreadsheet "uniform selection" toggle rule.
Borders offers all four sides as thin solid lines only (no width/style
choice). Number Format offers Number/Percent/Currency with decimal places,
thousands separator, and a currency symbol; it never adds a date kind (see
[theming-and-visual-system.md](theming-and-visual-system.md) and
`README.md`'s "Dates and times" section for how this interacts with date
serials). Keyboard shortcuts: **Ctrl+B / Ctrl+I / Ctrl+U**, **Ctrl+\\**
(Clear Formatting), and the one-step number format presets **Ctrl+Shift+1**
(Number, 2 decimals with thousands separator), **Ctrl+Shift+4** (Currency:
¥ with no decimals in Japanese, $ with 2 decimals otherwise), and
**Ctrl+Shift+5** (Percent). The presets keep the Control key on macOS,
where Cmd+Shift+4 / 5 take screenshots.

**Format > Font…** sets the selection's own font family and size. Sizes are
shown and drawn in px; the file stores points (1pt = 4/3 px, so every size
the px list offers is a whole or half point; RSF keys in [the JSON document](../formats/rsf/json-document.md)); the
toolbar over text selected in the cell editor sets them for just that text.
Choices are a fixed list (the sheet fonts plus common Latin fonts) and,
where `queryLocalFonts` is allowed, the device's fonts — never a typed name.
A font the device lacks displays in the sheet font; its name stays saved.
Rows do not grow for larger text, and auto-fit/wrap still measure with the
sheet font.

## The main toolbar

A row of icon buttons above the formula bar (`src/ui/app-toolbar.ts`),
hidden on the welcome screen. Any menu command with an icon can go on it
(plus Bold/Italic/Underline, Wrap and Full Screen, which the menus show with
a check mark instead); its tooltip, shortcut and pressed state come from the
command's menu item, a divider separates commands from different menus, and
an unavailable command is `aria-disabled` with its reason in the tooltip.
View > Toolbar & Status Bar > Show Toolbar hides it; **View > Toolbar & Status Bar > Customize Toolbar…** (also its
trailing button) opens a dockable panel to reorder, remove and add
commands, and Reset Toolbar restores the default set. Every change applies
at once. The list and visibility are stored in this browser's `localStorage`
only (`src/app/toolbar-prefs.ts`) — never in a file — so a file opens the
same on every device; ids a build no longer offers are skipped.

## The status bar

The bar under the grid (`src/ui/status-bar.ts`). Its information items —
file type, encoding, delimiter, line endings, size, rows × columns,
formula count, edited cells, filter, sort, CSV engine, the selected cell
with its totals, and the version — each show in the bar, behind the bar's
**Details** button (a popover), or not at all, as **View > Toolbar &
Status Bar > Customize Status Bar…** sets (also a right-click on the bar, and the popover's own
link). The panel lists the items in three lists (in the bar, in Details,
not shown); an item is dragged by its grip to another list or another
place in its list (Up/Down and a place list per item do the same from the
keyboard), and the bar and the Details popover show items in the order
listed, the bar's all together where the first of them would be. The
places and the order are stored in this browser only
(`src/app/status-bar-prefs.ts`); every item starts in the bar, in the
default order. Warnings and controls are always in the bar, after the
arranged items: structure problems, unreadable
characters, unsaved changes, the protection switch (**Edit | Protected**,
the current one pressed; choosing the other runs `file.toggleProtect`),
and at the right end the spreadsheet zoom (− , the View > Spreadsheet
Zoom levels, +; a zoom that is not a level is listed too) and Full Screen.
On a phone the file details stay behind the Details toggle whatever their
place, and zoom and Full Screen stay in the View menu, so the bar keeps to
one line (see [mobile-and-touch.md](mobile-and-touch.md)).

## The shared dockable-panel chrome

Filter, Sort, Data Validation, Conditional Formatting/Cell Formatting, SQL
Query, the Comments panel, the Find and Replace panel, and the docked
Markdown/JSON/YAML worksheet
preview all share one **dockable, resizable side panel** shell
(`openSidePanel` / `buildSidePanelChrome` in `src/ui/dialogs/side-panel.ts`)
instead of separate popup layouts:

- **One title bar.** `buildSidePanelChrome` builds every panel's header:
  an icon (the same one its menu item uses; an eye for previews) before
  the title, then the dock-side buttons, maximize, and a close (×) button,
  always in that order and size. No panel builds its own header.
- **One form layout.** Both `openSidePanel`'s and `openDialog`'s body
  (`.form-layout`, styled in `src/styles/form-layout.css`) stack
  `formSection`s; each `formField` puts its label above a full-width
  control (`formFieldWithStatus` adds a live error line under it),
  side-by-side fields share a `formGrid` (two columns at most in a
  dialog), checkboxes/radios use `formCheck`, and every text field,
  select, and in-body button (`.panel-button`) is the same height. The
  builders live in `src/ui/dialogs/form-layout.ts`. Design system 2.5.0
  (D-47 to D-51 in `design-system/v2/docs/decisions.md`) sets the rules:
  label above the control, gaps from `--label-gap`, `--stack-gap` and
  `--section-gap` only, no shaded title or footer band, the committing
  button last in the footer with Cancel just before it and any other
  action marked `atStart` (far left), and a dialog width passed to
  `openDialog` as `sm` / `md` (default) / `lg` (360 / 480 / 640px). Build
  new controls from these helpers rather than ad-hoc rows.
- **Dialog or panel.** Design system D-46: a modal dialog only for what
  must be answered before going on (a confirmation, a short input that
  starts an action, a pick-and-close choice, the OK/Cancel Settings);
  everything used while looking at the sheet (reference text such as the
  shortcut list and formula help, settings adjusted while watching the
  result, lists moved through) is a side panel. Help ▸ About, Keyboard
  Shortcuts and Formula and Function Help (`src/ui/dialogs/help-panels.ts`),
  Sheet ▸ File Version History (`version-history-panel.ts`) and Data ▸
  Compare / Diff (`diff.ts`) are panels. A panel opened with a `key` exists
  once: asking for it again expands the open one.

- **Dock position.** Buttons in the panel's header pick top, right,
  bottom, or left; a top/bottom dock sits below the menu bar and document
  tabs / above the status bar rather than covering them (a top dock starts
  exactly where `#app-content` does, so it follows the tabs whether they
  share the menu bar's row or not — #596), and reserves its own space as a
  genuine split view rather than floating over the sheet.
- **Resize.** Drag the panel's inner edge to resize it.
- **Maximize.** A maximize button next to the position switcher expands
  the panel to take the whole area, and back: a left/right-docked panel
  spans the full viewport width, and a top/bottom-docked one fills
  everything between the top chrome (menu bar, document tabs) and the
  bottom chrome (worksheet strip, status bar). A manual resize still stops
  160px short of the viewport, so dragging never hides the sheet entirely.
- **Several panels at once (accordion).** Every open side panel — the
  transient ones (Filter, Sort, Format, SQL Query, …) and the persistent
  ones (comments, the Markdown/JSON/YAML previews) — shares one dock: the
  same side and size. With more than one open, only one is expanded; the
  others collapse to their title bar, stacked in the dock instead of lying
  on top of each other. Clicking a collapsed title bar (or pressing
  Enter/Space on it) expands that panel and collapses the rest; a newly
  opened panel starts expanded, and changing the dock side, size, or
  maximize state from any panel moves the whole dock. The dock's space
  stays reserved until the last panel closes (#598). The bookkeeping is
  `openSidePanels` in `src/ui/dialogs/side-panel.ts`: a panel joins through
  `applySidePanelPosition` and leaves through `releaseSidePanel`.
- **Persistence within a session.** The most recently chosen dock position
  and size are remembered for the next panel opened in the same session
  (an in-memory preference, not written to the document or `localStorage`
  beyond what the theme/font preferences already use).
- **Dismissal.** Only the header's × (or Escape) closes a panel. No other
  button does: transient panels have no footer Close button, and the
  commands that show a persistent panel (View > Comments Panel, the Show
  preview button of Markdown/JSON/YAML sheets) only open it — the preview
  button is disabled while its panel is open rather than becoming Hide.
  Apply and Clear never do: the command passes an `onApply` handler
  (`ApplyHandler` in `src/app/ui-port.ts`, run through `applyWhileOpen` in
  `src/app/commands/shared.ts`), so each press applies immediately — one
  history entry per press, to whatever is selected at that moment — and
  the panel stays open for further adjustments. Neither a stray click on
  the sheet behind it nor the window losing focus (a native color picker
  opening, switching apps) closes it, so adjusting settings in the panel
  is never silently discarded.
- On a narrow, portrait mobile viewport the default dock position is
  **bottom** instead of right — see
  [mobile-and-touch.md](mobile-and-touch.md) for the touch/viewport
  specifics of this shell.
