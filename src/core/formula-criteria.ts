// SPDX-License-Identifier: MIT
/**
 * Criteria parsing and matching for the conditional-aggregation functions
 * (`COUNTIF`, `COUNTIFS`, `SUMIF`, `SUMIFS`, `AVERAGEIF`, `AVERAGEIFS`).
 *
 * ## Criteria grammar
 *
 * A criterion is an ordinary formula value. When it is **not** text it means
 * "equal to this value". When it *is* text it is parsed as:
 *
 *   criterion := [ '=' | '<>' | '>=' | '<=' | '>' | '<' ] operand
 *
 * with no operator meaning `=`. Whitespace around the operand is significant
 * for text comparison and ignored when the operand parses as a number.
 *
 * | Written      | Means                                                   |
 * | ------------ | ------------------------------------------------------- |
 * | `"apple"`    | equal to `apple` (case-insensitive, wildcards active)   |
 * | `"=apple"`   | the same                                                |
 * | `"<>apple"`  | not equal to `apple`                                    |
 * | `">10"`      | numerically greater than 10                             |
 * | `">=10"`     | numerically greater than or equal to 10                 |
 * | `"<5"`       | numerically less than 5                                 |
 * | `"<=5"`      | numerically less than or equal to 5                     |
 * | `"*text*"`   | text containing `text`                                  |
 * | `"?"`        | text of exactly one code point                          |
 * | `""`, `"="`  | blank cells                                             |
 * | `"<>"`       | non-blank cells                                         |
 *
 * ## Type rules
 *
 * A criterion only ever matches cells of a compatible kind, which is what
 * keeps `">10"` from matching the text `"zebra"`:
 *
 * - An **ordering** comparison (`<`, `<=`, `>`, `>=`) with a numeric operand
 *   matches only numeric cells (booleans count as 1 / 0); with a text operand
 *   it matches only text cells, ordered case-insensitively by code unit.
 * - An **equality** comparison (`=`, `<>`) with a numeric operand matches
 *   numeric cells by value. With a text operand it matches text cells, and
 *   numeric cells only when the operand parses as the same number.
 * - Blank cells match only `""`, `"="`, and (negated) `"<>"`.
 * - Error cells never match any criterion; they are reported separately so the
 *   caller can propagate them (`SUMIF` over a range holding `#DIV/0!` is
 *   `#DIV/0!`, not a silent partial sum).
 *
 * ## Wildcards
 *
 * `*` matches any run of code points including none; `?` matches exactly one
 * code point. A literal `*`, `?`, or `~` is written `~*`, `~?`, `~~`. A
 * trailing lone `~` is a literal tilde.
 *
 * Matching is a hand-written two-pointer scan with single-star backtracking —
 * **never a regular expression**. Its worst case is O(pattern × subject) with
 * no backtracking blow-up, so a hostile pattern such as `"*a*a*a*a*a*b"` costs
 * time proportional to the product of the two lengths and nothing worse.
 * Criteria are additionally capped at {@link MAX_CRITERIA_LENGTH} code units.
 */

import {
  coerceToNumber,
  coerceToText,
  foldCase,
  MAX_CRITERIA_LENGTH,
  parseNumericText,
  type FormulaValue,
} from './formula-value';

/** The comparison a criterion performs. */
export type CriteriaOp = '=' | '<>' | '>' | '>=' | '<' | '<=';

/**
 * A parsed criterion, ready to test many cells. Parsing happens once per
 * criteria argument, never once per cell.
 */
export interface Criterion {
  op: CriteriaOp;
  /** Numeric operand, when the operand parses as a number. */
  readonly number: number | null;
  /** Text operand exactly as written after the operator. */
  readonly text: string;
  /** Case-folded operand, for text comparison. */
  readonly folded: string;
  /** Compiled wildcard pattern, or null when the operand holds no wildcard. */
  readonly wildcard: WildcardPattern | null;
  /** True for `""` / `"="` / `"<>"` — the blank-cell criteria. */
  readonly blankTest: boolean;
}

/** Parsing outcome; a criterion longer than the documented cap is refused. */
export type CriterionResult = { ok: true; criterion: Criterion } | { ok: false };

/**
 * Parse a criterion value. Non-text values become an equality test against
 * themselves; text is parsed per the grammar above.
 */
