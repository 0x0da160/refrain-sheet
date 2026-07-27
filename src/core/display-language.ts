// SPDX-License-Identifier: MIT
/**
 * The per-workbook display-language setting.
 *
 * `TEXT()`'s weekday-name tokens (`ddd` / `dddd`, see `formula-text-format.ts`)
 * render a language-specific name. Like the workbook's timezone
 * (`timezone.ts`), that language is **stored in the file** rather than read
 * from whichever machine or session happens to open it, so a `.rsf` document
 * renders the same text everywhere it is opened — see
 * `RsfDocument.displayLanguage`.
 *
 * This is intentionally a small, closed set, independent of the
 * application's own UI-chrome locale catalogs (`src/app/i18n.ts`):
 * `src/core/` never imports from `src/app/` (see `docs/architecture.md`), and
 * a workbook's formula output must not depend on which UI language happens to
 * be active on the machine that opens it — that is exactly the determinism
 * problem this setting exists to avoid.
 */

export type DisplayLanguageId = 'en' | 'ja';

/** Fallback used when nothing is stored, or the stored value is unrecognized. */
export const DEFAULT_DISPLAY_LANGUAGE: DisplayLanguageId = 'en';

/** True when `value` is a display language this build knows how to render. */
export function isValidDisplayLanguage(value: string): value is DisplayLanguageId {
  return value === 'en' || value === 'ja';
}
