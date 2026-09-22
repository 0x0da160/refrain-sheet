---
type: format-concept
title: RSF single-sheet body grammar
description: The container-version-3 body layout — the full 17-version-gated field encoding, one section per feature that raised the version, and the load-time bounds table.
sources:
  - resource: docs/rsf-format.md (migrated content; file removed after migration — see knowledge/log.md)
  - resource: ../../../src/core/rsf-codec.ts
status: stable
generated:
  by: claude-code/claude-sonnet-5
  at: 2026-09-22T12:09:14Z
---

# RSF single-sheet body grammar

The body is a compact binary encoding of one sheet, written inside a
container-version-3 container (see [overview.md](overview.md)). All
strings are UTF-8.

## Version selection

Version selection on write is minimal so older readers keep working where
possible: body **version 17** is written when the worksheet is a yaml or
text sheet, or the file has auto-format-on-commit turned on (see
"Worksheet kind: yaml and text" and "Auto-format source on commit" below)
— **regardless of whether the file also overrides its retained-snapshot
cap**, since both were added after the cap-override feature had already
shipped (in v0.8.3) at version 16, and that version number is never
renumbered — a real file saved by that release has this exact body version
meaning "the cap-override field follows"; **version 16** when the file
overrides its retained-snapshot cap (see "Version history: retained-snapshot
cap override" below) with no yaml/text worksheet — this feature's own,
original version number, unaffected by yaml/text being added later;
**version 15** when the worksheet is a json sheet (see "Worksheet kind:
json" below); **version 14** when version history is disabled or holds at
least one snapshot (see "Version history" below); **version 13** when the
worksheet is locked (see "Worksheet locked" below); **version 12** when the
worksheet is a Markdown sheet (see "Worksheet kind" below); **version 11**
when at least one cell carries a comment; **version 10** when at least one
border side carries a non-default line style or width; **version 9** when
at least one cell carries a number format; **version 8** when at least one
cell carries a style; **version 7** when the workbook display language is
not English; **version 6** when the workbook timezone is not `UTC`;
**version 5** when wrap-long-rows is stored; **version 4** when a sheet
filter is present; **version 3** when display settings are present;
**version 2** when only the creating/updating application metadata is
present; **version 1** otherwise. Versions 1–17 are all accepted on read;
an older reader rejects a body version it does not know with a localized
"unsupported version" message rather than misparsing it.

Because two independent things (yaml/text and the cap override) can each
select body version 16 or above, whether the cap-override field is
physically present is **not simply "version >= 16"**: a version-17 file may
carry yaml/text alone, a cap override alone (cap-override-alone always
stays at 16), or both. In practice a version-16 body unconditionally has
the override field (nothing else can ever select exactly 16), and a
version-17 body's presence is carried by a bit in the history flags byte
itself rather than inferred from the version number — see the history
flags row below and "Version history: retained-snapshot cap override".

## Field layout

| Size | Field                                                                                                                                                                                                                                                                                       |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Body version — `17`, `16`, `15`, `14`, `13`, `12`, `11`, `10`, `9`, `8`, `7`, `6`, `5`, `4`, `3`, `2`, or `1` (see selection)                                                                                                                                                               |
| 1    | Delimiter byte: `,` (`0x2C`), `;` (`0x3B`), or TAB (`0x09`)                                                                                                                                                                                                                                 |
| 2    | _(v2+)_ Application-name length, `u16`                                                                                                                                                                                                                                                      |
| …    | _(v2+)_ Application name (UTF-8), e.g. `Refrain Sheet`                                                                                                                                                                                                                                      |
| 2    | _(v2+)_ Application-version length, `u16`                                                                                                                                                                                                                                                   |
| …    | _(v2+)_ Application version (UTF-8), e.g. `0.2.7`                                                                                                                                                                                                                                           |
| 2    | _(v3+)_ Spreadsheet zoom percent, `u16` (`0` = none stored)                                                                                                                                                                                                                                 |
| 4    | _(v3+)_ Column-width entry count `W`, `u32`                                                                                                                                                                                                                                                 |
| …    | _(v3+)_ `W` column-width entries (see below)                                                                                                                                                                                                                                                |
| 1    | _(v5 only)_ Display flags, `u8` (bit 0: wrap long rows)                                                                                                                                                                                                                                     |
| 1    | _(v4+)_ Filter flags, `u8` (bit 0: a filter block follows)                                                                                                                                                                                                                                  |
| …    | _(v4+)_ Filter block (only when bit 0 is set — see below)                                                                                                                                                                                                                                   |
| 2    | _(v6 only)_ IANA timezone-name length, `u16`                                                                                                                                                                                                                                                |
| …    | _(v6 only)_ IANA timezone name (UTF-8), e.g. `Asia/Tokyo`                                                                                                                                                                                                                                   |
| 2    | _(v7 only)_ Display-language length, `u16`                                                                                                                                                                                                                                                  |
| …    | _(v7 only)_ Display-language id (UTF-8): `en` or `ja`                                                                                                                                                                                                                                       |
| 1    | _(v12+)_ Worksheet kind, `u8` (`0` = grid, `1` = markdown, `2` = json, `3` = yaml, `4` = text — `2` legal only from v15, `3`/`4` only from v17 — see below)                                                                                                                                 |
| 1    | _(v13+)_ Worksheet locked, `u8` (`0` = unlocked, `1` = locked — see below)                                                                                                                                                                                                                  |
| 1    | _(v14+)_ History flags, `u8` (bit 0: version history enabled; bit 1: retained-snapshot cap is unlimited, meaningful only when bit 2 is set; bit 2: the cap-override field below is physically present; bit 3: JSON/YAML editors auto-format their source on commit — v17+ only — see below) |
| 4    | _(present exactly when bit 2 above is set)_ Retained-snapshot cap override, `u32` (ignored, written `0`, when bit 1 above is set — see below)                                                                                                                                               |
| 4    | _(v14+)_ Snapshot count `H`, `u32`                                                                                                                                                                                                                                                          |
| …    | _(v14+)_ `H` snapshot records (see below)                                                                                                                                                                                                                                                   |
| 2    | Sheet-name length `N`, `u16`                                                                                                                                                                                                                                                                |
| `N`  | Sheet name (UTF-8)                                                                                                                                                                                                                                                                          |
| 4    | Row count, `u32`                                                                                                                                                                                                                                                                            |
| 4    | Column count, `u32`                                                                                                                                                                                                                                                                         |
| 4    | Cell count `C`, `u32`                                                                                                                                                                                                                                                                       |
| …    | `C` cell records                                                                                                                                                                                                                                                                            |
| 4    | _(v8+)_ Styled-cell count `Y`, `u32`                                                                                                                                                                                                                                                        |
| …    | _(v8+)_ `Y` style records, each with a _(v10 only)_ per-border-style byte and a _(v9 only)_ number-format sub-record (see below)                                                                                                                                                            |
| 4    | _(v11+)_ Commented-cell count `Z`, `u32`                                                                                                                                                                                                                                                    |
| …    | _(v11+)_ `Z` comment records (see below)                                                                                                                                                                                                                                                    |

## Display settings (body version 3)

Non-executable display metadata: the spreadsheet zoom and the user's
overridden column widths. Purely presentational — never affects cell data,
formula evaluation, or CSV export, and contains no executable content,
external URLs, macros, or network references.

Each **column-width entry** is:

| Size | Field                           |
| ---- | ------------------------------- |
| 4    | Column index (0-based), `u32`   |
| 2    | Width in px at 100% zoom, `u16` |

- **Zoom** is a whole percent, valid range **50–200**, stored as `u16`.
  `0` means "no zoom stored". Out-of-range non-zero values are **clamped**
  into the valid range on load (never an error).
- **Column widths** are px at 100% zoom, valid range **40–1200**
  (matching the editor's resize bounds). Out-of-range widths are
  **clamped** on load. Entries whose column index is outside the sheet's
  column count are **dropped**; duplicate entries for the same column
  resolve to the last one.
- **Structural** problems — a truncated display block, or a width-entry
  count larger than the maximum column count — are `bad-shape` errors.

**Precedence:** (1) settings stored in the RSF document win when present
and valid; (2) when the document stores nothing, the application-level
local preference (the most recently used zoom) applies; (3) invalid or
unsupported values fall back safely as described above.

Changing zoom or column widths never marks a document dirty. Plain CSV
files never carry display settings.

## Wrap long rows (body version 5)

A single **display flag** byte carrying the worksheet's "wrap long rows"
state (bit 0). Payload-free and purely presentational; a reader that does
not know the flag stays perfectly byte-aligned. Written only when wrapping
is on. In the workbook container the same state is bit 2 of the
per-worksheet display-flags byte, so no extra byte is needed there.

Wrapping is enabled automatically when a committed cell value contains a
line break. Like zoom and column widths, it never marks the document dirty
on its own; plain CSV never carries it.

## Filter (body version 4)

A **sheet filter**: a saved set of criteria that hides non-matching rows
in the editor. Pure, **non-executable** criteria data — operator
identifiers, plain comparison strings, and numbers only, no expressions,
regular expressions, patterns, external URLs, macros, or code of any kind.
Filtering only ever hides rows **visually**: it never deletes, reorders, or
rewrites cell data, and formula evaluation always uses the normal sheet
model.

The filter block (present only when filter flag bit 0 is set) is:

| Size | Field                                                         |
| ---- | ------------------------------------------------------------- |
| 1    | Header-row flag, `u8` (1 = the range's first row is a header) |
| 4    | Range top row (0-based), `u32`                                |
| 4    | Range left column (0-based), `u32`                            |
| 4    | Range bottom row (0-based), `u32`                             |
| 4    | Range right column (0-based), `u32`                           |
| 2    | Column-filter count `K`, `u16`                                |
| …    | `K` column filters (see below)                                |

Each **column filter** is:

| Size | Field                                                            |
| ---- | ---------------------------------------------------------------- |
| 4    | Column index (0-based), `u32`                                    |
| 1    | Join, `u8` (0 = AND, 1 = OR — how this column's conditions join) |
| 1    | Condition count `M`, `u8`                                        |
| …    | `M` conditions (see below)                                       |
| 1    | Has-value-list flag, `u8` (0 = all values, 1 = list follows)     |
| 2    | _(if list)_ Value count `V`, `u16`                               |
| …    | _(if list)_ `V` length-prefixed UTF-8 strings                    |

Each **condition** is a kind byte (`0` = text, `1` = number), an operator
index, and its operand(s): text conditions carry one length-prefixed UTF-8
string; number conditions carry two little-endian `f64` values (the
second is `NaN` when unused). Text operators are `contains`,
`does not contain`, `equals`, `does not equal`, `begins with`,
`ends with`, `is blank`, `is not blank`; number operators are `=`, `≠`,
`>`, `≥`, `<`, `≤`, and `between`.

Combination semantics: conditions **within a column** combine with that
column's AND/OR join, its selected-value list (when present) is an
additional AND clause, and criteria **across columns** always combine with
AND.

Types, bounds, and validation (all enforced on load):

- Range size ≤ **1,000,000** rows; at most **64** columns carry criteria;
  at most **4** conditions per column; at most **1,000** values per value
  list; each comparison string ≤ **1,024** UTF-16 code units.
- A **structurally** truncated or unreadable filter block is a
  `bad-shape` error.
- A **structurally readable** filter whose contents fail validation
  (range/column indices outside the sheet, duplicate columns, an unknown
  operator or join, or any bound above exceeded) is **ignored** (never
  guessed at): the sheet loads normally without a filter and the
  application shows a localized warning.

Unlike display settings, applying or clearing a filter **is** a document
change, so it is undoable and marks the document dirty. Structural
row/column insertion and deletion clear an active filter as part of the
same atomic, undoable operation. Plain CSV files never carry a filter.

## Timezone (body version 6)

The **workbook timezone**: an IANA zone name (e.g. `Asia/Tokyo`) that
`TODAY()` and `NOW()` are computed in — see
[values.md](values.md#date-serials). Written only when the timezone is not
`UTC`. A new workbook defaults to the browser's local timezone; a workbook
loaded from a file with no stored timezone uses `UTC`. An unresolvable
timezone name is treated the same as absent and falls back to `UTC` — never
a load error. Changing the timezone does not mark the document dirty, but
it does recompute every cached formula result the same way
**Sheet > Recalculate** does.

## Display language (body version 7)

The **workbook display language**: `en` or `ja`, read by `TEXT()`'s
`ddd`/`dddd` weekday-name tokens. Written only when the language is not
`en`. A new workbook defaults to the application's current UI language at
creation time; a workbook loaded from a file with no stored display
language, or an unrecognized value, falls back to `en`. Changing it does
not mark the document dirty but recomputes every cached formula result.
This setting travels with the file independently of the application's own
UI-chrome language toggle.

The application metadata records which build of the software created or
last updated the file (`Refrain Sheet` and the version from
`package.json`, the single authoritative version source) — descriptive
only, never affects interpretation. Application-name and
application-version strings are each capped at 255 bytes.

Each **cell record** is:

| Size | Field                        |
| ---- | ---------------------------- |
| 4    | Row index, `u32`             |
| 4    | Column index, `u32`          |
| 4    | Input byte length `L`, `u32` |
| `L`  | Cell input (UTF-8)           |

Only non-empty cells are stored; every other cell is empty. A cell input
that begins with `=` is a **formula expression**; anything else is a
**literal**. Formulas are evaluated by Refrain's sandboxed engine (no
`eval`, no `new Function`) at display time — never executed during
loading.

## Cell styles (body version 8)

**Cell-level visual formatting**: bold, italic, underline, text color,
background color, and per-side (top/right/bottom/left) borders. Purely
presentational, non-executable data — plain flags and `#rrggbb` colors, no
expressions, macros, external URLs, or code. Never affects a cell's value,
formula evaluation, sort, filter, or CSV export. Written only when at
least one cell carries a style.

The style block is a `u32` styled-cell count `Y` followed by `Y` **style
records**:

| Size | Field                                                      |
| ---- | ---------------------------------------------------------- |
| 4    | Row index, `u32`                                           |
| 4    | Column index, `u32`                                        |
| 2    | Style flags, `u16` (see below)                             |
| 0–18 | One 3-byte RGB triple per color flag bit set, in bit order |

The flags bitfield, low to high: bit 0 bold, bit 1 italic, bit 2
underline, bit 3 text color, bit 4 background color, bit 5 border-top, bit
6 border-right, bit 7 border-bottom, bit 8 border-left. A border side is
"on" exactly when its flag bit is set — every border is a thin solid line
in the given color. Each set color flag contributes one 3-byte RGB triple
(no alpha), in the fixed bit order above, immediately after the flags
field.

Only cells that carry at least one property are stored (the canonical "no
style" form is the absence of a record). Row/column indices are validated
against the sheet's already-known dimensions — out of range is
`bad-shape`; a count above what the grid could possibly hold is
`too-large`. A structurally truncated style block is `bad-shape`.

Applying or clearing cell formatting **is** a document change, so it is
undoable and marks the document dirty — unlike zoom, column widths, or
wrap. Row/column insertion/deletion reindex styled cells along with the
data they were applied to; a deleted row or column's styles are dropped
along with its data. Plain CSV files never carry cell styles.

## Number format (body version 9)

A **numeric display format** per cell: a kind (number/percent/currency), a
fixed decimal-place count, an optional thousands separator, and — for
currency — a symbol. Purely presentational: changes how a number-typed
formula result is displayed, never the cell's underlying value, formula
evaluation, sort/filter order, or CSV/XLSX export. Written only when at
least one cell carries a number format.

The number-format sub-record is appended to **every** style record once
body version 9 is selected (even a styled cell with no number format
writes its "none" kind byte), immediately after that record's color
bytes:

| Size | Field                                                      |
| ---- | ---------------------------------------------------------- |
| 1    | Kind byte: `0` none, `1` number, `2` percent, `3` currency |
| 1    | _(kind ≠ 0)_ Decimal places, `u8`, `0`–`10`                |
| 1    | _(kind ≠ 0)_ Flags, `u8` (bit 0: thousands separator)      |
| 1    | _(kind = 3 only)_ Currency-symbol byte length `Z`, `u8`    |
| `Z`  | _(kind = 3 only)_ Currency symbol (UTF-8)                  |

A kind byte outside `0`–`3` makes the rest of the record's length
unknowable, so it is rejected as `bad-shape` rather than guessing how many
bytes to skip — the reject-don't-guess policy applied everywhere in this
format. Decimal places above `10` and a currency symbol longer than 4
UTF-16 code units are rejected by the editor before they can be saved
(`MAX_NUMBER_FORMAT_DECIMALS`, `MAX_CURRENCY_SYMBOL_LENGTH`), and are
clamped/truncated on load as defense-in-depth against a hand-edited or
future-version file.

Changing a cell's number format is a document change, so it is undoable
and marks the document dirty. Plain CSV files never carry number formats.

## Cell comments (body version 11)

**Cell comments**: a short free-text annotation attached to one cell,
independent of its value. Purely an annotation — plain UTF-8 text, no
expressions, macros, external URLs, or code. Never affects a cell's value,
formula evaluation, sort, filter, or CSV export. Written only when at
least one cell carries a comment.

The comment block is a `u32` commented-cell count `Z` followed by `Z`
**comment records**:

| Size | Field                               |
| ---- | ----------------------------------- |
| 4    | Row index, `u32`                    |
| 4    | Column index, `u32`                 |
| 4    | Comment-text byte length `L`, `u32` |
| `L`  | Comment text (UTF-8)                |

Row/column indices are validated against the sheet's already-known
dimensions — out of range is `bad-shape`; a count above what the grid
could possibly hold, or a single comment's declared length above a
generous byte ceiling (`MAX_RSF_COMMENT_BYTES`, three bytes per UTF-16
code unit of the editor's own `MAX_COMMENT_LENGTH` cap), is `too-large`. A
structurally truncated comment block is `bad-shape`.

Setting or clearing a comment **is** a document change, so it is undoable
and marks the document dirty. Row/column insertion/deletion reindex
commented cells along with the data; a deleted row or column's comments
are dropped along with its data. Plain CSV files never carry cell
comments.

## Worksheet kind (body version 12)

A **worksheet kind** byte: `0` (grid, the default and every worksheet
before this field existed) or `1` (markdown — a worksheet whose entire
content is one Markdown document, edited by a docked source/preview
surface in the spreadsheet area instead of the grid). Written only when
the worksheet is a markdown sheet. A byte outside `0`/`1` is rejected as
`bad-shape` rather than guessed at.

A markdown worksheet's document text is **not** a new storage shape: it is
the raw UTF-8 input of the worksheet's one and only cell, `(0, 0)`, using
the ordinary cell-record encoding above. A markdown worksheet is required
to be exactly **1 row × 1 column** with **at most one cell record**; any
other declared shape is `bad-shape`. This is what lets editing a markdown
sheet's text reuse the exact same atomic, undoable cell-edit path
(`HistoryEntry`) a grid cell edit uses. A markdown worksheet never carries
a filter, cell styles, comments, or a sort in practice, and its cell is
never evaluated as a formula regardless of what it starts with — but the
container does not special-case or forbid those sections structurally, so
a hand-edited or future-version file that does carry one still round-trips
without corrupting the container. A markdown worksheet is **excluded from
CSV export** and its cell remains an ordinary, cross-sheet-referenceable
cell to the formula engine (`OtherSheet!A1` reads a markdown sheet's raw
source as a text value).

Unlike the reversible degrade some prior sections describe, a workbook
using a markdown worksheet writes container-level body version 12 (or
workbook body version 8 — see [grammar-workbook-body.md](grammar-workbook-body.md)),
which an older release rejects outright with the standard "unsupported
version" message: **compatibility is preserved by never raising the
version for a workbook that has no markdown worksheet**, not by making a
version-12 file still openable by an older release.

## Worksheet locked (body version 13)

A **worksheet locked** byte: `0` (unlocked, the default) or `1` (locked).
Written only when the worksheet is locked. A byte outside `0`/`1` is
rejected as `bad-shape`.

A worksheet's lock is a plain, non-cryptographic protection flag — no
password, no key material. Locking a worksheet blocks that worksheet's own
cell edits and structural changes (`src/app/app-state.ts`'s
`refuseLockedSheetWrite`, the same mutation-gating mechanism `Tab.readOnly`
uses, scoped to one worksheet); every other worksheet stays editable.
Toggling the lock is not itself undoable but is persisted in the saved
container. No effect on cell data, formula evaluation, sorting, filtering,
or CSV export.

Like the worksheet-kind byte, a workbook with a locked worksheet writes
container-level body version 13 (or workbook body version 9): compatibility
is preserved by never raising the version for a workbook with no locked
worksheet.

## Version history (body version 14)

**Version (snapshot) history**: a per-file, on-by-default setting
(**Sheet > File Version History…**) that records a snapshot of the file's
content every time it saves successfully. Unlike a version-3 body's
display settings, this **is** part of the saved file, but like the RSF
body itself it stores no executable content — a snapshot is exactly the
same inert cell/style/formula data the live document itself stores.

The history block (base shape; version 16 extends it — see "Version
history: retained-snapshot cap override" — and that extended shape carries
through unchanged at version 17) is:

| Size | Field                                                |
| ---- | ---------------------------------------------------- |
| 1    | History flags, `u8` (bit 0: version history enabled) |
| 4    | Snapshot count `H`, `u32`                            |
| …    | `H` snapshot records, oldest first (see below)       |

Each **snapshot record** is:

| Size | Field                               |
| ---- | ----------------------------------- |
| 8    | Timestamp, `f64` ms since epoch     |
| 4    | Snapshot byte length `L`, `u32`     |
| `L`  | Snapshot bytes (opaque — see below) |

A snapshot's bytes are an **opaque, headerless body encoding** — the same
shape this section's own container body has, with no history section of
its own. Because a snapshot never carries a nested history list, history
cannot grow recursively. The block itself does not record whether a given
snapshot was encoded in the single-sheet or workbook body shape; the
Restore action decodes one by trying the single-sheet decoder first,
falling back to the workbook decoder — both fully validate their shape,
including an exact-length final check.

Both the flags byte and the count are always written once version 14 is
selected — even a file with history disabled and no snapshots yet still
writes the (empty) block. The history section is written (forcing body
version 14 or higher) whenever version history is **disabled** (the
non-default choice) **or** at least one snapshot is recorded.

Retention is bounded: at most **20** snapshots are kept per file by
default (`DEFAULT_HISTORY_SNAPSHOT_LIMIT`), overridable per file (see
below); once a save would exceed the applicable cap, the oldest snapshot
is dropped first. This is a write-time policy enforced by `RsfDocument`,
not the codec itself — a reader still enforces an absolute ceiling
independently: a stored snapshot count above it
(`MAX_RSF_HISTORY_SNAPSHOTS`, 500) is `too-large`, and a single snapshot's
declared byte length above the decompression ceiling
(`MAX_RSF_BODY_BYTES`, 512 MiB) is `too-large` too.

Snapshots are stored **inside the same compressed body** as the file's
current content, not compressed independently — this lets the file's
chosen compression method exploit the redundancy between a snapshot and
the live content it was taken from.

Turning version history off stops recording _new_ snapshots but never
deletes the ones already recorded — clearing them is the separate,
explicitly confirmed **Sheet > Clear Version History** action. Both
changes are persisted in the saved container and mark the document as
having unsaved changes, but alter no cell input, so neither is pushed onto
the undo/redo history and neither invalidates the evaluation memo. Plain
CSV files never carry version history.

Like the worksheet-kind and worksheet-locked bytes, a file using version
history writes container-level body version 14 (or workbook body version
10): compatibility is preserved by never raising the version for a file
with history disabled and no recorded snapshots. Because history is on by
default, a file saved by a release that has this feature will, in
practice, almost always be a version-14 (or workbook version-10) file
after its first save.

## Worksheet kind: json (body version 15)

Allows the worksheet-kind byte to hold a third value, `2` (json — a
worksheet whose entire content is one JSON document, edited by a docked
source/preview surface with a syntax-highlighted preview and an explicit
"Format" pretty-print action, in place of the grid). Does not add a new
byte to the layout — the worksheet-kind byte is already written from body
version 12 — it only widens which values are legal for that existing
byte, and only from this version: a `2` byte in a body version 12–14 file
is rejected as `bad-shape` there, not misread as json.

A json worksheet's document text is stored exactly like a markdown
worksheet's, required to be exactly **1 row × 1 column** with **at most
one cell record**. It reuses the same atomic, undoable cell-edit path, is
never evaluated as a formula, is excluded from CSV export, and its cell
remains an ordinary, cross-sheet-referenceable cell — all identical to the
markdown worksheet's behavior, just for JSON content.

A workbook using a json worksheet writes container-level body version 15
(or workbook body version 11): compatibility is preserved by never raising
the version for a workbook that has no json worksheet.

Standalone (non-RSF-container) editing of JSON/YAML/plain-text files
remains tracked as follow-up work (issue #529), independent of the
in-workbook `yaml`/`text` worksheet kinds below.

## Version history: retained-snapshot cap override (body version 16)

Extends the version-history block with a per-file override of the
retained-snapshot cap: the default (20) can be raised to a custom number
or set to unlimited. This is the feature's own, original version number,
shipped in v0.8.3 before the yaml/text worksheet kind existed — it is
never renumbered, since real files already on disk have this exact body
version meaning "the cap-override field follows". Two bits are added to
the history flags byte (bit 0 unchanged): bit 1 means "the cap override is
unlimited" (meaningful only when bit 2 is set), and bit 2 means "the
cap-override `u32` field below is physically present":

| Size | Field                                                                                                                       |
| ---- | --------------------------------------------------------------------------------------------------------------------------- |
| 1    | History flags, `u8` (bit 0: version history enabled; bit 1: cap override is unlimited; bit 2: cap-override field follows)   |
| 4    | _(present exactly when bit 2 above is set)_ Retained-snapshot cap override, `u32` (ignored, written `0`, when bit 1 is set) |
| 4    | Snapshot count `H`, `u32`                                                                                                   |
| …    | `H` snapshot records, oldest first (identical layout to body version 14's own)                                              |

(A later addition, "Auto-format source on commit" below, defines bit 3 of
this same flags byte — introduced at body version 17 — leaving this
table's bits 0–2 unchanged.)

The cap-override field is validated on read into
`[1, MAX_RSF_HISTORY_SNAPSHOTS]` (`bad-shape` outside that range) whenever
bit 1 is clear; bit 1 set means "unlimited" and the field's value is
ignored. Absent means "use the default". "Unlimited" is still bounded in
practice by the absolute ceiling `MAX_RSF_HISTORY_SNAPSHOTS` (500), which
every writer and reader enforces regardless of a file's own cap.

Bit 2's presence is deliberately **self-describing** rather than inferred
purely from the body version: the yaml/text worksheet kind (below) was
added _after_ this feature had already shipped, and needed a still-higher
version tier (17) of its own — meaning a version-17 file can independently
carry yaml/text, a cap override, or both, and the version number alone can
no longer say which. Presence is resolved as: **body version exactly
16** unconditionally means the field is present (nothing other than a cap
override can ever select exactly that version); **body version 17 or
above** reads bit 2 to decide. This section is written (forcing at least
body version 16) only when a file actually carries a cap override — the
default (20, unset) keeps the file on the lowest sufficient body version
(14 or 15).

## Worksheet kind: yaml and text (body version 17)

Allows the worksheet-kind byte to hold a fourth or fifth value: `3` (yaml
— a worksheet whose entire content is one YAML document, edited the same
way a json worksheet is, with a syntax-highlighted preview and an explicit
"Format" pretty-print action powered by the `yaml` package) or `4` (text —
a worksheet holding unstructured plain text, with no preview panel and no
Format action, since there is nothing to render or pretty-print). Like
`json` before it, no new byte is added — only a widening of which values
are legal for the existing byte, from this version: a `3` or `4` byte in a
body version 12–16 file is rejected as `bad-shape` there.

This version sits _above_ the cap override (16) rather than sharing or
displacing it, because yaml/text was added after the cap-override feature
had already shipped (v0.8.3) at that version number.

A yaml or text worksheet's document text is stored exactly like a markdown
or json worksheet's, required to be exactly **1 row × 1 column** with **at
most one cell record**. Both reuse the same atomic, undoable cell-edit
path, are never evaluated as a formula, are excluded from CSV export, and
their cell remains an ordinary, cross-sheet-referenceable cell — all
identical to the markdown and json worksheets' behavior, just for YAML or
unstructured text content.

A workbook using a yaml or text worksheet writes container-level body
version 17 (or workbook body version 13): compatibility is preserved by
never raising the version for a workbook that has no yaml or text
worksheet.

## Auto-format source on commit (body version 17)

Adds bit 3 to the history flags byte: whether the JSON and YAML worksheet
editors auto-format their source in place when an edit commits, a
per-file setting from a checkbox in each editor's toolbar, off by default.
Does not add a new byte to the layout — the history flags byte already
exists from body version 14 — it only defines a bit that was previously
always zero, with no legacy-version special case: this flag has no
pre-existing shipped meaning to preserve, so a reader always resolves it
straight from the bit, at any body version 14 or above. It shares body
version 17 with the yaml/text worksheet kind for the same reason: it was
added after the container's version history already existed at lower
tiers, and there is no lower tier it can safely reuse.

Turning this on never formats existing content by itself and never runs on
save — only a live edit's commit triggers it; invalid input is left
untouched and its parse error reported, exactly like the explicit "Format"
button. This does not contradict issue #529's "never automatic" decision —
that was about the _default_, which stays off.

**Sheet > File Version History…** also lists every recorded snapshot with
a Restore action, which replaces the file's current worksheets/cells/styles
with a chosen snapshot's content. Restoring changes no body version or
layout by itself — it is an ordinary content mutation, marking the
document dirty exactly like any other edit — and is not itself undoable
via the regular undo/redo stack; a confirmation is shown first.

## Bounds (validated on load)

| Limit                 | Value        |
| --------------------- | ------------ |
| Max rows              | `2,000,000`  |
| Max columns           | `16,384`     |
| Max cells (rows×cols) | `20,000,000` |
| Max cell input length | `1,000,000`  |

The row/column of every cell record must be in range, the input length
within the per-cell limit, the cell count no greater than `rows × cols`,
and the body must be consumed exactly (no trailing bytes). Any violation
is `bad-shape` (or `too-large` for the size limits).
