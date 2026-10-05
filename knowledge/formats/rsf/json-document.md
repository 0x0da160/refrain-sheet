---
type: format-concept
title: RSF JSON document
description: The JSON inside a .rsf file — every key of the workbook, worksheet, view, style, filter, comment, and history objects, how they are laid out for a text editor, and what the reader validates.
sources:
  - resource: ../../../src/core/workbook/rsf-codec.ts
  - resource: ../../../src/core/workbook/history-delta.ts
  - resource: ../../../src/core/workbook/rsf-folders.ts
  - resource: ../../../src/core/workbook/rsf-sheet-extras.ts
  - resource: ../../../src/core/workbook/rsf-sheet-charts.ts
  - resource: ../../../tests/core/rsf-codec.test.ts
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
`src/core/workbook/rsf-codec.ts`.

## Layout

The writer emits **compact** JSON, with no whitespace between tokens, to
keep files small; `jq .` (or any JSON formatter) makes it readable. A
source worksheet's text is stored as `lines`, one element per line.
Releases up to 0.9.14 pretty-printed (2-space indentation, one grid row
per line). Readers must not depend on either layout; any valid JSON with
the same content is the same document.

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
| `folders`          | array of objects | no       | Sheet folders (below), at most 256. Left out when the file has none.                     |
| `sheets`           | array of objects | yes      | 1–256 worksheets, in tab order (see below).                                              |
| `images`           | object           | no       | The pictures image objects show (below), keyed by id. Left out when the file has none.   |
| `history`          | object           | no       | Version history (see below). Left out when history is on with no snapshots and no limit. |

## Worksheet

| Key           | Type             | Meaning                                                                                  |
| ------------- | ---------------- | ---------------------------------------------------------------------------------------- |
| `id`          | string (1–255)   | Stable internal identifier, unique in the workbook; a duplicate is `bad-shape`.          |
| `name`        | string           | Display name used by cross-sheet formulas (at most 400 UTF-8 bytes).                     |
| `kind`        | string           | `grid` (default), `markdown`, `json`, `yaml`, or `text`.                                 |
| `locked`      | boolean          | Protected against editing. Left out when `false`.                                        |
| `tabColor`    | string           | The tab's color, `#rrggbb` (written lowercase). Left out when none; else `bad-shape`.    |
| `folder`      | string           | The id of the folder (in `folders`) the worksheet is in. Left out at the top level.      |
| `rows`        | integer          | Grid only: row count, 1–2,000,000.                                                       |
| `cols`        | integer          | Grid only: column count, 1–16,384 (and `rows × cols` at most 20,000,000).                |
| `cells`       | array of arrays  | Grid only: rows of cell inputs (below).                                                  |
| `lines`       | array of strings | Source kinds only: the document text, split on `\n`.                                     |
| `view`        | object           | Display settings (below).                                                                |
| `filter`      | object           | The worksheet's filter (below).                                                          |
| `styles`      | object           | Cell formatting keyed by A1 reference (below).                                           |
| `comments`    | object           | Cell comments keyed by A1 reference: `{ "B2": "text" }` (at most 2,000 characters each). |
| `validations` | array of objects | Grid only: data-validation rules (below), at most 64. Left out when none.                |
| `objects`     | array of objects | Grid only: shapes over the grid (below), bottom to top, at most 1,000. Left out if none. |
| `paper`       | integer          | Grid only: makes it a grid-paper sheet (below), the side of one square in px (8–64).     |

### Grid paper

A grid worksheet with `paper` is a grid-paper sheet, for forms, screen
mock-ups and wireframes (`src/core/workbook/grid-paper.ts`). The app draws
every row and column `paper` pixels wide (at 100% zoom), keeps its cells
empty (text goes in text boxes, which are `objects`), and snaps objects to
the squares. Its `cells`, `styles` and other grid keys keep their usual
meaning. A reader that does not know `paper` ignores it and shows an
ordinary grid with the same objects, so the key keeps `"version": 1`.

