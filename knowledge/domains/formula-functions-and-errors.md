---
type: domain-concept
title: Formula functions and errors
description: The 55-function inventory by group, criteria syntax for COUNTIF/SUMIF, lookup semantics, Unicode-code-point-safe text functions, dates as numbers, and the full error code list.
sources:
  - resource: ../../README.md
  - resource: ../../src/core/formula-functions.ts
  - resource: ../../src/core/formula-criteria.ts
  - resource: ../../src/core/formula-date.ts
  - resource: ../../src/core/formula-text.ts
  - resource: ../../src/core/formula-value.ts
status: stable
generated:
  by: claude-code/claude-sonnet-5
  at: 2026-09-22T16:27:09Z
---

# Formula functions and errors

**This is not a claim of Excel or Google Sheets compatibility.** The
functions use familiar names and argument orders, and the great majority of
everyday formulas behave identically, but the differences documented here
are deliberate, not accidental.

## Function inventory

All 55 functions, grouped as they appear in the offline help
(**Help > Formula and Function Help**). `[square brackets]` mark optional
arguments. `src/core/formula-functions.ts`'s `FUNCTION_DEFS` is the single
shared source of truth for this list, the autocomplete metadata, and the
evaluator, so documented functions cannot drift from implemented ones — a
test enforces this.

| Group                      | Functions                                                                                           |
| -------------------------- | --------------------------------------------------------------------------------------------------- |
| Aggregation                | `SUM` `AVERAGE` `MIN` `MAX` `COUNT` `COUNTA` `COUNTBLANK`                                           |
| Conditional aggregation    | `COUNTIF` `COUNTIFS` `SUMIF` `SUMIFS` `AVERAGEIF` `AVERAGEIFS`                                      |
| Logical and error handling | `IF` `AND` `OR` `NOT` `IFERROR`                                                                     |
| Math and rounding          | `ROUND` `ROUNDUP` `ROUNDDOWN` `ABS` `MOD`                                                           |
| Lookup and reference       | `XLOOKUP` `VLOOKUP` `INDEX` `MATCH`                                                                 |
| Text                       | `LEFT` `RIGHT` `MID` `LEN` `TRIM` `CONCAT` `TEXTJOIN` `SUBSTITUTE` `REPLACE` `UPPER` `LOWER` `TEXT` |
| Date and time              | `TODAY` `NOW` `DATE` `YEAR` `MONTH` `DAY` `DATEDIF`                                                 |
| Statistics                 | `MEDIAN` `MODE.SNGL` `STDEV.S` `STDEV.P` `RANK.EQ`                                                  |
| Dynamic arrays             | `FILTER` `UNIQUE` `SORT` `SEQUENCE`                                                                 |

Dynamic-array functions (`FILTER`, `UNIQUE`, `SORT`, `SEQUENCE`, plus
`XLOOKUP`/`INDEX`/`IFERROR` when asked for a whole row or column) are
covered in depth in
[dynamic-arrays-and-spilling.md](dynamic-arrays-and-spilling.md).

## Errors

`#ERROR!` (does not parse), `#NAME?` (unknown function), `#VALUE!` (wrong
type or shape), `#DIV/0!`, `#REF!` (deleted or invalid reference),
`#CYCLE!` (circular reference — see
[formulas-and-references.md](formulas-and-references.md)), `#N/A` (lookup
found nothing), `#NUM!` (out of range or not a finite number), `#SPILL!` (a
dynamic array cannot write its result), and `#CALC!` (a dynamic array
produced no values). Errors propagate through every operator and function
except `IFERROR`.

## Criteria (`COUNTIF`, `SUMIF`, and friends)

A criterion is a value, or text beginning with a comparison operator:
`"apple"`, `"=apple"`, `"<>apple"`, `">10"`, `">=10"`, `"<5"`, `"<=5"`.

- Text comparison is **case-insensitive** and uses a fixed,
  locale-independent case fold, so results never depend on the host's
  language settings.
- `*` matches any run of characters and `?` matches exactly one Unicode
  code point. Write `~*`, `~?`, or `~~` for a literal one.
- An ordering comparison (`<`, `<=`, `>`, `>=`) with a numeric operand
  matches only numeric cells; with a text operand it matches only text
  cells — that is what stops `">10"` from counting the word `"zebra"`.
- `""` and `"="` match blank cells; `"<>"` matches non-blank ones.
- Every criteria range in one call must have the same shape; a mismatch is
  `#VALUE!` rather than a silently misaligned scan.
- Matching never compiles a regular expression. The wildcard matcher
  (`src/core/formula-criteria.ts`) is a hand-written, bounded scan whose
  worst case is proportional to pattern length × subject length, so no
  criterion can trigger catastrophic backtracking — see
  [`../operations/security-threat-model.md`](../operations/security-threat-model.md).

