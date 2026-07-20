// SPDX-License-Identifier: MIT
/**
 * Flash Fill: deterministic, fully offline inference of a simple text
 * transformation from user-provided examples (RSF spreadsheets only).
 *
 * The user types one or more example results in a target column; the engine
 * looks for a transformation of the same row's *source* columns that
 * reproduces every example exactly, then proposes applying it to the
 * remaining rows. There is no machine learning, no network access, no
 * telemetry, and no dynamic code execution — every candidate transformation
 * is a small closed data structure ({@link FlashFillOp}) evaluated by
 * {@link applyFlashFillOp}, and inference is a bounded, deterministic search.
 *
 * Safety model: a proposal is only made when at least one candidate matches
 * **all** examples, and when every matching candidate agrees on the value of
 * every cell to be filled. If two structurally different candidates would
 * fill any cell differently, the inference is reported as *ambiguous* and
 * nothing is changed — the user is asked for another example instead of the
 * engine guessing.
 */

/** Optional casing normalization applied after extracting the text. */
export type FlashFillCasing = 'none' | 'upper' | 'lower';

/** One inferred transformation. Pure data — evaluated, never executed. */
export type FlashFillOp =
  /** Copy another column's value (optionally normalizing its casing). */
  | { kind: 'copy'; col: number; casing: FlashFillCasing }
  /** Concatenate source-column values with constant literal separators. */
  | { kind: 'concat'; parts: FlashFillPart[] }
  /** Take part `index` of a column's value split by a literal separator. */
  | { kind: 'split'; col: number; sep: string; index: number; fromEnd: boolean; casing: FlashFillCasing }
  /** Take a constant number of leading/trailing characters of a column. */
  | { kind: 'affix'; side: 'prefix' | 'suffix'; col: number; length: number; casing: FlashFillCasing };

export type FlashFillPart = { type: 'col'; col: number } | { type: 'lit'; text: string };

/** Reads a source cell of the current sheet (row-major, raw display text). */
export type SourceReader = (row: number, col: number) => string;

export interface FlashFillExample {
  row: number;
  value: string;
}

/** Separators tried for split candidates, in fixed priority order. */
export const FLASH_FILL_SEPARATORS = [' ', ',', ';', '-', '_', '/', '.', ':', '@'] as const;

/** Source columns considered for concatenation candidates (bounds the search). */
export const FLASH_FILL_MAX_CONCAT_COLS = 6;

/** Hard cap on candidates carried into the agreement scan. */
export const FLASH_FILL_MAX_CANDIDATES = 24;

const CASINGS: readonly FlashFillCasing[] = ['none', 'upper', 'lower'];

function applyCasing(text: string, casing: FlashFillCasing): string {
  switch (casing) {
    case 'upper':
      return text.toUpperCase();
    case 'lower':
      return text.toLowerCase();
    case 'none':
      return text;
  }
}

/**
 * Evaluate a transformation for one row. Returns null when the row has no
 * usable output (a required source cell is empty, or a split/affix index is
 * out of range) — such rows are left untouched by the fill.
 */
export function applyFlashFillOp(op: FlashFillOp, get: (col: number) => string): string | null {
  switch (op.kind) {
    case 'copy': {
      const v = get(op.col);
      return v === '' ? null : applyCasing(v, op.casing);
    }
    case 'concat': {
      let out = '';
      for (const part of op.parts) {
        if (part.type === 'lit') {
          out += part.text;
        } else {
          const v = get(part.col);
          if (v === '') {
            return null;
          }
          out += v;
        }
      }
      return out;
    }
    case 'split': {
      const v = get(op.col);
      if (v === '') {
        return null;
      }
      const parts = v.split(op.sep);
      const i = op.fromEnd ? parts.length - 1 - op.index : op.index;
      if (i < 0 || i >= parts.length || parts[i] === '') {
        return null;
      }
      return applyCasing(parts[i], op.casing);
    }
    case 'affix': {
      const v = get(op.col);
      if (v === '' || op.length <= 0 || op.length > v.length) {
        return null;
      }
      const s = op.side === 'prefix' ? v.slice(0, op.length) : v.slice(v.length - op.length);
      return applyCasing(s, op.casing);
    }
  }
}

/** True when `op` reproduces every example exactly. */
function matchesAll(op: FlashFillOp, examples: FlashFillExample[], get: SourceReader): boolean {
  return examples.every((e) => applyFlashFillOp(op, (col) => get(e.row, col)) === e.value);
}

/**
 * Enumerate every candidate transformation that reproduces all examples, in
 * a fixed deterministic order (copy, then split, then affix, then concat;
 * columns ascending; separators and casings in their declared order). Casing
 * variants are only added when the plain form does not already match, so a
 * matching identity transform never spawns redundant agreeing twins.
 */
