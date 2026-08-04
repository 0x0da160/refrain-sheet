// SPDX-License-Identifier: MIT
/**
 * A hand-written, read-only SQL-subset engine for local analysis over one
 * worksheet/CSV table at a time (no external database, no new dependency —
 * see docs/security.md "Dependency policy" and the design note in
 * docs/architecture.md for why).
 *
 * The engine only ever *parses* `SELECT` statements: there is no grammar
 * production for `INSERT`/`UPDATE`/`DELETE`/`DROP`/`ATTACH`/`PRAGMA`/anything
 * else, so those are rejected by construction (a syntax error), not by a
 * keyword blacklist. There is exactly one queryable table per query, always
 * named the fixed literal `data` in `FROM data` — the caller (the app layer)
 * maps that fixed name to whichever worksheet/CSV the user picked in the UI,
 * so a worksheet's *display* name (which may contain spaces, quotes, or SQL
 * keywords) never has to be parsed or escaped as a SQL identifier and user
 * input is never concatenated into a query string.
 *
 * Grammar supported:
 *
 *   SELECT <item> [, <item>]*
 *   FROM data
 *   [WHERE <expr>]
 *   [GROUP BY <column> [, <column>]*]
 *   [ORDER BY (<column> | <position>) [ASC|DESC] [, ...]*]
 *   [LIMIT <n>]
 *   [;]
 *
 *   <item>  := * | <expr> [[AS] <alias>]
 *   <expr>  := <expr> OR <expr> | <expr> AND <expr> | NOT <expr>
 *            | <expr> (= | <> | != | < | <= | > | >=) <expr>
 *            | <expr> [NOT] BETWEEN <expr> AND <expr>
 *            | <expr> [NOT] IN ( <expr> [, <expr>]* )
 *            | <expr> [NOT] LIKE <expr>
 *            | <expr> IS [NOT] NULL
 *            | <expr> (+ | - | * | /) <expr> | - <expr> | ( <expr> )
 *            | <column> | <number> | <string> | <function>(<expr>, ...)
 *
 * Aggregate functions: COUNT(*), COUNT(expr), SUM, AVG, MIN, MAX.
 * Scalar functions: LOWER, UPPER, TRIM, LENGTH, ABS, ROUND, COALESCE.
 *
 * Cell values are plain strings; an empty string is the table's "blank" cell
 * (there is no separate NULL) and is what `IS NULL`, `COALESCE`, and the
 * aggregates treat as absent. A cell is read as a number only when the whole
 * (trimmed) string parses as one; otherwise every numeric operation involving
 * it evaluates to blank rather than throwing, mirroring the spreadsheet
 * formula engine's "wrong type produces an empty/error result, never a
 * crash" rule (see docs/security.md).
 *
 * Every bound below is enforced before or during evaluation, never after —
 * an oversized query is rejected before a single row is scanned.
 */

// ----- Bounds (documented; mirrors the formula engine's bounds table in docs/security.md) -----

/** Maximum query text length, in UTF-16 code units. */
export const SQL_MAX_QUERY_LENGTH = 4096;
/** Maximum number of tokens the tokenizer will produce before rejecting the query. */
export const SQL_MAX_TOKENS = 2000;
/** Maximum expression nesting depth (parentheses, function args, operators). */
export const SQL_MAX_EXPR_DEPTH = 64;
/** Maximum SELECT list items. */
export const SQL_MAX_SELECT_ITEMS = 64;
/** Maximum GROUP BY key columns. */
export const SQL_MAX_GROUP_KEYS = 8;
/** Maximum ORDER BY key columns. */
export const SQL_MAX_ORDER_KEYS = 8;
/** Maximum items in an `IN (...)` list. */
export const SQL_MAX_IN_ITEMS = 1000;
/** Maximum source rows considered from the picked table (see docs/performance.md). */
export const SQL_MAX_SOURCE_ROWS = 200_000;
/** Maximum result rows ever returned, regardless of `LIMIT`. */
export const SQL_MAX_RESULT_ROWS = 1000;

// ----- Public data model -----

/** A source table: the first row is always the header row. */
export interface SqlTable {
  headers: string[];
  rows: string[][];
}

/** A query result cell: a plain string, or a number when the engine computed one. */
export type SqlValue = string | number;

export interface SqlQueryResult {
  /** Output column display names, left to right. */
  columns: string[];
  rows: SqlValue[][];
  /** Rows in the source table that were available (before any WHERE filter). */
  sourceRows: number;
  /** True when the source table itself was cut off at {@link SQL_MAX_SOURCE_ROWS}. */
  sourceTruncated: boolean;
  /** Rows that matched, before LIMIT/{@link SQL_MAX_RESULT_ROWS} was applied. */
  matchedRows: number;
  /** True when `rows` is shorter than `matchedRows` because a cap applied. */
  truncated: boolean;
}

/** A stable, localizable reason a query was rejected — see `sql.error.*` in the locale files. */
export type SqlErrorCode =
  | 'empty'
  | 'tooLong'
  | 'tooManyTokens'
  | 'tooDeep'
  | 'unexpectedChar'
  | 'unexpectedToken'
  | 'unsupportedStatement'
  | 'multipleStatements'
  | 'expectedTable'
  | 'tooManySelectItems'
  | 'tooManyGroupKeys'
  | 'tooManyOrderKeys'
  | 'tooManyInItems'
  | 'unknownColumn'
  | 'unknownFunction'
  | 'nestedAggregate'
  | 'aggregateInWhere'
  | 'notAggregated'
  | 'invalidLimit'
  | 'invalidOrderTarget';

