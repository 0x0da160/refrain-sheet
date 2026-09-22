// SPDX-License-Identifier: MIT
/**
 * A small, hand-written, dependency-free syntax highlighter for fenced code
 * blocks in the Markdown preview (#486). Like `src/core/markdown.ts`, it
 * never produces an HTML string — it tokenizes source text into a flat list
 * of `{ type, text }` tokens; the renderer (`src/ui/markdown-render.ts`)
 * turns each token into a DOM node via `textContent`, so highlighted code
 * gets the same "never render untrusted text as anything but literal text"
 * guarantee as the rest of the Markdown preview.
 *
 * This recognizes a fixed set of common languages via a shared, generic
 * scanner driven by a per-language `LangSpec` (line/block comment markers,
 * string-quote characters, and a keyword set) rather than a full grammar per
 * language — good enough for readable highlighting, not a real lexer/parser.
 * An unrecognized or missing `lang` renders as a single unhighlighted token.
 */

type CodeTokenType = 'keyword' | 'string' | 'comment' | 'number' | 'text';

export interface CodeToken {
  type: CodeTokenType;
  text: string;
}

interface LangSpec {
  lineComments: string[];
  blockComments: Array<[string, string]>;
  stringQuotes: string[];
  keywords: Set<string>;
}

const NUMBER_RE = /^\d+(\.\d+)?([eE][+-]?\d+)?/;
const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*/;

const C_LIKE_KEYWORDS = [
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'implements',
  'import',
  'in',
  'instanceof',
  'interface',
  'let',
  'new',
  'null',
  'of',
  'private',
  'protected',
  'public',
  'return',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'undefined',
  'var',
  'void',
  'while',
  'yield',
  'async',
  'await',
  'type',
  'as',
  'from',
  'namespace',
  'readonly',
];

const PYTHON_KEYWORDS = [
  'and',
  'as',
  'assert',
  'async',
  'await',
  'break',
  'class',
  'continue',
  'def',
  'del',
  'elif',
  'else',
  'except',
  'False',
  'finally',
  'for',
  'from',
  'global',
  'if',
  'import',
  'in',
  'is',
  'lambda',
  'None',
  'nonlocal',
  'not',
  'or',
  'pass',
  'raise',
  'return',
  'True',
  'try',
  'while',
  'with',
  'yield',
];

const SQL_KEYWORDS = [
  'select',
  'from',
  'where',
  'insert',
  'into',
  'values',
  'update',
  'set',
  'delete',
  'create',
  'table',
  'drop',
  'alter',
  'join',
  'inner',
  'left',
  'right',
  'outer',
  'on',
  'group',
  'by',
  'order',
  'having',
  'limit',
  'and',
  'or',
  'not',
  'null',
  'as',
  'distinct',
  'union',
  'case',
  'when',
  'then',
  'else',
  'end',
];

const SHELL_KEYWORDS = [
  'if',
  'then',
  'else',
  'elif',
  'fi',
  'for',
  'while',
  'do',
  'done',
  'case',
  'esac',
  'function',
  'return',
  'export',
  'local',
  'echo',
  'in',
];

const RUST_KEYWORDS = [
  ...C_LIKE_KEYWORDS,
  'fn',
  'let',
  'mut',
  'match',
  'struct',
  'impl',
  'trait',
  'pub',
  'use',
  'mod',
  'crate',
  'self',
  'Self',
  'loop',
  'ref',
  'move',
  'unsafe',
  'dyn',
];

const GO_KEYWORDS = [
  'break',
  'case',
  'chan',
  'const',
  'continue',
  'default',
  'defer',
  'else',
  'fallthrough',
  'for',
  'func',
  'go',
  'goto',
  'if',
  'import',
  'interface',
  'map',
  'package',
  'range',
  'return',
  'select',
  'struct',
  'switch',
  'type',
  'var',
  'true',
  'false',
  'nil',
];

function spec(overrides: Partial<LangSpec>): LangSpec {
  return {
    lineComments: [],
    blockComments: [],
    stringQuotes: ["'", '"'],
    keywords: new Set(),
    ...overrides,
  };
}

