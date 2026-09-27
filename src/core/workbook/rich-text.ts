// SPDX-License-Identifier: MIT

/**
 * Rich text inside one cell: parts of a plain-text cell's input carrying
 * their own bold/italic/underline/text color. Stored on the cell's
 * {@link CellStyle} as `runs`, a list of text segments that concatenate to
 * the cell's input — so the runs check themselves: when the cell's text no
 * longer matches (edited through a path that did not carry the runs along),
 * they are simply not applied (see {@link runsForText}) and are dropped on
 * the next save. Purely presentational, like every other style property: it
 * never changes the cell's value, formula results, sort, filter, or CSV.
 *
 * A run's property overrides the whole cell's; an absent one inherits it.
 * `false` is meaningful (e.g. one plain word in a bold cell).
 */
export interface RunFormat {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** `#rrggbb`. */
  textColor?: string;
}

/** One segment of a cell's text and its format. */
export interface TextRun extends RunFormat {
  text: string;
}

export type RunFormatKey = keyof RunFormat;

/** Most runs one cell may carry (the reader refuses more as `too-large`). */
export const MAX_TEXT_RUNS = 10_000;

const RUN_KEYS: readonly RunFormatKey[] = ['bold', 'italic', 'underline', 'textColor'];

/** True when a format sets nothing. */
function isPlainFormat(format: RunFormat): boolean {
  return RUN_KEYS.every((key) => format[key] === undefined);
}

function formatsEqual(a: RunFormat, b: RunFormat): boolean {
  return RUN_KEYS.every((key) => a[key] === b[key]);
}

function copyFormat(format: RunFormat): RunFormat {
  const out: RunFormat = {};
  for (const key of RUN_KEYS) {
    if (format[key] !== undefined) {
      (out as Record<RunFormatKey, unknown>)[key] = format[key];
    }
  }
  return out;
}

/** Structural equality of two run lists (`undefined` equals `undefined` only). */
export function runsEqual(a: readonly TextRun[] | undefined, b: readonly TextRun[] | undefined): boolean {
  if (a === undefined || b === undefined) {
    return a === b;
  }
  return a.length === b.length && a.every((run, i) => run.text === b[i].text && formatsEqual(run, b[i]));
}

/** The text the runs spell out. */
function runsText(runs: readonly TextRun[]): string {
  return runs.map((run) => run.text).join('');
}

/**
 * The runs to apply to a cell showing `text`, or `null` when there are none
 * or they no longer describe that text. Formulas never take runs.
 */
export function runsForText(runs: readonly TextRun[] | undefined, text: string): readonly TextRun[] | null {
  if (!runs || runs.length === 0 || text.startsWith('=') || runsText(runs) !== text) {
    return null;
  }
  return runs;
}

/** One format per UTF-16 code unit of the runs' text. */
export function charFormats(runs: readonly TextRun[] | null): RunFormat[] {
  const out: RunFormat[] = [];
  for (const run of runs ?? []) {
    const format = copyFormat(run);
    for (let i = 0; i < run.text.length; i++) {
      out.push(format);
    }
  }
  return out;
}

/**
 * Merge per-character formats back into runs: adjacent characters with the
 * same format share one run. Returns `null` when no character carries a
 * format (a plain cell stores no runs), or for a formula.
 */
export function runsFromChars(text: string, formats: readonly RunFormat[]): TextRun[] | null {
  if (text.startsWith('=') || text.length === 0) {
    return null;
  }
  const runs: TextRun[] = [];
  let any = false;
  let start = 0;
  for (let i = 1; i <= text.length; i++) {
    const current = formats[start] ?? {};
    // A run ends where the format changes, but never inside a surrogate pair.
    if (i < text.length && (formatsEqual(formats[i] ?? {}, current) || isLowSurrogate(text.charCodeAt(i)))) {
      continue;
    }
    runs.push({ ...copyFormat(current), text: text.slice(start, i) });
    any ||= !isPlainFormat(current);
    start = i;
  }
  return any ? runs : null;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/**
 * Carry per-character formats across a text edit. The unchanged prefix and
 * suffix keep their formats; inserted characters take the format of the
 * character just before them (the one the caret followed), or of the one
 * after them when inserted at the very start.
 */
export function remapFormats(before: string, after: string, formats: readonly RunFormat[]): RunFormat[] {
  let prefix = 0;
  const max = Math.min(before.length, after.length);
  while (prefix < max && before.charCodeAt(prefix) === after.charCodeAt(prefix)) {
    prefix++;
  }
  let suffix = 0;
  while (
    suffix < max - prefix &&
    before.charCodeAt(before.length - 1 - suffix) === after.charCodeAt(after.length - 1 - suffix)
  ) {
    suffix++;
  }
  const inserted = after.length - prefix - suffix;
  const inherit = prefix > 0 ? formats[prefix - 1] : formats[before.length - suffix];
  const out = formats.slice(0, prefix);
  for (let i = 0; i < inserted; i++) {
    out.push(inherit ?? {});
  }
  out.push(...formats.slice(before.length - suffix));
  return out;
}

/** Runs for `after`, carried over from runs describing `before` (see {@link remapFormats}). */
export function remapRuns(before: string, after: string, runs: readonly TextRun[] | null): TextRun[] | null {
  if (!runs) {
    return null;
  }
  return runsFromChars(after, remapFormats(before, after, charFormats(runs)));
}

/**
 * Set (or, with `null`, clear) one property on the characters in
 * `[start, end)`, returning new formats. Never mutates its input.
 */
export function setFormatKey<K extends RunFormatKey>(
  formats: readonly RunFormat[],
  start: number,
  end: number,
  key: K,
  value: RunFormat[K] | null,
): RunFormat[] {
  return formats.map((format, i) => {
    if (i < start || i >= end) {
      return format;
    }
    const next = copyFormat(format);
    if (value === null || value === undefined) {
      delete next[key];
    } else {
      next[key] = value;
    }
    return next;
  });
}

/** Clear every property on the characters in `[start, end)`. */
export function clearFormats(formats: readonly RunFormat[], start: number, end: number): RunFormat[] {
  return formats.map((format, i) => (i < start || i >= end ? format : {}));
}

/**
 * Whether every character in `[start, end)` is shown with `key` on, given
 * the whole cell's own value for it — the rule that decides a toggle's
 * direction (all on → turn off, otherwise turn on).
 */
export function isFormatOn(
  formats: readonly RunFormat[],
  start: number,
  end: number,
  key: 'bold' | 'italic' | 'underline',
  cellValue: boolean,
): boolean {
  for (let i = start; i < end; i++) {
    if (!(formats[i]?.[key] ?? cellValue)) {
      return false;
    }
  }
  return end > start;
}

/**
 * Drop one property from every run — used when the same property is set on
 * the whole cell, which then applies to all of its text. Returns `undefined`
 * when no formatted run remains.
 */
export function withoutRunKey(runs: readonly TextRun[], key: RunFormatKey): TextRun[] | undefined {
  const text = runsText(runs);
  const formats = charFormats(runs).map((format) => {
    const next = copyFormat(format);
    delete next[key];
    return next;
  });
  return runsFromChars(text, formats) ?? undefined;
}