export interface SqlErrorLocation {
  /** 0-based UTF-16 offset into the query text. */
  offset: number;
}

/** A rejected or failed query. `code`/`params` drive localized `sql.error.*` messages; `message` is English, for logs/tests. */
export class SqlQueryError extends Error {
  readonly code: SqlErrorCode;
  readonly params: Record<string, string | number>;
  readonly location: SqlErrorLocation | null;

  constructor(code: SqlErrorCode, message: string, params: Record<string, string | number> = {}, location: SqlErrorLocation | null = null) {
    super(message);
    this.name = 'SqlQueryError';
    this.code = code;
    this.params = params;
    this.location = location;
  }
}

// ----- Tokenizer -----

type TokenType = 'ident' | 'qident' | 'number' | 'string' | 'punct' | 'eof';

interface Token {
  type: TokenType;
  /** Literal text (identifiers/strings already unescaped; punctuation verbatim). */
  text: string;
  /** Uppercased text, for case-insensitive keyword/identifier comparisons. */
  upper: string;
  offset: number;
}

const PUNCT_2 = ['<>', '!=', '<=', '>='];
const PUNCT_1 = ['(', ')', ',', '.', '*', '+', '-', '/', '=', '<', '>', ';'];

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = src.length;
  const push = (type: TokenType, text: string, offset: number) => {
    tokens.push({ type, text, upper: text.toUpperCase(), offset });
    if (tokens.length > SQL_MAX_TOKENS) {
      throw new SqlQueryError('tooManyTokens', `query has more than ${SQL_MAX_TOKENS} tokens`, {
        max: SQL_MAX_TOKENS,
      });
    }
  };
  while (i < n) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
      continue;
    }
    const start = i;
    // Line comment: -- to end of line (a common, harmless SQL convenience).
    if (c === '-' && src[i + 1] === '-') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      i++;
      while (i < n && /[A-Za-z0-9_]/.test(src[i])) i++;
      push('ident', src.slice(start, i), start);
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      i++;
      while (i < n && /[0-9]/.test(src[i])) i++;
      if (src[i] === '.') {
        i++;
        while (i < n && /[0-9]/.test(src[i])) i++;
      }
      push('number', src.slice(start, i), start);
      continue;
    }
    if (c === "'") {
      i++;
      let out = '';
      let closed = false;
      while (i < n) {
        if (src[i] === "'" && src[i + 1] === "'") {
          out += "'";
          i += 2;
          continue;
        }
        if (src[i] === "'") {
          i++;
          closed = true;
          break;
        }
        out += src[i];
        i++;
      }
      if (!closed) {
        throw new SqlQueryError('unexpectedChar', 'unterminated string literal', {}, { offset: start });
      }
      push('string', out, start);
      continue;
    }
    if (c === '"') {
      i++;
      let out = '';
      let closed = false;
      while (i < n) {
        if (src[i] === '"' && src[i + 1] === '"') {
          out += '"';
          i += 2;
          continue;
        }
        if (src[i] === '"') {
          i++;
          closed = true;
          break;
        }
        out += src[i];
        i++;
      }
      if (!closed) {
        throw new SqlQueryError('unexpectedChar', 'unterminated quoted identifier', {}, { offset: start });
      }
      push('qident', out, start);
      continue;
    }
    const two = src.slice(i, i + 2);
    if (PUNCT_2.includes(two)) {
      push('punct', two, start);
      i += 2;
      continue;
    }
    if (PUNCT_1.includes(c)) {
      push('punct', c, start);
      i += 1;
      continue;
    }
    throw new SqlQueryError('unexpectedChar', `unexpected character "${c}"`, { char: c }, { offset: start });
  }
  push('eof', '', n);
  return tokens;
}

// ----- AST -----

type Expr =
  | { kind: 'star' }
  | { kind: 'column'; name: string; offset: number }
  | { kind: 'literal'; value: SqlValue }
  | { kind: 'call'; name: string; args: Expr[]; star: boolean; offset: number }
  | { kind: 'unary'; op: '-' | 'NOT'; expr: Expr }
  | { kind: 'binary'; op: string; left: Expr; right: Expr }
  | { kind: 'between'; expr: Expr; low: Expr; high: Expr; negate: boolean }
  | { kind: 'in'; expr: Expr; list: Expr[]; negate: boolean }
  | { kind: 'isNull'; expr: Expr; negate: boolean }
  | { kind: 'like'; expr: Expr; pattern: Expr; negate: boolean };

interface SelectItem {
  expr: Expr;
  alias: string | null;
}

interface OrderItem {
  /** A column/alias name, or a 1-based select-list position. */
  target: { kind: 'name'; name: string } | { kind: 'position'; index: number };
  dir: 'ASC' | 'DESC';
}

interface ColumnRef {
  name: string;
  offset: number;
}

interface SelectStatement {
  items: SelectItem[];
  where: Expr | null;
  groupBy: ColumnRef[];
  orderBy: OrderItem[];
  limit: number | null;
}

const AGGREGATE_FUNCTIONS = new Set(['COUNT', 'SUM', 'AVG', 'MIN', 'MAX']);
const SCALAR_FUNCTIONS = new Set(['LOWER', 'UPPER', 'TRIM', 'LENGTH', 'ABS', 'ROUND', 'COALESCE']);

