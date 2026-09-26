---
type: format-concept
title: RSF JSON document
description: The JSON inside a .rsf file — every key of the workbook, worksheet, view, style, filter, comment, and history objects, how they are laid out for a text editor, and what the reader validates.
sources:
  - resource: ../../../src/core/rsf-codec.ts
  - resource: ../../../tests/rsf-codec.test.ts
  - resource: ../../../tests/fixtures/rsf/v1/features.rsf
status: stable
generated:
  by: claude-code
  at: 2026-09-23T16:00:00Z
---

# The RSF JSON document

After the container is unwrapped (see [overview.md](overview.md)), a `.rsf`
file is one UTF-8 JSON document (no BOM). This page is its full
specification for format **version 1**. The reference implementation is
`src/core/rsf-codec.ts`.

## Layout

The writer pretty-prints for a text editor:

- 2-space indentation;
- an array of plain values stays on **one line** — so each grid row is
  one line, and a diff shows exactly which rows changed;
- an object of plain values stays inline when it fits in about 100
  characters (a style, a column-width table);
- a source worksheet's text is stored as `lines`, **one element per line**.

Readers must not depend on this layout; any valid JSON with the same
content is the same document.

## Workbook (top level)

| Key                | Type             | Required | Meaning                                                                                  |
| ------------------ | ---------------- | -------- | ---------------------------------------------------------------------------------------- |
| `format`           | string           | yes      | Always `"refrain-sheet"`. Anything else is `bad-shape`.                                  |
| `version`          | integer          | yes      | The document version, `1`. Any other value is `bad-version`.                             |
| `app`              | object           | no       | `{ "name", "version" }` of the application that last saved the file.                     |
| `id`               | string           | no       | Stable workbook identifier, kept across saves.                                           |
| `created`          | ISO 8601 string  | no       | When the workbook was created. Unparseable values are ignored.                           |
| `updated`          | ISO 8601 string  | no       | When it was last saved. Unparseable values are ignored.                                  |
| `delimiter`        | string           | no       | `","` (default), `";"`, or `"\t"`: the default for CSV export.                           |
| `timezone`         | string           | no       | IANA zone for `TODAY()`/`NOW()`. Left out for UTC; an unknown zone falls back to UTC.    |
| `language`         | string           | no       | `"ja"` for `TEXT()` weekday names. Left out for English; an unknown value falls back.    |
| `activeSheet`      | string           | no       | The id of the worksheet to show on open; the first one when missing or unknown.          |
| `autoFormatSource` | boolean          | no       | Whether the JSON/YAML editors reformat their source on commit. Left out when `false`.    |
| `view`             | object           | no       | File-level display settings (below). Left out when the file specifies none.              |
| `sheets`           | array of objects | yes      | 1–256 worksheets, in tab order (see below).                                              |
| `history`          | object           | no       | Version history (see below). Left out when history is on with no snapshots and no limit. |

## Worksheet

| Key        | Type             | Meaning                                                                                  |
| ---------- | ---------------- | ---------------------------------------------------------------------------------------- |
| `id`       | string (1–255)   | Stable internal identifier, unique in the workbook; a duplicate is `bad-shape`.          |
| `name`     | string           | Display name used by cross-sheet formulas (at most 400 UTF-8 bytes).                     |
| `kind`     | string           | `grid` (default), `markdown`, `json`, `yaml`, or `text`.                                 |
| `locked`   | boolean          | Protected against editing. Left out when `false`.                                        |
| `rows`     | integer          | Grid only: row count, 1–2,000,000.                                                       |
| `cols`     | integer          | Grid only: column count, 1–16,384 (and `rows × cols` at most 20,000,000).                |
| `cells`    | array of arrays  | Grid only: rows of cell inputs (below).                                                  |
| `lines`    | array of strings | Source kinds only: the document text, split on `\n`.                                     |
| `view`     | object           | Display settings (below).                                                                |
| `filter`   | object           | The worksheet's filter (below).                                                          |
| `styles`   | object           | Cell formatting keyed by A1 reference (below).                                           |
| `comments` | object           | Cell comments keyed by A1 reference: `{ "B2": "text" }` (at most 2,000 characters each). |

### Cells

`cells` is a dense list of rows, each a list of strings. A cell's string is
its **raw input** exactly as typed: a formula is a string starting with `=`
(`"=SUM(A1:A3)"`), a number is its text (`"1.10"` stays `"1.10"`). An empty
string is an empty cell. The writer trims trailing empty cells from each
row and trailing empty rows, so `cells` may be shorter than `rows` and a
row shorter than `cols`; neither may be longer (`bad-shape`). A value that
is not a string is `bad-shape`; one longer than 1,000,000 characters is
`too-large`.

