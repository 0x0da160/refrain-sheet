// SPDX-License-Identifier: MIT
/**
 * Reference rewriting: adjusting a formula's references for row/column
 * insertion and deletion, copies, and worksheet renames and deletions,
 * always preserving the written `$` markers.
 */
import {
  type CellRefEx,
  columnLabel,
  isFormula,
  parseRefEx,
  parseWholeColumnEx,
  parseWholeRowEx,
  quoteSheetName,
  refLabel,
  sheetNameKey,
  type SpanEnd,
} from './refs';
import { type Token, tokenize } from './tokenizer';

// ---------------------------------------------------------------------------
// Reference rewriting (insert/delete/copy adjustments)
// ---------------------------------------------------------------------------

/**
 * Maps one cell reference to its rewritten coordinates. The input carries the
 * reference's `$` markers so mappers can hold absolute components fixed
 * (copy/paste) or ignore the markers (structural edits); the rewriter itself
 * always re-renders the original markers on the mapped output.
 */
export type RefMap = (ref: CellRefEx) => { row: number; col: number } | 'REF_ERROR';
export type RangeMap = (
  from: CellRefEx,
  to: CellRefEx,
) => { from: { row: number; col: number }; to: { row: number; col: number } } | 'REF_ERROR';
/** Map the endpoints of a whole-column or whole-row span (1-D, with `$` markers). */
export type SpanMap = (from: SpanEnd, to: SpanEnd) => { from: number; to: number } | 'REF_ERROR';

/**
 * Rewrite every cell reference in a formula string using the given mapping
 * functions, preserving all other text — including each reference's `$`
 * absolute markers, which are re-rendered onto the mapped coordinates.
 * References that map to 'REF_ERROR' are replaced with the literal #REF!
 * error. Formulas that do not tokenize are returned unchanged (they already
 * display #ERROR!).
 *
 * `mapColSpan`/`mapRowSpan` handle whole-column (`A:C`) and whole-row (`1:10`)
 * ranges; when omitted those ranges are left unchanged.
 */
/**
 * Cross-sheet options for {@link rewriteFormulaRefs}. Omitting them keeps the
 * single-worksheet behavior: every reference is remapped and any worksheet
 * qualifier is preserved exactly as written.
 */
export interface SheetRewriteOptions {
  /**
   * The worksheet the formula being rewritten lives in. An unqualified
   * reference belongs to this worksheet, which is what `shouldMapCoords`
   * receives as the reference's effective worksheet.
   */
  homeSheet?: string;
  /**
   * Transform an explicit worksheet qualifier. Return a name to rewrite the
   * prefix (re-quoted as needed), `'REF_ERROR'` to turn the whole reference
   * into #REF! (the worksheet was deleted), or null to keep the prefix
   * exactly as written.
   */
  mapSheet?: (sheet: string) => string | 'REF_ERROR' | null;
  /**
   * Whether the coordinate mappers apply to a reference whose effective
   * worksheet is `sheet` (null when the formula's own worksheet is unknown).
   * Structural row/column edits use this so inserting a row in one worksheet
   * never shifts references that point at a different one. Defaults to
   * remapping every reference.
   */
  shouldMapCoords?: (sheet: string | null) => boolean;
}

/**
 * Rewrite every cell reference in a formula string using the given mapping
 * functions, preserving all other text — including each reference's `$`
 * absolute markers, which are re-rendered onto the mapped coordinates, and its
 * worksheet qualifier (`Sheet1!`, `'Quarter 1'!`), which is preserved or
 * transformed through {@link SheetRewriteOptions.mapSheet}. References that map
 * to 'REF_ERROR' — and references into a deleted worksheet — are replaced with
 * the literal #REF! error. Formulas that do not tokenize are returned unchanged
 * (they already display #ERROR!).
 *
 * `mapColSpan`/`mapRowSpan` handle whole-column (`A:C`) and whole-row (`1:10`)
 * ranges; when omitted those ranges keep their coordinates.
 */
