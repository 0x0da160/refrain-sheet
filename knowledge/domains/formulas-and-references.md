---
type: domain-concept
title: Formulas and references
description: Formula syntax, the four A1-style reference forms, whole-column/row ranges, cross-sheet references and quoting, what worksheet lifecycle changes do to references, and circular-reference detection.
sources:
  - resource: ../../README.md
  - resource: ../../src/core/formula.ts
status: stable
generated:
  by: claude-code/claude-sonnet-5
  at: 2026-09-22T16:27:09Z
---

# Formulas and references

RSF-only (see [workbook-and-worksheet-lifecycle.md](workbook-and-worksheet-lifecycle.md)):
plain CSV documents have no formula concept.

## Syntax

A cell whose input begins with `=` is a formula. The grid shows the computed
value; the formula bar shows the underlying expression. 55 functions are
supported (see
[formula-functions-and-errors.md](formula-functions-and-errors.md)), plus
operators `+ - * /`, parentheses, the comparisons `= <> < > <= >=`, and
numeric / string / boolean (`TRUE`, `FALSE`) literals. The engine
(`src/core/formula.ts` and the `formula-*.ts` family) is a hand-written
parser and evaluator — there is no `eval`, no `new Function`, no dynamic
code generation, no macros, and loading a document never executes anything;
see
[`../operations/security-threat-model.md`](../operations/security-threat-model.md)
for why that matters against a hostile file.

## References

References may be single cells (`A1`), rectangular ranges (`A1:B3`), and
whole columns or rows (`A:A`, `A:C`, `1:1`, `2:10`), bounded to the used
grid.

**All four A1-style forms** are supported, including as range endpoints and
on whole-column/row spans:

| Form   | Meaning         | Example                  |
| ------ | --------------- | ------------------------ |
| `A1`   | relative        | `A1`, `SUM(A1:A10)`      |
| `$A$1` | absolute        | `$A$1`, `SUM($A$1:$A10)` |
| `$A1`  | absolute column | `$A1`, `$A:C`            |
| `A$1`  | absolute row    | `A$1`, `$1:10`           |

The `$` markers are preserved exactly as written when formulas are
displayed, stored, and rewritten. Copying, pasting, filling, and Insert
Copied Cells/Rows/Columns shift only the relative components; absolute
components stay fixed. Row/column insertion and deletion adjust absolute
and relative references alike (both keep pointing at the same data),
preserving the markers.

## Cross-sheet references

A reference can address another worksheet of the same workbook:
`Sheet1!A1`, `Sheet1!A1:B10`, `Sheet1!$A$1`, `SUM(Sheet1!A1:A10)`.

- Wrap the worksheet name in single quotes when it is not a plain
  identifier — `'Quarter 1'!A1`, `'Quarter 1'!$A$1:$B10` — and double a
  literal single quote inside it (`'O''Brien'!A1`).
- An unqualified reference always means the current worksheet, and
  worksheet names match case-insensitively.
- Circular references are detected **across** worksheets, not just within
  one.
- Ranges spanning two worksheets (`Sheet1!A1:Sheet2!B2`, "3D" ranges) are
  deliberately not supported and report `#ERROR!` rather than guessing.

The container-level grammar for how a cross-sheet reference is encoded is
covered by
[`../formats/rsf/cross-sheet-references.md`](../formats/rsf/cross-sheet-references.md);
this section is the syntax a person types.

## What worksheet lifecycle changes do to references

- **Rename** rewrites every reference to that worksheet across the workbook
  (re-quoting as needed) without changing any result.
- **Delete** turns references to the deleted worksheet into `#REF!` — never
  silently redirected to another worksheet.
- **Duplicate** copies formulas verbatim: qualified references still point
  at the worksheets they name, while unqualified ones stay relative to the
  copy.
- **Insert/delete rows or columns** rewrites references in the whole
  worksheet — and `Name!`-qualified references to it from every other
  worksheet — as one atomic, undoable operation. A formula's own unqualified
  references are never moved by an edit on a different worksheet.

Every one of these rewrites rides inside the same `HistoryEntry` as the
structural change that caused it; see
[undo-redo-and-history.md](undo-redo-and-history.md).

## Circular references

Circular references resolve to `#CYCLE!` rather than hanging. See
[formula-functions-and-errors.md](formula-functions-and-errors.md) for the
full error code list.

## Display

Formula cells are shown upright, never italic (italic hurts CJK legibility).
They are differentiated by a subtle green tint and a small non-italic
corner marker; error cells show the literal error code (e.g. `#DIV/0!`) in
bold, so the state is clear without relying on color or italic.
