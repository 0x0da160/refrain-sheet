// SPDX-License-Identifier: MIT
/**
 * The formula tokenizer: formula source (without the leading `=`) to tokens.
 * Bounded and never throws anything but `FormulaError`.
 */
import { ERROR_CODES, type ErrorCode } from './value';

/** Recursion guard; ~5 depth units are consumed per nesting level. */
export const MAX_PARSE_DEPTH = 400;

export type TokenType =
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

export interface Token {
  type: TokenType;
  /** Source span within the formula text (including the leading '='). */
  start: number;
  end: number;
  text: string;
  /** Parsed value for number/string tokens. */
  value?: number | string;
}

export class FormulaError extends Error {
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

/** Single-character tokens other than operators. */
const PUNCTUATION: ReadonlyMap<string, TokenType> = new Map([
  ['(', 'lparen'],
  [')', 'rparen'],
  [',', 'comma'],
  [':', 'colon'],
  ['!', 'bang'],
]);

const SINGLE_CHAR_OPS: ReadonlySet<string> = new Set(['+', '-', '*', '/', '=', '&']);

export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === ' ' || ch === '\t') {
      i += 1;
      continue;
    }
    const token = scanToken(src, i, ch);
    tokens.push(token);
    i = token.end;
  }
  return tokens;
}

/** The token starting at `i` (whose first character is `ch`). */
function scanToken(src: string, i: number, ch: string): Token {
  if (isDigit(ch)) {
    return scanNumber(src, i);
  }
  if (ch === '.') {
    return scanLeadingDotNumber(src, i);
  }
  if (ch === '"') {
    const { value, end } = scanQuoted(src, i, '"');
    return { type: 'string', start: i, end, text: src.slice(i, end), value };
  }
  if (ch === "'") {
    // A single-quoted worksheet name (`'Quarter 1'`), used as a cross-sheet
    // reference prefix before `!`. A literal single quote inside the name is
    // written doubled (`''`), matching conventional spreadsheets.
    const { value, end } = scanQuoted(src, i, "'");
    if (value.length === 0) {
      throw new FormulaError('#ERROR!');
    }
    return { type: 'sheetname', start: i, end, text: src.slice(i, end), value };
  }
  if (ch === '$' || /[A-Za-z_]/.test(ch)) {
    return scanIdentifier(src, i, ch);
  }
  if (ch === '#') {
    // Error literals such as #REF! or #DIV/0!.
    const rest = src.slice(i);
    const match = ERROR_CODES.find((code) => rest.startsWith(code));
    if (!match) {
      throw new FormulaError('#ERROR!');
    }
    return { type: 'error', start: i, end: i + match.length, text: match };
  }
  const punctuation = PUNCTUATION.get(ch);
  if (punctuation) {
    return { type: punctuation, start: i, end: i + 1, text: ch };
  }
  if (ch === '<' || ch === '>') {
    const two = src.slice(i, i + 2);
    const text = two === '<=' || two === '<>' || two === '>=' ? two : ch;
    return { type: 'op', start: i, end: i + text.length, text };
  }
  if (SINGLE_CHAR_OPS.has(ch)) {
    return { type: 'op', start: i, end: i + 1, text: ch };
  }
  throw new FormulaError('#ERROR!');
}

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= '0' && ch <= '9';
}

/** End of the run of ASCII digits starting at `j`. */
function skipDigits(src: string, j: number): number {
  while (j < src.length && isDigit(src[j])) j++;
  return j;
}

/** `12` or `12.5` (or `12.`). */
function scanNumber(src: string, i: number): Token {
  let j = skipDigits(src, i + 1);
  if (j < src.length && src[j] === '.') {
    j = skipDigits(src, j + 1);
  }
  const text = src.slice(i, j);
  return { type: 'number', start: i, end: j, text, value: Number(text) };
}

/** `.5`; a dot without digits is an error. */
function scanLeadingDotNumber(src: string, i: number): Token {
  const j = skipDigits(src, i + 1);
  if (j === i + 1) {
    throw new FormulaError('#ERROR!');
  }
  const text = src.slice(i, j);
  return { type: 'number', start: i, end: j, text, value: Number(text) };
}

/** A `quote`-delimited run starting at `i`, with doubled quotes unescaped. */
function scanQuoted(src: string, i: number, quote: string): { value: string; end: number } {
  let j = i + 1;
  let out = '';
  while (j < src.length) {
    if (src[j] === quote) {
      if (j + 1 < src.length && src[j + 1] === quote) {
        out += quote;
        j += 2;
        continue;
      }
      return { value: out, end: j + 1 };
    }
    out += src[j];
    j += 1;
  }
  throw new FormulaError('#ERROR!');
}

/** An identifier, function name, or (possibly `$`-marked) reference. */
function scanIdentifier(src: string, i: number, ch: string): Token {
  // `$`-marked references tokenize as one ident-shaped token so absolute
  // and mixed forms ($A$1, $A1, A$1) and `$`-marked span endpoints ($A,
  // $1) survive as single units; plain identifiers fall through below.
  const m = DOLLAR_REF_TOKEN.exec(src.slice(i));
  if (m) {
    return { type: 'ident', start: i, end: i + m[0].length, text: m[0] };
  }
  if (ch === '$') {
    throw new FormulaError('#ERROR!');
  }
  let j = i + 1;
  // A dot continues an identifier only when a letter follows it, so the
  // dotted function names (MODE.SNGL, STDEV.S, RANK.EQ) tokenize as one
  // unit while `1.5` and `.5` still reach the number scanners above.
  while (
    j < src.length &&
    (/[A-Za-z0-9_]/.test(src[j]) || (src[j] === '.' && /[A-Za-z]/.test(src[j + 1] ?? '')))
  ) {
    j++;
  }
  return { type: 'ident', start: i, end: j, text: src.slice(i, j) };
}