// ----- Parser -----

class Parser {
  private pos = 0;
  private depth = 0;

  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.pos];
  }

  private next(): Token {
    const t = this.tokens[this.pos];
    if (t.type !== 'eof') this.pos++;
    return t;
  }

  private isKeyword(t: Token, word: string): boolean {
    return t.type === 'ident' && t.upper === word;
  }

  private eatKeyword(word: string): boolean {
    if (this.isKeyword(this.peek(), word)) {
      this.next();
      return true;
    }
    return false;
  }

  private expectKeyword(word: string): void {
    if (!this.eatKeyword(word)) {
      const t = this.peek();
      throw new SqlQueryError(
        'unexpectedToken',
        `expected ${word}, got "${t.text || '<end of query>'}"`,
        { expected: word, got: t.text || '<end>' },
        { offset: t.offset },
      );
    }
  }

  private expectPunct(p: string): void {
    const t = this.peek();
    if (t.type !== 'punct' || t.text !== p) {
      throw new SqlQueryError(
        'unexpectedToken',
        `expected "${p}", got "${t.text || '<end of query>'}"`,
        { expected: p, got: t.text || '<end>' },
        { offset: t.offset },
      );
    }
    this.next();
  }

  private enter(): void {
    this.depth++;
    if (this.depth > SQL_MAX_EXPR_DEPTH) {
      throw new SqlQueryError('tooDeep', `expression nesting exceeds ${SQL_MAX_EXPR_DEPTH}`, {
        max: SQL_MAX_EXPR_DEPTH,
      });
    }
  }

  private leave(): void {
    this.depth--;
  }

  parseStatement(): SelectStatement {
    const first = this.peek();
    if (!this.isKeyword(first, 'SELECT')) {
      throw new SqlQueryError(
        'unsupportedStatement',
        'only read-only SELECT queries are supported',
        {},
        { offset: first.offset },
      );
    }
    this.next();
    const items = this.parseSelectList();
    this.expectKeyword('FROM');
    const tableTok = this.peek();
    if (tableTok.type !== 'ident' || tableTok.upper !== 'DATA') {
      throw new SqlQueryError(
        'expectedTable',
        'FROM must name the picked data source as "data"',
        {},
        { offset: tableTok.offset },
      );
    }
    this.next();
    let where: Expr | null = null;
    if (this.eatKeyword('WHERE')) {
      where = this.parseExpr();
    }
    const groupBy: ColumnRef[] = [];
    if (this.eatKeyword('GROUP')) {
      this.expectKeyword('BY');
      groupBy.push(this.parseColumnRef());
      while (this.eatPunct(',')) {
        if (groupBy.length >= SQL_MAX_GROUP_KEYS) {
          throw new SqlQueryError('tooManyGroupKeys', `at most ${SQL_MAX_GROUP_KEYS} GROUP BY columns`, {
            max: SQL_MAX_GROUP_KEYS,
          });
        }
        groupBy.push(this.parseColumnRef());
      }
    }
    const orderBy: OrderItem[] = [];
    if (this.eatKeyword('ORDER')) {
      this.expectKeyword('BY');
      orderBy.push(this.parseOrderItem());
      while (this.eatPunct(',')) {
        if (orderBy.length >= SQL_MAX_ORDER_KEYS) {
          throw new SqlQueryError('tooManyOrderKeys', `at most ${SQL_MAX_ORDER_KEYS} ORDER BY columns`, {
            max: SQL_MAX_ORDER_KEYS,
          });
        }
        orderBy.push(this.parseOrderItem());
      }
    }
    let limit: number | null = null;
    if (this.eatKeyword('LIMIT')) {
      const t = this.next();
      const n = t.type === 'number' ? Number(t.text) : NaN;
      if (!Number.isInteger(n) || n < 0) {
        throw new SqlQueryError('invalidLimit', 'LIMIT must be a non-negative integer', {}, { offset: t.offset });
      }
      limit = n;
    }
    this.eatPunct(';');
    const end = this.peek();
    if (end.type !== 'eof') {
      throw new SqlQueryError(
        'multipleStatements',
        'only one SELECT statement is allowed',
        {},
        { offset: end.offset },
      );
    }
    return { items, where, groupBy, orderBy, limit };
  }

  private eatPunct(p: string): boolean {
    const t = this.peek();
    if (t.type === 'punct' && t.text === p) {
      this.next();
      return true;
    }
    return false;
  }

  private parseSelectList(): SelectItem[] {
    const items: SelectItem[] = [];
    for (;;) {
      const t = this.peek();
      const next = this.tokens[this.pos + 1];
      if (t.type === 'punct' && t.text === '*' && next && (next.text === ',' || this.isKeyword(next, 'FROM'))) {
        this.next();
        items.push({ expr: { kind: 'star' }, alias: null });
      } else {
        const expr = this.parseExpr();
        let alias: string | null = null;
        this.eatKeyword('AS');
        const at = this.peek();
        if (at.type === 'ident' && !this.isReservedHere(at.upper)) {
          alias = at.text;
          this.next();
        } else if (at.type === 'qident') {
          alias = at.text;
          this.next();
        }
        items.push({ expr, alias });
      }
      if (items.length > SQL_MAX_SELECT_ITEMS) {
        throw new SqlQueryError('tooManySelectItems', `at most ${SQL_MAX_SELECT_ITEMS} select items`, {
          max: SQL_MAX_SELECT_ITEMS,
        });
      }
      if (!this.eatPunct(',')) break;
    }
    return items;
  }

  private isReservedHere(upper: string): boolean {
    return ['FROM', 'WHERE', 'GROUP', 'ORDER', 'LIMIT', 'AS'].includes(upper);
  }

  private parseColumnRef(): ColumnRef {
    const t = this.peek();
    if (t.type === 'ident' || t.type === 'qident') {
      this.next();
      return { name: t.text, offset: t.offset };
    }
    throw new SqlQueryError(
      'unexpectedToken',
      `expected a column name, got "${t.text || '<end of query>'}"`,
      { got: t.text || '<end>' },
      { offset: t.offset },
    );
  }

  private parseOrderItem(): OrderItem {
    const t = this.peek();
    let target: OrderItem['target'];
    if (t.type === 'number') {
      this.next();
      const idx = Number(t.text);
      if (!Number.isInteger(idx) || idx < 1) {
        throw new SqlQueryError(
          'invalidOrderTarget',
          'ORDER BY position must be a positive integer',
          {},
          { offset: t.offset },
        );
      }
      target = { kind: 'position', index: idx };
    } else {
      target = { kind: 'name', name: this.parseColumnRef().name };
    }
    let dir: 'ASC' | 'DESC' = 'ASC';
    if (this.eatKeyword('ASC')) dir = 'ASC';
    else if (this.eatKeyword('DESC')) dir = 'DESC';
    return { target, dir };
  }

  parseExpr(): Expr {
    return this.parseOr();
  }

  private parseOr(): Expr {
    this.enter();
    let left = this.parseAnd();
    while (this.eatKeyword('OR')) {
      left = { kind: 'binary', op: 'OR', left, right: this.parseAnd() };
    }
    this.leave();
    return left;
  }

  private parseAnd(): Expr {
    this.enter();
    let left = this.parseNot();
    while (this.eatKeyword('AND')) {
      left = { kind: 'binary', op: 'AND', left, right: this.parseNot() };
    }
    this.leave();
    return left;
  }

  private parseNot(): Expr {
    this.enter();
    if (this.eatKeyword('NOT')) {
      const expr = this.parseNot();
      this.leave();
      return { kind: 'unary', op: 'NOT', expr };
    }
    const expr = this.parsePredicate();
    this.leave();
    return expr;
  }

  private parsePredicate(): Expr {
    this.enter();
    let expr = this.parseAdditive();
    const t = this.peek();
    if (t.type === 'punct' && ['=', '<>', '!=', '<', '<=', '>', '>='].includes(t.text)) {
      this.next();
      const right = this.parseAdditive();
      expr = { kind: 'binary', op: t.text === '!=' ? '<>' : t.text, left: expr, right };
    } else if (this.isKeyword(t, 'NOT') && this.peekIsBetweenLikeIn(1)) {
      this.next();
      expr = this.parseBetweenLikeIn(expr, true);
    } else if (this.peekIsBetweenLikeIn(0)) {
      expr = this.parseBetweenLikeIn(expr, false);
    } else if (this.isKeyword(t, 'IS')) {
      this.next();
      const negate = this.eatKeyword('NOT');
      this.expectKeyword('NULL');
      expr = { kind: 'isNull', expr, negate };
    }
    this.leave();
    return expr;
  }

  private peekIsBetweenLikeIn(offset: number): boolean {
    const t = this.tokens[this.pos + offset];
    return t !== undefined && (this.isKeyword(t, 'BETWEEN') || this.isKeyword(t, 'LIKE') || this.isKeyword(t, 'IN'));
  }

  private parseBetweenLikeIn(expr: Expr, negate: boolean): Expr {
    const t = this.peek();
    if (this.isKeyword(t, 'BETWEEN')) {
      this.next();
      const low = this.parseAdditive();
      this.expectKeyword('AND');
      const high = this.parseAdditive();
      return { kind: 'between', expr, low, high, negate };
    }
    if (this.isKeyword(t, 'LIKE')) {
      this.next();
      const pattern = this.parseAdditive();
      return { kind: 'like', expr, pattern, negate };
    }
    this.expectKeyword('IN');
    this.expectPunct('(');
    const list: Expr[] = [];
    if (!this.eatPunct(')')) {
      list.push(this.parseExpr());
      while (this.eatPunct(',')) {
        if (list.length >= SQL_MAX_IN_ITEMS) {
          throw new SqlQueryError('tooManyInItems', `at most ${SQL_MAX_IN_ITEMS} items in an IN (...) list`, {
            max: SQL_MAX_IN_ITEMS,
          });
        }
        list.push(this.parseExpr());
      }
      this.expectPunct(')');
    }
    return { kind: 'in', expr, list, negate };
  }

  private parseAdditive(): Expr {
    this.enter();
    let left = this.parseMultiplicative();
    for (;;) {
      const t = this.peek();
      if (t.type === 'punct' && (t.text === '+' || t.text === '-')) {
        this.next();
        left = { kind: 'binary', op: t.text, left, right: this.parseMultiplicative() };
      } else {
        break;
      }
    }
    this.leave();
    return left;
  }

  private parseMultiplicative(): Expr {
    this.enter();
    let left = this.parseUnary();
    for (;;) {
      const t = this.peek();
      if (t.type === 'punct' && (t.text === '*' || t.text === '/')) {
        this.next();
        left = { kind: 'binary', op: t.text, left, right: this.parseUnary() };
      } else {
        break;
      }
    }
    this.leave();
    return left;
  }

  private parseUnary(): Expr {
    this.enter();
    if (this.eatPunct('-')) {
      const expr = this.parseUnary();
      this.leave();
      return { kind: 'unary', op: '-', expr };
    }
    const expr = this.parsePrimary();
    this.leave();
    return expr;
  }

  private parsePrimary(): Expr {
    this.enter();
    const t = this.peek();
    if (t.type === 'number') {
      this.next();
      this.leave();
      return { kind: 'literal', value: Number(t.text) };
    }
    if (t.type === 'string') {
      this.next();
      this.leave();
      return { kind: 'literal', value: t.text };
    }
    if (t.type === 'qident') {
      this.next();
      this.leave();
      return { kind: 'column', name: t.text, offset: t.offset };
    }
    if (t.type === 'punct' && t.text === '(') {
      this.next();
      const expr = this.parseExpr();
      this.expectPunct(')');
      this.leave();
      return expr;
    }
    if (t.type === 'ident') {
      if (t.upper === 'NULL') {
        this.next();
        this.leave();
        return { kind: 'literal', value: '' };
      }
      if (t.upper === 'TRUE') {
        this.next();
        this.leave();
        return { kind: 'literal', value: 1 };
      }
      if (t.upper === 'FALSE') {
        this.next();
        this.leave();
        return { kind: 'literal', value: 0 };
      }
      const next = this.tokens[this.pos + 1];
      if (next && next.type === 'punct' && next.text === '(') {
        this.next();
        this.next();
        const name = t.upper;
        if (!AGGREGATE_FUNCTIONS.has(name) && !SCALAR_FUNCTIONS.has(name)) {
          this.leave();
          throw new SqlQueryError('unknownFunction', `unknown function "${t.text}"`, { name: t.text }, { offset: t.offset });
        }
        let star = false;
        const args: Expr[] = [];
        if (this.peek().type === 'punct' && this.peek().text === '*') {
          this.next();
          star = true;
        } else if (!(this.peek().type === 'punct' && this.peek().text === ')')) {
          args.push(this.parseExpr());
          while (this.eatPunct(',')) {
            args.push(this.parseExpr());
          }
        }
        this.expectPunct(')');
        this.leave();
        return { kind: 'call', name, args, star, offset: t.offset };
      }
      this.next();
      this.leave();
      return { kind: 'column', name: t.text, offset: t.offset };
    }
    this.leave();
    throw new SqlQueryError(
      'unexpectedToken',
      `unexpected "${t.text || '<end of query>'}"`,
      { got: t.text || '<end>' },
      { offset: t.offset },
    );
  }
}

