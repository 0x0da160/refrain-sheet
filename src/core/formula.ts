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
 *   primary     := NUMBER | STRING | ERROR | ref | range | colrange | rowrange
 *                | FUNC '(' [expr (',' expr)*] ')' | '(' expr ')'
 *   ref         := LETTERS DIGITS          (e.g. A1, B2, AA10; relative only)
 *   range       := ref ':' ref             (e.g. A1:B10)
 *   colrange    := LETTERS ':' LETTERS     (e.g. A:A, A:C; whole columns)
 *   rowrange    := DIGITS ':' DIGITS       (e.g. 1:1, 2:10; whole rows)
 *
 * Whole-column and whole-row ranges are bounded to the used grid when a
 * formula is evaluated (see EvalContext.rowCount / columnCount); they never
 * imply an unbounded spreadsheet.
 *
 * Supported functions: SUM, AVERAGE, MIN, MAX, COUNT, IF.
 * Errors: #ERROR! (invalid formula), #NAME? (unsupported function),
 * #VALUE! (type error), #DIV/0!, #REF! (invalid/deleted reference),
 * #CYCLE! (circular reference).
 */

export type ErrorCode = '#ERROR!' | '#NAME?' | '#VALUE!' | '#DIV/0!' | '#REF!' | '#CYCLE!';

export const ERROR_CODES: readonly ErrorCode[] = [
  '#ERROR!',
  '#NAME?',
  '#VALUE!',
  '#DIV/0!',
  '#REF!',
  '#CYCLE!',
];

export type FormulaValue =
  | { type: 'number'; value: number }
  | { type: 'string'; value: string }
  | { type: 'boolean'; value: boolean }
  | { type: 'empty' }
  | { type: 'error'; code: ErrorCode };

export const EMPTY_VALUE: FormulaValue = { type: 'empty' };

export function numberValue(value: number): FormulaValue {
  return { type: 'number', value };
}

export function errorValue(code: ErrorCode): FormulaValue {
  return { type: 'error', code };
}

/** True when a string is a formula (leading `=`, at least one more character). */
export function isFormula(input: string): boolean {
  return input.length > 1 && input.startsWith('=');
}

/**
 * Coerce a literal cell string to a formula value: numeric-looking strings
 * become numbers, empty strings the empty value, everything else a string.
 */
export function literalToValue(input: string): FormulaValue {
  if (input === '') {
    return EMPTY_VALUE;
  }
  const trimmed = input.trim();
  if (trimmed !== '') {
    const n = Number(trimmed);
    if (Number.isFinite(n)) {
      return { type: 'number', value: n };
    }
  }
  return { type: 'string', value: input };
}

/** Render a formula value for display in the grid. */
export function formatValue(value: FormulaValue): string {
  switch (value.type) {
    case 'number':
      return String(value.value);
    case 'string':
      return value.value;
    case 'boolean':
      return value.value ? 'TRUE' : 'FALSE';
    case 'empty':
      return '';
    case 'error':
      return value.code;
  }
}

// ---------------------------------------------------------------------------
// Cell reference notation
// ---------------------------------------------------------------------------

const MAX_REF_COLUMN = 16_383; // 'XFD', a conventional spreadsheet limit
const MAX_REF_ROW = 9_999_999;

