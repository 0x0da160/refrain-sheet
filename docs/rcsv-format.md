# RCSV (Refrain CSV Format) — the `.rcsv` binary container

**RCSV (Refrain CSV Format)** is the dedicated spreadsheet document format used
by **Refrain Sheet**, saved with the `.rcsv` extension. It carries formulas,
structural editing intent, and per-document metadata that plain CSV cannot
represent without breaking Refrain Sheet's byte-for-byte CSV preservation
guarantee. RCSV is a versioned, compressed binary container — **not** a JSON
document, **not** a plain/standard CSV file, and **not** a byte-identical
representation of an imported CSV. When a CSV is converted to a spreadsheet
(explicitly, by the user), saving it produces an `.rcsv` file; the original
`.csv` on disk is never touched, and plain CSV files keep their byte-preserving
guarantees until conversion.

This document specifies the container so the format is auditable and other tools
can read or write it. The reference implementation lives in
[`src/core/rcsv-codec.ts`](../src/core/rcsv-codec.ts) (framing) and
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
- **Self-contained runtime.** Compression is DEFLATE, implemented in Rust and
  compiled to WebAssembly that is embedded in the app as Base64 — never fetched
  — so the editor works from a `file://` page with no network.

## Compression method

The container records a one-byte compression method:

| Value | Method    | Notes                                                      |
| ----- | --------- | ---------------------------------------------------------- |
| `0`   | `store`   | Body stored uncompressed. Always readable.                 |
| `1`   | `deflate` | Raw DEFLATE (RFC 1951). Written by the WebAssembly engine. |

> **Why DEFLATE, not Zstd?** The Refrain WASM core targets
> `wasm32-unknown-unknown`, which has no C toolchain; the `zstd` crate’s
> `zstd-sys` C bindings do not build for that target. The dependency-free,
> pure-Rust [`miniz_oxide`](https://crates.io/crates/miniz_oxide) DEFLATE
> implementation compiles cleanly to WASM and is used instead. The
> compression-method byte reserves room to add a Zstd method later without
> breaking existing files.

When the WebAssembly engine is unavailable (rare — it is embedded and normally
always loads), the JavaScript fallback writes `store` and can always read
`store`. Reading a `deflate` file requires the WASM engine.

## Container layout

All multi-byte integers are **little-endian**. The header is a fixed 20 bytes,
followed by the (possibly compressed) body payload.

| Offset | Size | Field                                               |
| ------ | ---- | --------------------------------------------------- |
| 0      | 4    | Magic bytes `RCSV` (`0x52 0x43 0x53 0x56`)          |
| 4      | 1    | Container version — currently `2`                   |
| 5      | 1    | Compression method (`0` = store, `1` = deflate)     |
| 6      | 1    | Flags (reserved, must be `0`)                       |
| 7      | 1    | Reserved (must be `0`)                              |
| 8      | 4    | Uncompressed body length, `u32`                     |
| 12     | 4    | CRC-32 (IEEE 802.3) of the uncompressed body, `u32` |
| 16     | 4    | Compressed payload length, `u32`                    |
| 20     | …    | Payload (the body, compressed per the method byte)  |

A reader must reject the file when: the length is under 20 bytes or the magic
does not match (`bad-magic`); the container version is not `2` (`bad-version`);
the method byte is not `0` or `1` (`unsupported-compression`); the stored body
length exceeds the ceiling (`too-large`); or `20 + payloadLength` does not equal
the file length (`bad-shape`). After decompression, the CRC-32 must match
(`checksum`).

The decompression ceiling (`MAX_RCSV_BODY_BYTES`) is **512 MiB**.

## Body layout

The body is a compact binary encoding of one sheet. All strings are UTF-8.

Body **version 2** (written by this release) adds the creating/updating
application metadata immediately after the delimiter. Body **version 1** (no
metadata) is still accepted on read.

| Size | Field                                                              |
| ---- | ------------------------------------------------------------------ |
| 1    | Body version — `2` (metadata-bearing); `1` (no metadata) also read |
| 1    | Delimiter byte: `,` (`0x2C`), `;` (`0x3B`), or TAB (`0x09`)        |
| 2    | _(v2 only)_ Application-name length, `u16`                         |
| …    | _(v2 only)_ Application name (UTF-8), e.g. `Refrain Sheet`         |
| 2    | _(v2 only)_ Application-version length, `u16`                      |
| …    | _(v2 only)_ Application version (UTF-8), e.g. `0.1.1`              |
| 2    | Sheet-name length `N`, `u16`                                       |
| `N`  | Sheet name (UTF-8)                                                 |
| 4    | Row count, `u32`                                                   |
| 4    | Column count, `u32`                                                |
| 4    | Cell count `C`, `u32`                                              |
| …    | `C` cell records                                                   |

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

## Versioning and compatibility

This is container **version 2**. Version 1 of the _container_ was an experimental
JSON encoding and is no longer produced or read; there is no migration path
in-app. The _body_ was bumped from version 1 to version 2 to carry application
metadata; readers accept both body versions (version 1 simply has no metadata).
Future changes bump the container version (framing changes) or the body version
(sheet encoding changes); readers reject container versions they do not
understand rather than guessing.
