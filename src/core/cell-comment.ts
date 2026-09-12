// SPDX-License-Identifier: MIT
/**
 * Cell comments: a short free-text note attached to one cell, independent of
 * its value. Purely an annotation — it never affects a cell's value, formula
 * evaluation, sort, filter, or CSV export (see #235).
 *
 * Persisted in the RSF container (body version 11+, see
 * `src/core/rsf-codec.ts` and `docs/rsf-format.md`): comments live in a
 * worksheet's sparse comment map (`Worksheet`) and survive closing and
 * reopening a file, exactly like cell styles.
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