function parse(query: string): SelectStatement {
  if (query.trim().length === 0) {
    throw new SqlQueryError('empty', 'the query is empty');
  }
  if (query.length > SQL_MAX_QUERY_LENGTH) {
    throw new SqlQueryError('tooLong', `query exceeds ${SQL_MAX_QUERY_LENGTH} characters`, {
      max: SQL_MAX_QUERY_LENGTH,
    });
  }
  const tokens = tokenize(query);
  const parser = new Parser(tokens);
  return parser.parseStatement();
}

// ----- Schema binding -----

interface Schema {
  names: string[];
}

function buildSchema(headers: string[]): Schema {
  const names: string[] = [];
  const seen = new Set<string>();
  headers.forEach((raw, i) => {
    const trimmed = raw.trim();
    const key = trimmed.toUpperCase();
    if (trimmed !== '' && !seen.has(key)) {
      names.push(trimmed);
      seen.add(key);
    } else {
      let fallback = `col${i + 1}`;
      let fk = fallback.toUpperCase();
      let n = i + 1;
      while (seen.has(fk)) {
        n++;
        fallback = `col${n}`;
        fk = fallback.toUpperCase();
      }
      names.push(fallback);
      seen.add(fk);
    }
  });
  return { names };
}

function resolveColumn(schema: Schema, name: string, offset: number): number {
  const key = name.trim().toUpperCase();
  const idx = schema.names.findIndex((n) => n.toUpperCase() === key);
  if (idx < 0) {
    throw new SqlQueryError('unknownColumn', `unknown column "${name}"`, { name }, { offset });
  }
  return idx;
}

