// SPDX-License-Identifier: MIT
// Dependency-free, lossless-ish CSS minifier for the landing page stylesheet
// (Issue #219: Lighthouse flagged src/landing/styles.css as ~22% removable
// whitespace/comments once served unminified from landing/).
//
// This is intentionally not a general-purpose CSS parser: it strips comments,
// drops the semicolon immediately before a `}` (optional in CSS), and
// collapses runs of whitespace to a single space, dropping that space
// entirely next to `{ } ; , :` where CSS never requires it. Quoted strings
// (font names, generated content, attribute-selector values) are copied
// verbatim so their internal spacing is never touched. Whitespace that is
// syntactically significant elsewhere — the descendant combinator ("a b"),
// and the operators inside calc()/clamp()/min()/max() ("1rem + 2vw") — is
// never adjacent to those punctuation characters, so it is always preserved.

const DROP_ADJACENT_TO = new Set(['{', '}', ';', ',', ':']);

/** @param {string} css */
export function minifyCss(css) {
  let out = '';
  let lastEmitted = '';
  let i = 0;
  const n = css.length;

  while (i < n) {
    const c = css[i];

    if (c === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }

    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      while (j < n && css[j] !== quote) {
        j += css[j] === '\\' ? 2 : 1;
      }
      j = Math.min(j + 1, n);
      const literal = css.slice(i, j);
      out += literal;
      lastEmitted = literal[literal.length - 1];
      i = j;
      continue;
    }

    if (/\s/.test(c)) {
      let j = i;
      while (j < n && /\s/.test(css[j])) j += 1;
      const next = css[j];
      if (lastEmitted && next && !DROP_ADJACENT_TO.has(lastEmitted) && !DROP_ADJACENT_TO.has(next)) {
        out += ' ';
        lastEmitted = ' ';
      }
      i = j;
      continue;
    }

    if (c === '}' && lastEmitted === ';') {
      out = out.slice(0, -1);
    }
    out += c;
    lastEmitted = c;
    i += 1;
  }

  return out.trim();
}
