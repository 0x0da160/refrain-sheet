---
type: ui-concept
title: Print and PDF
description: File > Print… lays the chosen sheets out for the browser's own print, whose Save as PDF makes the PDF; what prints, the page settings, and the limits.
sources:
  - resource: ../../src/core/print-layout.ts
  - resource: ../../src/ui/print-view.ts
  - resource: ../../src/ui/dialogs/print-dialog.ts
  - resource: ../../src/styles/print.css
status: stable
---

# Print and PDF

**File > Print…** opens a dockable panel (the same chrome as the other
side panels, see [view-formatting-and-panels.md](view-formatting-and-panels.md))
with the page settings. **Print** hands the page to the browser's own print
dialog; a PDF comes from choosing "Save as PDF" as the printer there. No
print or PDF library is bundled, and nothing leaves the device. The panel
stays open after printing, so another range or paper needs no reopening.
There is no keyboard shortcut: Ctrl+P stays the browser's (see
`src/ui/CLAUDE.md`).

## What prints

- **Current sheet**, **Selected cells**, or **Entire file** (every sheet,
  each starting on a new page under its name; offered when the file has
  more than one sheet).
- A grid prints down to its last row and across to its last column that
  hold anything (a selection prints exactly), with the displayed values —
  formula results and number formats — cell formatting, rich text,
  conditional formatting, and column widths. The active sheet prints as
  shown: in its sort order and without the rows its filter hides. Other
  sheets print in document order.
- Shapes, pictures and charts print over the cells, each drawn from the
  corner of the cell it is anchored to at its offset and size, in the
  sheet's stacking order; the grid reaches every shown object's anchor cell,
  so a sheet of only objects prints too. Hidden objects never print, and an
  object whose anchor cell does not print (outside the selection, on a row
  the filter hides) is left out. Rows print at their natural height, so an
  object that spans many rows may not line up with the same cells as on
  screen.
- A Markdown sheet prints rendered; a JSON, YAML or text sheet prints its
  text. A CSV document prints as one grid.
- Everything is rendered as text into a print-only layer
  (`.print-root`), never as HTML from the file.

## Page settings

Paper (A4, A3, JIS B5, Letter, Legal), orientation, shrink to the page
width or a fixed scale (10–400%), gridlines, row numbers and column
letters, repeating the first row on every page, and a fixed number of rows
per page (0 leaves page breaks to the browser). The last settings are
remembered in this browser (`localStorage`), never in the file. Paper and
orientation reach the page through an `@page` rule in a constructed
stylesheet, because the offline build's CSP refuses `<style>` elements;
where a browser cannot adopt one, its print dialog still offers them.

## Limits

One print lays out at most 200,000 cells; a larger one is refused with a
message suggesting a selection. Locked (unreadable) sheets, once they
exist, are left out.
