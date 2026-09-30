// SPDX-License-Identifier: MIT

/**
 * Re-indent valid JSON text without converting it to values and back, so
 * every number and string keeps exactly the characters it was written with
 * (`1.0` stays `1.0`, a 20-digit integer keeps its digits, `"é"` keeps
 * its escape). Only the whitespace between tokens changes: one item per line,
 * `indent` per level, `": "` after a key, and `[]` / `{}` for an empty
 * container, matching `JSON.stringify(value, null, 2)` wherever that would
 * not change a value. A trailing newline in the input is kept.
 *
 * The caller checks that the text is valid JSON first (`JSON.parse`); on
 * anything else the output is unspecified.
 */
export function reindentJson(text: string, indent = '  '): string {
  const tokens = jsonTokens(text);
  let out = '';
  let depth = 0;
  const newline = (): string => `\n${indent.repeat(depth)}`;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === '{' || token === '[') {
      const close = token === '{' ? '}' : ']';
      if (tokens[i + 1] === close) {
        out += token + close;
        i += 1;
        continue;
      }
      depth += 1;
      out += token + newline();
    } else if (token === '}' || token === ']') {
      depth -= 1;
      out += newline() + token;
    } else if (token === ',') {
      out += `,${newline()}`;
    } else if (token === ':') {
      out += ': ';
    } else {
      out += token;
    }
  }
  return text.endsWith('\n') ? `${out}\n` : out;
}

/** Split JSON text into punctuation, strings (with their quotes and escapes as written) and bare literals. */
function jsonTokens(text: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i += 1;
    } else if ('{}[],:'.includes(ch)) {
      tokens.push(ch);
      i += 1;
    } else if (ch === '"') {
      let end = i + 1;
      while (end < text.length && text[end] !== '"') {
        end += text[end] === '\\' ? 2 : 1;
      }
      tokens.push(text.slice(i, end + 1));
      i = end + 1;
    } else {
      let end = i;
      while (end < text.length && !' \t\n\r{}[],:"'.includes(text[end])) {
        end += 1;
      }
      tokens.push(text.slice(i, end));
      i = end;
    }
  }
  return tokens;
}
