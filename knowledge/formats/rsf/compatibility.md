---
type: format-concept
title: RSF versioning and compatibility
description: Lossy CSV→RSF conversion, the JSON document version and how later versions may extend it, the refused binary format of releases up to 0.8.x, and the frozen fixture corpus.
sources:
  - resource: ../../../src/core/rsf-codec.ts
  - resource: ../../../tests/rsf-fixtures.test.ts
status: stable
generated:
  by: claude-code
  at: 2026-09-23T16:00:00Z
---

# Versioning and compatibility

This is the container identified by `RSF2`, holding a JSON document with
`"version": 1` (see [overview.md](overview.md) and
[json-document.md](json-document.md)).

## Lossy CSV → RSF conversion

Converting a CSV document to RSF is an **explicit, lossy** operation: it
moves from the byte-preserving CSV mode (which round-trips delimiters,
quoting, whitespace, line endings, encodings, BOMs, and even malformed
regions exactly) to the spreadsheet mode, whose model is the cell _values_
only. The conversion is never claimed to be byte-identical; RSF stores the
current cell inputs, not the original CSV bytes. The original `.csv` on
disk is never modified.

## The binary format of releases up to 0.8.x is refused

Releases up to 0.8.x wrote a custom binary container (magic `RSF1`,
container versions 3 and 4, 17 version-gated body layouts, a choice of
store/DEFLATE/Zstandard/LZ4) and, before that, the same layout under the
magic `RCSV` with the `.rcsv` extension. The maintainer chose to drop
compatibility with it when the format was redesigned (#602, option A), so
this release does **not** read those files:

- A file starting with `RSF1` or `RCSV` is refused with its own error,
  `legacy-format`, whose message explains the way out: open it in a 0.8.x
  release and export CSV or XLSX, then open that here. It is never
  misparsed or partly loaded.
- `.rcsv` files still go to the RSF reader (not the CSV reader), so they
  get that message instead of being shown as garbage text.
- Nothing converts them automatically; there is no migration path in-app.

## How the format may change

- **Additions that older readers can ignore** (a new optional key) keep
  `"version": 1`: the reader ignores unknown keys, so a file written by a
  later release still opens, minus the new feature. A new key must be
  optional and must not change the meaning of any existing key.
- **Anything an older reader must not misread** (a changed meaning, a new
  required key, a different cell encoding) raises `version`; a reader
  refuses a version it does not know (`bad-version`) instead of guessing.
- **A container change** (framing, checksum, compression) gets a new
  identifier in place of `RSF2`, which older readers refuse as
  `bad-magic`.

Defaults are left out when writing (UTC timezone, English, unlocked,
`grid`, solid/thin borders, history on with no snapshots and no limit), so
the same content always serializes to the same text.

## Frozen fixture corpus

`tests/fixtures/rsf/v1/` holds committed files in this format — every
feature on one sheet, the four source worksheet kinds, version history, a
compressed bulk sheet, and a Raw-block file written by the JavaScript
fallback — and `tests/rsf-fixtures.test.ts` checks each two ways: the
committed bytes must still **decode** to the data they were written from (a
fixture is never rewritten), and the current encoder must still
**reproduce** them byte-for-byte (output stability, which also pins the
embedded WASM codec). An intentional output change keeps the old fixture's
decode check, marks it `encodes: false`, and adds a new fixture.

The binary-format files directly in `tests/fixtures/rsf/` stay, never
edited, as proof that each one is refused as `legacy-format`.
