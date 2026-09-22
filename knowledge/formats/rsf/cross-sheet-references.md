---
type: format-concept
title: RSF cross-sheet formula references
description: Reference syntax and what happens to formulas when worksheets are renamed, deleted, duplicated, or restructured.
sources:
  - resource: docs/rsf-format.md (migrated content; file removed after migration — see knowledge/log.md)
status: stable
generated:
  by: claude-code/claude-sonnet-5
  at: 2026-09-22T12:09:14Z
---

# Cross-sheet formula references

A formula may reference another worksheet of the same workbook:

```text
Sheet1!A1        Sheet1!A1:B10      Sheet1!$A$1
'Quarter 1'!A1   'Quarter 1'!$A$1:$B10
SUM(Sheet1!A1:A10)
```

- The worksheet name is written bare when it reads as a plain identifier,
  and single-quoted otherwise; a literal single quote inside the name is
  doubled (`'O''Brien'!A1`).
- An **unqualified** reference always means the current worksheet.
- Relative, absolute, and mixed (`$`) references behave exactly as they do
  within one worksheet; the `$` markers survive every rewrite.
- Both endpoints of a range belong to the qualifying worksheet. A second
  qualifier inside a range (`Sheet1!A1:Sheet2!B2`, a "3D" range) is
  **deliberately unsupported** and resolves to `#ERROR!` rather than being
  guessed at.
- A reference to a worksheet that does not exist evaluates to `#REF!` and
  is never redirected to a different worksheet.
- Circular references are detected **across** worksheets (`#CYCLE!`),
  because the workbook owns one shared evaluation memo and in-progress
  set.

## What happens to formulas when worksheets change

| Change                           | Effect on formulas                                                                                                                                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Worksheet **renamed**            | Every reference to it is rewritten to the new name (re-quoted as needed); results unchanged.                                                                                                                  |
| Worksheet **deleted**            | Every reference to it becomes `#REF!`. Never silently redirected.                                                                                                                                             |
| Worksheet **duplicated**         | Cell inputs are copied verbatim: **qualified** references still name the worksheets they named; **unqualified** references stay relative to the copy.                                                         |
| Rows/columns inserted or deleted | References adjust on the edited worksheet _and_ in `Name!`-qualified references to it from every other worksheet. A formula's own unqualified references are never moved by an edit on a different worksheet. |

Each of these is one atomic, undoable history entry: the structural change
and every formula rewrite it implies undo and redo together.
