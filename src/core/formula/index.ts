// SPDX-License-Identifier: MIT
/**
 * Spreadsheet formula parser and evaluator.
 *
 * Formulas begin with `=` and are evaluated by a hand-written tokenizer,
 * recursive-descent parser, and tree-walking evaluator. There is no `eval`,
 * `new Function`, or any other dynamic code execution anywhere, and
 * evaluation is fully offline.
 *
 * Grammar (documented and testable):
 *
 *   formula     := '=' expr
 *   expr        := comparison
 *   comparison  := additive (('=' | '<>' | '<=' | '>=' | '<' | '>') additive)*
 *   additive    := term (('+' | '-') term)*
 *   term        := factor (('*' | '/') factor)*
 *   factor      := ('+' | '-') factor | primary
 *   primary     := NUMBER | STRING | ERROR | reference
 *                | FUNC '(' [expr (',' expr)*] ')' | '(' expr ')'
 *   reference   := [sheet '!'] (ref | range | colrange | rowrange)
 *   sheet       := NAME | "'" QUOTED "'"        (Sheet1, 'Quarter 1', 'O''Brien')
 *   ref         := ['$'] LETTERS ['$'] DIGITS   (A1, $A$1, $A1, A$1, AA10)
 *   range       := ref ':' ref                  (e.g. A1:B10, $A$1:B10)
 *   colrange    := colref ':' colref            (e.g. A:A, $A:C; whole columns)
 *   rowrange    := rowref ':' rowref            (e.g. 1:1, $2:10; whole rows)
 *   colref      := ['$'] LETTERS
 *   rowref      := ['$'] DIGITS
 *
 * A reference may be qualified with a worksheet of the same workbook
 * (`Sheet1!A1`, `Sheet1!$A$1`, `SUM(Sheet1!A1:A10)`, `'Quarter 1'!$A$1:$B10`).
 * The name is single-quoted when it is not a plain identifier, and a literal
 * single quote inside it is doubled (`'O''Brien'!A1`). An unqualified
 * reference always means the current worksheet. Both endpoints of a range
 * belong to the qualifying worksheet: a second qualifier inside a range
 * (`Sheet1!A1:Sheet2!B2`, a "3D" range) is deliberately unsupported and
 * resolves to #ERROR! rather than being guessed at. A reference naming a
 * worksheet that does not exist — including one that was deleted — evaluates
 * to #REF! and is never redirected to another worksheet.
 *
 * References support the four A1-style forms: relative (`A1`), absolute
 * (`$A$1`), and the two mixed forms (`$A1`, `A$1`). The `$` markers never
 * change what a formula evaluates to — a reference resolves to the same cell
 * either way. They control how the reference *adjusts* when the formula is
 * copied, filled, or pasted elsewhere: absolute components stay fixed while
 * relative components shift by the copy offset. Row/column insertion and
 * deletion adjust absolute and relative references alike (both track the
 * referenced cell's new position), always preserving the written `$` markers.
 *
 * Whole-column and whole-row ranges are bounded to the used grid when a
 * formula is evaluated (see EvalContext.rowCount / columnCount); they never
 * imply an unbounded spreadsheet.
 *
 * Supported functions come from the registry in `formula-functions.ts`, which
 * is the single source of truth for names, arity, evaluation, autocomplete,
 * and help. The value model, coercion rules, error set, and the documented
 * limits live in `formula-value.ts`.
 *
 * A function may return a rectangular array, which makes the formula a
 * **dynamic array**: `spill.ts` writes the result across the worksheet and the
 * formula cell becomes the spill anchor.
 */

export {
  EMPTY_VALUE,
  errorValue,
  formatValue,
  literalToValue,
  MAX_FORMULA_LENGTH,
  type FormulaValue,
  type ValueGrid,
} from './value';
export {
  FUNCTION_INFOS,
  SUPPORTED_FUNCTIONS,
  VOLATILE_FUNCTIONS,
  type FunctionCategory,
  type FunctionInfo,
} from './functions';
export {
  cellLabel,
  type CellRefEx,
  columnIndex,
  columnLabel,
  isFormula,
  isValidSheetName,
  MAX_REF_COLUMN,
  MAX_REF_ROW,
  MAX_SHEET_NAME_LENGTH,
  parseRef,
  parseRefEx,
  parseWholeColumnEx,
  parseWholeRowEx,
  quoteSheetName,
  refLabel,
  sheetNameKey,
  sheetNameNeedsQuoting,
  type SpanEnd,
} from './refs';
export { type AstNode, functionCompletions, parseFormula, type ParseResult } from './parser';
export { type EvalContext, evaluateAst, evaluateAstArray } from './evaluator';
export {
  formulaReferencesSheet,
  invalidateSheetRefsInFormula,
  type RangeMap,
  type RefMap,
  renameSheetInFormula,
  rewriteFormulaRefs,
  type SheetRewriteOptions,
  type SpanMap,
} from './rewrite';
export {
  adjustFormulaForAxis,
  extractFormulaRefs,
  type FormulaRefRange,
  moveFormulaAxis,
  movedAxisIndex,
  shiftFormulaRefs,
} from './ref-scan';
