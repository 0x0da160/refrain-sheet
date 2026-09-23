# RSF — the `.rsf` spreadsheet file

**Refrain Sheet Format (RSF)** is the spreadsheet document format Refrain
Sheet saves, with the `.rsf` extension. It carries formulas, several
worksheets, formatting, and per-document settings that plain CSV cannot
represent without breaking Refrain Sheet's byte-for-byte CSV preservation
guarantee.

Since #602 an `.rsf` file is a **JSON document compressed with
Zstandard**: `zstd -d book.rsf -o book.json` turns it into text any editor
opens. The binary container earlier releases wrote (and its `.rcsv`
predecessor) is no longer read; see [compatibility.md](compatibility.md).

The reference implementation lives in `src/core/rsf-codec.ts` (container
and JSON) and `src/core/zstd-frame.ts` (the codec-free Zstandard frame
parts); compression runs in the embedded WASM engine (`wasm/src/compress.rs`).
**High risk, human-review area:** `CLAUDE.md` calls out the RSF format by
name as needing extra care and human review for any change.

- [Overview](overview.md) — design goals, the two-frame container,
  Zstandard-only compression, bounds, and the workbook/worksheet model.
- [JSON document](json-document.md) — every key of the document, the
  text-editor-friendly layout, and what the reader validates.
- [Cross-sheet formula references](cross-sheet-references.md) — reference
  syntax and what happens to formulas when worksheets are renamed, deleted,
  duplicated, or restructured.
- [The formula value model](values.md) — value kinds, the error set, and
  date-serial semantics.
- [Dynamic arrays (spill)](dynamic-arrays.md) — why nothing derived is ever
  stored, placement rules, and formula-evaluation bounds.
- [Versioning and compatibility](compatibility.md) — lossy CSV→RSF
  conversion, the document version, how later versions may extend it, and
  why the older binary format is refused.
