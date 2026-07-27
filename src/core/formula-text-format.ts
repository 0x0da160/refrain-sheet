// SPDX-License-Identifier: MIT
/**
 * The format-code renderer behind `TEXT()`.
 *
 * Excel's custom number-format grammar is large: color codes, multi-section
 * conditional formats separated by `;`, fractions, scientific notation, a
 * text placeholder (`@`), and locale-specific calendars. This module renders
 * a **documented, Excel-compatible subset** of that grammar rather than a
 * second full format engine:
 *
 * - Numeric: `0` and `#,##0`, each with an optional `.` followed by one or
 *   more `0`s for a fixed decimal count, and an optional trailing `%`
 *   (`0`, `0.00`, `#,##0`, `#,##0.00`, `0%`, `0.00%`, `#,##0.00%`, ...).
 *   `#,##0` groups the integer part with thousands separators; `0` does not.
 * - Date: the tokens `yyyy`, `yy`, `mm`, `dd`, `dddd`, `ddd`, each usable at
 *   most once, joined by any of the separators `-`, `/`, `.`, or a space (for
 *   example `yyyy-mm-dd`, `yyyy/mm/dd`, `mm/dd/yyyy`, `dd.mm.yyyy`, `dddd`).
 *   Matching is case-insensitive (`"YYYY-MM-DD"` and `"DDDD"` work the same
 *   as their lowercase form), matching Excel's own format-code grammar; the
 *   rendered output always uses this module's own casing regardless of the
 *   case used in the format string.
 *
 * `dddd`/`ddd` render the weekday name in `language` — see
 * `display-language.ts`. That is a workbook-stored setting, not the live UI
 * language, so the same formula renders identical text wherever the workbook
 * is opened.
 *
 * A `format_text` outside this grammar is not an error to recover from — it
 * is reported to the caller as unsupported (`null`), which `TEXT()` turns
 * into `#VALUE!`.
 */

import { DEFAULT_DISPLAY_LANGUAGE, type DisplayLanguageId } from './display-language';
import { serialToParts, weekdayOf } from './formula-date';

const NUMERIC_FORMAT = /^(#,##0|0)(\.0+)?(%)?$/;
const DATE_TOKENS = /yyyy|yy|dddd|ddd|mm|dd|[-/. ]/gi;
const DATE_FIELD_TOKENS = new Set(['yyyy', 'yy', 'mm', 'dd', 'dddd', 'ddd']);

/**
 * Weekday names for `dddd` (full) and `ddd` (abbreviated), indexed `0`
 * (Sunday) … `6` (Saturday) — matching {@link weekdayOf}. Hardcoded here
 * rather than drawn from `src/locales/`: those catalogs belong to the
 * application's UI chrome (`src/app/i18n.ts`), a layer `src/core/` never
 * imports from, and are keyed to the *live* UI language rather than this
 * workbook-stored setting.
 */
const WEEKDAY_NAMES: Record<DisplayLanguageId, { long: readonly string[]; short: readonly string[] }> = {
  en: {
    long: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    short: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  },
  ja: {
    long: ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日'],
    short: ['日', '月', '火', '水', '木', '金', '土'],
  },
};

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function formatNumeric(value: number, format: string): string | null {
  const match = NUMERIC_FORMAT.exec(format);
  if (!match) {
    return null;
  }
  const [, integerPart, decimalPart, percent] = match;
  const grouped = integerPart === '#,##0';
  const decimals = decimalPart ? decimalPart.length - 1 : 0;
  const scaled = percent ? value * 100 : value;
  const fixed = Math.abs(scaled).toFixed(decimals);
  const [whole, frac] = fixed.split('.');
  const wholeOut = grouped ? groupThousands(whole) : whole;
  const sign = scaled < 0 ? '-' : '';
  const body = frac === undefined ? wholeOut : `${wholeOut}.${frac}`;
  return `${sign}${body}${percent ? '%' : ''}`;
}

function formatDate(serial: number, format: string, language: DisplayLanguageId): string | null {
  const tokens = format.match(DATE_TOKENS);
  if (!tokens || tokens.join('') !== format) {
    return null;
  }
  // Matching is case-insensitive (Excel's own format codes are), so field
  // identity and duplicate detection compare the lowercased token.
  const fields = tokens.map((token) => token.toLowerCase()).filter((token) => DATE_FIELD_TOKENS.has(token));
  if (fields.length === 0 || new Set(fields).size !== fields.length) {
    return null;
  }
  const day = Math.floor(serial);
  const parts = serialToParts(day);
  if (!parts) {
    return null;
  }
  const names = WEEKDAY_NAMES[language];
  return tokens
    .map((token) => {
      switch (token.toLowerCase()) {
        case 'yyyy':
          return String(parts.year).padStart(4, '0');
        case 'yy':
          return String(parts.year % 100).padStart(2, '0');
        case 'mm':
          return String(parts.month).padStart(2, '0');
        case 'dd':
          return String(parts.day).padStart(2, '0');
        case 'dddd':
          return names.long[weekdayOf(day)!];
        case 'ddd':
          return names.short[weekdayOf(day)!];
        default:
          return token;
      }
    })
    .join('');
}

/**
 * Render `value` (a plain number or a date serial — the two share one scale;
 * see `formula-date.ts`) according to `format`. Returns `null` when `format`
 * falls outside the supported grammar, or when it is a date format and
 * `value` is not a representable date serial. `language` selects the weekday
 * name for `dddd`/`ddd` (defaults to English); it is ignored by every other
 * token.
 */
export function formatValueAsText(
  value: number,
  format: string,
  language: DisplayLanguageId = DEFAULT_DISPLAY_LANGUAGE,
): string | null {
  const numeric = formatNumeric(value, format);
  return numeric !== null ? numeric : formatDate(value, format, language);
}
