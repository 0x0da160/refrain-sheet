---
type: domain-concept
title: Import, export, and conversion
description: What formats import (CSV, JSON array-of-flat-objects, XLSX) and export (CSV, JSON, XLSX), why every non-RSF export is a lossy "values only" conversion, and unrepresentable-character handling on export.
sources:
  - resource: ../../README.md
  - resource: ../../CHANGELOG.md
  - resource: ../../src/core/csv-export.ts
  - resource: ../../src/core/json-import.ts
  - resource: ../../src/core/json-export.ts
  - resource: ../../src/core/xlsx-import.ts
  - resource: ../../src/core/xlsx-export.ts
status: stable
generated:
  by: claude-code/claude-sonnet-5
  at: 2026-09-22T16:27:09Z
---

# Import, export, and conversion

Refrain Sheet's native formats are plain CSV (byte-preserving, see
[csv-preservation-guarantee.md](csv-preservation-guarantee.md)) and `.rsf`
(the spreadsheet container, see
[`../formats/rsf/overview.md`](../formats/rsf/overview.md)). JSON and XLSX
are secondary formats: reachable, but explicitly lossy in one direction or
the other.

## What imports

- **CSV / `.rcsv`** open directly as byte-preserving documents (or, for
  legacy `.rcsv`, migrate to `.rsf` on open — see
  [`../formats/rsf/compatibility.md`](../formats/rsf/compatibility.md)).
- **JSON** (`src/core/json-import.ts`): **File > Open** accepts a `.json`
  file containing a top-level array of flat (non-nested) objects — one
  array element per row, columns as the union of every object's keys in
  first-seen order. A deeply nested value (an object or array as a
  property value) has no single standard flattening convention, so a
  document shaped that way is rejected with a typed error (`invalid-json`,
  `not-an-array`, `empty-array`, `not-flat-object`) rather than being
  silently flattened or dropped.
- **XLSX** (`src/core/xlsx-import.ts`): an arbitrary, untrusted `.xlsx` (a
  ZIP archive of OOXML parts) is read for its calculated/display values
  only — formulas, cell styles/number formats, merged cells, column
  widths, and charts are not parsed. A numeric cell formatted as a date by
  the workbook's `styles.xml` therefore imports as its raw serial-number
  text.

Both JSON and XLSX import follow the same **"import → new tab"** pattern:
the source file is read into a **new** `.rsf` spreadsheet tab and never
mutated itself, and the app's own XLSX/JSON writers reuse the same
display-value scope so import and export stay symmetric. XLSX import is
also strictly bounded against decompression bombs and oversized grids —
see
[`../operations/security-threat-model.md`](../operations/security-threat-model.md)'s
"Opened `.xlsx` files" row for the exact controls (512 MiB per-entry
decompression ceiling, a bound on total materialized cells, any structural
failure aborting the whole import).

## What exports

### CSV

**File > Export as CSV…** writes the computed values back out to plain
CSV. A CSV file holds exactly one sheet, so when the workbook has more
than one worksheet, a dialog asks which worksheet to export before
anything else — the export never silently takes the active worksheet. The
export options dialog doubles as the explicit confirmation; nothing is
written until **Export CSV** is pressed:

- **Encoding:** UTF-8, Shift_JIS / CP932, or EUC-JP.
- **BOM:** include or omit (UTF-8 only; disabled, with an explanation, for
  the other encodings).
- **Delimiter:** keep the workbook's own delimiter (default), or override
  with comma, semicolon, or tab.
- **Quoting:** quote a field only when required (default), or always quote
  every field.
- **Line endings:** CRLF, LF, or CR, applied exactly to every record.

CSV export is explicitly **lossy**: formulas are exported as their
calculated display values, not expressions, and RSF-only data — formulas
and dependency information, the other worksheets, structure beyond the
exported grid, column widths, filters, document metadata, and font
preferences — is not preserved. The export flow never mutates the source
`.rsf` document and never marks it saved; cancellation and errors leave
everything untouched.

### JSON

**File > Export as JSON…** (`src/core/json-export.ts`) writes the active
worksheet's calculated values back out as a JSON array of objects, using
the first row as field names; a multi-worksheet workbook is asked which
worksheet to export, exactly like Export as CSV. Like CSV export, this is
a single-table, values-only export — no formulas, and (unlike XLSX) no
native way to hold more than one worksheet in one file. Cell text becomes
a JSON number or boolean only for a canonical numeric form or exactly
`"TRUE"`/`"FALSE"`; every other value round-trips as a JSON string.

### XLSX

Export writes a `.xlsx` (Excel Open XML) ZIP archive
(`src/core/xlsx-export.ts`), serializing only the displayed (calculated)
values of one or more worksheets — no formulas, styles, column widths, or
other spreadsheet-only data. Unlike CSV, XLSX natively holds multiple
worksheets, so a whole workbook exports in one file with no per-sheet
choice required. Every ZIP entry is written uncompressed (STORE method)
with timestamps fixed to the DOS epoch, so the same input always produces
byte-identical output.

## Unrepresentable-character handling on export

Every exported CSV value is validated against the chosen encoding in a
time-sliced scan behind the progress indicator. If characters cannot be
represented, a dialog lists the affected cells and the export is
**cancelled by default**; only after explicit confirmation does it
continue, writing those characters as numeric character references (e.g.
`&#128512;`), which is then reported per cell. This is the same
cancel-by-default / NCR-on-confirm pattern used for a lossy encoding
conversion when saving a CSV with options — see
[csv-preservation-guarantee.md](csv-preservation-guarantee.md).

## Version history is not import/export

Recording and restoring a file's own past states (**Sheet > File Version
History…**) is a different feature from any of the above — it operates
entirely inside one `.rsf` container and has no bearing on CSV/JSON/XLSX
import or export. See
[version-history-and-snapshots.md](version-history-and-snapshots.md).
