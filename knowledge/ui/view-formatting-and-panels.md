---
type: ui-concept
title: View, formatting, and dockable panels
description: Filter, Sort, Data Validation, Conditional Formatting, and Cell Formatting as a functional group — what's saved vs session-only — plus the shared dockable-panel chrome those and other panels use.
sources:
  - resource: ../../README.md
  - resource: ../../CHANGELOG.md
  - resource: ../../src/ui/dialogs/shared.ts
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

| Feature                    | Saved to `.rsf`?               | Undoable?                                                         | Marks document dirty? |
| -------------------------- | ------------------------------ | ----------------------------------------------------------------- | --------------------- |
| **Filter**                 | Yes (container body version 4) | Yes (as one atomic step; clearing it via structural edits is too) | Yes                   |
| **Cell Formatting**        | Yes                            | Yes (one atomic history entry per change)                         | Yes                   |
| **Sort**                   | No — session-only view state   | No                                                                | No                    |
| **Data Validation**        | No — session-only view state   | No                                                                | No                    |
| **Conditional Formatting** | No — session-only view state   | No                                                                | No                    |

This split is deliberate and recorded as an invariant in
[../architecture/invariants.md](../architecture/invariants.md) ("Filter =
hide only, never mutate" and "Sort = display order only, never mutate"):
Filter and Cell Formatting change what reopens with the file; Sort, Data
Validation, and Conditional Formatting are purely how the current session
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
**list** rule (allowed values, one per line) or a **number** rule (optional
min/max). A blank cell is always valid for either kind. Editing a cell
covered by a list rule shows a keyboard-accessible dropdown popup below the
cell; typing narrows it. Invalid edits are refused with an explanation, the
same refusal pattern as editing inside a sorted range. Up to 64 rules per
worksheet, up to 500 values in one list rule; overlapping ranges resolve to
the most recently applied rule.

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
serials). Keyboard shortcuts: **Ctrl+B / Ctrl+I / Ctrl+U**.

## The shared dockable-panel chrome

Filter, Sort, Data Validation, Conditional Formatting/Cell Formatting, SQL
Query, the Comments panel, and the docked Markdown/JSON/YAML worksheet
preview all share one **dockable, resizable side panel** shell
(`openSidePanel` / `buildSidePanelDock` in `src/ui/dialogs/shared.ts`)
instead of separate popup layouts:

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
  `openSidePanels` in `src/ui/dialogs/shared.ts`: a panel joins through
  `applySidePanelPosition` and leaves through `releaseSidePanel`.
- **Persistence within a session.** The most recently chosen dock position
  and size are remembered for the next panel opened in the same session
  (an in-memory preference, not written to the document or `localStorage`
  beyond what the theme/font preferences already use).
- **Dismissal.** Escape, window blur, or the panel's own Cancel/close
  button closes it; a stray click on the sheet behind it does not (this
  was a deliberate change from an earlier click-outside-closes behavior,
  so adjusting settings in the panel is never silently discarded by an
  accidental click).
- On a narrow, portrait mobile viewport the default dock position is
  **bottom** instead of right — see
  [mobile-and-touch.md](mobile-and-touch.md) for the touch/viewport
  specifics of this shell.