export function parseCriterion(value: FormulaValue): CriterionResult {
  if (value.type === 'error') {
    return { ok: false };
  }
  if (value.type !== 'string') {
    // A number, boolean, or blank criterion is a plain equality test. Blank
    // behaves as `""` so `COUNTIF(A:A, B1)` with an empty B1 counts blanks.
    const text = coerceToText(value) ?? '';
    return {
      ok: true,
      criterion: {
        op: '=',
        number: value.type === 'empty' ? null : coerceToNumber(value),
        text,
        folded: foldCase(text),
        wildcard: null,
        blankTest: value.type === 'empty',
      },
    };
  }
  const src = value.value;
  if (src.length > MAX_CRITERIA_LENGTH) {
    return { ok: false };
  }
  let op: CriteriaOp = '=';
  let rest = src;
  // Longest operators first so `<=` and `<>` are not read as a bare `<`.
  for (const candidate of ['<>', '<=', '>=', '=', '<', '>'] as const) {
    if (src.startsWith(candidate)) {
      op = candidate;
      rest = src.slice(candidate.length);
      break;
    }
  }
  const blankTest = rest === '' && (op === '=' || op === '<>' || src === '');
  const wildcard = op === '=' || op === '<>' ? compileWildcard(rest) : null;
  return {
    ok: true,
    criterion: {
      op,
      number: parseNumericText(rest),
      text: rest,
      folded: foldCase(rest),
      wildcard,
      blankTest,
    },
  };
}

/**
 * Test one cell value against a parsed criterion.
 *
 * Errors never match. Callers that must propagate an error in the scanned
 * range check for it themselves before (or while) calling this.
 */
export function matchesCriterion(value: FormulaValue, criterion: Criterion): boolean {
  if (value.type === 'error') {
    return false;
  }
  const isBlank = value.type === 'empty' || (value.type === 'string' && value.value === '');
  if (criterion.blankTest) {
    return criterion.op === '<>' ? !isBlank : isBlank;
  }
  switch (criterion.op) {
    case '=':
      return equalityMatch(value, criterion, isBlank);
    case '<>':
      return !equalityMatch(value, criterion, isBlank);
    default:
      return orderingMatch(value, criterion, isBlank);
  }
}

function equalityMatch(value: FormulaValue, criterion: Criterion, isBlank: boolean): boolean {
  if (isBlank) {
    return false; // handled by blankTest; a non-empty criterion never matches a blank
  }
  if (criterion.wildcard) {
    const text = coerceToText(value);
    return text === null ? false : matchWildcard(criterion.wildcard, text);
  }
  if (criterion.number !== null) {
    // A numeric criterion matches numbers and booleans by value. Text cells
    // never match a numeric criterion, even when they read like the number.
    if (value.type === 'number') {
      return value.value === criterion.number;
    }
    if (value.type === 'boolean') {
      return (value.value ? 1 : 0) === criterion.number;
    }
    return false;
  }
  const text = coerceToText(value);
  return text !== null && foldCase(text) === criterion.folded;
}

function orderingMatch(value: FormulaValue, criterion: Criterion, isBlank: boolean): boolean {
  if (isBlank) {
    return false; // a blank participates in no ordering comparison
  }
  if (criterion.number !== null) {
    const n = value.type === 'number' ? value.value : value.type === 'boolean' ? (value.value ? 1 : 0) : null;
    return n === null
      ? false
      : compare(criterion.op, n < criterion.number ? -1 : n > criterion.number ? 1 : 0);
  }
  if (value.type !== 'string') {
    return false; // a text criterion orders only against text cells
  }
  const a = foldCase(value.value);
  const b = criterion.folded;
  return compare(criterion.op, a < b ? -1 : a > b ? 1 : 0);
}

function compare(op: CriteriaOp, cmp: number): boolean {
  switch (op) {
    case '>':
      return cmp > 0;
    case '>=':
      return cmp >= 0;
    case '<':
      return cmp < 0;
    case '<=':
      return cmp <= 0;
    case '=':
      return cmp === 0;
    case '<>':
      return cmp !== 0;
  }
}

// ---------------------------------------------------------------------------
// Wildcards
// ---------------------------------------------------------------------------