// ----- Validation (aggregate usage) -----

function containsAggregate(expr: Expr): boolean {
  switch (expr.kind) {
    case 'call':
      return AGGREGATE_FUNCTIONS.has(expr.name) || expr.args.some(containsAggregate);
    case 'unary':
      return containsAggregate(expr.expr);
    case 'binary':
      return containsAggregate(expr.left) || containsAggregate(expr.right);
    case 'between':
      return containsAggregate(expr.expr) || containsAggregate(expr.low) || containsAggregate(expr.high);
    case 'in':
      return containsAggregate(expr.expr) || expr.list.some(containsAggregate);
    case 'isNull':
      return containsAggregate(expr.expr);
    case 'like':
      return containsAggregate(expr.expr) || containsAggregate(expr.pattern);
    default:
      return false;
  }
}

function assertNoNestedAggregate(expr: Expr): void {
  if (expr.kind === 'call' && AGGREGATE_FUNCTIONS.has(expr.name)) {
    for (const arg of expr.args) {
      if (containsAggregate(arg)) {
        throw new SqlQueryError('nestedAggregate', 'aggregate functions cannot be nested', { name: expr.name }, { offset: expr.offset });
      }
    }
  }
  for (const child of childExprs(expr)) {
    assertNoNestedAggregate(child);
  }
}