const LANG_SPECS: Record<string, LangSpec> = {
  javascript: spec({
    lineComments: ['//'],
    blockComments: [['/*', '*/']],
    keywords: new Set(C_LIKE_KEYWORDS),
  }),
  typescript: spec({
    lineComments: ['//'],
    blockComments: [['/*', '*/']],
    keywords: new Set(C_LIKE_KEYWORDS),
  }),
  json: spec({ keywords: new Set(['true', 'false', 'null']) }),
  css: spec({ blockComments: [['/*', '*/']] }),
  html: spec({ blockComments: [['<!--', '-->']] }),
  python: spec({ lineComments: ['#'], keywords: new Set(PYTHON_KEYWORDS) }),
  bash: spec({ lineComments: ['#'], keywords: new Set(SHELL_KEYWORDS) }),
  sql: spec({ lineComments: ['--'], blockComments: [['/*', '*/']], keywords: new Set(SQL_KEYWORDS) }),
  yaml: spec({ lineComments: ['#'] }),
  rust: spec({ lineComments: ['//'], blockComments: [['/*', '*/']], keywords: new Set(RUST_KEYWORDS) }),
  go: spec({ lineComments: ['//'], blockComments: [['/*', '*/']], keywords: new Set(GO_KEYWORDS) }),
};

const LANG_ALIASES: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  htm: 'html',
  xml: 'html',
  rs: 'rust',
};

function resolveLangSpec(lang: string | null): LangSpec | null {
  if (lang === null) {
    return null;
  }
  const key = lang.trim().toLowerCase();
  return LANG_SPECS[LANG_ALIASES[key] ?? key] ?? null;
}

/** Tokenize fenced code block text for highlighting. An unrecognized `lang` yields one plain `text` token. */
export function tokenizeCode(code: string, lang: string | null): CodeToken[] {
  const langSpec = resolveLangSpec(lang);
  if (langSpec === null) {
    return code === '' ? [] : [{ type: 'text', text: code }];
  }

  const tokens: CodeToken[] = [];
  let plain = '';
  const flushPlain = (): void => {
    if (plain !== '') {
      tokens.push({ type: 'text', text: plain });
      plain = '';
    }
  };

  let i = 0;
  while (i < code.length) {
    const rest = code.slice(i);

    const lineComment = langSpec.lineComments.find((marker) => rest.startsWith(marker));
    if (lineComment !== undefined) {
      const end = code.indexOf('\n', i);
      const text = end === -1 ? rest : code.slice(i, end);
      flushPlain();
      tokens.push({ type: 'comment', text });
      i += text.length;
      continue;
    }

    const blockComment = langSpec.blockComments.find(([open]) => rest.startsWith(open));
    if (blockComment !== undefined) {
      const [open, close] = blockComment;
      const closeIndex = code.indexOf(close, i + open.length);
      const end = closeIndex === -1 ? code.length : closeIndex + close.length;
      flushPlain();
      tokens.push({ type: 'comment', text: code.slice(i, end) });
      i = end;
      continue;
    }

    const quote = langSpec.stringQuotes.find((q) => rest.startsWith(q));
    if (quote !== undefined) {
      let end = i + quote.length;
      while (end < code.length && !code.startsWith(quote, end)) {
        end += code[end] === '\\' ? 2 : 1;
      }
      end = Math.min(end + quote.length, code.length);
      flushPlain();
      tokens.push({ type: 'string', text: code.slice(i, end) });
      i = end;
      continue;
    }

    const numberMatch = NUMBER_RE.exec(rest);
    if (numberMatch !== null && !/[A-Za-z_]/.test(code[i - 1] ?? '')) {
      flushPlain();
      tokens.push({ type: 'number', text: numberMatch[0] });
      i += numberMatch[0].length;
      continue;
    }

    const identifierMatch = IDENTIFIER_RE.exec(rest);
    if (identifierMatch !== null) {
      const word = identifierMatch[0];
      if (langSpec.keywords.has(word)) {
        flushPlain();
        tokens.push({ type: 'keyword', text: word });
      } else {
        plain += word;
      }
      i += word.length;
      continue;
    }

    plain += code[i];
    i++;
  }
  flushPlain();
  return tokens;
}
