// SPDX-License-Identifier: MIT
/**
 * Cell comments: a short free-text note attached to one cell, independent of
 * its value. Purely an annotation — it never affects a cell's value, formula
 * evaluation, sort, filter, or CSV export (see #235).
 *
 * Session-only view state, like `sort.ts` and `data-validation.ts`
 * (`Worksheet.validations`): comments live only in memory, in a worksheet's
 * sparse comment map, and are never persisted in the RSF container, so they
 * do not survive closing and reopening a file. Persisting them durably would
 * need a new RSF body version (see docs/rsf-format.md) — a sensitive,
 * separately reviewed change — so an in-session annotation is the smallest
 * safe increment for the initial feature.
 *
 * Everything here is pure and DOM-free.
 */

/** Maximum length (UTF-16 code units) of one cell's comment text. */
export const MAX_COMMENT_LENGTH = 2000;

/**
 * Normalize raw dialog input into stored form: trims leading/trailing
 * whitespace and caps length at {@link MAX_COMMENT_LENGTH}. Returns null for
 * blank input, meaning "no comment" (clearing a cell's comment is the same
 * as never having set one).
 */
export function normalizeCommentText(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return null;
  }
  return trimmed.length > MAX_COMMENT_LENGTH ? trimmed.slice(0, MAX_COMMENT_LENGTH) : trimmed;
}
