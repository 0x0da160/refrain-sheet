// SPDX-License-Identifier: MIT
/**
 * The RSF date and time serial system.
 *
 * ## The scale
 *
 * A date is a **number**, not a distinct value kind: serial `n` is `n` days
 * after the epoch, and the fractional part is the time of day (`0.5` is noon).
 * That makes `=A1+7` mean "a week later" with no special cases.
 *
 * - **Epoch:** serial `0` is **1899-12-30T00:00:00Z**.
 * - **Calendar:** proleptic Gregorian, so every year divisible by 100 but not
 *   400 is a common year.
 * - **Range:** serial `0` … {@link MAX_SERIAL} (9999-12-31). Anything outside
 *   is `#NUM!`.
 *
 * That epoch is chosen for interoperability: it makes RSF serials **identical
 * to Excel and Google Sheets for every date from 1900-03-01 onward**, which is
 * every date anyone writes. It deliberately does **not** reproduce Excel's
 * fictitious 1900-02-29, so for the 60 days from 1899-12-31 to 1900-02-28 an
 * RSF serial is exactly one greater than the Excel serial for the same date.
 * A workbook is self-consistent either way; only pasting a raw serial number
 * across applications is affected, and only in that 60-day window.
 *
 * ## Timezone policy
 *
 * **Every conversion in this module is UTC.** There is no host-timezone or DST
 * input anywhere, so `DATE`, `YEAR`, `MONTH`, `DAY`, and `DATEDIF` return the
 * same answer on every machine, and a `.rsf` file computes the same values
 * wherever it is opened. `TODAY()` and `NOW()` read the host clock but convert
 * it as UTC, so "today" means the current UTC date. In a UTC+9 morning that is
 * the previous local calendar day — a deliberate trade of local intuition for
 * a workbook that cannot change meaning when it travels. Display and
 * localization are a separate concern and are documented in
 * `docs/rsf-format.md`.
 *
 * ## Volatility
 *
 * `TODAY()` and `NOW()` are volatile: their value depends on the clock, not on
 * any cell. See `formula-functions.ts` for how the engine bounds their
 * recalculation — there is no background timer.
 */

/** Milliseconds in one day. */
export const MS_PER_DAY = 86_400_000;

/**
 * Epoch offset in milliseconds: `Date.UTC(1899, 11, 30)`. Serial `n` is
 * `EPOCH_MS + n * MS_PER_DAY`.
 */
export const EPOCH_MS = Date.UTC(1899, 11, 30);

/** Smallest representable serial (the epoch itself). */
export const MIN_SERIAL = 0;

/** Largest representable serial: 9999-12-31T00:00:00Z. */
export const MAX_SERIAL = (Date.UTC(9999, 11, 31) - EPOCH_MS) / MS_PER_DAY;

/** Exclusive upper bound including the last day's time-of-day fraction. */
export const MAX_SERIAL_EXCLUSIVE = MAX_SERIAL + 1;

/** True when a serial is inside the representable range. */
export function isValidSerial(serial: number): boolean {
  return Number.isFinite(serial) && serial >= MIN_SERIAL && serial < MAX_SERIAL_EXCLUSIVE;
}

/** Calendar fields of a serial, all UTC. */
export interface DateParts {
  year: number;
  /** 1-12. */
  month: number;
  /** 1-31. */
  day: number;
  hours: number;
  minutes: number;
  seconds: number;
}

/**
 * Split a serial into UTC calendar fields, or null when out of range.
 *
 * The date part is taken from `floor(serial)` so a serial carrying a time of
 * day still reports the calendar day it falls on.
 */
export function serialToParts(serial: number): DateParts | null {
  if (!isValidSerial(serial)) {
    return null;
  }
  const days = Math.floor(serial);
  const date = new Date(EPOCH_MS + days * MS_PER_DAY);
  // Time of day from the fraction, rounded to the nearest second so that
  // accumulated floating-point error cannot report 11:59:59 for noon.
  const secondsOfDay = Math.round((serial - days) * 86_400);
  const clamped = Math.min(secondsOfDay, 86_399);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hours: Math.floor(clamped / 3600),
    minutes: Math.floor((clamped % 3600) / 60),
    seconds: clamped % 60,
  };
}

/**
 * Build a serial from UTC calendar fields, or null when the result falls
 * outside the representable range.
 *
 * The year is taken **literally** — see {@link remapShortYear} for the
 * separate two-digit-year rule the `DATE` function applies first. Month and
 * day values outside their normal ranges roll into adjacent months and years:
 *
 * - `partsToSerial(2020, 13, 1)` is 2021-01-01,
 * - `partsToSerial(2020, 0, 1)` is 2019-12-01,
 * - `partsToSerial(2020, 1, 32)` is 2020-02-01,
 * - `partsToSerial(2020, 3, 0)` is 2020-02-29.
 *
 * Rolling over rather than rejecting is what makes `DATE(y, m + 1, 0)` — the
 * conventional "last day of month `m`" idiom — work.
 */
export function partsToSerial(year: number, month: number, day: number): number | null {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }
  const y = Math.trunc(year);
  const m = Math.trunc(month);
  const d = Math.trunc(day);
  // Normalize the month into a year offset before touching Date, so the
  // calculation never depends on Date's own two-digit-year remapping.
  const monthIndex = m - 1;
  const yearShift = Math.floor(monthIndex / 12);
  const normalizedMonth = monthIndex - yearShift * 12;
  const targetYear = y + yearShift;
  if (targetYear < 0 || targetYear > 9999) {
    return null;
  }
  const date = new Date(0);
  date.setUTCFullYear(targetYear, normalizedMonth, d);
  date.setUTCHours(0, 0, 0, 0);
  const serial = (date.getTime() - EPOCH_MS) / MS_PER_DAY;
  return isValidSerial(serial) ? serial : null;
}

