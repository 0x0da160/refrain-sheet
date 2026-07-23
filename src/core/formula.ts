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
// Worksheet-name notation (cross-sheet references)
// ---------------------------------------------------------------------------

/**
 * Documented maximum worksheet-name length (characters). Names are trimmed and
 * validated at the command layer; the codec also bounds the stored bytes.
 */
export const MAX_SHEET_NAME_LENGTH = 100;

/**
 * True when a name character conflicts with formula-reference or file-format
 * syntax: a C0 control character or one of `[ ] : \ / ? *`. A single quote is
 * allowed (escaped by doubling inside a quoted reference).
 */
function isDisallowedSheetChar(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return (
    code < 0x20 ||
    ch === '[' ||
    ch === ']' ||
    ch === ':' ||
    ch === '\\' ||
    ch === '/' ||
    ch === '?' ||
    ch === '*'
  );
}

/** True when a trimmed worksheet name is non-empty, within length, and free of disallowed characters. */
export function isValidSheetName(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_SHEET_NAME_LENGTH) {
    return false;
  }
  for (const ch of trimmed) {
    if (isDisallowedSheetChar(ch)) {
      return false;
    }
  }
  return true;
}

/**
 * The uniqueness key for a worksheet name. Worksheet names are unique
 * case-insensitively (documented policy), matching conventional spreadsheets,
 * so this normalizes to a trimmed, case-folded key.
 */
export function sheetNameKey(name: string): string {
  return name.trim().toLocaleLowerCase();
}

/**
 * True when a worksheet name must be single-quoted to appear as a formula
 * reference prefix: it is bare-safe only when it reads as one plain identifier
 * token (letter/underscore start, then letters/digits/underscore).
 */