/** Convert a 0-based column index to spreadsheet letters (0 -> A, 26 -> AA). */
export function columnLabel(col: number): string {
  let label = '';
  let n = col;
  for (;;) {
    label = String.fromCharCode(0x41 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
    if (n < 0) break;
  }
  return label;
}

/** Convert column letters to a 0-based index (A -> 0, AA -> 26). */
export function columnIndex(label: string): number {
  let n = 0;
  for (const ch of label.toUpperCase()) {
    n = n * 26 + (ch.charCodeAt(0) - 0x40);
  }
  return n - 1;
}

export function cellLabel(row: number, col: number): string {
  return `${columnLabel(col)}${row + 1}`;
}

const REF_PATTERN = /^([A-Za-z]{1,3})([1-9][0-9]{0,6})$/;
const COL_LABEL_PATTERN = /^[A-Za-z]{1,3}$/;
const ROW_NUMBER_PATTERN = /^[1-9][0-9]{0,6}$/;

/** Parse "A1"-style notation into 0-based coordinates, or null. */
export function parseRef(text: string): { row: number; col: number } | null {
  const m = REF_PATTERN.exec(text);
  if (!m) {
    return null;
  }
  const col = columnIndex(m[1]);
  const row = Number(m[2]) - 1;
  if (col > MAX_REF_COLUMN || row > MAX_REF_ROW) {
    return null;
  }
  return { row, col };
}

/** Parse a bare column label ("A", "AB") to a 0-based column index, or null. */
export function parseWholeColumn(text: string): number | null {
  if (!COL_LABEL_PATTERN.test(text)) {
    return null;
  }
  const col = columnIndex(text);
  return col >= 0 && col <= MAX_REF_COLUMN ? col : null;
}

/** Parse a bare row number ("1", "10") to a 0-based row index, or null. */
export function parseWholeRow(text: string): number | null {
  if (!ROW_NUMBER_PATTERN.test(text)) {
    return null;
  }
  const row = Number(text) - 1;
  return row >= 0 && row <= MAX_REF_ROW ? row : null;
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

export const MAX_FORMULA_LENGTH = 8192;
/** Recursion guard; ~5 depth units are consumed per nesting level. */
const MAX_PARSE_DEPTH = 400;

type TokenType = 'number' | 'string' | 'ident' | 'error' | 'op' | 'lparen' | 'rparen' | 'comma' | 'colon';

interface Token {
  type: TokenType;
  /** Source span within the formula text (including the leading '='). */
  start: number;
  end: number;
  text: string;
  /** Parsed value for number/string tokens. */
  value?: number | string;
}

class FormulaError extends Error {
  constructor(readonly code: ErrorCode) {
    super(code);
  }
}

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const len = src.length;
  while (i < len) {
    const ch = src[i];
    if (ch === ' ' || ch === '\t') {
      i += 1;
      continue;
    }
    const start = i;
    if (ch >= '0' && ch <= '9') {
      let j = i + 1;
      while (j < len && src[j] >= '0' && src[j] <= '9') j++;
      if (j < len && src[j] === '.') {
        j += 1;
        while (j < len && src[j] >= '0' && src[j] <= '9') j++;
      }
      const text = src.slice(i, j);
      tokens.push({ type: 'number', start, end: j, text, value: Number(text) });
      i = j;
      continue;
    }
    if (ch === '.') {
      let j = i + 1;
      let digits = 0;
      while (j < len && src[j] >= '0' && src[j] <= '9') {
        j++;
        digits++;
      }
      if (digits === 0) {
        throw new FormulaError('#ERROR!');
      }
      const text = src.slice(i, j);
      tokens.push({ type: 'number', start, end: j, text, value: Number(text) });
      i = j;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      let out = '';
      let closed = false;
      while (j < len) {
        if (src[j] === '"') {
          if (j + 1 < len && src[j + 1] === '"') {
            out += '"';
            j += 2;
            continue;
          }
          closed = true;
          j += 1;
          break;
        }
        out += src[j];
        j += 1;
      }
      if (!closed) {
        throw new FormulaError('#ERROR!');
      }
      tokens.push({ type: 'string', start, end: j, text: src.slice(i, j), value: out });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < len && /[A-Za-z0-9_]/.test(src[j])) j++;
      tokens.push({ type: 'ident', start, end: j, text: src.slice(i, j) });
      i = j;
      continue;
    }
    if (ch === '#') {
      // Error literals such as #REF! or #DIV/0!.
      const rest = src.slice(i);
      const match = ERROR_CODES.find((code) => rest.startsWith(code));
      if (!match) {
        throw new FormulaError('#ERROR!');
      }
      tokens.push({ type: 'error', start, end: i + match.length, text: match });
      i += match.length;
      continue;
    }
    if (ch === '(') {
      tokens.push({ type: 'lparen', start, end: i + 1, text: ch });
      i += 1;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: 'rparen', start, end: i + 1, text: ch });
      i += 1;
      continue;
    }
    if (ch === ',') {
      tokens.push({ type: 'comma', start, end: i + 1, text: ch });
      i += 1;
      continue;
    }
    if (ch === ':') {
      tokens.push({ type: 'colon', start, end: i + 1, text: ch });
      i += 1;
      continue;
    }
    if (ch === '<') {
      const two = src.slice(i, i + 2);
      if (two === '<=' || two === '<>') {
        tokens.push({ type: 'op', start, end: i + 2, text: two });
        i += 2;
      } else {
        tokens.push({ type: 'op', start, end: i + 1, text: '<' });
        i += 1;
      }
      continue;
    }
    if (ch === '>') {
      if (src.slice(i, i + 2) === '>=') {
        tokens.push({ type: 'op', start, end: i + 2, text: '>=' });
        i += 2;
      } else {
        tokens.push({ type: 'op', start, end: i + 1, text: '>' });
        i += 1;
      }
      continue;
    }
    if (ch === '+' || ch === '-' || ch === '*' || ch === '/' || ch === '=') {
      tokens.push({ type: 'op', start, end: i + 1, text: ch });
      i += 1;
      continue;
    }
    throw new FormulaError('#ERROR!');
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export interface RefNode {
  kind: 'ref';
  row: number;
  col: number;
}

export type AstNode =
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | RefNode
  | { kind: 'range'; from: RefNode; to: RefNode }
  /** Whole-column range (e.g. A:C); bounded to the used grid at evaluation. */
  | { kind: 'colrange'; fromCol: number; toCol: number }
  /** Whole-row range (e.g. 1:10); bounded to the used grid at evaluation. */
  | { kind: 'rowrange'; fromRow: number; toRow: number }
  | { kind: 'unary'; op: '+' | '-'; operand: AstNode }
  | { kind: 'binary'; op: string; left: AstNode; right: AstNode }
  | { kind: 'call'; name: string; args: AstNode[] }
  | { kind: 'error'; code: ErrorCode };

export const SUPPORTED_FUNCTIONS = ['SUM', 'AVERAGE', 'MIN', 'MAX', 'COUNT', 'IF'] as const;