/**
 * The `DATE` function's year rule, applied before {@link partsToSerial}:
 * a year of `0 … 1899` means `1900 + year`, so `DATE(24, 1, 1)` is 1924-01-01
 * and `DATE(1899, 1, 1)` is 3799-01-01. A year of `1900 … 9999` is used as
 * written; anything else is invalid and returns null.
 *
 * This lives apart from `partsToSerial` because it is a quirk of one
 * function's argument handling, not a property of the serial scale — mixing
 * the two would make it impossible to convert a real 1899 date at all.
 */
export function remapShortYear(year: number): number | null {
  if (!Number.isFinite(year)) {
    return null;
  }
  const y = Math.trunc(year);
  if (y < 0 || y > 9999) {
    return null;
  }
  return y < 1900 ? y + 1900 : y;
}

/** Serial for a UTC date-time in milliseconds since the Unix epoch. */
export function millisToSerial(ms: number): number {
  return (ms - EPOCH_MS) / MS_PER_DAY;
}

/** The current UTC date as a whole-day serial (`TODAY()`). */
export function todaySerial(nowMs: number): number {
  return Math.floor(millisToSerial(nowMs));
}

/**
 * The current UTC date and time as a serial (`NOW()`), truncated to whole
 * seconds so two `NOW()` calls in the same recalculation agree.
 */
export function nowSerial(nowMs: number): number {
  return millisToSerial(Math.floor(nowMs / 1000) * 1000);
}

/** Units accepted by `DATEDIF`. */
export type DateDifUnit = 'Y' | 'M' | 'D' | 'YM' | 'YD' | 'MD';

/** True when `unit` (already upper-cased) is a supported `DATEDIF` unit. */
export function isDateDifUnit(unit: string): unit is DateDifUnit {
  return unit === 'Y' || unit === 'M' || unit === 'D' || unit === 'YM' || unit === 'YD' || unit === 'MD';
}

/**
 * `DATEDIF` for two whole-day serials, or null when the inputs are invalid or
 * reversed (`end` before `start`).
 *
 * The unit definitions, all counting **complete** periods:
 *
 * | Unit | Meaning                                                                |
 * | ---- | ---------------------------------------------------------------------- |
 * | `D`  | Elapsed whole days, `end - start`.                                     |
 * | `Y`  | Complete years; the anniversary must have been reached.                |
 * | `M`  | Complete months; the same day-of-month must have been reached.         |
 * | `YM` | Complete months ignoring years — always `0 … 11`.                      |
 * | `YD` | Days since the last anniversary of `start` on or before `end`.         |
 * | `MD` | Days since the last month-day of `start` on or before `end`.           |
 *
 * `MD` and `YD` are computed by *advancing the start date* to the last
 * anniversary that does not pass `end` and taking the day difference. That is
 * well defined for every input, including month-end starts: it never produces
 * the negative results Excel's `MD` is known for.
 */
export function dateDif(startSerial: number, endSerial: number, unit: DateDifUnit): number | null {
  const start = serialToParts(Math.floor(startSerial));
  const end = serialToParts(Math.floor(endSerial));
  if (!start || !end) {
    return null;
  }
  const startDay = Math.floor(startSerial);
  const endDay = Math.floor(endSerial);
  if (endDay < startDay) {
    return null;
  }
  if (unit === 'D') {
    return endDay - startDay;
  }
  // Complete months between the two dates: whole month steps, minus one when
  // the day-of-month has not been reached yet in the final month.
  const rawMonths = (end.year - start.year) * 12 + (end.month - start.month);
  const completeMonths = end.day < start.day ? rawMonths - 1 : rawMonths;
  switch (unit) {
    case 'Y':
      return Math.floor(completeMonths / 12);
    case 'M':
      return completeMonths;
    case 'YM':
      return ((completeMonths % 12) + 12) % 12;
    case 'YD': {
      const years = Math.floor(completeMonths / 12);
      const anniversary = advanceMonths(start, years * 12);
      return anniversary === null ? null : endDay - anniversary;
    }
    case 'MD': {
      const anniversary = advanceMonths(start, completeMonths);
      return anniversary === null ? null : endDay - anniversary;
    }
  }
}

/**
 * The serial of `parts` moved forward by `months`, clamping the day to the
 * target month's length (so 31 January plus one month is 28/29 February, not
 * a rolled-over 2/3 March). Used only by `DATEDIF`'s `YD` / `MD`.
 */
function advanceMonths(parts: DateParts, months: number): number | null {
  const monthIndex = parts.month - 1 + months;
  const yearShift = Math.floor(monthIndex / 12);
  const targetMonth = monthIndex - yearShift * 12;
  const targetYear = parts.year + yearShift;
  const lastDay = daysInMonth(targetYear, targetMonth + 1);
  return partsToSerial(targetYear, targetMonth + 1, Math.min(parts.day, lastDay));
}

/** Days in a 1-based month of a proleptic-Gregorian year. */
export function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/** Proleptic-Gregorian leap year test. */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}