## Lookups

- `XLOOKUP` supports exact matching (`match_mode` 0, the default) and
  wildcard matching (2), searching first-to-last (`search_mode` 1, the
  default) or last-to-first (-1). The approximate modes (-1, 1) and the
  binary-search modes (2, -2) are **not implemented** and report
  `#VALUE!` — they are refused rather than silently downgraded to a
  different search.
- `VLOOKUP` and `MATCH` do offer approximate matching. It assumes the
  lookup column is sorted ascending (descending for `MATCH` with
  `match_type` -1); the scan is linear and forward, so unsorted input
  yields a defined but not meaningful answer, never a hang.
- Nothing found is `#N/A`, unless `XLOOKUP`'s `if_not_found` argument is
  given.
- Lookup arrays may live on another worksheet of the same workbook.

## Text and Unicode

`LEN`, `LEFT`, `RIGHT`, `MID`, `REPLACE`, and the `?` wildcard count
**Unicode code points**, never UTF-16 units and never grapheme clusters:

- Not UTF-16 units, so `LEFT` can never cut an emoji in half or emit a lone
  surrogate.
- Not grapheme clusters, because segmenting those depends on the host's
  bundled Unicode tables — and a `.rsf` file must compute the same values
  on every machine (see the determinism note in
  [`../operations/security-threat-model.md`](../operations/security-threat-model.md)).

So `LEN("日本語")` is 3 and `LEN("🍎")` is 1, while a combining accent
(`e` + U+0301) counts 2 and a three-person family emoji counts 5. `TRIM`
removes surrounding whitespace and collapses runs of ordinary spaces, but
never touches a line break or an ideographic space. Text results are capped
at 32,767 characters.

## Dates and times

A date is a **number**, not a separate kind of value:

- Serial `0` is **1899-12-30**; whole numbers are days and the fraction is
  the time of day, so `=A1+7` means a week later.
- That epoch makes RSF serials identical to Excel and Google Sheets for
  every date from **1900-03-01 onward**. RSF deliberately does not
  reproduce Excel's fictitious 1900-02-29, so for the 60 days before that
  an RSF serial is one greater than the Excel serial.
- **Date arithmetic is UTC.** `DATE`, `YEAR`, `MONTH`, `DAY`, and `DATEDIF`
  have no timezone or DST input at all, so they return the same answer on
  every machine.
- **`TODAY()` and `NOW()` use the workbook's own timezone**, not the
  opening machine's clock. Every workbook stores an IANA timezone
  (**Sheet > Timezone…**; a new workbook defaults to the browser's local
  zone), so a `.rsf` file still computes the same `TODAY()`/`NOW()`
  wherever it is opened — the timezone travels with the file. Changing it
  recalculates the workbook immediately. A file saved before this setting
  existed has no stored timezone and defaults to UTC, its original
  behavior. `TODAY()`/`NOW()` are volatile: they change only when the
  workbook is edited or **Sheet > Recalculate** is chosen — there is
  deliberately no background recalculation timer.
- **`TEXT()`'s date format codes** support `yyyy`, `yy`, `mm`, `dd`, `ddd`
  (abbreviated weekday), and `dddd` (full weekday), each usable at most
  once and joined by `-`, `/`, `.`, or a space (matching is
  case-insensitive, like Excel's own format codes). Any other format code
  is outside this documented subset and `TEXT()` returns `#VALUE!` rather
  than guessing.
- **`ddd`/`dddd` render in the workbook's own stored display language**
  (**Sheet > Display Language…**; a new workbook defaults to the
  application's current menu language), not the opening machine's UI
  language, for the same reproducibility reason as the timezone above. It
  is independent of the application's own English/日本語 menu-language
  toggle. A file saved before this setting existed has no stored display
  language and defaults to English.
- `DATE` rolls month and day overflow into neighbouring months and years,
  so `DATE(2020, 3, 0)` is 29 February 2020 and `DATE(2020, 13, 1)` is
  1 January 2021. A year of 0–1899 means 1900 + year.
- `DATEDIF` supports `"Y"`, `"M"`, `"D"`, `"YM"`, `"YD"`, and `"MD"`. `YD`
  and `MD` advance the start date to its last anniversary on or before the
  end date, so they never return the negative values Excel's `MD` is known
  for. A reversed range or an unknown unit is an error, not a guess.
- **Dates display as their serial number.** Cell number formats
  (**Format > Number Format…**) offer Number, Percent, and Currency, but
  no date kind, so applying one to a date cell only changes how the serial
  itself is displayed — use `YEAR`/`MONTH`/`DAY`, or `TEXTJOIN`, to present
  a date readably.