export interface FunctionInfo {
  name: (typeof SUPPORTED_FUNCTIONS)[number];
  /** Human-readable call signature shown in autocomplete hints and help. */
  signature: string;
  /** A ready-to-read example formula shown in the help panel. */
  example: string;
}

/**
 * The single source of truth for supported functions: autocomplete, the
 * formula & function help panel, and (via {@link SUPPORTED_FUNCTIONS}) the
 * evaluator all read this list, so documented functions cannot drift from
 * implemented ones. The `signature`/`example` are display-only; localized
 * one-line descriptions live in the locale catalogs under `formula.fn.<NAME>`.
 */
export const FUNCTION_INFOS: readonly FunctionInfo[] = [
  { name: 'SUM', signature: 'SUM(value, …)', example: '=SUM(A1:A10)' },
  { name: 'AVERAGE', signature: 'AVERAGE(value, …)', example: '=AVERAGE(B1:B20)' },
  { name: 'MIN', signature: 'MIN(value, …)', example: '=MIN(A1:A10)' },
  { name: 'MAX', signature: 'MAX(value, …)', example: '=MAX(A1:A10)' },
  { name: 'COUNT', signature: 'COUNT(value, …)', example: '=COUNT(A1:A10)' },
  { name: 'IF', signature: 'IF(condition, then, else)', example: '=IF(A1>10, "big", "small")' },
];

/**
 * Autocomplete matches for a formula being edited: the function names whose
 * start matches the identifier word immediately before the caret. Returns an
 * empty list unless the text is a formula (`=…`) and the caret sits at the end
 * of a bare identifier word (not a cell reference, not after `(`/a digit).
 */
