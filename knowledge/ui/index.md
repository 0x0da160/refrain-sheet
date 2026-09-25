# UI

How a person actually interacts with Refrain Sheet: the grid, the keyboard,
dialogs and dockable panels, mobile/touch, accessibility, and theming. This
domain covers **interaction and presentation** behavior — what a user sees,
clicks, types, and drags, and the guarantees that make that safe (IME
composition, keyboard operability, non-color state cues). It is a sibling of
[`domains/`](../domains/index.md), which covers data and calculation
semantics (formulas, workbook lifecycle, CSV preservation); this domain does
not re-derive that material, and links to it and to
[`architecture/`](../architecture/index.md) (layering, command dispatch,
module boundaries) wherever a concept here builds on it instead of restating
it.

- [Editing and IME](editing-and-ime.md) — inline cell editing, the formula
  bar as a second edit surface, multi-line editing, and the user-facing flow
  behind the IME-safe hidden "sink" textarea.
- [Selection and navigation](selection-and-navigation.md) — selecting cells,
  rows, columns, and ranges; the four selection-role visuals; Select All;
  Go to Cell; the cell-reference box.
- [Copy, paste, fill, and Flash Fill](copy-paste-fill-and-flash-fill.md) —
  clipboard formats, pattern-repeat paste tiling, Insert Copied
  Cells/Rows/Columns, the fill handle and numeric-series AutoFill, moving a
  selected range, and Flash Fill's safe-transformation/preview/refusal model.
- [Find, Replace, and Go to Cell](find-replace-and-goto.md) — the Find/Replace
  bar, match case, bounded regex mode, and RSF's workbook-wide search scope.
- [Column resize and auto-fit](column-resize-and-autofit.md) — manual
  drag-resize, single- and multi-column auto-fit, what auto-fit actually
  measures, and the virtualized sampling strategy for huge sheets.
- [View, formatting, and dockable panels](view-formatting-and-panels.md) —
  Filter, Sort, Data Validation, Conditional Formatting, and Cell Formatting
  as a functional group (what's saved vs. session-only), plus the shared
  dockable-panel chrome (dock/resize/maximize) those and other panels share.
- [Tabs and worksheet strip](tabs-and-worksheet-strip.md) — the interaction
  model of the two independent tab strips: drag reorder, keyboard
  equivalents, roving tabindex, dirty indicators, and the close-tab flow.
- [Mobile and touch](mobile-and-touch.md) — touch drag gestures, on-screen-
  keyboard suppression, and phone-width layout adaptations, grounded in code
  and tests rather than the (touch-thin) README.
- [Accessibility](accessibility.md) — keyboard-only operability, ARIA
  labeling, focus management, and never signaling state by color alone.
- [Theming and the visual system](theming-and-visual-system.md) — System/
  Light/Dark/Hybrid themes, live `prefers-color-scheme` tracking, the
  spreadsheet font choice, vertical text centering, and conditional
  row-height wrapping.

Before choosing or changing a keyboard shortcut, the
[spreadsheet shortcut comparison](../references/spreadsheet-shortcut-comparison.md)
lists what Excel for the web, Google Sheets, and LibreOffice Calc document and where they
disagree or collide with the browser. It is background, not a spec; the
shipped keys and their browser-safety rules are in `src/app/shortcuts.ts`
and [accessibility.md](accessibility.md).

Any change to how the UI looks or is laid out also falls under the
[IP risk policy](../decisions/ip-risk-policy.md): familiar operation is
welcome, but screens, icons, wording, and layout stay original, never a
reproduction of a specific Excel screen.