export function inferFlashFillCandidates(
  examples: FlashFillExample[],
  sourceCols: number[],
  get: SourceReader,
): FlashFillOp[] {
  if (examples.length === 0 || sourceCols.length === 0) {
    return [];
  }
  const out: FlashFillOp[] = [];
  const add = (op: FlashFillOp): void => {
    if (out.length < FLASH_FILL_MAX_CANDIDATES && matchesAll(op, examples, get)) {
      out.push(op);
    }
  };
  /** Add the first matching casing variant only (none → upper → lower). */
  const addFirstCasing = (make: (casing: FlashFillCasing) => FlashFillOp): void => {
    for (const casing of CASINGS) {
      const op = make(casing);
      if (matchesAll(op, examples, get)) {
        add(op);
        return;
      }
    }
  };

  for (const col of sourceCols) {
    addFirstCasing((casing) => ({ kind: 'copy', col, casing }));
  }

  for (const col of sourceCols) {
    for (const sep of FLASH_FILL_SEPARATORS) {
      // Derive the candidate index from the first example, then verify all.
      const first = examples[0];
      const source = get(first.row, col);
      if (source === '' || !source.includes(sep)) {
        continue;
      }
      const parts = source.split(sep);
      let added = false;
      for (const casing of CASINGS) {
        // From the start: the first index whose part matches.
        for (let i = 0; i < parts.length && !added; i++) {
          if (parts[i] !== '' && applyCasing(parts[i], casing) === first.value) {
            const op: FlashFillOp = { kind: 'split', col, sep, index: i, fromEnd: false, casing };
            if (matchesAll(op, examples, get)) {
              add(op);
              added = true;
            }
          }
        }
        // From the end (e.g. "last part"), only when no from-start form fits.
        for (let i = 0; i < parts.length && !added; i++) {
          const j = parts.length - 1 - i;
          if (parts[j] !== '' && applyCasing(parts[j], casing) === first.value) {
            const op: FlashFillOp = { kind: 'split', col, sep, index: i, fromEnd: true, casing };
            if (matchesAll(op, examples, get)) {
              add(op);
              added = true;
            }
          }
        }
        if (added) {
          break;
        }
      }
    }
  }

  for (const col of sourceCols) {
    const len = examples[0].value.length;
    if (len > 0 && examples.every((e) => e.value.length === len)) {
      // Constant-length prefix/suffix; skipped when it would equal a full
      // copy of every example (the copy candidate already covers that).
      const isProper = examples.some((e) => get(e.row, col).length > len);
      if (isProper) {
        addFirstCasing((casing) => ({ kind: 'affix', side: 'prefix', col, length: len, casing }));
        addFirstCasing((casing) => ({ kind: 'affix', side: 'suffix', col, length: len, casing }));
      }
    }
  }

  // Concatenations of 2–3 distinct source columns with constant literals,
  // derived from the first example and verified against all of them.
  const concatCols = sourceCols.slice(0, FLASH_FILL_MAX_CONCAT_COLS);
  const trySequence = (seq: number[]): void => {
    const first = examples[0];
    let pos = 0;
    const parts: FlashFillPart[] = [];
    for (const col of seq) {
      const v = get(first.row, col);
      if (v === '') {
        return;
      }
      const idx = first.value.indexOf(v, pos);
      if (idx < 0) {
        return;
      }
      if (idx > pos) {
        parts.push({ type: 'lit', text: first.value.slice(pos, idx) });
      }
      parts.push({ type: 'col', col });
      pos = idx + v.length;
    }
    if (pos < first.value.length) {
      parts.push({ type: 'lit', text: first.value.slice(pos) });
    }
    add({ kind: 'concat', parts });
  };
  for (const a of concatCols) {
    for (const b of concatCols) {
      if (a !== b) {
        trySequence([a, b]);
      }
    }
  }
  for (const a of concatCols) {
    for (const b of concatCols) {
      for (const c of concatCols) {
        if (a !== b && a !== c && b !== c) {
          trySequence([a, b, c]);
        }
      }
    }
  }
  return out;
}

/** Outcome of evaluating all candidates for one fill row. */
export type FlashFillRowOutcome =
  | { kind: 'agreed'; value: string | null }
  | { kind: 'conflict'; first: FlashFillOp; second: FlashFillOp; a: string | null; b: string | null };

/**
 * Evaluate every candidate for one row. All candidates must produce the same
 * output (null — "leave untouched" — included) for the fill to stay
 * unambiguous; the first disagreement is reported with both candidate
 * outputs so the UI can explain *why* inference failed.
 */
export function flashFillRow(candidates: FlashFillOp[], get: (col: number) => string): FlashFillRowOutcome {
  const value = applyFlashFillOp(candidates[0], get);
  for (let i = 1; i < candidates.length; i++) {
    const other = applyFlashFillOp(candidates[i], get);
    if (other !== value) {
      return { kind: 'conflict', first: candidates[0], second: candidates[i], a: value, b: other };
    }
  }
  return { kind: 'agreed', value };
}