export function rewriteFormulaRefs(
  src: string,
  mapRef: RefMap,
  mapRange: RangeMap,
  mapColSpan?: SpanMap,
  mapRowSpan?: SpanMap,
  sheetOpts?: SheetRewriteOptions,
): string {
  if (!isFormula(src)) {
    return src;
  }
  let tokens: Token[];
  try {
    tokens = tokenize(src.slice(1));
  } catch {
    return src;
  }
  const mappers: Mappers = { mapRef, mapRange, mapColSpan, mapRowSpan };
  const splices: Splice[] = [];
  // Token offsets are relative to the text after '='.
  const body = src.slice(1);
  let i = 0;
  while (i < tokens.length) {
    // An optional worksheet qualifier: `Name!` or `'Quoted Name'!`.
    const qualifier = readQualifier(tokens, i);
    const j = qualifier ? i + 2 : i;
    const token = tokens[j] ?? null;
    if (!token) {
      i += 1;
      continue;
    }
    if (tokens[j + 1]?.type === 'lparen') {
      i = j + 1; // a function name, never a reference
      continue;
    }
    const sheetName = qualifier?.name ?? null;
    const prefix = resolvePrefix(sheetName, qualifier?.text ?? null, sheetOpts);
    const occurrence = matchOccurrence(tokens, j, mapsCoords(sheetName, sheetOpts), mappers);
    if (!occurrence) {
      // Not a reference occurrence; skip just the head token so a stray
      // qualifier cannot swallow the tokens that follow it.
      i += 1;
      continue;
    }
    const spanStart = qualifier ? qualifier.start : token.start;
    const { coords, end, lastIndex } = occurrence;
    const text = prefix === null || coords === null ? '#REF!' : `${prefix}${coords}`;
    if (text !== body.slice(spanStart, end)) {
      splices.push({ start: spanStart, end, text });
    }
    i = lastIndex + 1;
  }
  if (splices.length === 0) {
    return src;
  }
  let out = body;
  for (let k = splices.length - 1; k >= 0; k--) {
    const s = splices[k];
    out = out.slice(0, s.start) + s.text + out.slice(s.end);
  }
  return `=${out}`;
}

interface Splice {
  start: number;
  end: number;
  text: string;
}

interface Mappers {
  mapRef: RefMap;
  mapRange: RangeMap;
  mapColSpan?: SpanMap;
  mapRowSpan?: SpanMap;
}

/**
 * A reference occurrence: its rewritten coordinate text (null when it becomes
 * #REF!), the source offset it ends at, and the index of its last token.
 */
interface Occurrence {
  coords: string | null;
  end: number;
  lastIndex: number;
}

/** A `Name!` / `'Quoted Name'!` qualifier starting at token `i`, if any. */
function readQualifier(tokens: Token[], i: number): { name: string; text: string; start: number } | null {
  const head = tokens[i];
  if (tokens[i + 1]?.type !== 'bang' || (head.type !== 'ident' && head.type !== 'sheetname')) {
    return null;
  }
  return {
    name: head.type === 'sheetname' ? (head.value as string) : head.text,
    text: head.text,
    start: head.start,
  };
}

/** True when the coordinate mappers apply to a reference on `sheetName`. */
function mapsCoords(sheetName: string | null, sheetOpts: SheetRewriteOptions | undefined): boolean {
  const effective = sheetName ?? sheetOpts?.homeSheet ?? null;
  return sheetOpts?.shouldMapCoords ? sheetOpts.shouldMapCoords(effective) : true;
}

/** The rewritten `Sheet!` prefix, '' when unqualified, or null for #REF!. */
function resolvePrefix(
  sheetName: string | null,
  sheetText: string | null,
  sheetOpts: SheetRewriteOptions | undefined,
): string | null {
  if (sheetName === null) {
    return '';
  }
  const mapped = sheetOpts?.mapSheet?.(sheetName);
  if (mapped === 'REF_ERROR') {
    return null;
  }
  if (typeof mapped === 'string') {
    return `${quoteSheetName(mapped)}!`;
  }
  return `${sheetText}!`;
}

/** The reference occurrence at token `j` (after any qualifier), or null. */
function matchOccurrence(tokens: Token[], j: number, doMap: boolean, mappers: Mappers): Occurrence | null {
  const token = tokens[j];
  if (token.type !== 'number' && token.type !== 'ident') {
    return null;
  }
  const ref = token.type === 'ident' ? parseRefEx(token.text) : null;
  if (ref) {
    return matchCellOrRange(tokens, j, ref, doMap, mappers);
  }
  if (tokens[j + 1]?.type !== 'colon') {
    return null;
  }
  return matchColumnSpan(tokens, j, doMap, mappers) ?? matchRowSpan(tokens, j, doMap, mappers);
}

/** `ref` or `ref ':' ref`. */
function matchCellOrRange(
  tokens: Token[],
  j: number,
  ref: CellRefEx,
  doMap: boolean,
  mappers: Mappers,
): Occurrence {
  if (tokens[j + 1]?.type === 'colon') {
    const endToken = tokens[j + 2] ?? null;
    const endRef = endToken && endToken.type === 'ident' ? parseRefEx(endToken.text) : null;
    if (endRef && endToken) {
      const mapped = doMap ? mappers.mapRange(ref, endRef) : { from: ref, to: endRef };
      const coords =
        mapped === 'REF_ERROR'
          ? null
          : `${refLabel(mapped.from.row, mapped.from.col, ref.absRow, ref.absCol)}:${refLabel(mapped.to.row, mapped.to.col, endRef.absRow, endRef.absCol)}`;
      return { coords, end: endToken.end, lastIndex: j + 2 };
    }
  }
  const mapped = doMap ? mappers.mapRef(ref) : { row: ref.row, col: ref.col };
  const coords = mapped === 'REF_ERROR' ? null : refLabel(mapped.row, mapped.col, ref.absRow, ref.absCol);
  return { coords, end: tokens[j].end, lastIndex: j };
}

