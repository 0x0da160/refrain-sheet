# Domains

User-facing/product behavior of Refrain Sheet: what a person experiences
editing a CSV or an RSF spreadsheet, independent of how it is implemented.
This complements `architecture/` (the code-level model), `formats/rsf/` (the
`.rsf` binary container spec), and `operations/` (security and performance) —
each concept below links out to those instead of repeating them. Migrated
from `README.md`, cross-checked against `src/core/`; see that file for
anything not yet split into a concept here.

- [CSV preservation guarantee](csv-preservation-guarantee.md) — the Refrain
  principle, byte-identical unedited saves, minimal-diff edits, the
  documented exceptions, encoding support and detection, opening
  structurally invalid CSV, and the CSV-injection warning.
- [Workbook and worksheet lifecycle](workbook-and-worksheet-lifecycle.md) —
  RSF workbooks vs. worksheets, worksheet kinds, add/rename/duplicate/
  delete/reorder as atomic undoable operations, naming rules, and
  converting CSV to RSF.
- [Formulas and references](formulas-and-references.md) — formula syntax,
  the four reference forms, whole-column/row ranges, cross-sheet references,
  what worksheet lifecycle changes do to references, and `#CYCLE!`.
- [Formula functions and errors](formula-functions-and-errors.md) — the
  55-function inventory by group, criteria syntax, lookup semantics,
  Unicode-code-point-safe text functions, dates as numbers, and the full
  error code list.
- [Dynamic arrays and spilling](dynamic-arrays-and-spilling.md) — spill
  anchors and derived cells, `#SPILL!`, placement order, why only the
  anchor is ever saved, and how arithmetic vs. comparisons interact with
  spilled ranges.
- [Undo/redo and history](undo-redo-and-history.md) — one `HistoryEntry`
  per user-visible mutation from the user's perspective, what rides bundled
  into one entry, and what is deliberately not undoable.
- [Import, export, and conversion](import-export-and-conversion.md) — what
  formats import (CSV, JSON, XLSX) and export (CSV, JSON, XLSX), and why
  every non-RSF export is lossy.
- [Version history and snapshots](version-history-and-snapshots.md) —
  per-file snapshot recording on save, the retained-snapshot cap, Restore
  vs. Preview, and Clear Version History.
