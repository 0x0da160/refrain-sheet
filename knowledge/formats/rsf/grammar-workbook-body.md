---
type: format-concept
title: RSF workbook body grammar
description: The container-version-4 body layout, written only when a workbook holds two or more worksheets — version selection, field layout, per-worksheet records, and workbook-level bounds.
sources:
  - resource: docs/rsf-format.md (migrated content; file removed after migration — see knowledge/log.md)
  - resource: ../../../src/core/rsf-codec.ts
status: stable
generated:
  by: claude-code/claude-sonnet-5
  at: 2026-09-22T12:09:14Z
---

# RSF workbook body grammar

Written only when the workbook holds **two or more** worksheets (see
[overview.md](overview.md)). All strings are UTF-8 and length-prefixed
with a `u16`; all integers are little-endian.

## Version selection

Workbook body version selection is minimal, like the single-sheet body:
**version 13** is written when at least one worksheet in the workbook is a
yaml or text sheet, or the workbook has auto-format-on-commit turned on —
**regardless of whether the workbook also overrides its retained-snapshot
cap**, for the same reason the single-sheet body's version 17 does: both
were added after the cap-override feature had already shipped (v0.8.3) at
version 12, and that number is never renumbered; **version 12** when the
workbook overrides its retained-snapshot cap with no yaml/text worksheet —
this feature's own, original version number; **version 11** when at least
one worksheet in the workbook is a json sheet (the worksheet-kind byte,
below, is only legal to hold json from this version, and yaml/text only
from version 13); **version 10** when version history is disabled or holds
at least one snapshot; **version 9** when at least one worksheet in the
workbook is locked; **version 8** when at least one worksheet in the
workbook is a markdown or json sheet; **version 7** when at least one cell
in any worksheet carries a comment; **version 6** when at least one border
side in any worksheet carries a non-default line style or width; **version
5** when at least one styled cell in any worksheet carries a number
format; **version 4** when at least one cell in any worksheet carries a
style; **version 3** when the workbook display language is not `en`;
**version 2** when the workbook timezone is not `UTC`; **version 1**
otherwise. All thirteen versions are accepted on read.

Just like the single-sheet body, whether the cap-override field is
physically present in a version-13 workbook body is **not simply "version

> = 12"** — a version-13 workbook may have yaml/text alone, a cap override
> alone (which actually always stays at 12), or both. A version-12 body
> unconditionally has the field (nothing else can ever select exactly that
> version); a version-13 body's presence is carried by a bit in the history
> flags byte itself.

## Field layout

| Size | Field                                                                                                                                                                                                                                       |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Workbook body version — `13`, `12`, `11`, `10`, `9`, `8`, `7`, `6`, `5`, `4`, `3`, `2`, or `1` (see selection)                                                                                                                              |
| 1    | Delimiter byte: `,` (`0x2C`), `;` (`0x3B`), or TAB (`0x09`)                                                                                                                                                                                 |
| 2+…  | Application name (UTF-8, `u16` length; may be empty)                                                                                                                                                                                        |
| 2+…  | Application version (UTF-8, `u16` length; may be empty)                                                                                                                                                                                     |
| 8    | Creation timestamp, `f64` ms since epoch (`0` = not stored)                                                                                                                                                                                 |
| 8    | Last-update timestamp, `f64` ms since epoch (`0` = not stored)                                                                                                                                                                              |
| 2+…  | Workbook identifier (UTF-8, `u16` length; may be empty)                                                                                                                                                                                     |
| 2+…  | Active worksheet identifier (UTF-8, `u16` length; may be empty)                                                                                                                                                                             |
| 2+…  | _(v2+)_ Workbook timezone, IANA name (UTF-8, `u16` length)                                                                                                                                                                                  |
| 2+…  | _(v3 only)_ Workbook display language (UTF-8, `u16` length)                                                                                                                                                                                 |
| 1    | _(v10+)_ History flags, `u8` (bit 0: version history enabled; bit 1: cap override unlimited, meaningful only when bit 2 is set; bit 2: cap-override field follows; bit 3: JSON/YAML editors auto-format their source on commit — v13+ only) |
| 4    | _(present exactly when bit 2 above is set)_ Retained-snapshot cap override, `u32` (ignored, written `0`, when bit 1 above is set)                                                                                                           |
| 4    | _(v10+)_ Snapshot count `H`, `u32`                                                                                                                                                                                                          |
| …    | _(v10+)_ `H` snapshot records — identical layout to the single-sheet history block's own                                                                                                                                                    |
| 2    | Worksheet count `S`, `u16`                                                                                                                                                                                                                  |
| …    | `S` worksheet records (below)                                                                                                                                                                                                               |

