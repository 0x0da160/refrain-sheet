// SPDX-License-Identifier: MIT
/**
 * The two kinds of document the editor opens, and the one place that tells
 * them apart.
 *
 * - A **CSV document** (`LosslessDocument`) is a single byte-preserved table:
 *   saving writes the loaded bytes back verbatim except for edited fields.
 *   It has no worksheets, formulas, styles, validation or comments — those
 *   need a workbook. It can be sorted and filtered, but only on screen: the
 *   sort and filter are never saved, so the file's bytes stay the same.
 * - A **workbook** (`RsfDocument`, saved as `.rsf`) holds worksheets and every
 *   spreadsheet feature.
 *
 * Code outside this module asks a capability question (`isWorkbook`,
 * `workbookOf`, `activeSheetOf`) instead of comparing `doc.kind` itself, so
 * the rule for what a CSV document can do lives in one place.
 * `eslint.config.js` forbids comparing `kind` with `'rsf'`/`'csv'` elsewhere.
 */
import type { LosslessDocument } from './csv/lossless-document';
import type { RsfDocument } from './workbook/rsf-document';
import type { Worksheet } from './workbook/worksheet';

/** Either document kind; the shared editing surface is common to both. */
export type EditorDocument = LosslessDocument | RsfDocument;

type MaybeDocument = EditorDocument | null | undefined;

/** True for a workbook (`.rsf`) — a document with worksheets and spreadsheet features. */
export function isWorkbook(doc: MaybeDocument): doc is RsfDocument {
  return doc?.kind === 'rsf';
}

/** True for a CSV document — one byte-preserved table without workbook features. */
export function isCsv(doc: MaybeDocument): doc is LosslessDocument {
  return doc?.kind === 'csv';
}

/**
 * What the current sort and filter belong to: the active worksheet of a
 * workbook, or the CSV document itself. A dialog that stays open compares
 * it to tell whether the user moved to another sheet in the meantime.
 */
export function sortFilterOwnerOf(doc: EditorDocument): object {
  return isWorkbook(doc) ? doc.activeSheet : doc;
}

/** The workbook `doc` is, or null for a CSV document (or no document). */
export function workbookOf(doc: MaybeDocument): RsfDocument | null {
  return isWorkbook(doc) ? doc : null;
}

/** The active worksheet of a workbook, or null for a CSV document (or no document). */
export function activeSheetOf(doc: MaybeDocument): Worksheet | null {
  return isWorkbook(doc) ? doc.activeSheet : null;
}
