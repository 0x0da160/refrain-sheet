---
type: format-concept
title: RSF versioning and compatibility
description: Lossy CSV→RSF conversion, legacy .rcsv handling, single-sheet-to-workbook migration, mismatched-pair rejection, and the full body-version bump history.
sources:
  - resource: docs/rsf-format.md (migrated content; file removed after migration — see knowledge/log.md)
status: stable
generated:
  by: claude-code/claude-sonnet-5
  at: 2026-09-22T12:09:14Z
---

# Versioning and compatibility

This is container **version 3** (one worksheet) or **version 4**
(workbook), both written with the magic `RSF1` (see
[overview.md](overview.md)).

## Lossy CSV → RSF conversion

Converting a CSV document to RSF is an **explicit, lossy** operation: it
moves from the byte-preserving CSV mode (which round-trips delimiters,
quoting, whitespace, line endings, encodings, BOMs, and even malformed
regions exactly) to the spreadsheet mode, whose model is the cell _values_
only. The conversion is never claimed to be byte-identical; RSF stores the
current cell inputs, not the original CSV bytes. The original `.csv` on
disk is never modified.

## Legacy `.rcsv` (RCSV) files

The previous release used the magic `RCSV` (`0x52 0x43 0x53 0x56`) with
container version `2` and the `.rcsv` extension, under the old name
**Refrain CSV Format**. The rename to RSF changed only the container name,
magic bytes, and version number — the header shape and body layout are
byte-identical.

- **Reading.** Legacy `.rcsv` files (magic `RCSV`, container version `2`)
  are read transparently as a legacy _import_ format.
- **Migration on save.** Opening a legacy `.rcsv` file renames the
  in-memory document to `.rsf`, detaches the original file handle so the
  `.rcsv` on disk is never overwritten in place, and marks the document
  unsaved. The next Save writes a new `.rsf` file (magic `RSF1`, version
  `3`); the original `.rcsv` stays untouched on disk.
- **Writing.** The app only ever writes the current RSF container. Older
  readers that only understand `RCSV`/version 2 will correctly reject the
  new magic rather than misinterpreting it.
- **Mismatched pairs are rejected.** The magic and container version are
  validated as a pair: `RSF1`+`3`, `RSF1`+`4`, and `RCSV`+`2` are the only
  accepted combinations; any other pairing (e.g. `RCSV` magic with version
  `3`) is a `bad-version` error.

## Migrating a single-worksheet file to a workbook

An existing single-worksheet `.rsf` (container version 3) and a legacy
`.rcsv` both load as a workbook with exactly one worksheet, keeping their
sheet name, delimiter, application metadata, display settings, and
filter. Nothing about the file changes until the document does:

- While the workbook still holds **one** worksheet, saving writes the
  same version-3 container it came from — the file stays readable by
  older releases.
- As soon as a **second** worksheet exists, saving writes a version-4
  workbook container. That is the migration, and it happens only because
  the document now genuinely needs it.
- Older readers encountering a version-4 container reject it with a
  localized unsupported-version message (`bad-version`); they never
  misparse it or silently drop the extra worksheets.

## Older container revisions

Version 1 of the _container_ was an experimental JSON encoding and is no
longer produced or read; there is no migration path in-app.

The _body_ version history, each bump written only when the triggering
data is actually present (so a document without the feature stays on its
previous, lower body version):