function childExprs(expr: Expr): Expr[] {
  switch (expr.kind) {
    case 'call':
      return expr.args;
    case 'unary':
      return [expr.expr];
    case 'binary':
      return [expr.left, expr.right];
    case 'between':
      return [expr.expr, expr.low, expr.high];
    case 'in':
      return [expr.expr, ...expr.list];
    case 'isNull':
      return [expr.expr];
    case 'like':
      return [expr.expr, expr.pattern];
    default:
      return [];
  }
}

/** Columns referenced outside of any aggregate call (must all be GROUP BY columns when aggregating). */
function columnsOutsideAggregates(expr: Expr): Array<{ name: string; offset: number }> {
  if (expr.kind === 'column') {
    return [{ name: expr.name, offset: expr.offset }];
  }
  if (expr.kind === 'call' && AGGREGATE_FUNCTIONS.has(expr.name)) {
    return [];
  }
  return childExprs(expr).flatMap(columnsOutsideAggregates);
}

// ----- Evaluation -----

function toNumber(v: SqlValue): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = v.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function isBlank(v: SqlValue): boolean {
  return v === '';
}

function toStr(v: SqlValue): string {
  return typeof v === 'number' ? String(v) : v;
}

/** Deterministic, locale-independent string ordering (matches the formula engine's stated policy). */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Numeric compare when both sides parse as numbers; otherwise a deterministic string compare. Blanks never compare equal/ordered against anything but another blank. */
function compareValues(a: SqlValue, b: SqlValue): number {
  const an = toNumber(a);
  const bn = toNumber(b);
  if (an !== null && bn !== null) return an === bn ? 0 : an < bn ? -1 : 1;
  return compareStrings(toStr(a), toStr(b));
}

function matchLike(pattern: string, subject: string): boolean {
  // Classic two-pointer wildcard scan (SQL % / _ , with \ as the escape
  // character) — bounded, no backtracking regex; see docs/security.md
  // "No regular expressions built from user input."
  let si = 0;
  let pi = 0;
  let star = -1;
  let starSi = -1;
  const pchars: string[] = [];
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === '\\' && i + 1 < pattern.length) {
      pchars.push(pattern[i + 1]);
      i++;
    } else {
      pchars.push(pattern[i] === '%' ? ' %' : pattern[i] === '_' ? ' _' : pattern[i]);
    }
  }
  while (si < subject.length) {
    if (pi < pchars.length && (pchars[pi] === ' _' || pchars[pi] === subject[si])) {
      si++;
      pi++;
    } else if (pi < pchars.length && pchars[pi] === ' %') {
      star = pi;
      starSi = si;
      pi++;
    } else if (star >= 0) {
      pi = star + 1;
      starSi++;
      si = starSi;
    } else {
      return false;
    }
  }
  while (pi < pchars.length && pchars[pi] === ' %') pi++;
  return pi === pchars.length;
}

interface EvalCtx {
  schema: Schema;
  /** The current row, or a group's rows when evaluating an aggregate call. */
  row: string[] | null;
  group: string[][] | null;
  groupByIndex: Set<number>;
}

function evalScalar(expr: Expr, ctx: EvalCtx): SqlValue {
  switch (expr.kind) {
    case 'star':
      throw new SqlQueryError('unexpectedToken', '"*" is only valid as a whole select item or inside COUNT(*)');
    case 'literal':
      return expr.value;
    case 'column': {
      const idx = resolveColumn(ctx.schema, expr.name, expr.offset);
      if (ctx.row) return ctx.row[idx] ?? '';
      // Aggregate context: a bare column must be a GROUP BY key (validated earlier).
      const first = ctx.group?.[0];
      return first ? (first[idx] ?? '') : '';
    }
    case 'unary': {
      if (expr.op === '-') {
        const n = toNumber(evalScalar(expr.expr, ctx));
        return n === null ? '' : -n;
      }
      return evalBoolean(expr, ctx) ? 1 : 0;
    }
    case 'binary': {
      if (expr.op === 'AND' || expr.op === 'OR') {
        return evalBoolean(expr, ctx) ? 1 : 0;
      }
      if (COMPARISON_OPS.has(expr.op)) {
        return evalBoolean(expr, ctx) ? 1 : 0;
      }
      const l = toNumber(evalScalar(expr.left, ctx));
      const r = toNumber(evalScalar(expr.right, ctx));
      if (l === null || r === null) return '';
      switch (expr.op) {
        case '+':
          return l + r;
        case '-':
          return l - r;
        case '*':
          return l * r;
        case '/':
          return r === 0 ? '' : l / r;
        default:
          return '';
      }
    }
    case 'between':
    case 'in':
    case 'isNull':
    case 'like':
      return evalBoolean(expr, ctx) ? 1 : 0;
    case 'call':
      return evalCall(expr, ctx);
  }
}

/** Truthy coercion for a value used in a boolean context without an explicit comparison (e.g. `WHERE amount`). */
function truthy(v: SqlValue): boolean {
  return typeof v === 'number' ? v !== 0 : v !== '';
}

const COMPARISON_OPS = new Set(['=', '<>', '<', '<=', '>', '>=']);

