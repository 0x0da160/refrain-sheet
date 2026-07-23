# Refrain Sheet Format (RSF) — the `.rsf` binary container

**Refrain Sheet Format (RSF)** is the dedicated spreadsheet document format used
by **Refrain Sheet**, saved with the `.rsf` extension. It carries formulas,
structural editing intent, and per-document metadata that plain CSV cannot
represent without breaking Refrain Sheet's byte-for-byte CSV preservation
guarantee. RSF is a versioned, compressed binary container — **not** a JSON
document, **not** a plain/standard CSV file, and **not** a byte-identical
representation of an imported CSV. When a CSV is converted to a spreadsheet
(explicitly, by the user), saving it produces an `.rsf` file; the original
`.csv` on disk is never touched, and plain CSV files keep their byte-preserving
guarantees until conversion.

> **Naming.** This format was previously called **Refrain CSV Format (RCSV)**
> and used the `.rcsv` extension. Only the name, extension, magic bytes, and
> container version changed; the on-disk structure is otherwise identical. See
> [Versioning and compatibility](#versioning-and-compatibility) for how legacy
> `.rcsv` files are read.

This document specifies the container so the format is auditable and other tools
can read or write it. The reference implementation lives in
[`src/core/rsf-codec.ts`](../src/core/rsf-codec.ts) (framing) and
[`wasm/src/compress.rs`](../wasm/src/compress.rs) (compression + checksum).

## Design goals

- **Inert data only.** The file contains cell inputs and small metadata — no
  executable code, macros, external references, or network URLs. Loading
  validates and never executes anything.
- **Integrity.** A CRC-32 checksum over the uncompressed body detects
  corruption before the document is trusted.
- **Bounded decompression.** The uncompressed body length is stored in the
  header and enforced as an allocation ceiling, so a crafted "decompression
  bomb" cannot exhaust memory.
- **Versioned.** A magic number plus explicit container and body version bytes
  let future revisions be detected and rejected cleanly rather than
  misinterpreted.
- **Self-contained runtime.** Every compression codec is implemented in
  **pure Rust** and compiled to WebAssembly that is embedded in the app as
  Base64 — never fetched — so the editor works from a `file://` page with no
  network, no C/C++ toolchain, and no server-side compression service.

## Compression methods

The container records a one-byte compression method. All three real codecs are
pure Rust and build for `wasm32-unknown-unknown` with no C toolchain:

| Value  | Method    | Crate         | Role                                                        |
| ------ | --------- | ------------- | ----------------------------------------------------------- |
| `0x00` | `store`   | —             | Uncompressed. Explicit debugging / interoperability option. |
| `0x01` | `deflate` | `miniz_oxide` | Raw DEFLATE (RFC 1951). Compatibility fallback.             |
| `0x02` | `zstd`    | `ruzstd`      | Zstandard. **Default** for new documents.                   |
| `0x03` | `lz4`     | `lz4_flex`    | LZ4 Frame. Speed-priority option.                           |

Method ids `0x80`–`0xFF` are reserved for future or experimental extensions.

### Default policy

- New RSF documents and CSV→RSF conversions default to **Zstandard** (`0x02`).
  It is never the uncompressed `store` method.
- Zstandard uses a moderate level: `ruzstd`’s encoder implements the `Fastest`
  level (≈ zstd level 1); its higher levels are not yet implemented, so
  `Fastest` is the level written. The output is a conformant Zstandard frame
  readable by any compliant decoder.
- **LZ4 Frame** is offered as an explicit speed-priority option, optimized for
  fast saving and opening; its files may be larger than Zstandard.
- **DEFLATE** is the compatibility fallback. It is chosen automatically only
  when Zstandard cannot be used in the current build.
- Saving an **existing** RSF document preselects and preserves that file’s
  method; the method is never changed silently by a normal save. Choosing a
  different method in the Save dialog rewrites the container but changes no
  logical content (cell values, formulas, structure, or metadata) other than
  normal save timestamps and the updater version.
- A method the current build cannot use is not offered, and a document written
  with an unavailable/unsupported method fails safely with a localized message
  rather than being guessed at or reinterpreted.

> **Why `ruzstd`, not the `zstd` crate?** The Refrain WASM core targets
> `wasm32-unknown-unknown`, which has no C toolchain; the `zstd` crate’s
> `zstd-sys` C bindings do not build there. `ruzstd` is a dependency-light,
> pure-Rust Zstandard encoder **and** decoder that compiles cleanly to WASM, so
> Zstandard can be the real default with no native code.

### Save dialog

The RSF Save dialog (File → Save with Options…) offers exactly these localized
choices, in English and Japanese:

| Label                     | Method | Description                                          |
| ------------------------- | ------ | ---------------------------------------------------- |
| `Zstandard (Recommended)` | `0x02` | Balanced ratio and speed; the default choice.        |
| `LZ4 Frame (Fast)`        | `0x03` | Prioritizes fast saving/opening; may be larger.      |
| `DEFLATE (Compatible)`    | `0x01` | Compatibility fallback when Zstandard is unsuitable. |
| `None (Uncompressed)`     | `0x00` | No compression; debugging/interoperability only.     |

Only methods actually bundled and usable in the current build are shown. The
selected method is displayed in the status bar. Compression runs in the embedded
WASM codec behind the app’s loading indicator (localized phase label with a
percentage for the serialize phase); on cancellation or failure the in-memory
document is preserved and no partial file is written.

When the WebAssembly engine is unavailable (rare — it is embedded and normally
always loads), the JavaScript fallback writes `store` and can only read `store`;
reading any compressed file requires the WASM engine.

## Container layout

All multi-byte integers are **little-endian**. The header is a fixed 20 bytes,
followed by the (possibly compressed) body payload.

| Offset | Size | Field                                                     |
| ------ | ---- | --------------------------------------------------------- |
| 0      | 4    | Magic bytes `RSF1` (`0x52 0x53 0x46 0x31`)                |
| 4      | 1    | Container version — `3` (one worksheet) or `4` (workbook) |
| 5      | 1    | Compression method (`0x00`–`0x03`; see above)             |
| 6      | 1    | Flags (reserved, must be `0`)                             |
| 7      | 1    | Codec profile version (must be `0`)                       |
| 8      | 4    | Uncompressed body length, `u32`                           |
| 12     | 4    | CRC-32 (IEEE 802.3) of the uncompressed body, `u32`       |
| 16     | 4    | Compressed payload length, `u32`                          |
| 20     | …    | Payload (the body, compressed per the method byte)        |

A reader must reject the file when: the length is under 20 bytes or the magic
matches neither `RSF1` nor the legacy `RCSV` (`bad-magic`); the container
version does not match its magic — `3` or `4` for `RSF1`, `2` for legacy `RCSV`
(`bad-version`); the method byte is not a defined method `0x00`–`0x03`, or the
codec profile byte is non-zero (`unsupported-compression`); the stored body
length exceeds the ceiling (`too-large`); or `20 + payloadLength` does not equal
the file length (`bad-shape`). After decompression, the CRC-32 must match
(`checksum`).

Every decompressor is bounded by the stored uncompressed length as an
allocation ceiling, so a crafted decompression bomb, malformed frame, or
truncated payload is rejected before it can exhaust memory. CRC-32 detects
**accidental** corruption only — it is not cryptographic tamper protection.

The decompression ceiling (`MAX_RSF_BODY_BYTES`) is **512 MiB**.

## Workbooks and worksheets

An RSF document is a **workbook** holding one or more **worksheets**. Each
worksheet owns its grid data, formulas, row/column structure, filter, and
display settings; the workbook owns the metadata shared by all of them
(delimiter, application name/version, timestamps, document identifier,
compression choice, worksheet order, and which worksheet is active).

Two container versions encode this, and which one is written depends only on
how many worksheets the workbook actually holds:

| Worksheets | Container version | Body                                     |
| ---------- | ----------------- | ---------------------------------------- |
| exactly 1  | `3`               | the single-sheet body (below), unchanged |
| 2 or more  | `4`               | the workbook body (below)                |

This keeps the common case maximally compatible: a workbook that never uses a
second worksheet is byte-for-byte the same kind of file earlier releases wrote
and read. A workbook that _does_ use multiple worksheets is a version-4
container, which older readers reject as `bad-version` (they validate the
magic/version pair) instead of misparsing it — the reject-don't-guess policy.

### Worksheet identity

Every worksheet has a **stable internal identifier** that is separate from its
mutable display name. The identifier never changes — not when the worksheet is
renamed, moved, or when other worksheets are added or removed — so the active
worksheet reference and any internal bookkeeping stay valid across renames.
Identifiers must be unique within a workbook; a duplicate is `bad-shape`.

The **display name** is what users see on the worksheet tab and what cross-sheet
formulas write (`Sheet1!A1`). Names are trimmed, at most **100 characters**,
unique within the workbook **case-insensitively**, and may not contain C0
control characters or any of `: \ / ? * [ ]` — the characters that would
conflict with formula-reference or file-path syntax. A name is never
interpreted as HTML, a formula, a URL, or code anywhere in the application.
Single quotes _are_ allowed and are escaped by doubling inside a quoted
reference (`'O''Brien'!A1`).

### Single-sheet containers have no worksheet identifier

A version-3 container stores a sheet _name_ but no identifier. When one is
read, a stable identifier is minted in memory so the whole application works
against one model. Because a single-worksheet workbook is written back as a
version-3 container, that minted identifier is not persisted — which is
harmless, since a file with one worksheet has no cross-sheet references and
nothing else keys off the identifier.

## Body layout

The body is a compact binary encoding of one sheet. All strings are UTF-8.

Version selection on write is minimal so older readers keep working where
possible: body **version 5** is written only when wrap-long-rows is stored;
**version 4** when a sheet filter is present; **version 3** when display
settings are present; **version 2** when only the creating/updating application
metadata is present; **version 1** otherwise. Versions 1–5 are all accepted on
read; an older reader rejects a body version it does not know with a localized
"unsupported version" message rather than misparsing it.

| Size | Field                                                       |
| ---- | ----------------------------------------------------------- |
| 1    | Body version — `5`, `4`, `3`, `2`, or `1` (see selection)   |
| 1    | Delimiter byte: `,` (`0x2C`), `;` (`0x3B`), or TAB (`0x09`) |
| 2    | _(v2+)_ Application-name length, `u16`                      |
| …    | _(v2+)_ Application name (UTF-8), e.g. `Refrain Sheet`      |
| 2    | _(v2+)_ Application-version length, `u16`                   |
| …    | _(v2+)_ Application version (UTF-8), e.g. `0.2.7`           |
| 2    | _(v3+)_ Spreadsheet zoom percent, `u16` (`0` = none stored) |
| 4    | _(v3+)_ Column-width entry count `W`, `u32`                 |
| …    | _(v3+)_ `W` column-width entries (see below)                |
| 1    | _(v5 only)_ Display flags, `u8` (bit 0: wrap long rows)     |
| 1    | _(v4+)_ Filter flags, `u8` (bit 0: a filter block follows)  |
| …    | _(v4+)_ Filter block (only when bit 0 is set — see below)   |
| 2    | Sheet-name length `N`, `u16`                                |
| `N`  | Sheet name (UTF-8)                                          |
| 4    | Row count, `u32`                                            |
| 4    | Column count, `u32`                                         |
| 4    | Cell count `C`, `u32`                                       |
| …    | `C` cell records                                            |

### Display settings (body version 3)

Body version 3 adds **non-executable display metadata**: the spreadsheet zoom
and the user's overridden column widths. It is purely presentational — it
never affects cell data, formula evaluation, or CSV export, and it contains
no executable content, external URLs, macros, or network references.

Each **column-width entry** is:

| Size | Field                           |
| ---- | ------------------------------- |
| 4    | Column index (0-based), `u32`   |
| 2    | Width in px at 100% zoom, `u16` |

Types, units, ranges, defaults, and validation:

- **Zoom** is a whole percent, valid range **50–200**, stored as `u16`. The
  value `0` means "no zoom stored". Out-of-range non-zero values are
  **clamped** into the valid range on load (never an error).
- **Column widths** are px at 100% zoom, valid range **40–1200** (matching
  the editor's resize bounds). Out-of-range widths are **clamped** on load.
  Entries whose column index is outside the sheet's column count are
  **dropped**; duplicate entries for the same column resolve to the last one.
  Only overridden columns are stored — absent columns use the default width.
- **Structural** problems — a truncated display block, or a width-entry count
  larger than the maximum column count — are `bad-shape` errors (the file is
  rejected like any other malformed container, before any allocation is made
  from the invalid count).

**Precedence** (also applied by the reference implementation):

1. Settings stored in the RSF document win when present and valid.
2. When the document stores nothing, the application-level local preference
   (the most recently used zoom) applies.
3. Invalid or unsupported values fall back safely as described above.

Changing zoom or column widths never marks a document dirty; the current
values are recorded into the container whenever the document is saved. Plain
CSV files never carry display settings — for CSV documents zoom is an
application-level local preference only.

### Wrap long rows (body version 5)

Body version 5 adds a single **display flag** byte carrying the worksheet's
"wrap long rows" state (bit 0). It is payload-free and purely presentational —
it never affects cell data, formula evaluation, or export — and, because it
carries no length or data of its own, a reader that does not know the flag stays
perfectly byte-aligned. The flag is written only when wrapping is on, so a
worksheet that does not use it stays a version-4-or-lower body. In the workbook
container (below) the same state is bit 2 of the per-worksheet display-flags
byte, so no extra byte is needed there.

Wrapping is enabled automatically when a committed cell value contains a line
break (see the README). Like zoom and column widths, it never marks the document
dirty on its own and is recorded whenever the document is saved; plain CSV never
carries it (wrapping is an application-level view preference for CSV).

### Filter (body version 4)

Body version 4 adds a **sheet filter**: a saved set of criteria that hides
non-matching rows in the editor. It is pure, **non-executable** criteria data
— operator identifiers, plain comparison strings, and numbers only. It
contains no expressions, regular expressions, patterns, external URLs, macros,
or code of any kind, and filtering only ever hides rows **visually**: it never
deletes, reorders, or rewrites cell data, and formula evaluation always uses
the normal sheet model.

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
string; number conditions carry two little-endian `f64` values (the second is
`NaN` when unused, e.g. for a single-bound comparison). Text operators are
`contains`, `does not contain`, `equals`, `does not equal`, `begins with`,
`ends with`, `is blank`, `is not blank`; number operators are `=`, `≠`, `>`,
`≥`, `<`, `≤`, and `between`.

Combination semantics: conditions **within a column** combine with that
column's AND/OR join, its selected-value list (when present) is an additional
AND clause, and criteria **across columns** always combine with AND.

Types, bounds, and validation (all enforced on load):

- Range size ≤ **1,000,000** rows; at most **64** columns carry criteria; at
  most **4** conditions per column; at most **1,000** values per value list;
  each comparison string ≤ **1,024** UTF-16 code units.
- A **structurally** truncated or unreadable filter block is a `bad-shape`
  error, exactly like any other malformed container region.
- A **structurally readable** filter whose contents fail validation — range or
  column indices outside the sheet, duplicate columns, an unknown operator or
  join, or any bound above exceeded — is **ignored** (never guessed at): the
  sheet loads normally without a filter and the application shows a localized
  warning. This keeps a malformed or unsupported filter from ever corrupting or
  rejecting the document itself.

Unlike display settings, applying or clearing a filter **is** a document change
(it is part of the saved file), so it is undoable and marks the document dirty.
Structural row/column insertion and deletion clear an active filter as part of
the same atomic, undoable operation (the stored range would otherwise drift).
Plain CSV files never carry a filter — filtering requires converting to RSF.

The application metadata records which build of the software created or last
updated the file (`Refrain Sheet` and the version from
[`package.json`](../package.json), the single authoritative version source). It
is descriptive only and never affects how the sheet is interpreted. The
application-name and application-version strings are each capped at 255 bytes.

Each **cell record** is:

| Size | Field                        |
| ---- | ---------------------------- |
| 4    | Row index, `u32`             |
| 4    | Column index, `u32`          |
| 4    | Input byte length `L`, `u32` |
| `L`  | Cell input (UTF-8)           |

Only non-empty cells are stored; every other cell is empty. A cell input that
begins with `=` is a **formula expression**; anything else is a **literal**.
Formulas are evaluated by Refrain's sandboxed engine (no `eval`, no
`new Function`) at display time — they are never executed during loading.

### Bounds (validated on load)

| Limit                 | Value        |
| --------------------- | ------------ |
| Max rows              | `2,000,000`  |
| Max columns           | `16,384`     |
| Max cells (rows×cols) | `20,000,000` |
| Max cell input length | `1,000,000`  |

The row/column of every cell record must be in range, the input length within
the per-cell limit, the cell count no greater than `rows × cols`, and the body
must be consumed exactly (no trailing bytes). Any violation is `bad-shape` (or
`too-large` for the size limits).

## Workbook body layout (container version 4)

Written only when the workbook holds **two or more** worksheets. All strings
are UTF-8 and length-prefixed with a `u16`; all integers are little-endian.

| Size | Field                                                           |
| ---- | --------------------------------------------------------------- |
| 1    | Workbook body version — currently `1`                           |
| 1    | Delimiter byte: `,` (`0x2C`), `;` (`0x3B`), or TAB (`0x09`)     |
| 2+…  | Application name (UTF-8, `u16` length; may be empty)            |
| 2+…  | Application version (UTF-8, `u16` length; may be empty)         |
| 8    | Creation timestamp, `f64` ms since epoch (`0` = not stored)     |
| 8    | Last-update timestamp, `f64` ms since epoch (`0` = not stored)  |
| 2+…  | Workbook identifier (UTF-8, `u16` length; may be empty)         |
| 2+…  | Active worksheet identifier (UTF-8, `u16` length; may be empty) |
| 2    | Worksheet count `S`, `u16`                                      |
| …    | `S` worksheet records (below)                                   |

Each worksheet record:

| Size | Field                                                             |
| ---- | ----------------------------------------------------------------- |
| 2+…  | Worksheet identifier (UTF-8, `u16` length; must be non-empty)     |
| 2+…  | Worksheet display name (UTF-8, `u16` length)                      |
| 4    | Row count, `u32`                                                  |
| 4    | Column count, `u32`                                               |
| 4    | Cell count `C`, `u32`                                             |
| …    | `C` cell records: row `u32`, column `u32`, length `u32`, bytes    |
| 1    | Display flags, `u8` (bit 0: zoom; bit 1: widths; bit 2: wrap)     |
| 2    | _(bit 0)_ Zoom percent, `u16`                                     |
| 4    | _(bit 1)_ Column-width entry count `W`, `u32`                     |
| …    | _(bit 1)_ `W` entries: column `u32`, width px at 100% zoom `u16`  |
| 1    | Filter flags, `u8` (bit 0: a filter block follows)                |
| …    | _(bit 0)_ Filter block — identical layout to the single-sheet one |

Cells are stored **sparsely**: only non-empty cells are written.

### Workbook bounds

Beyond the per-worksheet limits (which are the same as for a single-sheet body),
a workbook container enforces:

| Limit                                      | Value      |
| ------------------------------------------ | ---------- |
| Worksheets per workbook                    | 256        |
| Worksheet identifier / name (stored bytes) | 400        |
| Cells summed across **all** worksheets     | 20,000,000 |

The worksheet count is validated **before** any worksheet is allocated, each
worksheet's declared dimensions are validated before its cells are read, and the
cell budget is accumulated across worksheets — so a container cannot multiply
its way past the ceiling by declaring many worksheets. A worksheet count of `0`
is `bad-shape` (a workbook always has at least one worksheet); a count above the
limit is `too-large`. Duplicate worksheet identifiers are `bad-shape`. An active
worksheet identifier that names no worksheet is not an error: it falls back to
the first worksheet, so a partially-stale file still opens predictably. As with
the single-sheet body, the body must be consumed exactly — trailing bytes are
`bad-shape`.

## Cross-sheet formula references

A formula may reference another worksheet of the same workbook:

```text
Sheet1!A1        Sheet1!A1:B10      Sheet1!$A$1
'Quarter 1'!A1   'Quarter 1'!$A$1:$B10
SUM(Sheet1!A1:A10)
```

- The worksheet name is written bare when it reads as a plain identifier, and
  single-quoted otherwise; a literal single quote inside the name is doubled
  (`'O''Brien'!A1`).
- An **unqualified** reference always means the current worksheet.
- Relative, absolute, and mixed (`$`) references behave exactly as they do
  within one worksheet; the `$` markers survive every rewrite.
- Both endpoints of a range belong to the qualifying worksheet. A second
  qualifier inside a range (`Sheet1!A1:Sheet2!B2`, a "3D" range) is
  **deliberately unsupported** and resolves to `#ERROR!` rather than being
  guessed at.
- A reference to a worksheet that does not exist evaluates to `#REF!` and is
  never redirected to a different worksheet.
- Circular references are detected **across** worksheets (`#CYCLE!`), because
  the workbook owns one shared evaluation memo and in-progress set.

### What happens to formulas when worksheets change

| Change                           | Effect on formulas                                                                                                                                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Worksheet **renamed**            | Every reference to it is rewritten to the new name (re-quoted as needed); results unchanged.                                                                                                                  |
| Worksheet **deleted**            | Every reference to it becomes `#REF!`. Never silently redirected.                                                                                                                                             |
| Worksheet **duplicated**         | Cell inputs are copied verbatim: **qualified** references still name the worksheets they named; **unqualified** references stay relative to the copy.                                                         |
| Rows/columns inserted or deleted | References adjust on the edited worksheet _and_ in `Name!`-qualified references to it from every other worksheet. A formula's own unqualified references are never moved by an edit on a different worksheet. |

Each of these is one atomic, undoable history entry: the structural change and
every formula rewrite it implies undo and redo together.

## Versioning and compatibility

This is container **version 3** (one worksheet) or **version 4** (workbook),
both written with the magic `RSF1`.

### Lossy CSV → RSF conversion

Converting a CSV document to RSF is an **explicit, lossy** operation: it moves
from the byte-preserving CSV mode (which round-trips delimiters, quoting,
whitespace, line endings, encodings, BOMs, and even malformed regions exactly)
to the spreadsheet mode, whose model is the cell _values_ only. The conversion
is never claimed to be byte-identical; RSF stores the current cell inputs, not
the original CSV bytes. The original `.csv` on disk is never modified.

### Legacy `.rcsv` (RCSV) files

The previous release used the magic `RCSV` (`0x52 0x43 0x53 0x56`) with
container version `2` and the `.rcsv` extension, under the old name **Refrain
CSV Format**. The rename to RSF changed only the container name, magic bytes,
and version number — the header shape and body layout are byte-identical.

- **Reading.** Legacy `.rcsv` files (magic `RCSV`, container version `2`) are
  read transparently as a legacy _import_ format.
- **Migration on save.** Opening a legacy `.rcsv` file renames the in-memory
  document to `.rsf`, detaches the original file handle so the `.rcsv` on disk
  is never overwritten in place, and marks the document unsaved. The next Save
  writes a new `.rsf` file (magic `RSF1`, version `3`); the original `.rcsv`
  stays untouched on disk.
- **Writing.** The app only ever writes the current RSF container. Older
  readers that only understand `RCSV`/version 2 will correctly reject the new
  magic rather than misinterpreting it.
- **Mismatched pairs are rejected.** The magic and container version are
  validated as a pair: `RSF1`+`3`, `RSF1`+`4`, and `RCSV`+`2` are the only
  accepted combinations; any other pairing (e.g. `RCSV` magic with version `3`)
  is a `bad-version` error.

### Migrating a single-worksheet file to a workbook

An existing single-worksheet `.rsf` (container version 3) and a legacy `.rcsv`
both load as a workbook with exactly one worksheet, keeping their sheet name,
delimiter, application metadata, display settings, and filter. Nothing about
the file changes until the document does:

- While the workbook still holds **one** worksheet, saving writes the same
  version-3 container it came from — the file stays readable by older releases.
- As soon as a **second** worksheet exists, saving writes a version-4 workbook
  container. That is the migration, and it happens only because the document
  now genuinely needs it.
- Older readers encountering a version-4 container reject it with a localized
  unsupported-version message (`bad-version`); they never misparse it or
  silently drop the extra worksheets.

### Older container revisions

Version 1 of the _container_ was an experimental JSON encoding and is no longer
produced or read; there is no migration path in-app. The _body_ was bumped from
version 1 to version 2 to carry application metadata, from version 2 to version
3 to carry display settings (zoom, column widths), and from version 3 to version
4 to carry the sheet filter; readers accept all four body versions (older bodies
simply have no metadata / no display settings / no filter, so application
defaults apply). Because version selection on write is minimal — the lowest body
version sufficient for the data present is written — a document with no filter
still writes a version 1–3 body that older readers accept. A document saved with
an active filter writes a version 4 body, which a reader that only understands
versions 1–3 rejects as `bad-version` (consistent with the reject-don't-guess
policy) rather than silently dropping the filter. Multi-worksheet support was
added as a new _container_ version (4) with its own workbook body rather than
as another single-sheet body version, because it changes what the payload
describes — a workbook rather than a sheet. Future changes bump the container
version (framing changes) or the relevant body version (encoding changes);
readers reject versions they do not understand rather than guessing.