export function sheetNameNeedsQuoting(name: string): boolean {
  return !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

/**
 * Render a worksheet name as a formula-reference prefix, single-quoting and
 * escaping (`'` → `''`) when required so `Quarter 1` becomes `'Quarter 1'` and
 * `O'Brien` becomes `'O''Brien'`.
 */
export function quoteSheetName(name: string): string {
  return sheetNameNeedsQuoting(name) ? `'${name.replace(/'/g, "''")}'` : name;
}

// ---------------------------------------------------------------------------
// Cell reference notation
// ---------------------------------------------------------------------------

export const MAX_REF_COLUMN = 16_383; // 'XFD', a conventional spreadsheet limit
export const MAX_REF_ROW = 9_999_999;

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

const REF_PATTERN = /^(\$?)([A-Za-z]{1,3})(\$?)([1-9][0-9]{0,6})$/;
const COL_LABEL_PATTERN = /^(\$?)([A-Za-z]{1,3})$/;
const ROW_NUMBER_PATTERN = /^(\$?)([1-9][0-9]{0,6})$/;

/**
 * A parsed A1-style cell reference with its `$` absolute markers. The markers
 * never change which cell is referenced; they mark components that stay fixed
 * when the formula is copied/filled (see the module doc).
 */
export interface CellRefEx {
  row: number;
  col: number;
  absRow: boolean;
  absCol: boolean;
}

/**
 * Parse "A1"-style notation (including `$A$1` / `$A1` / `A$1` absolute and
 * mixed forms) into 0-based coordinates, or null.
 */
export function parseRef(text: string): { row: number; col: number } | null {
  const full = parseRefEx(text);
  return full ? { row: full.row, col: full.col } : null;
}

/** Like {@link parseRef} but also reports the `$` absolute markers. */
export function parseRefEx(text: string): CellRefEx | null {
  const m = REF_PATTERN.exec(text);
  if (!m) {
    return null;
  }
  const col = columnIndex(m[2]);
  const row = Number(m[4]) - 1;
  if (col > MAX_REF_COLUMN || row > MAX_REF_ROW) {
    return null;
  }
  return { row, col, absCol: m[1] === '$', absRow: m[3] === '$' };
}

/** Render a reference, preserving `$` absolute markers ("A1", "$A$1", …). */
export function refLabel(row: number, col: number, absRow = false, absCol = false): string {
  return `${absCol ? '$' : ''}${columnLabel(col)}${absRow ? '$' : ''}${row + 1}`;
}

/** One endpoint of a whole-column or whole-row span, with its `$` marker. */
export interface SpanEnd {
  index: number;
  abs: boolean;
}

/** Parse a bare column label ("A", "$AB") to a 0-based column index, or null. */
export function parseWholeColumn(text: string): number | null {
  return parseWholeColumnEx(text)?.index ?? null;
}

/** Like {@link parseWholeColumn} but also reports the `$` marker. */
export function parseWholeColumnEx(text: string): SpanEnd | null {
  const m = COL_LABEL_PATTERN.exec(text);
  if (!m) {
    return null;
  }
  const col = columnIndex(m[2]);
  return col >= 0 && col <= MAX_REF_COLUMN ? { index: col, abs: m[1] === '$' } : null;
}

/** Parse a bare row number ("1", "$10") to a 0-based row index, or null. */
export function parseWholeRow(text: string): number | null {
  return parseWholeRowEx(text)?.index ?? null;
}

/** Like {@link parseWholeRow} but also reports the `$` marker. */
export function parseWholeRowEx(text: string): SpanEnd | null {
  const m = ROW_NUMBER_PATTERN.exec(text);
  if (!m) {
    return null;
  }
  const row = Number(m[2]) - 1;
  return row >= 0 && row <= MAX_REF_ROW ? { index: row, abs: m[1] === '$' } : null;
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

export const MAX_FORMULA_LENGTH = 8192;
/** Recursion guard; ~5 depth units are consumed per nesting level. */
const MAX_PARSE_DEPTH = 400;

type TokenType =
  | 'number'
  | 'string'
  | 'ident'
  | 'error'
  | 'op'
  | 'lparen'
  | 'rparen'
  | 'comma'
  | 'colon'
  /** Worksheet-reference separator `!` (as in `Sheet1!A1`). */
  | 'bang'
  /** A single-quoted worksheet name (`'Quarter 1'`); `value` is the unescaped name. */
  | 'sheetname';

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

/**
 * A reference token containing at least one `$` marker (plain `A1` stays on
 * the ordinary identifier path). Longest alternatives first: a full cell
 * reference, then a `$`-marked whole-column / whole-row span endpoint.
 */
const DOLLAR_REF_TOKEN =
  /^(?:\$[A-Za-z]{1,3}\$?[0-9]{1,7}|[A-Za-z]{1,3}\$[0-9]{1,7}|\$[A-Za-z]{1,3}|\$[0-9]{1,7})/;

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
    if (ch === "'") {
      // A single-quoted worksheet name (`'Quarter 1'`), used as a cross-sheet
      // reference prefix before `!`. A literal single quote inside the name is
      // written doubled (`''`), matching conventional spreadsheets.
      let j = i + 1;
      let out = '';
      let closed = false;
      while (j < len) {
        if (src[j] === "'") {
          if (j + 1 < len && src[j + 1] === "'") {
            out += "'";
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
      if (!closed || out.length === 0) {
        throw new FormulaError('#ERROR!');
      }
      tokens.push({ type: 'sheetname', start, end: j, text: src.slice(i, j), value: out });
      i = j;
      continue;
    }
    if (ch === '!') {
      tokens.push({ type: 'bang', start, end: i + 1, text: ch });
      i += 1;
      continue;
    }
    if (ch === '$' || /[A-Za-z_]/.test(ch)) {
      // `$`-marked references tokenize as one ident-shaped token so absolute
      // and mixed forms ($A$1, $A1, A$1) and `$`-marked span endpoints ($A,
      // $1) survive as single units; plain identifiers fall through below.
      const m = DOLLAR_REF_TOKEN.exec(src.slice(i));
      if (m) {
        tokens.push({ type: 'ident', start, end: i + m[0].length, text: m[0] });
        i += m[0].length;
        continue;
      }
      if (ch === '$') {
        throw new FormulaError('#ERROR!');
      }
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
  /**
   * Worksheet-qualified reference (`Sheet1!A1`): the target worksheet's name.
   * Absent for an ordinary reference, which resolves against the current
   * worksheet. Resolution is workbook-provided (see EvalContext.getSheetCell);
   * an unresolvable name evaluates to #REF!.
   */
  sheet?: string;
}

export type AstNode =
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | RefNode
  | { kind: 'range'; from: RefNode; to: RefNode; sheet?: string }
  /** Whole-column range (e.g. A:C); bounded to the used grid at evaluation. */
  | { kind: 'colrange'; fromCol: number; toCol: number; sheet?: string }
  /** Whole-row range (e.g. 1:10); bounded to the used grid at evaluation. */
  | { kind: 'rowrange'; fromRow: number; toRow: number; sheet?: string }
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
  // (letters immediately followed by digits, e.g. A1, or preceded by a `$`
  // absolute marker) and not preceded by a letter/digit that would make it a
  // longer identifier.
  if (start > 0 && /[A-Za-z0-9$]/.test(text[start - 1])) {
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

  /**
   * Parse the reference that follows a worksheet qualifier (`Sheet1!`…):
   * a cell, a range, a whole-column range, or a whole-row range, all bound to
   * `sheet`. A second qualifier inside a range (`Sheet1!A1:Sheet2!B2`, a "3D"
   * range) is deliberately not supported: the endpoint fails to parse as a
   * reference and the formula resolves to #ERROR! rather than guessing.
   */
  private parseSheetQualified(sheet: string, depth: number): AstNode {
    if (depth > MAX_PARSE_DEPTH) {
      throw new FormulaError('#ERROR!');
    }
    const token = this.next();
    // `Sheet1!1:10` — a whole-row range introduced by a plain number.
    if (token.type === 'number') {
      if (this.peek()?.type !== 'colon') {
        throw new FormulaError('#ERROR!');
      }
      const fromRow = parseWholeRow(token.text);
      this.next(); // colon
      const endToken = this.next();
      const toRow =
        endToken.type === 'number' || endToken.type === 'ident' ? parseWholeRow(endToken.text) : null;
      if (fromRow === null || toRow === null) {
        throw new FormulaError('#ERROR!');
      }
      return { kind: 'rowrange', fromRow, toRow, sheet };
    }
    if (token.type !== 'ident') {
      throw new FormulaError('#ERROR!');
    }
    const nextToken = this.peek();
    const ref = parseRefEx(token.text);
    if (ref) {
      const refNode: RefNode = { kind: 'ref', row: ref.row, col: ref.col, sheet };
      if (nextToken && nextToken.type === 'colon') {
        this.next();
        const endToken = this.expect('ident');
        const endRef = parseRefEx(endToken.text);
        if (!endRef) {
          throw new FormulaError('#ERROR!');
        }
        return {
          kind: 'range',
          from: refNode,
          to: { kind: 'ref', row: endRef.row, col: endRef.col },
          sheet,
        };
      }
      return refNode;
    }
    // `Sheet1!A:C`
    const col = parseWholeColumn(token.text);
    if (col !== null && nextToken && nextToken.type === 'colon') {
      this.next();
      const endToken = this.expect('ident');
      const endCol = parseWholeColumn(endToken.text);
      if (endCol === null) {
        throw new FormulaError('#ERROR!');
      }
      return { kind: 'colrange', fromCol: col, toCol: endCol, sheet };
    }
    // `Sheet1!$1:10`
    const row = parseWholeRowEx(token.text);
    if (row !== null && row.abs && nextToken && nextToken.type === 'colon') {
      this.next();
      const endToken = this.next();
      const toRow =
        endToken.type === 'number' || endToken.type === 'ident' ? parseWholeRow(endToken.text) : null;
      if (toRow === null) {
        throw new FormulaError('#ERROR!');
      }
      return { kind: 'rowrange', fromRow: row.index, toRow, sheet };
    }
    throw new FormulaError('#ERROR!');
  }

  private parsePrimary(depth: number): AstNode {
    if (depth > MAX_PARSE_DEPTH) {
      throw new FormulaError('#ERROR!');
    }
    const token = this.next();
    switch (token.type) {
      case 'number': {
        // A whole-row range such as 1:1, 2:10, or 1:$10.
        if (this.peek()?.type === 'colon') {
          const fromRow = parseWholeRow(token.text);
          this.next(); // colon
          const endToken = this.next();
          const toRow =
            endToken.type === 'number' || endToken.type === 'ident' ? parseWholeRow(endToken.text) : null;
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
      case 'sheetname': {
        // A quoted worksheet name is only meaningful as a cross-sheet prefix.
        this.expect('bang');
        return this.parseSheetQualified(token.value as string, depth + 1);
      }
      case 'ident': {
        const nextToken = this.peek();
        // `Name!` can only introduce a cross-sheet reference, so an identifier
        // directly followed by `!` is an unquoted worksheet name.
        if (nextToken && nextToken.type === 'bang') {
          this.next();
          return this.parseSheetQualified(token.text, depth + 1);
        }
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
        const ref = parseRefEx(token.text);
        if (ref) {
          const refNode: RefNode = { kind: 'ref', row: ref.row, col: ref.col };
          if (nextToken && nextToken.type === 'colon') {
            this.next();
            const endToken = this.expect('ident');
            const endRef = parseRefEx(endToken.text);
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
        // A whole-column range such as A:A, A:C, or $A:$C.
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
        // A whole-row range starting with a `$`-marked row, e.g. $1:10.
        const row = parseWholeRowEx(token.text);
        if (row !== null && row.abs && nextToken && nextToken.type === 'colon') {
          this.next();
          const endToken = this.next();
          const toRow =
            endToken.type === 'number' || endToken.type === 'ident' ? parseWholeRow(endToken.text) : null;
          if (toRow === null) {
            throw new FormulaError('#ERROR!');
          }
          return { kind: 'rowrange', fromRow: row.index, toRow };
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
  /** Resolve a cell on the *current* worksheet (already computed for formula cells). */
  getCell(row: number, col: number): FormulaValue;
  /**
   * Used-grid bounds. Whole-column (`A:A`) and whole-row (`1:1`) ranges are
   * clamped to these so they cover only the actual sheet, never an unbounded
   * space. When omitted (e.g. a bare cell context in tests) whole-column/row
   * ranges resolve to empty.
   */
  rowCount?: number;
  columnCount?: number;
  /**
   * Resolve a cell on another worksheet of the same workbook, for
   * worksheet-qualified references (`Sheet1!A1`). Supplied by the workbook,
   * which owns the shared evaluation memo and the in-progress set — that is
   * what makes circular references detectable *across* worksheets. When this
   * is omitted (a single-sheet context) any qualified reference is #REF!.
   */
  getSheetCell?(sheet: string, row: number, col: number): FormulaValue;
  /**
   * Used-grid bounds of another worksheet, resolved by name (case-insensitively,
   * matching the worksheet-name uniqueness policy). Returns null when no such
   * worksheet exists, which makes the whole reference #REF! — a deleted or
   * unknown worksheet is never silently redirected to another one.
   */
  getSheetBounds?(sheet: string): { rowCount: number; columnCount: number } | null;
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
  | {
      kind: 'range';
      top: number;
      bottom: number;
      left: number;
      right: number;
      /** Worksheet the range belongs to, for a qualified range (`Sheet1!A1:B10`). */
      sheet?: string;
    };

function scalar(value: FormulaValue): EvalResult {
  return { kind: 'scalar', value };
}

function range(top: number, bottom: number, left: number, right: number, sheet?: string): EvalResult {
  return sheet === undefined
    ? { kind: 'range', top, bottom, left, right }
    : { kind: 'range', top, bottom, left, right, sheet };
}

/**
 * Resolve the used-grid bounds a reference should be clamped to. Returns null
 * when the reference names a worksheet that cannot be resolved (deleted,
 * renamed, or absent), which makes the whole reference #REF!.
 */
function boundsFor(sheet: string | undefined, ctx: EvalContext): { rows: number; cols: number } | null {
  if (sheet === undefined) {
    return { rows: ctx.rowCount ?? 0, cols: ctx.columnCount ?? 0 };
  }
  const resolved = ctx.getSheetCell && ctx.getSheetBounds ? ctx.getSheetBounds(sheet) : null;
  return resolved ? { rows: resolved.rowCount, cols: resolved.columnCount } : null;
}

/** The cell reader for a (possibly worksheet-qualified) reference. */
function cellReaderFor(
  sheet: string | undefined,
  ctx: EvalContext,
): (row: number, col: number) => FormulaValue {
  if (sheet === undefined) {
    return (row, col) => ctx.getCell(row, col);
  }
  const getSheetCell = ctx.getSheetCell;
  if (!getSheetCell) {
    return () => errorValue('#REF!');
  }
  return (row, col) => getSheetCell(sheet, row, col);
}

function evalNode(ast: AstNode, ctx: EvalContext): EvalResult {
  switch (ast.kind) {
    case 'number':
      return scalar(numberValue(ast.value));
    case 'string':
      return scalar({ type: 'string', value: ast.value });
    case 'error':
      return scalar(errorValue(ast.code));
    case 'ref': {
      // A worksheet-qualified reference must resolve to a real worksheet;
      // an unknown name is #REF!, never silently redirected.
      if (ast.sheet !== undefined && boundsFor(ast.sheet, ctx) === null) {
        return scalar(errorValue('#REF!'));
      }
      return scalar(cellReaderFor(ast.sheet, ctx)(ast.row, ast.col));
    }
    case 'range': {
      if (ast.sheet !== undefined && boundsFor(ast.sheet, ctx) === null) {
        return scalar(errorValue('#REF!'));
      }
      const top = Math.min(ast.from.row, ast.to.row);
      const bottom = Math.max(ast.from.row, ast.to.row);
      const left = Math.min(ast.from.col, ast.to.col);
      const right = Math.max(ast.from.col, ast.to.col);
      return range(top, bottom, left, right, ast.sheet);
    }
    case 'colrange': {
      // A:C over the used grid: all used rows, columns clamped to used bounds.
      const bounds = boundsFor(ast.sheet, ctx);
      if (!bounds) {
        return scalar(errorValue('#REF!'));
      }
      const left = Math.min(ast.fromCol, ast.toCol);
      const right = Math.min(Math.max(ast.fromCol, ast.toCol), bounds.cols - 1);
      return range(0, bounds.rows - 1, left, right, ast.sheet);
    }
    case 'rowrange': {
      // 1:10 over the used grid: all used columns, rows clamped to used bounds.
      const bounds = boundsFor(ast.sheet, ctx);
      if (!bounds) {
        return scalar(errorValue('#REF!'));
      }
      const top = Math.min(ast.fromRow, ast.toRow);
      const bottom = Math.min(Math.max(ast.fromRow, ast.toRow), bounds.rows - 1);
      return range(top, bottom, 0, bounds.cols - 1, ast.sheet);
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
    // A worksheet-qualified range iterates that worksheet's cells.
    const readCell = cellReaderFor(result.sheet, ctx);
    for (let r = top; r <= bottom; r++) {
      for (let c = left; c <= right; c++) {
        const v = readCell(r, c);
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

/**
 * Maps one cell reference to its rewritten coordinates. The input carries the
 * reference's `$` markers so mappers can hold absolute components fixed
 * (copy/paste) or ignore the markers (structural edits); the rewriter itself
 * always re-renders the original markers on the mapped output.
 */
export type RefMap = (ref: CellRefEx) => { row: number; col: number } | 'REF_ERROR';
export type RangeMap = (
  from: CellRefEx,
  to: CellRefEx,
) => { from: { row: number; col: number }; to: { row: number; col: number } } | 'REF_ERROR';
/** Map the endpoints of a whole-column or whole-row span (1-D, with `$` markers). */
export type SpanMap = (from: SpanEnd, to: SpanEnd) => { from: number; to: number } | 'REF_ERROR';

/**
 * Rewrite every cell reference in a formula string using the given mapping
 * functions, preserving all other text — including each reference's `$`
 * absolute markers, which are re-rendered onto the mapped coordinates.
 * References that map to 'REF_ERROR' are replaced with the literal #REF!
 * error. Formulas that do not tokenize are returned unchanged (they already
 * display #ERROR!).
 *
 * `mapColSpan`/`mapRowSpan` handle whole-column (`A:C`) and whole-row (`1:10`)
 * ranges; when omitted those ranges are left unchanged.
 */
/**
 * Cross-sheet options for {@link rewriteFormulaRefs}. Omitting them keeps the
 * single-worksheet behavior: every reference is remapped and any worksheet
 * qualifier is preserved exactly as written.
 */
export interface SheetRewriteOptions {
  /**
   * The worksheet the formula being rewritten lives in. An unqualified
   * reference belongs to this worksheet, which is what `shouldMapCoords`
   * receives as the reference's effective worksheet.
   */
  homeSheet?: string;
  /**
   * Transform an explicit worksheet qualifier. Return a name to rewrite the
   * prefix (re-quoted as needed), `'REF_ERROR'` to turn the whole reference
   * into #REF! (the worksheet was deleted), or null to keep the prefix
   * exactly as written.
   */
  mapSheet?: (sheet: string) => string | 'REF_ERROR' | null;
  /**
   * Whether the coordinate mappers apply to a reference whose effective
   * worksheet is `sheet` (null when the formula's own worksheet is unknown).
   * Structural row/column edits use this so inserting a row in one worksheet
   * never shifts references that point at a different one. Defaults to
   * remapping every reference.
   */
  shouldMapCoords?: (sheet: string | null) => boolean;
}

/**
 * Rewrite every cell reference in a formula string using the given mapping
 * functions, preserving all other text — including each reference's `$`
 * absolute markers, which are re-rendered onto the mapped coordinates, and its
 * worksheet qualifier (`Sheet1!`, `'Quarter 1'!`), which is preserved or
 * transformed through {@link SheetRewriteOptions.mapSheet}. References that map
 * to 'REF_ERROR' — and references into a deleted worksheet — are replaced with
 * the literal #REF! error. Formulas that do not tokenize are returned unchanged
 * (they already display #ERROR!).
 *
 * `mapColSpan`/`mapRowSpan` handle whole-column (`A:C`) and whole-row (`1:10`)
 * ranges; when omitted those ranges keep their coordinates.
 */
export function rewriteFormulaRefs(
  src: string,
  mapRef: RefMap,
  mapRange: RangeMap,
  mapColSpan?: SpanMap,
  mapRowSpan?: SpanMap,
  sheetOpts?: SheetRewriteOptions,
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
  // Token offsets are relative to the text after '='.
  const body = src.slice(1);
  // A whole-row span endpoint is a number token (1) or a `$`-marked ident ($1).
  const rowEnd = (token: Token | null): SpanEnd | null =>
    token && (token.type === 'number' || token.type === 'ident') ? parseWholeRowEx(token.text) : null;
  const colText = (index: number, abs: boolean): string => `${abs ? '$' : ''}${columnLabel(index)}`;
  const rowText = (index: number, abs: boolean): string => `${abs ? '$' : ''}${index + 1}`;

  /** True when the coordinate mappers apply to a reference on `sheetName`. */
  const mapsCoords = (sheetName: string | null): boolean => {
    const effective = sheetName ?? sheetOpts?.homeSheet ?? null;
    return sheetOpts?.shouldMapCoords ? sheetOpts.shouldMapCoords(effective) : true;
  };
  /** The rewritten `Sheet!` prefix, '' when unqualified, or null for #REF!. */
  const resolvePrefix = (sheetName: string | null, sheetText: string | null): string | null => {
    if (sheetName === null) {
      return '';
    }
    const mapped = sheetOpts?.mapSheet?.(sheetName);
    if (mapped === 'REF_ERROR') {
      return null;
    }
    if (typeof mapped === 'string') {
      return `${quoteSheetName(mapped)}!`;
    }
    return `${sheetText}!`;
  };

  let i = 0;
  while (i < tokens.length) {
    // An optional worksheet qualifier: `Name!` or `'Quoted Name'!`.
    let sheetName: string | null = null;
    let sheetText: string | null = null;
    let spanStart = -1;
    let j = i;
    const head = tokens[i];
    const afterHead = tokens[i + 1] ?? null;
    if (afterHead && afterHead.type === 'bang' && (head.type === 'ident' || head.type === 'sheetname')) {
      sheetName = head.type === 'sheetname' ? (head.value as string) : head.text;
      sheetText = head.text;
      spanStart = head.start;
      j = i + 2;
    }
    const token = tokens[j] ?? null;
    if (!token) {
      i += 1;
      continue;
    }
    const nextToken = tokens[j + 1] ?? null;
    if (nextToken && nextToken.type === 'lparen') {
      i = j + 1; // a function name, never a reference
      continue;
    }
    if (spanStart < 0) {
      spanStart = token.start;
    }
    const prefix = resolvePrefix(sheetName, sheetText);
    const doMap = mapsCoords(sheetName);
    // The coordinate text of the occurrence, or null when it becomes #REF!.
    let coords: string | null = null;
    let spanEnd = -1;
    let lastIndex = j;

    if (token.type === 'number' || token.type === 'ident') {
      const ref = token.type === 'ident' ? parseRefEx(token.text) : null;
      if (ref) {
        if (nextToken && nextToken.type === 'colon') {
          // Range: ref ':' ref
          const endToken = tokens[j + 2] ?? null;
          const endRef = endToken && endToken.type === 'ident' ? parseRefEx(endToken.text) : null;
          if (endRef && endToken) {
            const mapped = doMap ? mapRange(ref, endRef) : { from: ref, to: endRef };
            coords =
              mapped === 'REF_ERROR'
                ? null
                : `${refLabel(mapped.from.row, mapped.from.col, ref.absRow, ref.absCol)}:${refLabel(mapped.to.row, mapped.to.col, endRef.absRow, endRef.absCol)}`;
            spanEnd = endToken.end;
            lastIndex = j + 2;
          }
        }
        if (spanEnd < 0) {
          const mapped = doMap ? mapRef(ref) : { row: ref.row, col: ref.col };
          coords = mapped === 'REF_ERROR' ? null : refLabel(mapped.row, mapped.col, ref.absRow, ref.absCol);
          spanEnd = token.end;
          lastIndex = j;
        }
      } else if (nextToken && nextToken.type === 'colon') {
        // Whole-column range: COL ':' COL (e.g. A:C, $A:$C).
        const fromCol = token.type === 'ident' ? parseWholeColumnEx(token.text) : null;
        const endToken = tokens[j + 2] ?? null;
        const toCol = endToken && endToken.type === 'ident' ? parseWholeColumnEx(endToken.text) : null;
        if (fromCol !== null && toCol !== null && endToken) {
          const mapped =
            doMap && mapColSpan ? mapColSpan(fromCol, toCol) : { from: fromCol.index, to: toCol.index };
          coords =
            mapped === 'REF_ERROR'
              ? null
              : `${colText(mapped.from, fromCol.abs)}:${colText(mapped.to, toCol.abs)}`;
          spanEnd = endToken.end;
          lastIndex = j + 2;
        } else {
          // Whole-row range: (NUMBER | $ROW) ':' (NUMBER | $ROW).
          const fromRow = parseWholeRowEx(token.text);
          const toRow = rowEnd(endToken);
          if (fromRow !== null && toRow !== null && endToken) {
            const mapped =
              doMap && mapRowSpan ? mapRowSpan(fromRow, toRow) : { from: fromRow.index, to: toRow.index };
            coords =
              mapped === 'REF_ERROR'
                ? null
                : `${rowText(mapped.from, fromRow.abs)}:${rowText(mapped.to, toRow.abs)}`;
            spanEnd = endToken.end;
            lastIndex = j + 2;
          }
        }
      }
    }

    if (spanEnd < 0) {
      // Not a reference occurrence; skip just the head token so a stray
      // qualifier cannot swallow the tokens that follow it.
      i += 1;
      continue;
    }
    const text = prefix === null || coords === null ? '#REF!' : `${prefix}${coords}`;
    if (text !== body.slice(spanStart, spanEnd)) {
      splices.push({ start: spanStart, end: spanEnd, text });
    }
    i = lastIndex + 1;
  }
  if (splices.length === 0) {
    return src;
  }
  let out = body;
  for (let k = splices.length - 1; k >= 0; k--) {
    const s = splices[k];
    out = out.slice(0, s.start) + s.text + out.slice(s.end);
  }
  return `=${out}`;
}

// ---------------------------------------------------------------------------
// Reference extraction (live highlighting while a formula is edited)
// ---------------------------------------------------------------------------

/**
 * A referenced rectangle extracted from formula text. Whole-column and
 * whole-row references are unbounded along one axis (marked by the flags);
 * the renderer clamps them to the used grid.
 */
export interface FormulaRefRange {
  top: number;
  left: number;
  bottom: number;
  right: number;
  /** Whole-column reference (A:C): rows are unbounded. */
  wholeCols?: boolean;
  /** Whole-row reference (2:10): columns are unbounded. */
  wholeRows?: boolean;
  /** The reference exactly as written (for accessible descriptions). */
  text: string;
}

/** Highlighting caps out so a pathological formula cannot flood the grid. */
export const MAX_HIGHLIGHTED_REFS = 16;

const REF_SCAN_PATTERN =
  // string literal | A1[:B2] | A:C | 1:10 — each with optional `$` markers
  // ($A$1, $A1, A$1, $A:C, $1:10). Longest alternatives first.
  /"(?:[^"]|"")*"?|\$?([A-Za-z]{1,3})\$?([0-9]{1,7})(?::\$?([A-Za-z]{1,3})\$?([0-9]{1,7}))?|\$?([A-Za-z]{1,3}):\$?([A-Za-z]{1,3})|\$?([0-9]{1,7}):\$?([0-9]{1,7})/g;

/**
 * Extract every cell/range reference from (possibly incomplete) formula text.
 * This is a tolerant text scan, not the strict parser: it works while the
 * formula is mid-edit (`=SUM(A1:B` still highlights `A1`), skips string
 * literals, never throws, and ignores anything that is not valid reference
 * notation. Duplicate rectangles are merged; at most
 * {@link MAX_HIGHLIGHTED_REFS} distinct ranges are returned.
 */
export function extractFormulaRefs(src: string): FormulaRefRange[] {
  if (!src.startsWith('=')) {
    return [];
  }
  const body = src.slice(1);
  const out: FormulaRefRange[] = [];
  const seen = new Set<string>();
  const isWordChar = (ch: string | undefined): boolean => ch !== undefined && /[A-Za-z0-9_.]/.test(ch);
  REF_SCAN_PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = REF_SCAN_PATTERN.exec(body)) !== null) {
    if (m[0].startsWith('"')) {
      continue; // string literal
    }
    // Reject matches embedded in longer identifiers/numbers (e.g. `ABCD1`,
    // the `1.5` in a decimal, or `_A1`).
    if (isWordChar(body[m.index - 1]) || isWordChar(body[m.index + m[0].length])) {
      continue;
    }
    // A worksheet-qualified reference (`Sheet1!A1`) points at another
    // worksheet, so it has no rectangle to highlight in the current grid —
    // and the qualifier itself (`AB1` in `AB1!C2`) is a name, not a reference.
    if (body[m.index - 1] === '!' || body[m.index + m[0].length] === '!') {
      continue;
    }
    let range: FormulaRefRange | null = null;
    if (m[1] !== undefined && m[2] !== undefined) {
      const from = parseRef(`${m[1]}${m[2]}`);
      if (!from) continue;
      if (m[3] !== undefined && m[4] !== undefined) {
        const to = parseRef(`${m[3]}${m[4]}`);
        if (!to) continue;
        range = {
          top: Math.min(from.row, to.row),
          left: Math.min(from.col, to.col),
          bottom: Math.max(from.row, to.row),
          right: Math.max(from.col, to.col),
          text: m[0],
        };
      } else {
        range = { top: from.row, left: from.col, bottom: from.row, right: from.col, text: m[0] };
      }
    } else if (m[5] !== undefined && m[6] !== undefined) {
      const a = parseWholeColumn(m[5]);
      const b = parseWholeColumn(m[6]);
      if (a === null || b === null) continue;
      range = {
        top: 0,
        bottom: Number.MAX_SAFE_INTEGER,
        left: Math.min(a, b),
        right: Math.max(a, b),
        wholeCols: true,
        text: m[0],
      };
    } else if (m[7] !== undefined && m[8] !== undefined) {
      const a = parseWholeRow(m[7]);
      const b = parseWholeRow(m[8]);
      if (a === null || b === null) continue;
      range = {
        top: Math.min(a, b),
        bottom: Math.max(a, b),
        left: 0,
        right: Number.MAX_SAFE_INTEGER,
        wholeRows: true,
        text: m[0],
      };
    }
    if (!range) {
      continue;
    }
    const key = `${range.top},${range.left},${range.bottom},${range.right}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(range);
    if (out.length >= MAX_HIGHLIGHTED_REFS) {
      break;
    }
  }
  return out;
}

/**
 * Shift all references by a fixed delta (used for copy/paste/fill). Only
 * relative components move: `$`-marked absolute rows/columns (and `$`-marked
 * whole-column/row span endpoints) stay fixed, exactly like conventional
 * spreadsheets. Out-of-sheet results become #REF!.
 */
export function shiftFormulaRefs(src: string, deltaRow: number, deltaCol: number): string {
  const mapOne = (ref: CellRefEx): { row: number; col: number } | 'REF_ERROR' => {
    const r = ref.absRow ? ref.row : ref.row + deltaRow;
    const c = ref.absCol ? ref.col : ref.col + deltaCol;
    if (r < 0 || c < 0 || r > MAX_REF_ROW || c > MAX_REF_COLUMN) {
      return 'REF_ERROR';
    }
    return { row: r, col: c };
  };
  const spanShift =
    (delta: number, max: number): SpanMap =>
    (from, to) => {
      const a = from.abs ? from.index : from.index + delta;
      const b = to.abs ? to.index : to.index + delta;
      if (a < 0 || b < 0 || a > max || b > max) {
        return 'REF_ERROR';
      }
      return { from: a, to: b };
    };
  return rewriteFormulaRefs(
    src,
    mapOne,
    (from, to) => {
      const a = mapOne(from);
      const b = mapOne(to);
      if (a === 'REF_ERROR' || b === 'REF_ERROR') {
        return 'REF_ERROR';
      }
      return { from: a, to: b };
    },
    spanShift(deltaCol, MAX_REF_COLUMN),
    spanShift(deltaRow, MAX_REF_ROW),
  );
}

/**
 * Adjust references for a row or column insertion/deletion along one axis.
 * `index`/`count` describe the affected rows (axis 'row') or columns
 * (axis 'col'). Deletion follows conventional spreadsheet behavior:
 * references into the deleted span become #REF!; ranges are clamped and
 * become #REF! only when the whole range is deleted. Absolute (`$`) and
 * relative references adjust identically here — both track the referenced
 * cell's new position — and every `$` marker is preserved in the rewritten
 * text (`$` only fixes references against copy/fill, not structural edits).
 */
export function adjustFormulaForAxis(
  src: string,
  axis: 'row' | 'col',
  op: 'insert' | 'delete',
  index: number,
  count: number,
  sheetOpts?: SheetRewriteOptions,
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
  const mapRef: RefMap = (ref) => {
    const v = axis === 'row' ? ref.row : ref.col;
    const shifted = shiftPoint(v);
    if (shifted === 'deleted') {
      return 'REF_ERROR';
    }
    return axis === 'row' ? { row: shifted, col: ref.col } : { row: ref.row, col: shifted };
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
    const lowIn = Math.min(from.index, to.index);
    const highIn = Math.max(from.index, to.index);
    if (op === 'delete' && lowIn >= index && highIn < index + count) {
      return 'REF_ERROR';
    }
    const low = clampLow(lowIn);
    const high = clampHigh(highIn);
    if (high < low) {
      return 'REF_ERROR';
    }
    return from.index === lowIn ? { from: low, to: high } : { from: high, to: low };
  };
  // A column operation shifts whole-column spans; a row operation shifts
  // whole-row spans. The orthogonal span kind is left untouched.
  const mapColSpan = axis === 'col' ? mapSpan : undefined;
  const mapRowSpan = axis === 'row' ? mapSpan : undefined;
  return rewriteFormulaRefs(src, mapRef, mapRange, mapColSpan, mapRowSpan, sheetOpts);
}

// ---------------------------------------------------------------------------
// Worksheet-scoped rewrites (rename / delete a worksheet)
// ---------------------------------------------------------------------------

/** Coordinate mappers that leave every reference exactly where it is. */
const IDENTITY_REF: RefMap = (ref) => ({ row: ref.row, col: ref.col });
const IDENTITY_RANGE: RangeMap = (from, to) => ({
  from: { row: from.row, col: from.col },
  to: { row: to.row, col: to.col },
});
const IDENTITY_SPAN: SpanMap = (from, to) => ({ from: from.index, to: to.index });

/**
 * Rewrite every reference to worksheet `oldName` so it names `newName`
 * instead, re-quoting the prefix only as the new name requires. Coordinates,
 * `$` markers, and all other formula text are untouched, so a rename never
 * changes what a formula computes. Worksheet names match case-insensitively,
 * matching the uniqueness policy.
 */
export function renameSheetInFormula(src: string, oldName: string, newName: string): string {
  const target = sheetNameKey(oldName);
  return rewriteFormulaRefs(src, IDENTITY_REF, IDENTITY_RANGE, IDENTITY_SPAN, IDENTITY_SPAN, {
    mapSheet: (sheet) => (sheetNameKey(sheet) === target ? newName : null),
  });
}

/**
 * Turn every reference to worksheet `sheetName` into the explicit #REF! error
 * (the worksheet was deleted). References to other worksheets and to the
 * formula's own worksheet are left untouched — a deleted worksheet is never
 * silently redirected to a different one.
 */
export function invalidateSheetRefsInFormula(src: string, sheetName: string): string {
  const target = sheetNameKey(sheetName);
  return rewriteFormulaRefs(src, IDENTITY_REF, IDENTITY_RANGE, IDENTITY_SPAN, IDENTITY_SPAN, {
    mapSheet: (sheet) => (sheetNameKey(sheet) === target ? 'REF_ERROR' : null),
  });
}

/**
 * True when the formula contains at least one reference qualified with
 * `sheetName` (case-insensitively). Used to report which worksheets a delete
 * or rename will affect without rewriting anything.
 */
export function formulaReferencesSheet(src: string, sheetName: string): boolean {
  const target = sheetNameKey(sheetName);
  let found = false;
  rewriteFormulaRefs(src, IDENTITY_REF, IDENTITY_RANGE, IDENTITY_SPAN, IDENTITY_SPAN, {
    mapSheet: (sheet) => {
      if (sheetNameKey(sheet) === target) {
        found = true;
      }
      return null;
    },
  });
  return found;
}
