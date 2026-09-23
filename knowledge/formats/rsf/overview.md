---
type: format-concept
title: RSF overview
description: Design goals, the two-frame Zstandard container, Zstandard-only compression with a Raw-block fallback, bounds, and the workbook/worksheet model.
sources:
  - resource: ../../../src/core/rsf-codec.ts
  - resource: ../../../src/core/zstd-frame.ts
  - resource: ../../../src/core/csv-engine.ts
status: stable
generated:
  by: claude-code
  at: 2026-09-23T16:00:00Z
---

# RSF overview

## Design goals

- **Readable.** The content is a pretty-printed JSON document (see
  [json-document.md](json-document.md)). Any standard Zstandard tool
  unpacks it, and any text editor or JSON tool reads the result; a grid
  row is one line, so text diffs are meaningful.
- **Inert data only.** Cell inputs and small metadata — no executable
  code, macros, external references, or network URLs. Loading validates
  strictly and never executes anything.
- **Bounded.** The uncompressed length is stored up front and enforced as
  an allocation ceiling (512 MiB), so a crafted "decompression bomb" cannot
  exhaust memory; every count and length in the JSON has a bound.
- **Integrity.** A CRC-32 of the JSON text detects accidental corruption
  before the document is trusted (it is not tamper protection).
- **Versioned.** A container identifier and a document `version` let later
  revisions be recognized and refused cleanly instead of misread.
- **Self-contained runtime.** Compression is pure Rust (`ruzstd`) compiled
  to WebAssembly and embedded as Base64 — never fetched — so the editor
  works from a `file://` page with no network.

## Container layout

A `.rsf` file is exactly two Zstandard frames. All integers are
little-endian.

| Offset | Size | Field                                                                 |
| ------ | ---- | --------------------------------------------------------------------- |
| 0      | 4    | Skippable-frame magic `0x184D2A5A`                                    |
| 4      | 4    | Skippable-frame payload size, always `12`                             |
| 8      | 4    | Identifier `RSF2` (`0x52 0x53 0x46 0x32`)                             |
| 12     | 4    | Length of the uncompressed JSON in bytes (at most 512 MiB)            |
| 16     | 4    | CRC-32 (IEEE 802.3) of the uncompressed JSON                          |
| 20     | …    | One standard Zstandard frame (RFC 8878) holding the JSON, to file end |

Zstandard decoders skip skippable frames, so standard tools see only the
second frame: `zstd -d book.rsf -o book.json` (or `unzstd`) yields the
JSON. The first frame exists for this app: it identifies the file, and
gives the length and checksum before any decompression happens.

A reader rejects the file when:

- it starts with `RSF1` or `RCSV` — the binary format of releases up to
  0.8.x (`legacy-format`);
- the skippable frame, its size, or the identifier do not match
  (`bad-magic`);
- the declared length exceeds 512 MiB (`too-large`);
- what follows is not a Zstandard frame, is truncated, or does not
  decompress to exactly the declared length (`bad-shape`);
- the CRC-32 differs (`checksum`);
- the text is not UTF-8 JSON, or the JSON fails validation (`bad-shape`,
  `too-large`, or `bad-version` — see [json-document.md](json-document.md)).

## Compression: Zstandard only

There is one compression method, Zstandard, and no choice to make: File >
Save with Options… applies to CSV only.

- **With the WASM engine** (the normal case), the writer compresses with
  `ruzstd` at its `Fastest` level (≈ zstd level 1 — its higher levels are
  not implemented yet), and the reader decodes any conformant frame,
  bounded by the declared length.
- **Without it** (WebAssembly blocked), the JavaScript fallback writes a
  frame of **Raw blocks** — the format's own uncompressed block type, so
  the file is larger but still a valid Zstandard file every tool reads —
  and reads frames made of Raw and RLE blocks. A file with compressed
  blocks needs the WASM engine; the fallback reports
  `unsupported-compression` rather than guessing.

`ruzstd` rather than the `zstd` crate: the WASM target has no C
toolchain, and `zstd-sys` does not build there.

## Workbooks and worksheets

An RSF document is a **workbook** holding 1–256 **worksheets**, in tab
order. Each worksheet owns its grid (or source text), formulas,
formatting, comments, filter, and display settings; the workbook owns what
they share (CSV-export delimiter, application name/version, timestamps,
document identifier, timezone, display language, which worksheet is
active, and version history). One worksheet or many, the file layout is
the same.

### Worksheet identity

Every worksheet has a **stable internal identifier** separate from its
display name. It never changes — not on rename, move, or when other
worksheets are added or removed — and must be unique in the workbook (a
duplicate is `bad-shape`).

The **display name** is what the worksheet tab shows and what cross-sheet
formulas write (`Sheet1!A1`). Names are trimmed, at most **100
characters**, unique case-insensitively, and may not contain C0 control
characters or any of `: \ / ? * [ ]`. A name is never interpreted as HTML,
a formula, a URL, or code. Single quotes are allowed and are doubled inside
a quoted reference (`'O''Brien'!A1`).

### Worksheet kinds

A `grid` worksheet is an ordinary spreadsheet. A `markdown`, `json`,
`yaml`, or `text` worksheet holds one source document, stored as its lines
of text; in memory it is a 1×1 sheet whose only cell (A1) is that text.
