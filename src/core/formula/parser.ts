// SPDX-License-Identifier: MIT
/**
 * The recursive-descent formula parser (grammar in `./index.ts`) and
 * function-name completion.
 */
import { FUNCTION_INFOS, type FunctionInfo, lookupFunction } from './functions';
import { isFormula, parseRefEx, parseWholeColumn, parseWholeRow, parseWholeRowEx } from './refs';
import { FormulaError, MAX_PARSE_DEPTH, type Token, tokenize, type TokenType } from './tokenizer';
import { type ErrorCode, MAX_FORMULA_LENGTH, MAX_FUNCTION_ARGS } from './value';

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

interface RefNode {
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
  /** The `TRUE` / `FALSE` literals. */
  | { kind: 'boolean'; value: boolean }
  | RefNode
  | { kind: 'range'; from: RefNode; to: RefNode; sheet?: string }
  /** Whole-column range (e.g. A:C); bounded to the used grid at evaluation. */
  | { kind: 'colrange'; fromCol: number; toCol: number; sheet?: string }
  /** Whole-row range (e.g. 1:10); bounded to the used grid at evaluation. */
  | { kind: 'rowrange'; fromRow: number; toRow: number; sheet?: string }
  | { kind: 'unary'; op: '+' | '-'; operand: AstNode }
  | { kind: 'binary'; op: string; left: AstNode; right: AstNode }
  | { kind: 'call'; name: string; args: AstNode[] }
  /**
   * An empty argument slot (`XLOOKUP(a, b, c, , 2)`). It evaluates to the
   * blank value, and functions can tell it apart from an explicitly written
   * blank through {@link FnArg.isOmitted} so an omitted optional argument
   * still means "use the default".
   */
  | { kind: 'blank' }
  | { kind: 'error'; code: ErrorCode };

/**
 * Autocomplete matches for a formula being edited: the function names whose
 * start matches the identifier word immediately before the caret. Returns an
 * empty list unless the text is a formula (`=…`) and the caret sits at the end
 * of a bare identifier word (not a cell reference, not after `(`/a digit).
 *
 * A `.` counts as part of the word so the dotted names (`MODE.SNGL`,
 * `STDEV.S`, `RANK.EQ`) complete from any prefix, including after the dot.
 */
export function functionCompletions(text: string, caret: number): { word: string; matches: FunctionInfo[] } {
  const empty = { word: '', matches: [] as FunctionInfo[] };
  if (!text.startsWith('=') || caret < 1 || caret > text.length) {
    return empty;
  }
  // The identifier word ending at the caret.
  let start = caret;
  while (start > 0 && /[A-Za-z.]/.test(text[start - 1])) {
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
  if (word.startsWith('.')) {
    return empty; // a bare dot is a decimal point, not a function prefix
  }
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

  /** Shared recursion-depth guard for every recursive-descent parse method. */
  private checkDepth(depth: number): void {
    if (depth > MAX_PARSE_DEPTH) {
      throw new FormulaError('#ERROR!');
    }
  }

  parseExpr(depth: number): AstNode {
    this.checkDepth(depth);
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
    this.checkDepth(depth);
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
    this.checkDepth(depth);
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
    this.checkDepth(depth);
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
    this.checkDepth(depth);
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
    this.checkDepth(depth);
    const token = this.next();
    switch (token.type) {
      case 'number':
        // A whole-row range such as 1:1, 2:10, or 1:$10.
        if (this.peek()?.type === 'colon') {
          return this.parseRowRangeEnd(parseWholeRow(token.text));
        }
        return { kind: 'number', value: token.value as number };
      case 'string':
        return { kind: 'string', value: token.value as string };
      case 'error':
        return { kind: 'error', code: token.text as ErrorCode };
      case 'lparen': {
        const inner = this.parseExpr(depth + 1);
        this.expect('rparen');
        return inner;
      }
      case 'sheetname':
        // A quoted worksheet name is only meaningful as a cross-sheet prefix.
        this.expect('bang');
        return this.parseSheetQualified(token.value as string, depth + 1);
      case 'ident':
        return this.parseIdentifier(token, depth);
      default:
        throw new FormulaError('#ERROR!');
    }
  }

  /** An identifier: a sheet prefix, a function call, a boolean, or a reference. */
  private parseIdentifier(token: Token, depth: number): AstNode {
    const nextToken = this.peek();
    // `Name!` can only introduce a cross-sheet reference, so an identifier
    // directly followed by `!` is an unquoted worksheet name.
    if (nextToken?.type === 'bang') {
      this.next();
      return this.parseSheetQualified(token.text, depth + 1);
    }
    if (nextToken?.type === 'lparen') {
      this.next();
      return this.parseCall(token.text.toUpperCase(), depth);
    }
    // Boolean literals. They are ordinary identifiers to the tokenizer and
    // are not valid cell references, so recognising them here is what lets
    // `=VLOOKUP(A1, B1:D9, 3, FALSE)` and `=SORT(A1:C9, 2, FALSE)` be
    // written the conventional way instead of with 0 and 1.
    const upperText = token.text.toUpperCase();
    if (upperText === 'TRUE' || upperText === 'FALSE') {
      return { kind: 'boolean', value: upperText === 'TRUE' };
    }
    const followedByColon = nextToken?.type === 'colon';
    const ref = parseRefEx(token.text);
    if (ref) {
      const refNode: RefNode = { kind: 'ref', row: ref.row, col: ref.col };
      if (!followedByColon) {
        return refNode;
      }
      this.next();
      const endRef = parseRefEx(this.expect('ident').text);
      if (!endRef) {
        throw new FormulaError('#ERROR!');
      }
      return { kind: 'range', from: refNode, to: { kind: 'ref', row: endRef.row, col: endRef.col } };
    }
    // A whole-column range such as A:A, A:C, or $A:$C.
    const col = parseWholeColumn(token.text);
    if (col !== null && followedByColon) {
      this.next();
      const endCol = parseWholeColumn(this.expect('ident').text);
      if (endCol === null) {
        throw new FormulaError('#ERROR!');
      }
      return { kind: 'colrange', fromCol: col, toCol: endCol };
    }
    // A whole-row range starting with a `$`-marked row, e.g. $1:10.
    const row = parseWholeRowEx(token.text);
    if (row !== null && row.abs && followedByColon) {
      return this.parseRowRangeEnd(row.index);
    }
    throw new FormulaError('#NAME?');
  }

  /** The `:end` of a whole-row range whose start row is `fromRow` (null when invalid). */
  private parseRowRangeEnd(fromRow: number | null): AstNode {
    this.next(); // colon
    const endToken = this.next();
    const toRow =
      endToken.type === 'number' || endToken.type === 'ident' ? parseWholeRow(endToken.text) : null;
    if (fromRow === null || toRow === null) {
      throw new FormulaError('#ERROR!');
    }
    return { kind: 'rowrange', fromRow, toRow };
  }

  /** A function call's argument list, after its opening parenthesis. */
  private parseCall(name: string, depth: number): AstNode {
    const args: AstNode[] = [];
    if (this.peek()?.type === 'rparen') {
      this.next();
    } else {
      for (;;) {
        // An empty slot between separators is an omitted optional
        // argument (`XLOOKUP(a, b, c, , 2)`), not a syntax error.
        const ahead = this.peek();
        if (ahead && (ahead.type === 'comma' || ahead.type === 'rparen')) {
          args.push({ kind: 'blank' });
        } else {
          args.push(this.parseExpr(depth + 1));
        }
        if (args.length > MAX_FUNCTION_ARGS) {
          throw new FormulaError('#ERROR!');
        }
        const sep = this.next();
        if (sep.type === 'rparen') {
          break;
        }
        if (sep.type !== 'comma') {
          throw new FormulaError('#ERROR!');
        }
      }
    }
    const fn = lookupFunction(name);
    if (!fn) {
      throw new FormulaError('#NAME?');
    }
    // Arity is registry-driven: a wrong argument count is a structural
    // error, reported at parse time so the cell shows it immediately.
    if (args.length < fn.minArgs || args.length > fn.maxArgs) {
      throw new FormulaError('#ERROR!');
    }
    return { kind: 'call', name, args };
  }
}