/** Whole-column range: COL ':' COL (e.g. A:C, $A:$C). */
function matchColumnSpan(tokens: Token[], j: number, doMap: boolean, mappers: Mappers): Occurrence | null {
  const token = tokens[j];
  const fromCol = token.type === 'ident' ? parseWholeColumnEx(token.text) : null;
  const endToken = tokens[j + 2] ?? null;
  const toCol = endToken && endToken.type === 'ident' ? parseWholeColumnEx(endToken.text) : null;
  if (fromCol === null || toCol === null || !endToken) {
    return null;
  }
  const mapped =
    doMap && mappers.mapColSpan
      ? mappers.mapColSpan(fromCol, toCol)
      : { from: fromCol.index, to: toCol.index };
  const coords =
    mapped === 'REF_ERROR'
      ? null
      : `${spanText(columnLabel(mapped.from), fromCol.abs)}:${spanText(columnLabel(mapped.to), toCol.abs)}`;
  return { coords, end: endToken.end, lastIndex: j + 2 };
}

/** Whole-row range: (NUMBER | $ROW) ':' (NUMBER | $ROW). */
function matchRowSpan(tokens: Token[], j: number, doMap: boolean, mappers: Mappers): Occurrence | null {
  const fromRow = parseWholeRowEx(tokens[j].text);
  const endToken = tokens[j + 2] ?? null;
  // A whole-row span endpoint is a number token (1) or a `$`-marked ident ($1).
  const toRow =
    endToken && (endToken.type === 'number' || endToken.type === 'ident')
      ? parseWholeRowEx(endToken.text)
      : null;
  if (fromRow === null || toRow === null || !endToken) {
    return null;
  }
  const mapped =
    doMap && mappers.mapRowSpan
      ? mappers.mapRowSpan(fromRow, toRow)
      : { from: fromRow.index, to: toRow.index };
  const coords =
    mapped === 'REF_ERROR'
      ? null
      : `${spanText(String(mapped.from + 1), fromRow.abs)}:${spanText(String(mapped.to + 1), toRow.abs)}`;
  return { coords, end: endToken.end, lastIndex: j + 2 };
}

function spanText(label: string, abs: boolean): string {
  return `${abs ? '$' : ''}${label}`;
}

// ---------------------------------------------------------------------------
// Worksheet-scoped rewrites (rename / delete a worksheet)
// ---------------------------------------------------------------------------

/** Coordinate mappers that leave every reference exactly where it is. */
const IDENTITY_REF: RefMap = (ref) => ({ row: ref.row, col: ref.col });
const IDENTITY_RANGE: RangeMap = (from, to) => ({
  from: { row: from.row, col: from.col },
  to: { row: to.row, col: to.col },
});
const IDENTITY_SPAN: SpanMap = (from, to) => ({ from: from.index, to: to.index });

/**
 * Rewrite every reference to worksheet `oldName` so it names `newName`
 * instead, re-quoting the prefix only as the new name requires. Coordinates,
 * `$` markers, and all other formula text are untouched, so a rename never
 * changes what a formula computes. Worksheet names match case-insensitively,
 * matching the uniqueness policy.
 */
export function renameSheetInFormula(src: string, oldName: string, newName: string): string {
  const target = sheetNameKey(oldName);
  return rewriteFormulaRefs(src, IDENTITY_REF, IDENTITY_RANGE, IDENTITY_SPAN, IDENTITY_SPAN, {
    mapSheet: (sheet) => (sheetNameKey(sheet) === target ? newName : null),
  });
}

/**
 * Turn every reference to worksheet `sheetName` into the explicit #REF! error
 * (the worksheet was deleted). References to other worksheets and to the
 * formula's own worksheet are left untouched — a deleted worksheet is never
 * silently redirected to a different one.
 */
export function invalidateSheetRefsInFormula(src: string, sheetName: string): string {
  const target = sheetNameKey(sheetName);
  return rewriteFormulaRefs(src, IDENTITY_REF, IDENTITY_RANGE, IDENTITY_SPAN, IDENTITY_SPAN, {
    mapSheet: (sheet) => (sheetNameKey(sheet) === target ? 'REF_ERROR' : null),
  });
}

/**
 * True when the formula contains at least one reference qualified with
 * `sheetName` (case-insensitively). Used to report which worksheets a delete
 * or rename will affect without rewriting anything.
 */
export function formulaReferencesSheet(src: string, sheetName: string): boolean {
  const target = sheetNameKey(sheetName);
  let found = false;
  rewriteFormulaRefs(src, IDENTITY_REF, IDENTITY_RANGE, IDENTITY_SPAN, IDENTITY_SPAN, {
    mapSheet: (sheet) => {
      if (sheetNameKey(sheet) === target) {
        found = true;
      }
      return null;
    },
  });
  return found;
}