function evalBoolean(expr: Expr, ctx: EvalCtx): boolean {
  switch (expr.kind) {
    case 'unary':
      if (expr.op === 'NOT') return !evalBoolean(expr.expr, ctx);
      // Unary minus in a boolean context (e.g. `WHERE -amount`): truthy-coerce the number.
      return truthy(evalScalar(expr, ctx));
    case 'binary': {
      if (expr.op === 'AND') return evalBoolean(expr.left, ctx) && evalBoolean(expr.right, ctx);
      if (expr.op === 'OR') return evalBoolean(expr.left, ctx) || evalBoolean(expr.right, ctx);
      if (!COMPARISON_OPS.has(expr.op)) {
        // Arithmetic operator used directly in a boolean context (e.g. `WHERE a - b`).
        return truthy(evalScalar(expr, ctx));
      }
      const l = evalScalar(expr.left, ctx);
      const r = evalScalar(expr.right, ctx);
      if (isBlank(l) || isBlank(r)) return false;
      const cmp = compareValues(l, r);
      switch (expr.op) {
        case '=':
          return cmp === 0;
        case '<>':
          return cmp !== 0;
        case '<':
          return cmp < 0;
        case '<=':
          return cmp <= 0;
        case '>':
          return cmp > 0;
        case '>=':
          return cmp >= 0;
        default:
          return false;
      }
    }
    case 'between': {
      const v = evalScalar(expr.expr, ctx);
      const lo = evalScalar(expr.low, ctx);
      const hi = evalScalar(expr.high, ctx);
      const result = !isBlank(v) && !isBlank(lo) && !isBlank(hi) && compareValues(v, lo) >= 0 && compareValues(v, hi) <= 0;
      return expr.negate ? !result : result;
    }
    case 'in': {
      const v = evalScalar(expr.expr, ctx);
      const found = expr.list.some((item) => !isBlank(v) && compareValues(v, evalScalar(item, ctx)) === 0);
      return expr.negate ? !found : found;
    }
    case 'isNull': {
      const isNull = isBlank(evalScalar(expr.expr, ctx));
      return expr.negate ? !isNull : isNull;
    }
    case 'like': {
      const v = toStr(evalScalar(expr.expr, ctx));
      const p = toStr(evalScalar(expr.pattern, ctx));
      const result = matchLike(p, v);
      return expr.negate ? !result : result;
    }
    default:
      return truthy(evalScalar(expr, ctx));
  }
}

function evalCall(expr: Extract<Expr, { kind: 'call' }>, ctx: EvalCtx): SqlValue {
  const name = expr.name;
  if (AGGREGATE_FUNCTIONS.has(name)) {
    const rows = ctx.group ?? (ctx.row ? [ctx.row] : []);
    if (name === 'COUNT') {
      if (expr.star) return rows.length;
      const arg = expr.args[0];
      return rows.filter((r) => !isBlank(evalScalar(arg, { ...ctx, row: r, group: null }))).length;
    }
    const arg = expr.args[0];
    const values = rows
      .map((r) => evalScalar(arg, { ...ctx, row: r, group: null }))
      .filter((v) => !isBlank(v));
    if (name === 'SUM' || name === 'AVG') {
      const nums = values.map(toNumber).filter((n): n is number => n !== null);
      if (nums.length === 0) return '';
      const sum = nums.reduce((a, b) => a + b, 0);
      return name === 'SUM' ? sum : sum / nums.length;
    }
    // MIN / MAX: numeric when every value is numeric, else a deterministic string comparison.
    if (values.length === 0) return '';
    const allNumeric = values.every((v) => toNumber(v) !== null);
    let best = values[0];
    for (const v of values.slice(1)) {
      const cmp = allNumeric ? (toNumber(v)! < toNumber(best)! ? -1 : 1) : compareStrings(toStr(v), toStr(best));
      if ((name === 'MIN' && cmp < 0) || (name === 'MAX' && cmp > 0)) best = v;
    }
    return best;
  }
  // Scalar functions.
  const args = expr.args.map((a) => evalScalar(a, ctx));
  switch (name) {
    case 'LOWER':
      return toStr(args[0] ?? '').toLowerCase();
    case 'UPPER':
      return toStr(args[0] ?? '').toUpperCase();
    case 'TRIM':
      return toStr(args[0] ?? '').trim();
    case 'LENGTH':
      return Array.from(toStr(args[0] ?? '')).length;
    case 'ABS': {
      const n = toNumber(args[0] ?? '');
      return n === null ? '' : Math.abs(n);
    }
    case 'ROUND': {
      const n = toNumber(args[0] ?? '');
      if (n === null) return '';
      const digits = args[1] !== undefined ? (toNumber(args[1]) ?? 0) : 0;
      const factor = 10 ** Math.max(0, Math.min(15, Math.trunc(digits)));
      return Math.round(n * factor) / factor;
    }
    case 'COALESCE':
      return args.find((v) => !isBlank(v)) ?? '';
    default:
      return '';
  }
}

// ----- Output column naming -----

function describeExpr(expr: Expr): string {
  switch (expr.kind) {
    case 'star':
      return '*';
    case 'literal':
      return typeof expr.value === 'number' ? String(expr.value) : `'${expr.value}'`;
    case 'column':
      return expr.name;
    case 'call':
      return `${expr.name}(${expr.star ? '*' : expr.args.map(describeExpr).join(', ')})`;
    case 'unary':
      return `${expr.op}${describeExpr(expr.expr)}`;
    case 'binary':
      return `${describeExpr(expr.left)} ${expr.op} ${describeExpr(expr.right)}`;
    default:
      return 'expr';
  }
}

