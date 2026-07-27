// SPDX-License-Identifier: MIT
/**
 * IANA timezone-name handling for the per-workbook timezone setting.
 *
 * Every conversion in `formula-date.ts` is deliberately UTC-only, so a
 * workbook's stored serials always mean the same instant regardless of the
 * machine that computes them. The *wall-clock instant* `TODAY()`/`NOW()`
 * read, though, is shifted by the workbook's own stored timezone (see
 * `RsfDocument`) before it ever reaches that pure UTC math — so it is the
 * file's stored choice, not the opening machine's clock, that decides what
 * "today" means, which keeps the same-file-same-result guarantee intact.
 */

/** Fallback timezone used when nothing is stored or valid: the app's original, pre-timezone behavior. */
export const DEFAULT_TIMEZONE = 'UTC';

/** True when `timeZone` is a name `Intl` can resolve (a real IANA zone, or `"UTC"`). */
export function isValidTimeZone(timeZone: string): boolean {
  if (typeof timeZone !== 'string' || timeZone.length === 0) {
    return false;
  }
  try {
    new Intl.DateTimeFormat(undefined, { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** The browser's local IANA timezone, or {@link DEFAULT_TIMEZONE} when it cannot be determined. */
export function localTimeZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz && isValidTimeZone(tz) ? tz : DEFAULT_TIMEZONE;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

/**
 * Every IANA zone name the runtime knows, sorted, for a settings picker.
 * `Intl.supportedValuesOf` is a 2022-era addition; on a runtime without it,
 * this falls back to just {@link DEFAULT_TIMEZONE} and the local zone so the
 * picker still has something usable. `supportedValuesOf('timeZone')` itself
 * does not include `"UTC"` (it is a special identifier, not a region/city
 * name in the IANA database), so it is always added back explicitly —
 * otherwise a workbook already on the default `UTC` would have no matching
 * entry in its own picker.
 */
export function listTimeZones(): string[] {
  const supportedValuesOf = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
  if (typeof supportedValuesOf === 'function') {
    try {
      return Array.from(new Set([DEFAULT_TIMEZONE, ...supportedValuesOf('timeZone')])).sort();
    } catch {
      // Fall through to the static fallback below.
    }
  }
  return Array.from(new Set([DEFAULT_TIMEZONE, localTimeZone()])).sort();
}

/**
 * Milliseconds to add to a UTC instant so that treating the result as UTC
 * reproduces `timeZone`'s wall-clock reading at that instant — the real,
 * DST-aware offset for that moment, not a fixed number. Returns `0` for `UTC`
 * or an unresolvable zone name (never throws).
 */
export function timeZoneOffsetMs(ms: number, timeZone: string): number {
  if (timeZone === DEFAULT_TIMEZONE) {
    return 0;
  }
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(new Date(ms));
    const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0');
    // `% 24`: some engines report hour 24 (not 0) for midnight under hourCycle 'h23'.
    const asUtc = Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      get('hour') % 24,
      get('minute'),
      get('second'),
    );
    return asUtc - ms;
  } catch {
    return 0;
  }
}
