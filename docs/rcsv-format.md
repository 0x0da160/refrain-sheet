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

- New RCSV documents and CSV→RCSV conversions default to **Zstandard** (`0x02`).
  It is never the uncompressed `store` method.
- Zstandard uses a moderate level: `ruzstd`’s encoder implements the `Fastest`
  level (≈ zstd level 1); its higher levels are not yet implemented, so
  `Fastest` is the level written. The output is a conformant Zstandard frame
  readable by any compliant decoder.
- **LZ4 Frame** is offered as an explicit speed-priority option, optimized for
  fast saving and opening; its files may be larger than Zstandard.
- **DEFLATE** is the compatibility fallback. It is chosen automatically only
  when Zstandard cannot be used in the current build.
- Saving an **existing** RCSV document preselects and preserves that file’s
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

The RCSV Save dialog (File → Save with Options…) offers exactly these localized
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

| Offset | Size | Field                                               |
| ------ | ---- | --------------------------------------------------- |
| 0      | 4    | Magic bytes `RCSV` (`0x52 0x43 0x53 0x56`)          |
| 4      | 1    | Container version — currently `2`                   |
| 5      | 1    | Compression method (`0x00`–`0x03`; see above)       |
| 6      | 1    | Flags (reserved, must be `0`)                       |
| 7      | 1    | Codec profile version (must be `0`)                 |
| 8      | 4    | Uncompressed body length, `u32`                     |
| 12     | 4    | CRC-32 (IEEE 802.3) of the uncompressed body, `u32` |
| 16     | 4    | Compressed payload length, `u32`                    |
| 20     | …    | Payload (the body, compressed per the method byte)  |

A reader must reject the file when: the length is under 20 bytes or the magic
does not match (`bad-magic`); the container version is not `2` (`bad-version`);
the method byte is not a defined method `0x00`–`0x03`, or the codec profile byte
is non-zero (`unsupported-compression`); the stored body length exceeds the
ceiling (`too-large`); or `20 + payloadLength` does not equal the file length
(`bad-shape`). After decompression, the CRC-32 must match (`checksum`).

Every decompressor is bounded by the stored uncompressed length as an
allocation ceiling, so a crafted decompression bomb, malformed frame, or
truncated payload is rejected before it can exhaust memory. CRC-32 detects
**accidental** corruption only — it is not cryptographic tamper protection.

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
