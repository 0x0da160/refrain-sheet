// SPDX-License-Identifier: MIT
/**
 * Formula templates: one parsed formula for a column of filled-down copies.
 *
 * A sheet of a million rows usually holds a handful of formulas, each written
 * once and filled down: `=E2*F2`, `=E3*F3`, … differ only in their relative
 * row numbers. A template is the formula as written for one row — its parsed
 * form, where its relative row numbers sit in the source, and which cells it
 * reads — so the copies below it need neither their own parse nor their own
 * syntax tree. The evaluator runs the shared tree with a row shift
 * (`evaluateAst`'s `rowShift`).
 *
 * Whether a cell is such a copy is decided by its **text**, exactly:
 * {@link templateSource} writes the template for another row, and only a cell
 * whose input equals that text shares the template. Nothing is inferred from
 * a formula's shape, so a cell that merely looks similar is parsed on its own.
 *
 * `$` markers follow the usual meaning: a row written with `$` stays fixed, a
 * row without it moves with the formula. Columns never move, because a
 * template is only ever shared down one column.
 */
import { lookupFunction } from './functions';
import { type AstNode, parseFormulaSlots, type ParseResult } from './parser';
import { MAX_REF_ROW } from './refs';

/**
 * One rectangle of cells a template reads, as written for the template's own
 * row. `rows` is null for a whole-column range (every row); otherwise it
 * holds the two row ends and whether each is fixed (`$`) or moves with the
 * formula.
 */
export interface Precedent {
  /** The worksheet name as written, or undefined for the formula's own worksheet. */
  readonly sheet: string | undefined;
  /** Inclusive column span; `right` is `Infinity` for a whole-row range. */
  readonly left: number;
  readonly right: number;
  readonly rows: {
    readonly a: number;
    readonly absA: boolean;
    readonly b: number;
    readonly absB: boolean;
  } | null;
}

export interface FormulaTemplate {
  /** The formula exactly as written for the template's own row. */
  readonly src: string;
  readonly parsed: ParseResult;
  /** The source split at its relative row numbers: `pieces[i]`, row `i`, `pieces[i + 1]`, … */
  readonly pieces: readonly string[];
  /** The relative row numbers as written (1-based), in source order. */
  readonly slotRows: readonly number[];
  /** The largest row shift that keeps every relative row a valid reference. */
  readonly maxShift: number;
  /** True when the formula calls a volatile function (`TODAY`, `NOW`). */
  readonly volatile: boolean;
  /** Every cell, range, column and row span the formula reads. */
  readonly precedents: readonly Precedent[];
}

/**
 * The largest row number (1-based, as written) that is still a reference:
 * the reference pattern reads at most seven digits, and the row must not
 * exceed `MAX_REF_ROW` (0-based).
 */
const MAX_ROW_NUMBER = Math.min(MAX_REF_ROW + 1, 9_999_999);

/** Compile a formula into a template for the row it is written on. Never throws. */
export function compileTemplate(src: string): FormulaTemplate {
  const { parsed, slots } = parseFormulaSlots(src);
  const pieces: string[] = [];
  const slotRows: number[] = [];
  let at = 0;
  let largest = 0;
  for (const slot of slots.sort((a, b) => a.start - b.start)) {
    pieces.push(src.slice(at, slot.start));
    const row = Number(src.slice(slot.start, slot.end));
    slotRows.push(row);
    largest = Math.max(largest, row);
    at = slot.end;
  }
  pieces.push(src.slice(at));
  const precedents: Precedent[] = [];
  const volatile = parsed.ok ? collect(parsed.ast, precedents) : false;
  return {
    src,
    parsed,
    pieces,
    slotRows,
    maxShift: slotRows.length === 0 ? Number.MAX_SAFE_INTEGER : MAX_ROW_NUMBER - largest,
    volatile,
    precedents,
  };
}

/** The template's formula as it is written `shift` rows further down. */
export function templateSource(template: FormulaTemplate, shift: number): string {
  const { pieces, slotRows } = template;
  let out = pieces[0];
  for (let i = 0; i < slotRows.length; i++) {
    out += String(slotRows[i] + shift) + pieces[i + 1];
  }
  return out;
}

/** Gather what `ast` reads into `out`; returns true when it calls a volatile function. */
function collect(ast: AstNode, out: Precedent[]): boolean {
  switch (ast.kind) {
    case 'ref': {
      const abs = ast.absRow === true;
      out.push({
        sheet: ast.sheet,
        left: ast.col,
        right: ast.col,
        rows: { a: ast.row, absA: abs, b: ast.row, absB: abs },
      });
      return false;
    }
    case 'range':
      out.push({
        sheet: ast.sheet,
        left: Math.min(ast.from.col, ast.to.col),
        right: Math.max(ast.from.col, ast.to.col),
        rows: {
          a: ast.from.row,
          absA: ast.from.absRow === true,
          b: ast.to.row,
          absB: ast.to.absRow === true,
        },
      });
      return false;
    case 'colrange':
      out.push({
        sheet: ast.sheet,
        left: Math.min(ast.fromCol, ast.toCol),
        right: Math.max(ast.fromCol, ast.toCol),
        rows: null,
      });
      return false;
    case 'rowrange':
      out.push({
        sheet: ast.sheet,
        left: 0,
        right: Infinity,
        rows: { a: ast.fromRow, absA: ast.absFrom === true, b: ast.toRow, absB: ast.absTo === true },
      });
      return false;
    case 'unary':
      return collect(ast.operand, out);
    case 'binary': {
      const left = collect(ast.left, out);
      return collect(ast.right, out) || left;
    }
    case 'call': {
      let volatile = lookupFunction(ast.name)?.volatile === true;
      for (const arg of ast.args) {
        volatile = collect(arg, out) || volatile;
      }
      return volatile;
    }
    default:
      return false;
  }
}
