---
type: format-concept
title: RSF formula value model
description: Value kinds, the error set, and date-serial semantics (including the workbook-timezone and display-language dependence of TODAY/NOW/TEXT).
sources:
  - resource: docs/rsf-format.md (migrated content; file removed after migration — see knowledge/log.md)
  - resource: ../../../src/core/formula-value.ts
  - resource: ../../../src/core/formula-date.ts
status: stable
generated:
  by: claude-code/claude-sonnet-5
  at: 2026-09-22T12:09:14Z
---

# The formula value model

A formula value is one of: **blank**, **number** (always a finite double),
**text**, **boolean**, **error**, or — only where arrays are allowed — a
rectangular **array**. Coercion rules are stated exhaustively in
`src/core/formula-value.ts` and summarized in the offline help.

Dates are **not** a separate value kind; they are numbers on the serial
scale below. That is why `=A1+7` means "a week later" with no special
case, and why a date displays as its serial number: this container stores
no per-cell number formats, so there is nothing to render a serial as a
calendar date.

## The error set

| Error     | Meaning                                                                                   |
| --------- | ----------------------------------------------------------------------------------------- |
| `#ERROR!` | The formula does not parse.                                                               |
| `#NAME?`  | Unknown function or name.                                                                 |
| `#VALUE!` | Wrong type, or wrong shape (mismatched ranges, a range where a single value is required). |
| `#DIV/0!` | Division by zero, or an average/deviation with no eligible values.                        |
| `#REF!`   | A deleted or out-of-range reference.                                                      |
| `#CYCLE!` | A circular reference, detected across worksheets.                                         |
| `#N/A`    | A lookup found no match.                                                                  |
| `#NUM!`   | Out of range, or a result that is not a finite number.                                    |
| `#SPILL!` | A dynamic array cannot write its result (see [dynamic-arrays.md](dynamic-arrays.md)).     |
| `#CALC!`  | A dynamic array produced no values at all.                                                |

Errors are values: they propagate through every operator and function
except `IFERROR`. An error code **typed literally into a cell** stays text
and never propagates — only the engine creates error values.

## Date serials

- Serial `0` is **1899-12-30T00:00:00Z**. Whole numbers are days; the
  fractional part is the time of day.
- The calendar is proleptic Gregorian, so 1900 is a common year. This
  matches Excel and Google Sheets for every date from **1900-03-01**
  onward and deliberately omits Excel's fictitious 1900-02-29, which makes
  RSF serials one greater than Excel's for the 60 days before that date.
- Valid serials run from `0` to 9999-12-31; anything outside is `#NUM!`.
- **All conversions in the formula engine itself are UTC.** No function in
  `src/core/formula-date.ts` reads a timezone or a DST rule directly, so
  `DATE`, `YEAR`, `MONTH`, `DAY`, and `DATEDIF` return the same answer on
  every machine regardless of any setting.
- **`TODAY()` and `NOW()` read the workbook's own stored timezone**, not
  the opening machine's clock (see
  the `timezone` key in [json-document.md](json-document.md#workbook-top-level)).
  The workbook shifts the real host-clock instant by its stored IANA
  zone's offset before handing it to the UTC-only formula engine, so
  "today" means the current date in the workbook's own timezone. Because
  that timezone travels with the file, a `.rsf` file still computes the
  same `TODAY()`/`NOW()` wherever it is opened. A file with no stored
  timezone defaults to `UTC`, its exact original behavior.
- **`TEXT()`'s `ddd`/`dddd` weekday-name tokens read the workbook's own
  stored display language** (see
  the `language` key in [json-document.md](json-document.md#workbook-top-level)),
  not the opening machine's active UI language, for the same reason: the
  same formula renders identical text wherever the file is opened. A file
  with no stored display language, or an unrecognized value, defaults to
  `en`.

## Volatile formulas

`TODAY()` and `NOW()` depend on the clock rather than on cells. The clock
the whole workbook reads advances at exactly three moments:

1. when the workbook is created or loaded,
2. on any mutation (which invalidates the evaluation memo anyway),
3. when **Sheet > Recalculate** is chosen.

There is **no background timer**. An idle workbook never recalculates on
its own, so an open tab cannot burn CPU and a document cannot appear to
change by itself. Volatility is a property of the function, recorded in
the registry, and is not stored in the file.
