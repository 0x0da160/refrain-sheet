// SPDX-License-Identifier: MIT
import { isMap, isScalar, parseAllDocuments, visit, type Document } from 'yaml';

/**
 * Syntax checking for the JSON and YAML worksheets' source text: the first
 * syntax error and where it is, so the editor can show it as the user types.
 * DOM-free and side-effect free; nothing is evaluated or fetched (YAML is
 * parsed with the `yaml` package, JSON with `JSON.parse`).
 */

/** The first syntax error in a source text. `line`/`col` are 1-based; `offset` is a UTF-16 index into the text. */
export interface SourceProblem {
  readonly message: string;
  readonly line: number;
  readonly col: number;
  readonly offset: number;
  /** How many syntax errors were found in total (JSON reports at most one). */
  readonly count: number;
}

/** 1-based line and column of `offset` in `text`. */
function lineColOf(text: string, offset: number): { line: number; col: number } {
  const clamped = Math.max(0, Math.min(offset, text.length));
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < clamped; i += 1) {
    if (text.charCodeAt(i) === 10) {
      line += 1;
      lineStart = i + 1;
    }
  }
  return { line, col: clamped - lineStart + 1 };
}

/**
 * The first JSON syntax error in `text`, or null when it parses (or is blank:
 * a new, empty sheet has nothing to check yet).
 */
export function validateJson(text: string): SourceProblem | null {
  if (text.trim() === '') {
    return null;
  }
  try {
    JSON.parse(text);
    return null;
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    // V8 reports "… in JSON at position 7 (line 1 column 8)"; other engines
    // differ, and "Unexpected end of JSON input" has no position at all
    // (the error is at the end).
    const position = /at position (\d+)/.exec(raw);
    const offset = position ? Number(position[1]) : text.length;
    const message = raw
      .replace(/\s*in JSON at position \d+.*$/s, '')
      .replace(/\s*\(line \d+ column \d+\)$/, '');
    return { message, offset, count: 1, ...lineColOf(text, offset) };
  }
}

/**
 * The first duplicate scalar key in any mapping of `doc`, as an error. The
 * `yaml` package's own `uniqueKeys` check compares every key with every
 * earlier one, which takes seconds on a sheet of tens of thousands of lines;
 * a set per mapping gives the same answer for plain keys in linear time.
 */
function firstDuplicateKey(doc: Document): { offset: number } | null {
  let found: { offset: number } | null = null;
  visit(doc, {
    Map(_, map) {
      if (!isMap(map)) {
        return undefined;
      }
      const seen = new Set<string>();
      for (const pair of map.items) {
        if (!isScalar(pair.key)) {
          continue;
        }
        const key = `${typeof pair.key.value}:${String(pair.key.value)}`;
        if (seen.has(key)) {
          found = { offset: pair.key.range?.[0] ?? 0 };
          return visit.BREAK;
        }
        seen.add(key);
      }
      return undefined;
    },
  });
  return found;
}

/**
 * The first YAML syntax error in `text` (across every `---` document), or
 * null when it parses or is blank. Duplicate keys and tab indentation count
 * as errors.
 */
export function validateYaml(text: string): SourceProblem | null {
  if (text.trim() === '') {
    return null;
  }
  const docs = parseAllDocuments(text, { uniqueKeys: false });
  const errors = docs.flatMap((doc) => doc.errors);
  const first = errors[0];
  if (first) {
    const offset = first.pos[0];
    // The package appends " at line L, column C:" and a code frame; the
    // editor shows the position itself.
    const message = first.message.split('\n')[0].replace(/\s*at line \d+, column \d+:?$/, '');
    return { message, offset, count: errors.length, ...lineColOf(text, offset) };
  }
  for (const doc of docs) {
    const duplicate = firstDuplicateKey(doc);
    if (duplicate) {
      return {
        message: 'Map keys must be unique',
        offset: duplicate.offset,
        count: 1,
        ...lineColOf(text, duplicate.offset),
      };
    }
  }
  return null;
}