export function functionCompletions(text: string, caret: number): { word: string; matches: FunctionInfo[] } {
  const empty = { word: '', matches: [] as FunctionInfo[] };
  if (!text.startsWith('=') || caret < 1 || caret > text.length) {
    return empty;
  }
  // The identifier word ending at the caret.
  let start = caret;
  while (start > 0 && /[A-Za-z]/.test(text[start - 1])) {
    start -= 1;
  }
  if (start === caret) {
    return empty; // no word before the caret
  }
  // A word is only a function prefix when it is not part of a cell reference
  // (letters immediately followed by digits, e.g. A1) and not preceded by a
  // letter/digit that would make it a longer identifier.
  if (start > 0 && /[A-Za-z0-9]/.test(text[start - 1])) {
    return empty;
  }
  if (caret < text.length && /[0-9(]/.test(text[caret])) {
    return empty; // already a cell ref (A1) or an opened call
  }
  const word = text.slice(start, caret);
  const upper = word.toUpperCase();
  const matches = FUNCTION_INFOS.filter((f) => f.name.startsWith(upper));
  return { word, matches };
}

export type ParseResult = { ok: true; ast: AstNode } | { ok: false; code: ErrorCode };

/** Parse a formula string (must start with '='). Never throws. */
export function parseFormula(src: string): ParseResult {
  if (!isFormula(src)) {
    return { ok: false, code: '#ERROR!' };
  }
  if (src.length > MAX_FORMULA_LENGTH) {
    return { ok: false, code: '#ERROR!' };
  }
  let tokens: Token[];
  try {
    tokens = tokenize(src.slice(1));
  } catch (err) {
    return { ok: false, code: err instanceof FormulaError ? err.code : '#ERROR!' };
  }
  if (tokens.length === 0) {
    return { ok: false, code: '#ERROR!' };
  }
  const parser = new Parser(tokens);
  try {
    const ast = parser.parseExpr(0);
    if (!parser.atEnd()) {
      return { ok: false, code: '#ERROR!' };
    }
    return { ok: true, ast };
  } catch (err) {
    return { ok: false, code: err instanceof FormulaError ? err.code : '#ERROR!' };
  }
}

class Parser {
  private pos = 0;

  constructor(private readonly tokens: Token[]) {}

  atEnd(): boolean {
    return this.pos >= this.tokens.length;
  }

  private peek(): Token | null {
    return this.tokens[this.pos] ?? null;
  }

  private next(): Token {
    const token = this.tokens[this.pos];
    if (!token) {
      throw new FormulaError('#ERROR!');
    }
    this.pos += 1;
    return token;
  }

  private expect(type: TokenType): Token {
    const token = this.next();
    if (token.type !== type) {
      throw new FormulaError('#ERROR!');
    }
    return token;
  }

  parseExpr(depth: number): AstNode {
    if (depth > MAX_PARSE_DEPTH) {
      throw new FormulaError('#ERROR!');
    }
    let left = this.parseAdditive(depth + 1);
    for (;;) {
      const token = this.peek();
      if (!token || token.type !== 'op' || !['=', '<>', '<', '>', '<=', '>='].includes(token.text)) {
        return left;
      }
      this.next();
      const right = this.parseAdditive(depth + 1);
      left = { kind: 'binary', op: token.text, left, right };
    }
  }

  private parseAdditive(depth: number): AstNode {
    if (depth > MAX_PARSE_DEPTH) {
      throw new FormulaError('#ERROR!');
    }
    let left = this.parseTerm(depth + 1);
    for (;;) {
      const token = this.peek();
      if (!token || token.type !== 'op' || (token.text !== '+' && token.text !== '-')) {
        return left;
      }
      this.next();
      const right = this.parseTerm(depth + 1);
      left = { kind: 'binary', op: token.text, left, right };
    }
  }

  private parseTerm(depth: number): AstNode {
    if (depth > MAX_PARSE_DEPTH) {
      throw new FormulaError('#ERROR!');
    }
    let left = this.parseFactor(depth + 1);
    for (;;) {
      const token = this.peek();
      if (!token || token.type !== 'op' || (token.text !== '*' && token.text !== '/')) {
        return left;
      }
      this.next();
      const right = this.parseFactor(depth + 1);
      left = { kind: 'binary', op: token.text, left, right };
    }
  }

  private parseFactor(depth: number): AstNode {
    if (depth > MAX_PARSE_DEPTH) {
      throw new FormulaError('#ERROR!');
    }
    const token = this.peek();
    if (token && token.type === 'op' && (token.text === '+' || token.text === '-')) {
      this.next();
      return { kind: 'unary', op: token.text as '+' | '-', operand: this.parseFactor(depth + 1) };
    }
    return this.parsePrimary(depth + 1);
  }

  private parsePrimary(depth: number): AstNode {
    if (depth > MAX_PARSE_DEPTH) {
      throw new FormulaError('#ERROR!');
    }
    const token = this.next();
    switch (token.type) {
      case 'number': {
        // A whole-row range such as 1:1 or 2:10.
        if (this.peek()?.type === 'colon') {
          const fromRow = parseWholeRow(token.text);
          this.next(); // colon
          const endToken = this.expect('number');
          const toRow = parseWholeRow(endToken.text);
          if (fromRow === null || toRow === null) {
            throw new FormulaError('#ERROR!');
          }
          return { kind: 'rowrange', fromRow, toRow };
        }
        return { kind: 'number', value: token.value as number };
      }
      case 'string':
        return { kind: 'string', value: token.value as string };
      case 'error':
        return { kind: 'error', code: token.text as ErrorCode };
      case 'lparen': {
        const inner = this.parseExpr(depth + 1);
        this.expect('rparen');
        return inner;
      }
      case 'ident': {
        const nextToken = this.peek();
        if (nextToken && nextToken.type === 'lparen') {
          // Function call.
          this.next();
          const name = token.text.toUpperCase();
          const args: AstNode[] = [];
          if (this.peek()?.type === 'rparen') {
            this.next();
          } else {
            for (;;) {
              args.push(this.parseExpr(depth + 1));
              const sep = this.next();
              if (sep.type === 'rparen') {
                break;
              }
              if (sep.type !== 'comma') {
                throw new FormulaError('#ERROR!');
              }
            }
          }
          if (!(SUPPORTED_FUNCTIONS as readonly string[]).includes(name)) {
            throw new FormulaError('#NAME?');
          }
          // IF has a fixed arity; a wrong argument count is a structural error.
          if (name === 'IF' && (args.length < 2 || args.length > 3)) {
            throw new FormulaError('#ERROR!');
          }
          return { kind: 'call', name, args };
        }
        const ref = parseRef(token.text);
        if (ref) {
          const refNode: RefNode = { kind: 'ref', row: ref.row, col: ref.col };
          if (nextToken && nextToken.type === 'colon') {
            this.next();
            const endToken = this.expect('ident');
            const endRef = parseRef(endToken.text);
            if (!endRef) {
              throw new FormulaError('#ERROR!');
            }
            return {
              kind: 'range',
              from: refNode,
              to: { kind: 'ref', row: endRef.row, col: endRef.col },
            };
          }
          return refNode;
        }
        // A whole-column range such as A:A or A:C.
        const col = parseWholeColumn(token.text);
        if (col !== null && nextToken && nextToken.type === 'colon') {
          this.next();
          const endToken = this.expect('ident');
          const endCol = parseWholeColumn(endToken.text);
          if (endCol === null) {
            throw new FormulaError('#ERROR!');
          }
          return { kind: 'colrange', fromCol: col, toCol: endCol };
        }
        throw new FormulaError('#NAME?');
      }
      default:
        throw new FormulaError('#ERROR!');
    }
  }
}

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

/** Guard against absurdly large ranges keeping the UI responsive. */
export const MAX_RANGE_CELLS = 2_000_000;

export interface EvalContext {
  /** Resolve a cell to its value (already computed for formula cells). */
  getCell(row: number, col: number): FormulaValue;
  /**
   * Used-grid bounds. Whole-column (`A:A`) and whole-row (`1:1`) ranges are
   * clamped to these so they cover only the actual sheet, never an unbounded
   * space. When omitted (e.g. a bare cell context in tests) whole-column/row
   * ranges resolve to empty.
   */
  rowCount?: number;
  columnCount?: number;
}

function coerceToNumber(value: FormulaValue): number | null {
  switch (value.type) {
    case 'number':
      return value.value;
    case 'boolean':
      return value.value ? 1 : 0;
    case 'empty':
      return 0;
    case 'string': {
      const trimmed = value.value.trim();
      if (trimmed === '') {
        return null;
      }
      const n = Number(trimmed);
      return Number.isFinite(n) ? n : null;
    }
    case 'error':
      return null;
  }
}

function firstError(...values: FormulaValue[]): FormulaValue | null {
  for (const v of values) {
    if (v.type === 'error') {
      return v;
    }
  }
  return null;
}

/**
 * Evaluate a parsed formula. Scalar semantics:
 * - arithmetic coerces numbers, booleans (1/0), empties (0), and numeric
 *   strings; other strings produce #VALUE!,
 * - division by zero produces #DIV/0!,
 * - a bare range in scalar context produces #VALUE!,
 * - errors propagate,
 * - references outside the sheet evaluate as empty cells.
 */
export function evaluateAst(ast: AstNode, ctx: EvalContext): FormulaValue {
  const result = evalNode(ast, ctx);
  if (result.kind === 'range') {
    return errorValue('#VALUE!');
  }
  return result.value;
}

/**
 * A range result carries already-normalized, inclusive, used-grid-clamped
 * numeric bounds. An empty range (a whole-column/row range with no used grid,
 * or a column/row beyond the used bounds) has `top > bottom` or `left > right`.
 */
type EvalResult =
  | { kind: 'scalar'; value: FormulaValue }
  | { kind: 'range'; top: number; bottom: number; left: number; right: number };

function scalar(value: FormulaValue): EvalResult {
  return { kind: 'scalar', value };
}

function range(top: number, bottom: number, left: number, right: number): EvalResult {
  return { kind: 'range', top, bottom, left, right };
}

function evalNode(ast: AstNode, ctx: EvalContext): EvalResult {
  switch (ast.kind) {
    case 'number':
      return scalar(numberValue(ast.value));
    case 'string':
      return scalar({ type: 'string', value: ast.value });
    case 'error':
      return scalar(errorValue(ast.code));
    case 'ref':
      return scalar(ctx.getCell(ast.row, ast.col));
    case 'range': {
      const top = Math.min(ast.from.row, ast.to.row);
      const bottom = Math.max(ast.from.row, ast.to.row);
      const left = Math.min(ast.from.col, ast.to.col);
      const right = Math.max(ast.from.col, ast.to.col);
      return range(top, bottom, left, right);
    }
    case 'colrange': {
      // A:C over the used grid: all used rows, columns clamped to used bounds.
      const rows = ctx.rowCount ?? 0;
      const cols = ctx.columnCount ?? 0;
      const left = Math.min(ast.fromCol, ast.toCol);
      const right = Math.min(Math.max(ast.fromCol, ast.toCol), cols - 1);
      return range(0, rows - 1, left, right);
    }
    case 'rowrange': {
      // 1:10 over the used grid: all used columns, rows clamped to used bounds.
      const rows = ctx.rowCount ?? 0;
      const cols = ctx.columnCount ?? 0;
      const top = Math.min(ast.fromRow, ast.toRow);
      const bottom = Math.min(Math.max(ast.fromRow, ast.toRow), rows - 1);
      return range(top, bottom, 0, cols - 1);
    }
    case 'unary': {
      const operand = evalNode(ast.operand, ctx);
      if (operand.kind === 'range') {
        return scalar(errorValue('#VALUE!'));
      }
      const err = firstError(operand.value);
      if (err) {
        return scalar(err);
      }
      const n = coerceToNumber(operand.value);
      if (n === null) {
        return scalar(errorValue('#VALUE!'));
      }
      return scalar(numberValue(ast.op === '-' ? -n : n));
    }
    case 'binary':
      return scalar(evalBinary(ast.op, ast.left, ast.right, ctx));
    case 'call':
      return scalar(evalCall(ast.name, ast.args, ctx));
  }
}

function evalBinary(op: string, leftAst: AstNode, rightAst: AstNode, ctx: EvalContext): FormulaValue {
  const left = evalNode(leftAst, ctx);
  const right = evalNode(rightAst, ctx);
  if (left.kind === 'range' || right.kind === 'range') {
    return errorValue('#VALUE!');
  }
  const err = firstError(left.value, right.value);
  if (err) {
    return err;
  }
  if (['=', '<>', '<', '>', '<=', '>='].includes(op)) {
    return evalComparison(op, left.value, right.value);
  }
  const a = coerceToNumber(left.value);
  const b = coerceToNumber(right.value);
  if (a === null || b === null) {
    return errorValue('#VALUE!');
  }
  switch (op) {
    case '+':
      return numberValue(a + b);
    case '-':
      return numberValue(a - b);
    case '*':
      return numberValue(a * b);
    case '/':
      if (b === 0) {
        return errorValue('#DIV/0!');
      }
      return numberValue(a / b);
    default:
      return errorValue('#ERROR!');
  }
}

/**
 * Comparison semantics: numbers (and coercible values) compare numerically,
 * strings compare case-sensitively by code point. A number compared with a
 * non-numeric string is unequal ('=' false, '<>' true); ordering across
 * incomparable types produces #VALUE!.
 */
function evalComparison(op: string, left: FormulaValue, right: FormulaValue): FormulaValue {
  const bool = (v: boolean): FormulaValue => ({ type: 'boolean', value: v });
  if (left.type === 'string' && right.type === 'string') {
    const cmp = left.value < right.value ? -1 : left.value > right.value ? 1 : 0;
    return compareResult(op, cmp, bool);
  }
  const a = coerceToNumber(left);
  const b = coerceToNumber(right);
  if (a !== null && b !== null) {
    return compareResult(op, a < b ? -1 : a > b ? 1 : 0, bool);
  }
  // Treat empty as equal to the empty string.
  if (
    (left.type === 'empty' && right.type === 'string') ||
    (left.type === 'string' && right.type === 'empty')
  ) {
    const s = left.type === 'string' ? left.value : (right as { type: 'string'; value: string }).value;
    const cmp = s === '' ? 0 : -1;
    if (op === '=') return bool(cmp === 0);
    if (op === '<>') return bool(cmp !== 0);
    return errorValue('#VALUE!');
  }
  if (op === '=') {
    return bool(false);
  }
  if (op === '<>') {
    return bool(true);
  }
  return errorValue('#VALUE!');
}

function compareResult(op: string, cmp: number, bool: (v: boolean) => FormulaValue): FormulaValue {
  switch (op) {
    case '=':
      return bool(cmp === 0);
    case '<>':
      return bool(cmp !== 0);
    case '<':
      return bool(cmp < 0);
    case '>':
      return bool(cmp > 0);
    case '<=':
      return bool(cmp <= 0);
    case '>=':
      return bool(cmp >= 0);
    default:
      return errorValue('#ERROR!');
  }
}

/**
 * Collect the numeric contributions of one function argument. Ranges iterate
 * their cells (empties and non-numeric strings are skipped, like conventional
 * spreadsheets); scalars must be numeric-coercible except empties, which are
 * skipped. Errors abort.
 */
function collectNumbers(arg: AstNode, ctx: EvalContext, out: number[]): FormulaValue | null {
  const result = evalNode(arg, ctx);
  if (result.kind === 'range') {
    const { top, bottom, left, right } = result;
    if (bottom < top || right < left) {
      // Empty range (e.g. a whole-column range beyond the used grid).
      return null;
    }
    const cellCount = (bottom - top + 1) * (right - left + 1);
    if (cellCount > MAX_RANGE_CELLS) {
      return errorValue('#VALUE!');
    }
    for (let r = top; r <= bottom; r++) {
      for (let c = left; c <= right; c++) {
        const v = ctx.getCell(r, c);
        if (v.type === 'error') {
          return v;
        }
        if (v.type === 'number') {
          out.push(v.value);
        } else if (v.type === 'boolean') {
          out.push(v.value ? 1 : 0);
        }
        // Strings and empties inside ranges are skipped.
      }
    }
    return null;
  }
  const v = result.value;
  if (v.type === 'error') {
    return v;
  }
  if (v.type === 'empty') {
    return null;
  }
  const n = coerceToNumber(v);
  if (n === null) {
    return errorValue('#VALUE!');
  }
  out.push(n);
  return null;
}

function evalCall(name: string, args: AstNode[], ctx: EvalContext): FormulaValue {
  switch (name) {
    case 'IF': {
      if (args.length < 2 || args.length > 3) {
        return errorValue('#ERROR!');
      }
      const cond = evalNode(args[0], ctx);
      if (cond.kind === 'range') {
        return errorValue('#VALUE!');
      }
      if (cond.value.type === 'error') {
        return cond.value;
      }
      let truthy: boolean;
      if (cond.value.type === 'boolean') {
        truthy = cond.value.value;
      } else {
        const n = coerceToNumber(cond.value);
        if (n === null) {
          return errorValue('#VALUE!');
        }
        truthy = n !== 0;
      }
      const branch = truthy ? args[1] : args[2];
      if (!branch) {
        return { type: 'boolean', value: false };
      }
      const result = evalNode(branch, ctx);
      if (result.kind === 'range') {
        return errorValue('#VALUE!');
      }
      return result.value;
    }
    case 'SUM':
    case 'AVERAGE':
    case 'MIN':
    case 'MAX':
    case 'COUNT': {
      const numbers: number[] = [];
      for (const arg of args) {
        if (name === 'COUNT') {
          const err = collectCount(arg, ctx, numbers);
          if (err) {
            return err;
          }
          continue;
        }
        const err = collectNumbers(arg, ctx, numbers);
        if (err) {
          return err;
        }
      }
      switch (name) {
        case 'SUM':
          return numberValue(numbers.reduce((a, b) => a + b, 0));
        case 'AVERAGE':
          if (numbers.length === 0) {
            return errorValue('#DIV/0!');
          }
          return numberValue(numbers.reduce((a, b) => a + b, 0) / numbers.length);
        case 'MIN':
          return numberValue(numbers.length === 0 ? 0 : Math.min(...take(numbers)));
        case 'MAX':
          return numberValue(numbers.length === 0 ? 0 : Math.max(...take(numbers)));
        case 'COUNT':
          return numberValue(numbers.length);
        default:
          return errorValue('#ERROR!');
      }
    }
    default:
      return errorValue('#NAME?');
  }
}

/** COUNT counts numeric values only; unlike SUM it ignores non-numeric scalars. */
function collectCount(arg: AstNode, ctx: EvalContext, out: number[]): FormulaValue | null {
  const result = evalNode(arg, ctx);
  if (result.kind === 'range') {
    return collectNumbers(arg, ctx, out);
  }
  const v = result.value;
  if (v.type === 'error') {
    return v;
  }
  const n = coerceToNumber(v);
  if (n !== null && v.type !== 'empty') {
    out.push(n);
  }
  return null;
}

/** Math.min/max spread limit workaround for very large collections. */
function take(numbers: number[]): number[] {
  if (numbers.length <= 65_000) {
    return numbers;
  }
  let min = numbers[0];
  let max = numbers[0];
  for (const n of numbers) {
    if (n < min) min = n;
    if (n > max) max = n;
  }
  return [min, max];
}

// ---------------------------------------------------------------------------
// Reference rewriting (insert/delete/copy adjustments)
// ---------------------------------------------------------------------------

export type RefMap = (row: number, col: number) => { row: number; col: number } | 'REF_ERROR';
export type RangeMap = (
  from: { row: number; col: number },
  to: { row: number; col: number },
) => { from: { row: number; col: number }; to: { row: number; col: number } } | 'REF_ERROR';
/** Map the endpoints of a whole-column or whole-row span (1-D). */
export type SpanMap = (from: number, to: number) => { from: number; to: number } | 'REF_ERROR';

/**
 * Rewrite every cell reference in a formula string using the given mapping
 * functions, preserving all other text. References that map to 'REF_ERROR'
 * are replaced with the literal #REF! error. Formulas that do not tokenize
 * are returned unchanged (they already display #ERROR!).
 *
 * `mapColSpan`/`mapRowSpan` handle whole-column (`A:C`) and whole-row (`1:10`)
 * ranges; when omitted those ranges are left unchanged.
 */
export function rewriteFormulaRefs(
  src: string,
  mapRef: RefMap,
  mapRange: RangeMap,
  mapColSpan?: SpanMap,
  mapRowSpan?: SpanMap,
): string {
  if (!isFormula(src)) {
    return src;
  }
  let tokens: Token[];
  try {
    tokens = tokenize(src.slice(1));
  } catch {
    return src;
  }
  interface Splice {
    start: number;
    end: number;
    text: string;
  }
  const splices: Splice[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const nextToken = tokens[i + 1] ?? null;

    if (token.type === 'number') {
      // Whole-row range: NUMBER ':' NUMBER.
      if (mapRowSpan && nextToken && nextToken.type === 'colon') {
        const endToken = tokens[i + 2] ?? null;
        const fromRow = parseWholeRow(token.text);
        const toRow = endToken && endToken.type === 'number' ? parseWholeRow(endToken.text) : null;
        if (fromRow !== null && toRow !== null && endToken) {
          const mapped = mapRowSpan(fromRow, toRow);
          const text = mapped === 'REF_ERROR' ? '#REF!' : `${mapped.from + 1}:${mapped.to + 1}`;
          splices.push({ start: token.start, end: endToken.end, text });
          i += 2;
        }
      }
      continue;
    }

    if (token.type !== 'ident') {
      continue;
    }
    if (nextToken && nextToken.type === 'lparen') {
      continue; // function name
    }
    const ref = parseRef(token.text);
    if (ref) {
      // Range: ref ':' ref
      if (nextToken && nextToken.type === 'colon') {
        const endToken = tokens[i + 2] ?? null;
        const endRef = endToken && endToken.type === 'ident' ? parseRef(endToken.text) : null;
        if (endRef && endToken) {
          const mapped = mapRange(ref, endRef);
          const text =
            mapped === 'REF_ERROR'
              ? '#REF!'
              : `${cellLabel(mapped.from.row, mapped.from.col)}:${cellLabel(mapped.to.row, mapped.to.col)}`;
          splices.push({ start: token.start, end: endToken.end, text });
          i += 2;
          continue;
        }
      }
      const mapped = mapRef(ref.row, ref.col);
      splices.push({
        start: token.start,
        end: token.end,
        text: mapped === 'REF_ERROR' ? '#REF!' : cellLabel(mapped.row, mapped.col),
      });
      continue;
    }
    // Whole-column range: COL ':' COL (e.g. A:C).
    const fromCol = parseWholeColumn(token.text);
    if (fromCol !== null && mapColSpan && nextToken && nextToken.type === 'colon') {
      const endToken = tokens[i + 2] ?? null;
      const toCol = endToken && endToken.type === 'ident' ? parseWholeColumn(endToken.text) : null;
      if (toCol !== null && endToken) {
        const mapped = mapColSpan(fromCol, toCol);
        const text =
          mapped === 'REF_ERROR' ? '#REF!' : `${columnLabel(mapped.from)}:${columnLabel(mapped.to)}`;
        splices.push({ start: token.start, end: endToken.end, text });
        i += 2;
      }
    }
  }
  if (splices.length === 0) {
    return src;
  }
  // Token offsets are relative to the text after '='.
  let body = src.slice(1);
  for (let i = splices.length - 1; i >= 0; i--) {
    const s = splices[i];
    body = body.slice(0, s.start) + s.text + body.slice(s.end);
  }
  return `=${body}`;
}

/** Shift all references by a fixed delta (used for copy/paste). Negative results become #REF!. */
export function shiftFormulaRefs(src: string, deltaRow: number, deltaCol: number): string {
  const mapOne = (row: number, col: number): { row: number; col: number } | 'REF_ERROR' => {
    const r = row + deltaRow;
    const c = col + deltaCol;
    if (r < 0 || c < 0 || r > MAX_REF_ROW || c > MAX_REF_COLUMN) {
      return 'REF_ERROR';
    }
    return { row: r, col: c };
  };
  const mapColSpan: SpanMap = (from, to) => {
    const a = from + deltaCol;
    const b = to + deltaCol;
    if (a < 0 || b < 0 || a > MAX_REF_COLUMN || b > MAX_REF_COLUMN) {
      return 'REF_ERROR';
    }
    return { from: a, to: b };
  };
  const mapRowSpan: SpanMap = (from, to) => {
    const a = from + deltaRow;
    const b = to + deltaRow;
    if (a < 0 || b < 0 || a > MAX_REF_ROW || b > MAX_REF_ROW) {
      return 'REF_ERROR';
    }
    return { from: a, to: b };
  };
  return rewriteFormulaRefs(
    src,
    mapOne,
    (from, to) => {
      const a = mapOne(from.row, from.col);
      const b = mapOne(to.row, to.col);
      if (a === 'REF_ERROR' || b === 'REF_ERROR') {
        return 'REF_ERROR';
      }
      return { from: a, to: b };
    },
    mapColSpan,
    mapRowSpan,
  );
}

/**
 * Adjust references for a row or column insertion/deletion along one axis.
 * `index`/`count` describe the affected rows (axis 'row') or columns
 * (axis 'col'). Deletion follows conventional spreadsheet behavior:
 * references into the deleted span become #REF!; ranges are clamped and
 * become #REF! only when the whole range is deleted.
 */
export function adjustFormulaForAxis(
  src: string,
  axis: 'row' | 'col',
  op: 'insert' | 'delete',
  index: number,
  count: number,
): string {
  const shiftPoint = (v: number): number | 'deleted' => {
    if (op === 'insert') {
      return v >= index ? v + count : v;
    }
    if (v < index) {
      return v;
    }
    if (v < index + count) {
      return 'deleted';
    }
    return v - count;
  };
  const clampLow = (v: number): number => {
    // Deleted range start clamps to the first surviving position at `index`.
    const shifted = shiftPoint(v);
    return shifted === 'deleted' ? index : shifted;
  };
  const clampHigh = (v: number): number => {
    // Deleted range end clamps to the last surviving position before `index`.
    const shifted = shiftPoint(v);
    return shifted === 'deleted' ? index - 1 : shifted;
  };
  const mapRef: RefMap = (row, col) => {
    const v = axis === 'row' ? row : col;
    const shifted = shiftPoint(v);
    if (shifted === 'deleted') {
      return 'REF_ERROR';
    }
    return axis === 'row' ? { row: shifted, col } : { row, col: shifted };
  };
  const mapRange: RangeMap = (from, to) => {
    const lowIn = axis === 'row' ? Math.min(from.row, to.row) : Math.min(from.col, to.col);
    const highIn = axis === 'row' ? Math.max(from.row, to.row) : Math.max(from.col, to.col);
    if (op === 'delete' && lowIn >= index && highIn < index + count) {
      return 'REF_ERROR';
    }
    const low = clampLow(lowIn);
    const high = clampHigh(highIn);
    if (high < low) {
      return 'REF_ERROR';
    }
    const withAxis = (base: { row: number; col: number }, v: number): { row: number; col: number } =>
      axis === 'row' ? { row: v, col: base.col } : { row: base.row, col: v };
    // Preserve the original endpoint order.
    const fromIsLow = (axis === 'row' ? from.row : from.col) === lowIn;
    return fromIsLow
      ? { from: withAxis(from, low), to: withAxis(to, high) }
      : { from: withAxis(from, high), to: withAxis(to, low) };
  };
  // Whole-column / whole-row spans use the same 1-D clamp semantics as ranges.
  const mapSpan: SpanMap = (from, to) => {
    const lowIn = Math.min(from, to);
    const highIn = Math.max(from, to);
    if (op === 'delete' && lowIn >= index && highIn < index + count) {
      return 'REF_ERROR';
    }
    const low = clampLow(lowIn);
    const high = clampHigh(highIn);
    if (high < low) {
      return 'REF_ERROR';
    }
    return from === lowIn ? { from: low, to: high } : { from: high, to: low };
  };
  // A column operation shifts whole-column spans; a row operation shifts
  // whole-row spans. The orthogonal span kind is left untouched.
  const mapColSpan = axis === 'col' ? mapSpan : undefined;
  const mapRowSpan = axis === 'row' ? mapSpan : undefined;
  return rewriteFormulaRefs(src, mapRef, mapRange, mapColSpan, mapRowSpan);
}