### Folders

`folders` lists the sheet folders: `{ "id", "name", "parent" }`. `id` is a
string of 1–255 characters, unique among folders; `name` is non-empty text
of at most 400 UTF-8 bytes; `parent`, when present, is the id of the
folder this one is inside (absent = top level). A worksheet's `folder`
names the one folder it is in. An unknown `folder` or `parent`, a
duplicate id, a folder inside itself (at any depth), or a `folder` without
a `folders` list is `bad-shape`; more than 256 folders is `too-large`.

The folders do not reorder anything: `sheets` stays the one worksheet
order. A folder shows where its first worksheet is, and an empty folder
after its parent's other items; the application keeps each folder's
worksheets next to one another in `sheets`. Readers older than these keys
ignore them and show the worksheets in `sheets` order, without folders.

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

| Key            | Type    | Meaning                                                                          |
| -------------- | ------- | -------------------------------------------------------------------------------- |
| `zoom`         | number  | Zoom percent, clamped into 50–200 on load.                                       |
| `wrap`         | boolean | Wrap long cells onto several lines.                                              |
| `font`         | string  | Spreadsheet font id (`biz-ud`, `ms`, …): 1–64 of `a-z 0-9 -`, else `bad-shape`.  |
| `colWidths`    | object  | Width in pixels at 100% zoom per column letter: `{ "B": 240 }`, clamped 40–1200. |
| `bands`        | boolean | Tint every other row (banded rows).                                              |
| `bandLevel`    | number  | Band strength: `1` light, `2` medium, `3` dark; any other value is `bad-shape`.  |
| `gridlines`    | boolean | Draw the lines between cells.                                                    |
| `rowHighlight` | boolean | Tint the selected cell's row.                                                    |
| `colHighlight` | boolean | Tint the selected cell's column.                                                 |

A width for a column past `cols` is dropped; a key that is not a column
letter is `bad-shape`. The grid-look keys (`bands` through `colHighlight`)
store `false` as well as `true`, since `false` is a choice ("no gridlines")
rather than "not specified"; a boolean of the wrong type is `bad-shape`.
`wrap: false` is stored and read only for a `markdown`, `json`, `yaml` or
`text` worksheet, which wraps unless told otherwise; on a `grid` worksheet
it is not written and is read as "not specified", as before. For those four
kinds `zoom` and `wrap` are the worksheet's own: the file-level `view` does
not apply to them.

### File-level view

