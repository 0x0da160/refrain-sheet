---
type: ui-concept
title: Print and PDF
description: File > Print… lays the chosen sheets out for the browser's own print, whose Save as PDF makes the PDF; what prints, the page settings, and the limits.
sources:
  - resource: ../../src/core/print-layout.ts
  - resource: ../../src/ui/print-view.ts
  - resource: ../../src/ui/dialogs/print-dialog.ts
  - resource: ../../src/core/workbook/print-area.ts
  - resource: ../../src/app/state/print-area.ts
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

- **Current sheet**, **Selected cells**, **Print area**, or **Entire
  file** (every sheet, each starting on a new page under its name; offered
  when the file has more than one sheet). Within Entire file, a sheet with
  a print area prints only its print area.
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
  the filter hides) is left out.
- Rows are as tall as on screen. When the sheet does not wrap text (View >
  Wrap Long Cell Text), each row prints one line tall and text is cut at the cell's
  edge, as on screen; when it wraps, rows grow to fit their text, so an
  object that spans many rows may not line up with the same cells as on
  screen. Each sheet uses its own wrap setting (sheet > file > browser).
  A row whose height was set (Format > Row Height…) prints at that height.
- Banded rows print when the sheet shows them (View > Grid Look), in the
  sheet's band strength, counted over the shown rows so the pattern carries
  on across pages; a cell's own fill wins. Paper is always light, so the
  light theme's band colors print. The selected row and column highlights
  follow the cursor, so they never print. Gridlines follow the print
  panel's own Gridlines option.
- A Markdown sheet prints rendered; a JSON, YAML or text sheet prints its
  text. A CSV document prints as one grid.
- Everything is rendered as text into a print-only layer
  (`.print-root`), never as HTML from the file.

## Print area

Each grid sheet can have one print area, a block of cells. **File > Print
Area > Set Print Area to Selection** sets it and **Clear Print Area**
removes it; choosing **Print area** in the print panel shows the range as
text (`A1:F40`, any corner order, `$` allowed), and printing a typed range
also sets it. On a protected file or a locked sheet that print uses the
typed range without setting it, and the hint under the field says so.

An `.rsf` sheet keeps its area in the file (the `printArea` key, see
[json-document.md](../formats/rsf/json-document.md)), changed through
undoable history entries; inserted, deleted and moved rows and columns
move it, and undoing a delete gives back an area it shrank. A CSV file has
nowhere to keep one, so its tab remembers the area until it is closed.
When the sheet has a print area, the panel opens on **Print area**. The
grid shows the area with a thin dashed outline (none while the sheet is
sorted, because its rows are then out of document order). The active
sheet's print area prints in its shown order, without filtered-out rows.

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