// ----- Public entry point -----

export function runSqlQuery(query: string, table: SqlTable): SqlQueryResult {
  const stmt = parse(query);
  const schema = buildSchema(table.headers);

  for (const item of stmt.items) {
    assertNoNestedAggregate(item.expr);
  }
  if (stmt.where && containsAggregate(stmt.where)) {
    throw new SqlQueryError('aggregateInWhere', 'aggregate functions are not allowed in WHERE');
  }
  const groupByIndexes = stmt.groupBy.map((ref) => resolveColumn(schema, ref.name, ref.offset));
  const groupByIndexSet = new Set(groupByIndexes);
  const groupByNames = new Set(stmt.groupBy.map((ref) => ref.name.trim().toUpperCase()));

  const isAggregate = stmt.groupBy.length > 0 || stmt.items.some((it) => containsAggregate(it.expr));
  if (isAggregate) {
    for (const item of stmt.items) {
      if (item.expr.kind === 'star') {
        throw new SqlQueryError('notAggregated', 'SELECT * cannot be combined with GROUP BY or aggregate functions');
      }
      for (const col of columnsOutsideAggregates(item.expr)) {
        if (!groupByNames.has(col.name.trim().toUpperCase())) {
          throw new SqlQueryError(
            'notAggregated',
            `column "${col.name}" must appear in GROUP BY or inside an aggregate function`,
            { name: col.name },
            { offset: col.offset },
          );
        }
      }
    }
  }

  const totalSourceRows = table.rows.length;
  const sourceTruncated = totalSourceRows > SQL_MAX_SOURCE_ROWS;
  const rows = sourceTruncated ? table.rows.slice(0, SQL_MAX_SOURCE_ROWS) : table.rows;

  const baseCtx: EvalCtx = { schema, row: null, group: null, groupByIndex: groupByIndexSet };
  const filtered = stmt.where ? rows.filter((r) => evalBoolean(stmt.where!, { ...baseCtx, row: r })) : rows;

  const outputColumns: string[] = [];
  let outputRows: SqlValue[][];

  if (isAggregate) {
    const groups = new Map<string, string[][]>();
    const order: string[] = [];
    for (const r of filtered) {
      // JSON-encode the key parts (not a plain-joined string) so that, e.g.,
      // grouping by two columns with values ("a", "bc") and ("ab", "c") can
      // never collide into the same group.
      const key = JSON.stringify(groupByIndexes.map((i) => r[i] ?? ''));
      let g = groups.get(key);
      if (!g) {
        g = [];
        groups.set(key, g);
        order.push(key);
      }
      g.push(r);
    }
    if (groupByIndexes.length === 0 && groups.size === 0) {
      // Aggregating with no GROUP BY over zero rows still yields one row (COUNT(*) = 0, etc.)
      groups.set('', []);
      order.push('');
    }
    stmt.items.forEach((item) => outputColumns.push(item.alias ?? describeExpr(item.expr)));
    outputRows = order.map((key) => {
      const g = groups.get(key)!;
      const ctx: EvalCtx = { schema, row: null, group: g, groupByIndex: groupByIndexSet };
      return stmt.items.map((item) => evalScalar(item.expr, ctx));
    });
  } else {
    for (const item of stmt.items) {
      if (item.expr.kind === 'star') {
        outputColumns.push(...schema.names);
      } else {
        outputColumns.push(item.alias ?? describeExpr(item.expr));
      }
    }
    outputRows = filtered.map((r) => {
      const ctx: EvalCtx = { schema, row: r, group: null, groupByIndex: groupByIndexSet };
      const out: SqlValue[] = [];
      for (const item of stmt.items) {
        if (item.expr.kind === 'star') {
          out.push(...r.map((v) => v ?? ''));
        } else {
          out.push(evalScalar(item.expr, ctx));
        }
      }
      return out;
    });
  }

  if (stmt.orderBy.length > 0) {
    const resolvedTargets = stmt.orderBy.map((o) => {
      if (o.target.kind === 'position') {
        if (o.target.index < 1 || o.target.index > outputColumns.length) {
          throw new SqlQueryError('invalidOrderTarget', `ORDER BY position ${o.target.index} is out of range`, {
            index: o.target.index,
          });
        }
        return { index: o.target.index - 1, dir: o.dir };
      }
      const key = o.target.name.trim().toUpperCase();
      const idx = outputColumns.findIndex((c) => c.toUpperCase() === key);
      if (idx < 0) {
        throw new SqlQueryError('invalidOrderTarget', `unknown ORDER BY target "${o.target.name}"`, {
          name: o.target.name,
        });
      }
      return { index: idx, dir: o.dir };
    });
    outputRows = outputRows.slice().sort((a, b) => {
      for (const t of resolvedTargets) {
        const cmp = compareValues(a[t.index] ?? '', b[t.index] ?? '');
        if (cmp !== 0) return t.dir === 'ASC' ? cmp : -cmp;
      }
      return 0;
    });
  }

  const matchedRows = outputRows.length;
  const effectiveLimit = Math.min(stmt.limit ?? SQL_MAX_RESULT_ROWS, SQL_MAX_RESULT_ROWS);
  const limited = outputRows.slice(0, effectiveLimit);

  return {
    columns: outputColumns,
    rows: limited,
    sourceRows: rows.length,
    sourceTruncated,
    matchedRows,
    truncated: limited.length < matchedRows,
  };
}