### View

| Key         | Type    | Meaning                                                                          |
| ----------- | ------- | -------------------------------------------------------------------------------- |
| `zoom`      | number  | Zoom percent, clamped into 50–200 on load.                                       |
| `wrap`      | boolean | Wrap long cells onto several lines.                                              |
| `font`      | string  | Spreadsheet font id (`biz-ud`, `ms`, …): 1–64 of `a-z 0-9 -`, else `bad-shape`.  |
| `colWidths` | object  | Width in pixels at 100% zoom per column letter: `{ "B": 240 }`, clamped 40–1200. |

A width for a column past `cols` is dropped; a key that is not a column
letter is `bad-shape`.

### File-level view

The top-level `view` holds display settings for every worksheet: `zoom`
(number, clamped into 50–200), `font` (same rule as a worksheet's) and `wrap` (boolean; unlike a worksheet's,
`false` is stored, because it means "don't wrap" rather than "not
specified"). A key that is present applies to every worksheet whose own
`view` does not set that key: the **worksheet wins**. The application adds
one broader level below the file — this browser's defaults from File >
Settings… — so the order is worksheet > file > browser
(`src/core/settings-cascade.ts`). A value of the wrong type is `bad-shape`. A well-formed font id the
application does not know counts as "not specified".
Readers older than this key ignore it and use the worksheet settings.

### Styles

`styles` maps an A1 reference (`"B2"`) to a style object; a reference
outside the grid, or a malformed one, is `bad-shape`.

| Key                                                      | Type    | Meaning                                                   |
| -------------------------------------------------------- | ------- | --------------------------------------------------------- |
| `bold`, `italic`, `underline`                            | boolean | Text emphasis.                                            |
| `textColor`, `backgroundColor`                           | string  | `#rrggbb`.                                                |
| `borderTop`, `borderRight`, `borderBottom`, `borderLeft` | string  | Border color, `#rrggbb`.                                  |
| `border…Style`                                           | string  | `solid` (default, left out), `dashed`, `dotted`, `double` |
| `border…Width`                                           | string  | `thin` (default, left out), `medium`, `thick`             |
| `numberFormat`                                           | object  | `{ "kind", "decimals", "thousands", "currencySymbol" }`   |
| `runs`                                                   | array   | Rich text: parts of the cell's text with their own format |

A line style or width without its border color is ignored. `numberFormat`'s
`kind` is `number`, `percent`, or `currency`; `decimals` is an integer
0–10; `currencySymbol` (currency only) is cut to 4 characters. Any other
value is `bad-shape`.

`runs` lists the cell's text as segments,
`[{ "text": "Hello " }, { "text": "world", "bold": true }]`, each with
optional `bold`, `italic`, `underline` (booleans; `false` switches off the
whole cell's value for that part) and `textColor` (`#rrggbb`). An absent key
inherits the cell's own style. The segments must spell out the cell's input
exactly; the writer leaves `runs` out when they do not (the text was changed
without them) and for formulas, and a reader shows such runs as plain text.
At most 10,000 segments (`too-large` beyond); a segment that is not an object
with a string `text`, or a value of the wrong type, is `bad-shape`. Readers
older than this key ignore it and show the text with the cell's own style.

### Filter

`filter` has the in-memory shape of `SheetFilter` (`src/core/filter.ts`):
`top`, `left`, `bottom`, `right` (0-based, inclusive), `headerRow`, and
`columns`, each with `col`, `join` (`and`/`or`), `conditions` (`{ kind:
"text", op, value }` or `{ kind: "number", op, value, value2? }`), and
`values` (a list of allowed display values, or `null`). It is validated
against the worksheet; a filter that fails validation is **dropped** and
the user is warned, while the rest of the file loads.

## History

| Key         | Type             | Meaning                                                                           |
| ----------- | ---------------- | --------------------------------------------------------------------------------- |
| `enabled`   | boolean          | Whether saves record snapshots (default `true`).                                  |
| `limit`     | integer or null  | Retained-snapshot cap, 1–500; `null` means unlimited (still at most 500).         |
| `snapshots` | array of objects | Oldest first, at most 500 (`too-large` beyond): `{ "at": ISO time, "workbook" }`. |

A snapshot's `workbook` is a workbook object without `format`, `version`,
or `history` — so history never nests. Snapshots are validated in full only
when one is previewed or restored; a bad one fails then, not the file.

## What the reader rejects

Validation is strict and never guesses: a known key with the wrong type or
out of its range fails the whole file (`bad-shape`, or `too-large` for a
size bound), except where the tables above say a value is clamped, dropped,
or falls back. Unknown keys are ignored, so a later minor addition can be
read by this release. Cell values, names, and comments are always plain
text, never HTML or code.
