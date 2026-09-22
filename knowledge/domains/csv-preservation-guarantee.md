---
type: domain-concept
title: CSV preservation guarantee
description: The Refrain principle, byte-identical unedited saves, minimal-diff edits, the guarantee's documented exceptions, encoding detection/support, opening structurally invalid CSV, and the CSV-injection warning.
sources:
  - resource: ../../README.md
  - resource: ../../src/core/lossless-document.ts
  - resource: ../../src/core/serializer.ts
  - resource: ../../src/core/encoding.ts
  - resource: ../../src/core/byte-csv-parser.ts
status: stable
generated:
  by: claude-code/claude-sonnet-5
  at: 2026-09-22T16:27:09Z
---

# CSV preservation guarantee

## The Refrain principle

Refrain Sheet is not a spreadsheet application that normalizes CSV files: you
edit CSV field **values**, and everything else stays unchanged wherever
possible. A normal save never unifies line-ending styles or delimiters,
alters the header layout, adds or removes whitespace, adds or removes quotes
unnecessarily, adds or removes BOMs, repairs malformed CSV, or removes or
replaces undecodable bytes in unmodified fields. This is the product's core
differentiator, and it is what `src/core/lossless-document.ts` and
`src/core/serializer.ts` exist to implement — see
[`../architecture/invariants.md`](../architecture/invariants.md) for the
code-level guarantee ("CSV byte preservation") that tests and review protect.

## Byte-identical unedited saves

When a file is opened and saved normally (Ctrl+S / Cmd+S) without any edits,
the saved output is byte-for-byte identical to the original input: the app
saves the originally loaded bytes directly and never reserializes an unedited
document. This covers every encoding Refrain Sheet supports (UTF-8, UTF-8
with BOM, Shift_JIS / CP932, EUC-JP), CRLF/LF/CR and mixed line endings,
files with no final newline, whitespace around delimiters and inside/outside
quoted fields, escaped quotes (`""`), empty fields, header-only and empty
files, unclosed quotes, bare quotes, invalid text after a closing quote,
inconsistent field counts across rows, and undecodable bytes.

## Minimal-diff edits

Editing a field reserializes only that field's byte range:

- Unmodified fields, delimiters, record terminators, surrounding whitespace,
  and malformed regions keep their original raw bytes.
- A field that was quoted stays quoted; its whitespace outside the quotes is
  preserved.
- An unquoted field gains quotes only when the new value contains the
  delimiter, a quote, or a newline; any `"` inside the new value is escaped
  as `""`.

`LosslessDocument` keeps the original bytes verbatim and stores edits as an
overlay keyed by cell position, so a document with no edits can always be
saved as the exact original byte sequence; `serializer.ts` plans a save as
verbatim-copy segments interleaved with replacement segments for edited
fields only, rather than reserializing the whole document.

## Where exceptions apply

Full byte preservation applies to a normal save with no options changed. It
does not apply when you explicitly ask for a transformation:

- **Encoding conversion** (Save with Options) re-encodes the whole document.
  Quoting, whitespace, delimiters, and record structure are still preserved,
  but undecodable bytes cannot survive re-encoding — they become replacement
  characters.
- **Line-ending conversion** rewrites record terminators only; a missing
  final newline is never added.
- **BOM include/omit** adds or removes exactly the three UTF-8 BOM bytes.
- **Editing a field** replaces that field's bytes, including any malformed
  trailing text that was part of its displayed value. If an edited field
  originally contained undecodable bytes, a warning is shown before saving.
- **Unrepresentable characters**: if the output encoding cannot represent a
  new character (e.g. an emoji in CP932), the save is cancelled by default.
  Choosing to continue writes those characters as numeric character
  references such as `&#128512;` and reports which cells were affected and
  how many replacements were made — the same numeric-character-reference
  fallback used by CSV export (see
  [import-export-and-conversion.md](import-export-and-conversion.md)).

## Encodings

Supported: UTF-8 (with or without BOM), Shift_JIS / CP932, and EUC-JP. UTF-16
and ISO-2022-JP are **not** supported in this release — `src/core/encoding.ts`
only ever detects and decodes as `'utf-8' | 'shift_jis' | 'euc-jp'`. If a file
looks like an unsupported encoding, a warning explains the supported range;
the file still opens with a best-effort interpretation and its bytes remain
untouched.

Encoding is detected automatically: strict UTF-8 validation (`TextDecoder`
with `fatal: true`) plus Japanese-encoding heuristics via the locally bundled
`encoding-japanese` library. When detection is uncertain, CP932 is presented
as the candidate. **File > Reopen with Encoding…** changes the encoding or
delimiter interpretation at any time; reinterpreting never alters the
original bytes. Undecodable bytes display as replacement characters (�) but
are preserved on save unless their field is edited.

The status bar always shows the current encoding interpretation, BOM state,
delimiter, line-ending style, file size, and undecodable-byte warnings.

## Opening structurally invalid CSV

When a file is opened, its structure is parsed at the byte level
(`src/core/byte-csv-parser.ts`) and problems are listed in a CSV Validation
Results dialog with row, column, problem type, and a short explanation:
unclosed quotes, invalid text immediately after a closing quote, bare quotes
inside unquoted fields, inconsistent field counts across rows, and
structurally ambiguous content (a line break inside an unclosed quote).

Nothing is ever repaired or normalized. The dialog offers exactly two
choices: **Open Anyway** (malformed regions are preserved byte-for-byte as
long as you don't edit them) or **Cancel**. There is no auto-repair path
anywhere in the loading flow.

## CSV injection warning

Values beginning with `=`, `+`, `-`, or `@` may be interpreted as formulas by
spreadsheet software (Excel, LibreOffice, Google Sheets) when the saved CSV
is later opened there. In keeping with the Refrain principle, Refrain Sheet
**never silently modifies, escapes, or prefixes values** as a mitigation —
the same "edit values, not structure" rule that governs the rest of the
preservation guarantee. The Save with Options dialog carries the same
warning. Be careful when opening CSV files from untrusted sources in other
spreadsheet software; see
[`../operations/security-threat-model.md`](../operations/security-threat-model.md)
for the broader trust-boundary table this warning sits inside.