The workbook timezone follows the same rules as the single-sheet body
version 6 field: written only when non-`UTC`, and an absent or
unresolvable value falls back to `UTC` on load rather than rejecting the
file. The workbook display language follows the same rules as the
single-sheet body version 7 field: written only when non-`en`, and an
absent or unrecognized value falls back to `en` on load. Like the
timezone, a display-language section forces the timezone section to be
written too (even a workbook on the default `UTC` timezone), and a
cell-style section forces the display-language (and so timezone) sections
too, and a number-format section forces the cell-style section too, and
(further down the per-worksheet chain) a worksheet lock forces the
cell-style section too, and a non-default history section forces the
worksheet-lock section too, so the layout stays a strict prefix chain.

## Worksheet record

Each worksheet record:

| Size | Field                                                                                                                                                                                                                                       |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2+…  | Worksheet identifier (UTF-8, `u16` length; must be non-empty)                                                                                                                                                                               |
| 2+…  | Worksheet display name (UTF-8, `u16` length)                                                                                                                                                                                                |
| 4    | Row count, `u32`                                                                                                                                                                                                                            |
| 4    | Column count, `u32`                                                                                                                                                                                                                         |
| 4    | Cell count `C`, `u32`                                                                                                                                                                                                                       |
| …    | `C` cell records: row `u32`, column `u32`, length `u32`, bytes                                                                                                                                                                              |
| 1    | Display flags, `u8` (bit 0: zoom; bit 1: widths; bit 2: wrap)                                                                                                                                                                               |
| 2    | _(bit 0)_ Zoom percent, `u16`                                                                                                                                                                                                               |
| 4    | _(bit 1)_ Column-width entry count `W`, `u32`                                                                                                                                                                                               |
| …    | _(bit 1)_ `W` entries: column `u32`, width px at 100% zoom `u16`                                                                                                                                                                            |
| 1    | Filter flags, `u8` (bit 0: a filter block follows)                                                                                                                                                                                          |
| …    | _(bit 0)_ Filter block — identical layout to the single-sheet one                                                                                                                                                                           |
| 4    | _(v4+)_ Styled-cell count `Y`, `u32`                                                                                                                                                                                                        |
| …    | _(v4+)_ `Y` style records — identical layout to the single-sheet cell-styles block, each with a _(v5 only)_ number-format sub-record and a _(v6 only)_ per-border-side line-style+width byte appended                                       |
| 4    | _(v7+)_ Commented-cell count `Z`, `u32`                                                                                                                                                                                                     |
| …    | _(v7+)_ `Z` comment records — identical layout to the single-sheet cell-comments block                                                                                                                                                      |
| 1    | _(v8+)_ Worksheet kind, `u8` (`0` = grid, `1` = markdown, `2` = json, `3` = yaml, `4` = text — `2` legal only from v11, `3`/`4` only from v13 — see [grammar-single-sheet-body.md](grammar-single-sheet-body.md)'s worksheet-kind sections) |
| 1    | _(v9+)_ Worksheet locked, `u8` (`0` = unlocked, `1` = locked)                                                                                                                                                                               |

Cells are stored **sparsely**: only non-empty cells are written. When body
version 4 or higher is written, every worksheet record carries its own
style block (even a worksheet with no styled cells writes a zero count);
when body version 7 or higher is written, every worksheet record likewise
carries its own comment block; when body version 8 or higher is written,
every worksheet record carries the trailing kind byte; when body version 9
or higher is written, every worksheet record likewise carries the trailing
locked byte after it — exactly the way every other version-gated section
in this container is written unconditionally once its version is selected.

## Workbook bounds

Beyond the per-worksheet limits (the same as for a single-sheet body), a
workbook container enforces:

| Limit                                         | Value      |
| --------------------------------------------- | ---------- |
| Worksheets per workbook                       | 256        |
| Worksheet identifier / name (stored bytes)    | 400        |
| Cells summed across **all** worksheets        | 20,000,000 |
| Styled cells summed across **all** worksheets | 20,000,000 |

The worksheet count is validated **before** any worksheet is allocated,
each worksheet's declared dimensions are validated before its cells are
read, and the cell budget is accumulated across worksheets — so a
container cannot multiply its way past the ceiling by declaring many
worksheets. A worksheet count of `0` is `bad-shape` (a workbook always has
at least one worksheet); a count above the limit is `too-large`.
Duplicate worksheet identifiers are `bad-shape`. An active worksheet
identifier that names no worksheet is not an error: it falls back to the
first worksheet, so a partially-stale file still opens predictably. As
with the single-sheet body, the body must be consumed exactly — trailing
bytes are `bad-shape`.
