---
type: format-concept
title: RSF overview
description: Design goals, compression methods, the container header layout, and the workbook/worksheet model.
sources:
  - resource: ../../../docs/rsf-format.md
  - resource: ../../../src/core/rsf-codec.ts
status: stable
generated:
  by: claude-code/claude-sonnet-5
  at: 2026-09-22T12:09:14Z
---

# RSF overview

## Design goals

- **Inert data only.** The file contains cell inputs and small metadata —
  no executable code, macros, external references, or network URLs.
  Loading validates and never executes anything.
- **Integrity.** A CRC-32 checksum over the uncompressed body detects
  corruption before the document is trusted.
- **Bounded decompression.** The uncompressed body length is stored in the
  header and enforced as an allocation ceiling, so a crafted "decompression
  bomb" cannot exhaust memory.
- **Versioned.** A magic number plus explicit container and body version
  bytes let future revisions be detected and rejected cleanly rather than
  misinterpreted.
- **Self-contained runtime.** Every compression codec is implemented in
  **pure Rust** and compiled to WebAssembly embedded in the app as Base64 —
  never fetched — so the editor works from a `file://` page with no
  network, no C/C++ toolchain, and no server-side compression service.

## Compression methods

The container records a one-byte compression method. All three real codecs
are pure Rust and build for `wasm32-unknown-unknown` with no C toolchain:

| Value  | Method    | Crate         | Role                                                        |
| ------ | --------- | ------------- | ----------------------------------------------------------- |
| `0x00` | `store`   | —             | Uncompressed. Explicit debugging / interoperability option. |
| `0x01` | `deflate` | `miniz_oxide` | Raw DEFLATE (RFC 1951). Compatibility fallback.             |
| `0x02` | `zstd`    | `ruzstd`      | Zstandard. **Default** for new documents.                   |
| `0x03` | `lz4`     | `lz4_flex`    | LZ4 Frame. Speed-priority option.                           |

Method ids `0x80`–`0xFF` are reserved for future or experimental
extensions.

### Default policy

- New RSF documents and CSV→RSF conversions default to **Zstandard**
  (`0x02`). It is never the uncompressed `store` method.
- Zstandard uses a moderate level: `ruzstd`'s encoder implements the
  `Fastest` level (≈ zstd level 1); its higher levels are not yet
  implemented, so `Fastest` is the level written. The output is a
  conformant Zstandard frame readable by any compliant decoder.
- **LZ4 Frame** is an explicit speed-priority option; its files may be
  larger than Zstandard's.
- **DEFLATE** is the compatibility fallback, chosen automatically only
  when Zstandard cannot be used in the current build.
- Saving an **existing** RSF document preselects and preserves that file's
  method; the method is never changed silently by a normal save.
- A method the current build cannot use is not offered, and a document
  written with an unavailable/unsupported method fails safely with a
  localized message rather than being guessed at or reinterpreted.

> **Why `ruzstd`, not the `zstd` crate?** The Refrain WASM core targets
> `wasm32-unknown-unknown`, which has no C toolchain; the `zstd` crate's
> `zstd-sys` C bindings do not build there. `ruzstd` is a dependency-light,
> pure-Rust Zstandard encoder **and** decoder that compiles cleanly to
> WASM, so Zstandard can be the real default with no native code.

### Save dialog

The RSF Save dialog (File → Save with Options…) offers exactly these
localized choices, in English and Japanese:

| Label                     | Method | Description                                          |
| ------------------------- | ------ | ---------------------------------------------------- |
| `Zstandard (Recommended)` | `0x02` | Balanced ratio and speed; the default choice.        |
| `LZ4 Frame (Fast)`        | `0x03` | Prioritizes fast saving/opening; may be larger.      |
| `DEFLATE (Compatible)`    | `0x01` | Compatibility fallback when Zstandard is unsuitable. |
| `None (Uncompressed)`     | `0x00` | No compression; debugging/interoperability only.     |

Only methods actually bundled and usable in the current build are shown.
When the WebAssembly engine is unavailable (rare — it is embedded and
normally always loads), the JavaScript fallback writes `store` and can
only read `store`; reading any compressed file requires the WASM engine.

## Container layout

All multi-byte integers are **little-endian**. The header is a fixed 20
bytes, followed by the (possibly compressed) body payload.

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

A reader must reject the file when: the length is under 20 bytes or the
magic matches neither `RSF1` nor the legacy `RCSV` (`bad-magic`); the
container version does not match its magic — `3` or `4` for `RSF1`, `2`
for legacy `RCSV` (`bad-version`); the method byte is not a defined
method `0x00`–`0x03`, or the codec profile byte is non-zero
(`unsupported-compression`); the stored body length exceeds the ceiling
(`too-large`); or `20 + payloadLength` does not equal the file length
(`bad-shape`). After decompression, the CRC-32 must match (`checksum`).

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

Two container versions encode this, and which one is written depends only
on how many worksheets the workbook actually holds:

| Worksheets | Container version | Body                                                                                     |
| ---------- | ----------------- | ---------------------------------------------------------------------------------------- |
| exactly 1  | `3`               | the single-sheet body — see [grammar-single-sheet-body.md](grammar-single-sheet-body.md) |
| 2 or more  | `4`               | the workbook body — see [grammar-workbook-body.md](grammar-workbook-body.md)             |

This keeps the common case maximally compatible: a workbook that never
uses a second worksheet is byte-for-byte the same kind of file earlier
releases wrote and read. A workbook that _does_ use multiple worksheets is
a version-4 container, which older readers reject as `bad-version` (they
validate the magic/version pair) instead of misparsing it — the
reject-don't-guess policy.

### Worksheet identity

Every worksheet has a **stable internal identifier** that is separate from
its mutable display name. The identifier never changes — not when the
worksheet is renamed, moved, or when other worksheets are added or
removed. Identifiers must be unique within a workbook; a duplicate is
`bad-shape`.

The **display name** is what users see on the worksheet tab and what
cross-sheet formulas write (`Sheet1!A1`). Names are trimmed, at most **100
characters**, unique within the workbook **case-insensitively**, and may
not contain C0 control characters or any of `: \ / ? * [ ]` — the
characters that would conflict with formula-reference or file-path syntax.
A name is never interpreted as HTML, a formula, a URL, or code anywhere in
the application. Single quotes _are_ allowed and are escaped by doubling
inside a quoted reference (`'O''Brien'!A1`).

### Single-sheet containers have no worksheet identifier

A version-3 container stores a sheet _name_ but no identifier. When one is
read, a stable identifier is minted in memory so the whole application
works against one model. Because a single-worksheet workbook is written
back as a version-3 container, that minted identifier is not persisted —
harmless, since a file with one worksheet has no cross-sheet references
and nothing else keys off the identifier.