| Single-sheet body version | Workbook body version | Added                                                                                                                                                                                                                                                                                                      |
| ------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1                         | —                     | Original.                                                                                                                                                                                                                                                                                                  |
| 2                         | —                     | Application metadata (workbook body carries this unconditionally from its own version 1, not as a separate gate).                                                                                                                                                                                          |
| 3                         | —                     | Display settings, zoom and column widths (workbook body carries this unconditionally per worksheet record, not as a separate gate).                                                                                                                                                                        |
| 4                         | —                     | Sheet filter (workbook body carries this unconditionally per worksheet record, not as a separate gate).                                                                                                                                                                                                    |
| 5                         | —                     | Wrap long rows (workbook body: bit 2 of the same always-present per-worksheet display-flags byte, so no separate gate is needed).                                                                                                                                                                          |
| —                         | 1                     | Multi-worksheet support — a **new container version (4)** with its own workbook body, not another single-sheet body version, because it changes what the payload describes (a workbook rather than a sheet).                                                                                               |
| 6                         | 2                     | Workbook timezone.                                                                                                                                                                                                                                                                                         |
| 7                         | 3                     | Workbook display language.                                                                                                                                                                                                                                                                                 |
| 8                         | 4                     | Cell-level visual formatting (cell styles).                                                                                                                                                                                                                                                                |
| 9                         | 5                     | Per-cell number format.                                                                                                                                                                                                                                                                                    |
| 10                        | 6                     | Per-border-side line style and width.                                                                                                                                                                                                                                                                      |
| 11                        | 7                     | Cell comments.                                                                                                                                                                                                                                                                                             |
| 12                        | 8                     | Per-worksheet kind — markdown sheets (also the version from which the workbook worksheet-kind byte is physically present at all). A wholly different kind of worksheet content (a Markdown document rather than a grid) stored as an ordinary cell, so the container's cell-storage shape does not change. |
| 13                        | 9                     | Per-worksheet lock — a protective/presentational flag with no effect on cell data, formula evaluation, sorting, filtering, or CSV export, like timezone and display language.                                                                                                                              |
| 14                        | 10                    | Per-file version (snapshot) history — **on by default**, unlike every prior bump, so almost every file saved by a release with this feature reaches this version after its first save.                                                                                                                     |
| 15                        | 11                    | Worksheet-kind byte widened to also hold `json` — no new byte, just a version-gated widening of legal values for the byte already present from version 12/8.                                                                                                                                               |
| 16                        | 12                    | Per-file override of the retained-snapshot cap — written only when a file actually sets an override.                                                                                                                                                                                                       |
| 17                        | 13                    | Worksheet-kind byte widened again to also hold `yaml`/`text`, **and** a per-file auto-format-on-commit setting for JSON/YAML editors (a further bit in the same history flags byte, needing no legacy-version special case since it has no pre-existing shipped meaning).                                  |

Two points from this table are easy to get wrong and worth stating
explicitly:

- **Version 16/12's cap-override field is not simply "version >= 16/12".**
  The yaml/text kind (version 17/13) was added _after_ the cap-override
  feature had already shipped, and needed a still-higher tier of its own
  — so a version-17/13 file can independently carry yaml/text, a cap
  override, or both, and the version number alone can no longer say
  which. A real file at exactly version 16 (single-sheet) or 12
  (workbook) unconditionally has the cap-override field (nothing else can
  ever select exactly that version, so this reading never breaks an
  already-shipped file); at version 17/13, presence is read from a
  self-describing bit in the history flags byte instead — see
  [grammar-single-sheet-body.md](grammar-single-sheet-body.md#version-history-retained-snapshot-cap-override-body-version-16).
- **Future changes bump the container version** (framing changes) **or
  the relevant body version** (encoding changes); readers reject versions
  they do not understand rather than guessing. This reject-don't-guess
  policy is applied at every version boundary documented in
  [grammar-single-sheet-body.md](grammar-single-sheet-body.md) and
  [grammar-workbook-body.md](grammar-workbook-body.md), not just at the
  container level.

## Frozen fixture corpus

`tests/fixtures/rsf/` holds committed `.rsf` files — one per single-sheet
body version 1–17, one per compression method (DEFLATE, Zstandard, LZ4),
and two version-4 workbook containers — and `tests/rsf-fixtures.test.ts`
checks each two ways: the committed bytes must still **decode** to the data
they were written from (the compatibility guarantee; a fixture is never
rewritten), and the current encoder must still **reproduce** them
byte-for-byte (output stability, which also pins the embedded WASM codecs).
A version bump adds a new fixture; it never edits an old one. The corpus
does not yet cover the legacy RCSV container or pre-v0.8 files written by
real releases, which the handwritten cases in `tests/rsf-codec.test.ts`
still synthesize.
