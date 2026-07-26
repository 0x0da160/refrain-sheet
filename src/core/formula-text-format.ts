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
 * - Date: the tokens `yyyy`, `yy`, `mm`, `dd`, each usable at most once,
 *   joined by any of the separators `-`, `/`, `.`, or a space (for example
 *   `yyyy-mm-dd`, `yyyy/mm/dd`, `mm/dd/yyyy`, `dd.mm.yyyy`).
 *
 * A `format_text` outside this grammar is not an error to recover from — it
 * is reported to the caller as unsupported (`null`), which `TEXT()` turns
 * into `#VALUE!`.
 */

import { serialToParts } from './formula-date';

const NUMERIC_FORMAT = /^(#,##0|0)(\.0+)?(%)?$/;
const DATE_TOKENS = /yyyy|yy|mm|dd|[-/. ]/g;
const DATE_FIELD_TOKENS = new Set(['yyyy', 'yy', 'mm', 'dd']);

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

function formatDate(serial: number, format: string): string | null {
  const tokens = format.match(DATE_TOKENS);
  if (!tokens || tokens.join('') !== format) {
    return null;
  }
  const fields = tokens.filter((token) => DATE_FIELD_TOKENS.has(token));
  if (fields.length === 0 || new Set(fields).size !== fields.length) {
    return null;
  }
  const parts = serialToParts(Math.floor(serial));
  if (!parts) {
    return null;
  }
  return tokens
    .map((token) => {
      switch (token) {
        case 'yyyy':
          return String(parts.year).padStart(4, '0');
        case 'yy':
          return String(parts.year % 100).padStart(2, '0');
        case 'mm':
          return String(parts.month).padStart(2, '0');
        case 'dd':
          return String(parts.day).padStart(2, '0');
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
 * `value` is not a representable date serial.
 */
export function formatValueAsText(value: number, format: string): string | null {
  const numeric = formatNumeric(value, format);
  return numeric !== null ? numeric : formatDate(value, format);
}
