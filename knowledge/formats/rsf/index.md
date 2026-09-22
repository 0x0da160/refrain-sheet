# RSF — the `.rsf` binary container

**Refrain Sheet Format (RSF)** is the dedicated spreadsheet document format
used by Refrain Sheet, saved with the `.rsf` extension. It carries formulas,
structural editing intent, and per-document metadata that plain CSV cannot
represent without breaking Refrain Sheet's byte-for-byte CSV preservation
guarantee. RSF is a versioned, compressed binary container — **not** a JSON
document, **not** a plain/standard CSV file, and **not** a byte-identical
representation of an imported CSV.

> **Naming.** This format was previously called **Refrain CSV Format
> (RCSV)** and used the `.rcsv` extension. Only the name, extension, magic
> bytes, and container version changed; the on-disk structure is otherwise
> identical — see [compatibility.md](compatibility.md).

Migrated from the former `docs/rsf-format.md`, now removed — see
[`knowledge/log.md`](../../log.md) for the migration history. The reference
implementation lives in `src/core/rsf-codec.ts` (framing) and
`wasm/src/compress.rs` (compression + checksum). **High risk, human-review
area:** `CLAUDE.md` calls out the RSF codec by name as needing "extra care,
full `test:rust`, and human review" for any _code_ change — this knowledge
domain documents the existing, shipped format precisely as the reference
implementation defines it; it does not propose or imply any format change.

- [Overview](overview.md) — design goals, compression methods, container
  header layout, and the workbook/worksheet model.
- [Single-sheet body grammar](grammar-single-sheet-body.md) — the
  container-version-3 body: the full 17-version-gated field layout, one
  section per feature that raised the version.
- [Workbook body grammar](grammar-workbook-body.md) — the
  container-version-4 body, written only for 2+ worksheets.
- [Cross-sheet formula references](cross-sheet-references.md) — reference
  syntax and what happens to formulas when worksheets are renamed, deleted,
  duplicated, or restructured.
- [The formula value model](values.md) — value kinds, the error set, and
  date-serial semantics.
- [Dynamic arrays (spill)](dynamic-arrays.md) — why nothing derived is ever
  stored, placement rules, and formula-evaluation bounds.
- [Versioning and compatibility](compatibility.md) — lossy CSV→RSF
  conversion, legacy `.rcsv` handling, single-sheet-to-workbook migration,
  and the full body-version history.