/** What one compiled pattern symbol matches. */
export const enum WildcardKind {
  /** Exactly this code point (already case-folded). */
  Literal = 0,
  /** Any one code point (`?`). */
  Any = 1,
  /** Any run of code points, including none (`*`). */
  Run = 2,
}

/**
 * A compiled wildcard pattern: one entry per code point, each tagged with what
 * it matches. Storing the kind separately from the character is what keeps an
 * **escaped** `~*` — a literal asterisk — from being treated as a wildcard
 * when the pattern is matched.
 *
 * Compiling once means the escape rules and case folding are applied once per
 * criteria argument rather than once per scanned cell.
 */
export interface WildcardPattern {
  /** Case-folded code points; meaningless for non-literal entries. */
  readonly chars: readonly string[];
  /** Parallel to {@link chars}: what each entry matches. */
  readonly kinds: readonly WildcardKind[];
}

/**
 * Compile wildcard syntax, or return null when the text holds no *active*
 * wildcard (so the caller can use plain equality, which is cheaper and is what
 * makes `"a~*b"` compare literally against `a*b`).
 */
export function compileWildcard(source: string): WildcardPattern | null {
  if (!/[*?~]/.test(source)) {
    return null;
  }
  const outChars: string[] = [];
  const outKinds: WildcardKind[] = [];
  let active = false;
  const chars = Array.from(source); // code points, never half a surrogate pair
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === '~') {
      const next = chars[i + 1];
      if (next === '*' || next === '?' || next === '~') {
        // An escaped wildcard is a literal character, and must stay one when
        // the pattern is matched.
        outChars.push(foldCase(next));
        outKinds.push(WildcardKind.Literal);
        i += 1;
        continue;
      }
      outChars.push('~'); // a tilde before anything else is a literal tilde
      outKinds.push(WildcardKind.Literal);
      continue;
    }
    if (ch === '*' || ch === '?') {
      outChars.push(ch);
      outKinds.push(ch === '*' ? WildcardKind.Run : WildcardKind.Any);
      active = true;
      continue;
    }
    outChars.push(foldCase(ch));
    outKinds.push(WildcardKind.Literal);
  }
  if (!active) {
    return null; // only escapes, e.g. "a~*b" — compare as the literal "a*b"
  }
  return { chars: outChars, kinds: outKinds };
}

/** The literal text a pattern with no active wildcard reduces to. */
export function unescapeWildcard(source: string): string {
  let out = '';
  const chars = Array.from(source);
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === '~') {
      const next = chars[i + 1];
      if (next === '*' || next === '?' || next === '~') {
        out += next;
        i += 1;
        continue;
      }
    }
    out += ch;
  }
  return out;
}

/**
 * Match `subject` against a compiled pattern, case-insensitively.
 *
 * The algorithm is the classic two-pointer wildcard scan: literals and `?`
 * advance both pointers, and `*` records a backtrack point that is retried one
 * code point later on failure. Only the *most recent* `*` is remembered, which
 * is what bounds the work at O(subject × pattern) and makes exponential
 * backtracking structurally impossible — unlike a regular expression built
 * from user input.
 */
export function matchWildcard(pattern: WildcardPattern, subject: string): boolean {
  const text = Array.from(foldCase(subject));
  const { chars, kinds } = pattern;
  const length = kinds.length;
  let ti = 0;
  let pi = 0;
  let starPi = -1;
  let starTi = 0;
  while (ti < text.length) {
    if (pi < length) {
      const kind = kinds[pi];
      if (kind === WildcardKind.Any || (kind === WildcardKind.Literal && chars[pi] === text[ti])) {
        ti += 1;
        pi += 1;
        continue;
      }
      if (kind === WildcardKind.Run) {
        starPi = pi;
        starTi = ti;
        pi += 1;
        continue;
      }
    }
    if (starPi >= 0) {
      // Backtrack: let the last `*` swallow one more code point. Only the most
      // recent one is remembered, which bounds the work at O(text x pattern).
      pi = starPi + 1;
      starTi += 1;
      ti = starTi;
      continue;
    }
    return false;
  }
  while (pi < length && kinds[pi] === WildcardKind.Run) {
    pi += 1;
  }
  return pi === length;
}
