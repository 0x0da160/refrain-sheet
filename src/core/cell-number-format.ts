// SPDX-License-Identifier: MIT
/**
 * Renders a cell's numeric display for the `numberFormat` a `CellStyle` may
 * carry (Format > Number Format…, see `cell-style.ts`). Built on top of the
 * Excel-compatible numeric grammar `formula-text-format.ts` already
 * implements for `TEXT()` — reused for the `number`/`percent` cases rather
 * than duplicated. Currency is composed on top of that rendering instead of
 * being added to the shared grammar, so `TEXT()`'s documented, tested subset
 * is untouched (a literal `"$0.00"` format code stays unsupported there —
 * see `tests/formula-functions.test.ts`).
 */
import type { NumberFormat } from './cell-style';
import { formatValueAsText } from './formula-text-format';
import { numberToText } from './formula-value';

/** The `formula-text-format.ts` code for `format`'s decimals/thousands, without a currency symbol. */
function baseFormatCode(format: NumberFormat): string {
  const integerPart = format.thousands ? '#,##0' : '0';
  const decimalPart = format.decimals > 0 ? `.${'0'.repeat(format.decimals)}` : '';
  const percentSuffix = format.kind === 'percent' ? '%' : '';
  return `${integerPart}${decimalPart}${percentSuffix}`;
}

/** Insert `symbol` right after a leading minus sign, e.g. `-1,234.56` -> `-$1,234.56`. */
function withCurrencySymbol(rendered: string, symbol: string): string {
  return rendered.startsWith('-') ? `-${symbol}${rendered.slice(1)}` : `${symbol}${rendered}`;
}

/**
 * Render `value` per `format`. Every code this module builds from a
 * `NumberFormat` is inside `formatValueAsText`'s supported numeric grammar,
 * so the `null` (unsupported format) case never actually happens here; the
 * plain shortest-round-trip fallback exists only to keep this function total
 * without an internal assertion.
 */
export function formatCellNumber(value: number, format: NumberFormat): string {
  const rendered = formatValueAsText(value, baseFormatCode(format));
  if (rendered === null) {
    return numberToText(value);
  }
  return format.kind === 'currency' ? withCurrencySymbol(rendered, format.currencySymbol ?? '$') : rendered;
}
