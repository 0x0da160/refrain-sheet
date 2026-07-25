// SPDX-License-Identifier: MIT
/**
 * Unicode-safe text helpers for the string functions.
 *
 * ## The counting unit is the Unicode code point
 *
 * `LEN`, `LEFT`, `RIGHT`, `MID`, `REPLACE`, and the `?` wildcard all count
 * **code points**, not UTF-16 code units and not user-perceived grapheme
 * clusters.
 *
 * - Not UTF-16 units, because those would let `LEFT` cut an emoji in half and
 *   emit a lone surrogate. No function here can ever produce one.
 * - Not grapheme clusters, despite those matching human intuition best,
 *   because the only practical way to segment them is `Intl.Segmenter`, whose
 *   answers follow the host's bundled ICU version. A `.rsf` file must compute
 *   the same values on every machine and in every browser; a formula whose
 *   result depends on the host's Unicode tables would break that. Code points
 *   are fixed by the Unicode encoding itself and never change.
 *
 * What this means in practice:
 *
 * | Text                    | `LEN` | Why                                      |
 * | ----------------------- | ----- | ---------------------------------------- |
 * | `"日本語"`               | 3     | three ideographs                         |
 * | `"🍎"`                   | 1     | one code point (two UTF-16 units)        |
 * | `"é"` precomposed       | 1     | U+00E9                                   |
 * | `"é"` as `e` + U+0301   | 2     | base plus combining acute                |
 * | `"👨‍👩‍👧"` family emoji  | 5     | three people plus two zero-width joiners |
 *
 * The last two rows are where code points and human perception part company.
 * They are covered by tests so the behaviour is pinned, not accidental.
 */

import { MAX_TEXT_LENGTH } from './formula-value';

/**
 * Split text into code points. `Array.from` iterates a string by code point,
 * so surrogate pairs stay together.
 */
export function toCodePoints(text: string): string[] {
  return Array.from(text);
}

/** Length in code points. */
export function codePointLength(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    n += 1;
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        i += 1; // a surrogate pair is one code point
      }
    }
  }
  return n;
}

/**
 * `count` code points of `text` starting at 0-based code-point index `start`.
 * Out-of-range requests clamp to the available text rather than erroring —
 * `MID("abc", 2, 100)` is `"bc"`, matching conventional spreadsheets.
 */
export function sliceCodePoints(text: string, start: number, count: number): string {
  if (count <= 0 || start < 0) {
    return '';
  }
  const points = toCodePoints(text);
  return points.slice(start, start + count).join('');
}

/** The last `count` code points of `text`. */
export function lastCodePoints(text: string, count: number): string {
  if (count <= 0) {
    return '';
  }
  const points = toCodePoints(text);
  return count >= points.length ? text : points.slice(points.length - count).join('');
}

/**
 * The whitespace policy for `TRIM`: remove leading and trailing whitespace,
 * and collapse each internal run of **spaces** to a single space.
 *
 * "Whitespace" for the outer trim is JavaScript's `String.prototype.trim` set
 * (which includes Unicode space separators, tab, and line terminators). The
 * internal collapse is deliberately restricted to the ASCII space `U+0020`:
 * collapsing runs that contain a newline would silently destroy the multi-line
 * cell content this application supports, so `TRIM` never removes or merges a
 * line break. Ideographic space `U+3000` is likewise preserved internally,
 * because in Japanese text it is content, not padding.
 */
export function trimText(text: string): string {
  return text.trim().replace(/ {2,}/g, ' ');
}

/**
 * Guard a produced string against the documented output cap. Returns null when
 * the text is too long, which callers turn into `#VALUE!` so a formula such as
 * a deeply nested `SUBSTITUTE` cannot grow a cell without bound.
 */
export function boundedText(text: string): string | null {
  return text.length > MAX_TEXT_LENGTH ? null : text;
}

/**
 * Replace occurrences of `search` in `text` with `replacement`.
 *
 * With `instance` omitted every occurrence is replaced; with `instance` set to
 * `n` only the `n`-th (1-based) is. Scanning is a plain `indexOf` loop, so the
 * search text is matched literally — it is never compiled as a pattern.
 *
 * An empty `search` matches nothing and the text is returned unchanged, which
 * is what stops an empty needle from inserting the replacement between every
 * character (and, with a non-empty replacement, growing without bound).
 */
export function substituteText(
  text: string,
  search: string,
  replacement: string,
  instance?: number,
): string | null {
  if (search === '') {
    return text;
  }
  let out = '';
  let from = 0;
  let seen = 0;
  for (;;) {
    const at = text.indexOf(search, from);
    if (at < 0) {
      break;
    }
    seen += 1;
    if (instance === undefined || seen === instance) {
      out += text.slice(from, at) + replacement;
    } else {
      out += text.slice(from, at + search.length);
    }
    from = at + search.length;
    if (instance !== undefined && seen === instance) {
      break;
    }
    if (out.length > MAX_TEXT_LENGTH) {
      return null;
    }
  }
  return boundedText(out + text.slice(from));
}