The top-level `view` holds display settings for every worksheet: `zoom`
(number, clamped into 50–200), `font` and the grid-look keys (same rules as a worksheet's) and `wrap` (boolean; unlike a worksheet's,
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
| `fontFamily`                                             | string  | The cell's own font, by family name                       |
| `fontSize`                                               | number  | The cell's own font size in points                        |
| `horizontalAlign`                                        | string  | `left`, `center` or `right`; absent is the start (left)   |
| `runs`                                                   | array   | Rich text: parts of the cell's text with their own format |

A line style or width without its border color is ignored. `numberFormat`'s
`kind` is `number`, `percent`, or `currency`; `decimals` is an integer
0–10; `currencySymbol` (currency only) is cut to 4 characters. Any other
value is `bad-shape`.

`fontFamily` is a family name of 1–100 characters without control
characters, `"` or `\`; `fontSize` is a half point from 6 to 96 (`10.5`).
The name is kept as written even where that font is not installed: a reader
shows the text in its own sheet font instead and writes the name back
unchanged. Any other value is `bad-shape`. Readers older than these keys
ignore them and show the cell in the sheet font and size.

`horizontalAlign` places the text across the cell: `left`, `center` or
`right`. Absent keeps the text at the start of the cell, as before this key.
Any other value is `bad-shape`. Readers older than this key ignore it and
show the text at the start of the cell.

`runs` lists the cell's text as segments,
`[{ "text": "Hello " }, { "text": "world", "bold": true }]`, each with
optional `bold`, `italic`, `underline` (booleans; `false` switches off the
whole cell's value for that part), `textColor` (`#rrggbb`), `fontFamily`
and `fontSize` (as on the cell). An absent key
inherits the cell's own style. The segments must spell out the cell's input
exactly; the writer leaves `runs` out when they do not (the text was changed
without them) and for formulas, and a reader shows such runs as plain text.
At most 10,000 segments (`too-large` beyond); a segment that is not an object
with a string `text`, or a value of the wrong type, is `bad-shape`. Readers
older than this key ignore it and show the text with the cell's own style.

### Filter

`filter` has the in-memory shape of `SheetFilter` (`src/core/workbook/filter.ts`):
`top`, `left`, `bottom`, `right` (0-based, inclusive), `headerRow`, and
`columns`, each with `col`, `join` (`and`/`or`), `conditions` (`{ kind:
"text", op, value }` or `{ kind: "number", op, value, value2? }`), and
`values` (a list of allowed display values, or `null`). It is validated
against the worksheet; a filter that fails validation is **dropped** and
the user is warned, while the rest of the file loads.

### Validations

`validations` lists the worksheet's data-validation rules in the order they
were applied; where ranges overlap, the later rule wins. Each entry has a
`range` (two A1 references as the writer spells them, upper case, no `$`,
top left first, inside the worksheet) and one kind of rule:

| Entry                                                         | The cell must be                                           |
| ------------------------------------------------------------- | ---------------------------------------------------------- |
| `"list": ["Yes", "No"]`                                       | one of the values (1–500 non-empty, at most 2,000 chars)   |
| no `type`; `"min"`, `"max"`, `"integer": true` (all optional) | a number, within the bounds; a whole number with `integer` |
| `"type": "textLength"`, `"min"` and/or `"max"`                | text of that many characters (whole numbers, 0–1,000,000)  |
| `"type": "date"`, `"min"`, `"max"` (optional)                 | a date written `YYYY-MM-DD`, within the bounds (same form) |

Two flags may be added to any entry, each only as `true`: `"required"` (a
blank cell fails; otherwise a blank always passes) and `"toEnd"` (a column
rule: it also covers every row below the range, so rows added after the
last one are covered). A bound must not be above the other. Anything
else — an unknown `type`, a `list` with `type`/`min`/`max`/`integer`,
`integer` on a non-number rule, a flag set to anything but `true`, or the
key on a source worksheet — is `bad-shape`; more than 64 rules or 500
values is `too-large`. Releases older than this key ignore it and apply no
rules.

### Objects

`objects` lists the shapes placed over a grid worksheet, bottom to top (the
last is drawn on top). Each is anchored to a cell, so it moves when rows or
columns are inserted or deleted before it, and moves without resizing when
a row height or column width changes.

| Key                        | Type   | Meaning                                                                            |
| -------------------------- | ------ | ---------------------------------------------------------------------------------- |
| `id`                       | string | 1–32 of `A-Z a-z 0-9 _ -`, unique in the worksheet.                                |
| `name`                     | string | Shown in the object list: 1–100 characters, no control characters.                 |
| `kind`                     | string | `rect`, `ellipse`, `line`, `arrow`, `text` (a text box), `image`, or `chart`.      |
| `at`                       | string | The anchor cell, an A1 reference as the writer spells it, inside the worksheet.    |
| `dx`, `dy`                 | number | The top-left corner's offset from the anchor cell's, in pixels at 100%, 0–1e5.     |
| `width`, `height`          | number | The size in pixels at 100%, 0–100,000 (a straight line may be 0 either way).       |
| `rotation`                 | number | Clockwise degrees, above 0 and below 360. Left out when 0.                         |
| `flipH`, `flipV`           | `true` | A line or arrow starts at the right / bottom of its box instead of the left/top.   |
|                            |        | An image is mirrored left to right / top to bottom.                                |
| `fill`, `stroke`           | string | `#rrggbb` (lowercase) or `none`. Left out: the kind's default.                     |
| `strokeWidth`              | number | Line width in pixels at 100%, 0.25–20.                                             |
| `text`                     | string | The text on the shape, at most 10,000 characters.                                  |
| `textColor`                | string | `#rrggbb` (lowercase).                                                             |
| `fontSize`                 | number | Points, a half point from 6 to 96.                                                 |
| `bold`, `italic`           | `true` | Text style.                                                                        |
| `align`, `valign`          | string | `left`/`center`/`right` and `top`/`middle`/`bottom`.                               |
| `hidden`                   | `true` | Not drawn or printed; still listed.                                                |
| `lockPosition`, `lockEdit` | `true` | 配置を固定 (no move or resize) and 編集をロック (no move, resize, edit or delete). |
| `image`                    | string | Image only, required: the id of its picture in the file's `images`.                |
| `crop`                     | object | Image only: `{ "top", "right", "bottom", "left" }`, percent cut off each side.     |
| `aspectFree`               | `true` | Image only: resizing may change its width-to-height ratio.                         |
| `chart`                    | object | Chart only, required: the chart's type, cells and settings (Charts, below).        |
| `group`                    | string | The group it belongs to: 1–32 of `A-Z a-z 0-9 _ -`, shared by every member.        |

Anything else in a known key — a flag set to anything but `true`, an
anchor spelled another way or outside the worksheet, a duplicate `id`, an
unknown `kind`, or the key on a source worksheet — is `bad-shape`; more
than 1,000 objects is `too-large`. Releases older than this key ignore it
and show no shapes.

Objects that share a `group` id are one group: the application picks,
moves, copies and lines them up together, and each member keeps its own
settings. Groups do not nest; a group id is only a name, so a group of one
object is allowed.

An image object's `crop` values are each at least 0 and below 100, with
`top + bottom` and `left + right` below 100; what is left of the picture
fills the object's box. An image object with `text`, an `image` that names
no picture in `images`, or `image`, `crop` or `aspectFree` on another kind
is `bad-shape`.

### Charts

A chart object's `chart` shows a bar, line or pie chart of one rectangular
range of a grid worksheet, recalculated as its cells change.

| Key            | Type   | Meaning                                                                                    |
| -------------- | ------ | ------------------------------------------------------------------------------------------ |
| `type`         | string | `bar`, `line` or `pie`.                                                                    |
| `source`       | object | `{ "sheet": "<worksheet id>", "range": "A1:C5" }`: the cells shown.                        |
| `data`         | object | `{ "categories": [string], "series": [{ "name"?: string, "values": [number or null] }] }`. |
| `seriesInRows` | `true` | Each row of the range is a series (by default each column is).                             |
| `title`        | string | The chart's title.                                                                         |
| `legend`       | string | `bottom` or `none`. Left out: at the right.                                                |
| `xTitle`       | string | The category axis title (bar and line).                                                    |
| `yTitle`       | string | The value axis title (bar and line).                                                       |
| `colors`       | array  | `#rrggbb` (lowercase) per series (pie: per slice), in order; the rest use defaults.        |
| `dataLabels`   | `true` | Each value is shown next to its bar, point or slice.                                       |

Exactly one of `source` and `data` is set. `source.range` is spelled as the
writer spells it (upper case, no `$`, top-left corner first) and must lie
inside `source.sheet`, which must be a grid worksheet of the file. `data` is
what the chart keeps when the worksheet it showed is deleted: each series
has one value (a finite number or `null`) per category. Texts are at most
255 characters; at most 50 series (and colors) and 1,000 categories.

The range follows its cells: inserting or deleting rows or columns in the
worksheet moves, grows or shrinks it (the chart itself may be on any
worksheet). Which cells are names is read from the range, not stored: the
first row holds the series names when any of its cells (other than the
top-left one) is text, and the first column the category names when any of
its cells is text, or when the top-left cell is empty above series names.

Anything else — an unknown `type` or `legend`, both or neither of `source`
and `data`, a range spelled another way, outside its worksheet or on a
worksheet the file does not hold, `text` on a chart object, or `chart` on
another kind — is `bad-shape`. Charts arrived after `objects`, before any
release that reads `objects`.

### Images

The top-level `images` holds each picture once, however many image objects
(on any worksheet) show it: `{ "<id>": { "type", "data" } }`.

| Key    | Type   | Meaning                                                                    |
| ------ | ------ | -------------------------------------------------------------------------- |
| `type` | string | `image/png`, `image/jpeg`, `image/webp`, or `image/svg+xml`.               |
| `data` | string | The picture's bytes as Base64 (standard alphabet, padded, no line breaks). |

An id is 1–64 of `A-Z a-z 0-9 _ -`. The writer names a picture from its
bytes (`img-` and a hash), but readers must not depend on that. The
picture's bytes must be what `type` says — PNG and JPEG and WebP by their
signature, SVG as UTF-8 text with an `<svg` element — else `bad-shape`; a
picture over 20 MiB, or more than 1,000 pictures, is `too-large`. The writer
keeps only the pictures some image object shows. An application shows a
picture only as an image (for SVG: never as a document, so its scripts and
external references stay inert). Every release older than this key also
predates `objects`, so it opens such a file without its shapes and
pictures.

## History

| Key         | Type             | Meaning                                                                            |
| ----------- | ---------------- | ---------------------------------------------------------------------------------- |
| `enabled`   | boolean          | Whether saves record snapshots (default `true`).                                   |
| `limit`     | integer or null  | Retained-snapshot cap, 1–500; `null` means unlimited (still at most 500).          |
| `deltas`    | array of objects | Snapshots as deltas, oldest first, at most 500: `{ "at": ISO time, "delta" }`.     |
| `snapshots` | array of objects | Snapshots as full copies (written up to 0.9.14): `{ "at": ISO time, "workbook" }`. |

A snapshot is a workbook object without `format`, `version`, or `history`
— so history never nests. The writer stores `deltas`; readers accept either
key, never both (`bad-shape`), and more than 500 entries is `too-large`.

**Deltas.** The newest entry's `delta` turns the document's own workbook
(the top level without `format`, `version`, and `history`) into that
snapshot; each earlier entry's `delta` turns the snapshot after it into
its own. A delta is one of:

| Form                                        | Applies to | Result                                                                                                        |
| ------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------- |
| `{ "v": value }`                            | anything   | `value`.                                                                                                      |
| `{ "o": { key: delta }, "d": [], "k": [] }` | an object  | Each key in `o` changed by its delta (a new key's delta must be `v`), each key in `d` removed, the rest kept. |
| `{ "a": [[index, delta], …] }`              | an array   | The same length; each listed element (ascending indexes) changed by its delta.                                |
| `{ "s": [start, deleteCount, [items]] }`    | an array   | `deleteCount` elements at `start` replaced by `items` (an inserted or deleted row, a new worksheet).          |

`d` and `k` are optional. Keys keep the base's order with new keys
appended, unless `k` lists the result's keys in order. An index, count, or
key that does not fit, an unknown form, nesting deeper than 32, or a
result that is not a workbook object is `bad-shape`; the rebuilt snapshots
together may not exceed 512 MiB of JSON (`too-large`). A file with no
changes since its newest snapshot stores `{ "o": {} }` for it.

Snapshots are validated as workbooks in full only when one is previewed or
restored; a bad one fails then, not the file. Readers older than `deltas`
ignore the key: they open the file without its history, and saving there drops it.

## What the reader rejects

Validation is strict and never guesses: a known key with the wrong type or
out of its range fails the whole file (`bad-shape`, or `too-large` for a
size bound), except where the tables above say a value is clamped, dropped,
or falls back. Unknown keys are ignored, so a later minor addition can be
read by this release. Cell values, names, and comments are always plain
text, never HTML or code.
