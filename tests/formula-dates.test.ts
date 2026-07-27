// SPDX-License-Identifier: MIT
/**
 * The date serial system: epoch, leap years, overflow normalization, the UTC
 * timezone policy, `DATEDIF` units, and the volatile-function lifecycle.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  dateDif,
  daysInMonth,
  isLeapYear,
  isValidSerial,
  MAX_SERIAL,
  nowSerial,
  partsToSerial,
  serialToParts,
  todaySerial,
} from '../src/core/formula-date';
import { RsfDocument } from '../src/core/rsf-document';
import { VOLATILE_FUNCTIONS } from '../src/core/formula';
import { DEFAULT_TIMEZONE, localTimeZone } from '../src/core/timezone';

function evaluate(formula: string, cells: Record<string, string> = {}): string {
  const doc = RsfDocument.empty('t.rsf', 10, 6);
  for (const [ref, value] of Object.entries(cells)) {
    doc.setCell(Number(ref.slice(1)) - 1, ref.charCodeAt(0) - 65, value);
  }
  doc.setCell(9, 5, formula);
  return doc.getDisplayValue(9, 5);
}

/** The serial for a date, asserted non-null. */
function serial(year: number, month: number, day: number): number {
  const value = partsToSerial(year, month, day);
  expect(value, `${year}-${month}-${day}`).not.toBeNull();
  return value as number;
}

describe('the serial scale', () => {
  it('places the epoch at 1899-12-30 and matches spreadsheets from 1900-03-01', () => {
    expect(serial(1899, 12, 30)).toBe(0);
    expect(serial(1900, 3, 1)).toBe(61); // the conventional serial for this date
    expect(serial(2026, 7, 25)).toBe(46228);
    expect(serial(2000, 1, 1)).toBe(36526);
  });

  it('does not reproduce the fictitious 1900-02-29', () => {
    // 1900 is not a leap year on the real calendar, so 29 February rolls into
    // 1 March instead of existing as its own day.
    expect(isLeapYear(1900)).toBe(false);
    expect(serial(1900, 2, 29)).toBe(serial(1900, 3, 1));
  });

  it('round-trips calendar fields', () => {
    for (const [y, m, d] of [
      [1900, 1, 1],
      [1999, 12, 31],
      [2000, 2, 29],
      [2026, 7, 25],
      [9999, 12, 31],
    ] as const) {
      const parts = serialToParts(serial(y, m, d));
      expect(parts, `${y}-${m}-${d}`).not.toBeNull();
      expect(parts).toMatchObject({ year: y, month: m, day: d });
    }
  });

  it('bounds the representable range', () => {
    expect(isValidSerial(-1)).toBe(false);
    expect(isValidSerial(0)).toBe(true);
    expect(isValidSerial(MAX_SERIAL)).toBe(true);
    expect(isValidSerial(MAX_SERIAL + 1)).toBe(false);
    expect(partsToSerial(1899, 12, 29)).toBeNull();
    expect(partsToSerial(10000, 1, 1)).toBeNull();
    expect(partsToSerial(-1, 1, 1)).toBeNull();
  });

  it('handles leap years on the proleptic Gregorian calendar', () => {
    expect(isLeapYear(2000)).toBe(true);
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2100)).toBe(false);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2023, 2)).toBe(28);
    expect(daysInMonth(2024, 4)).toBe(30);
  });

  it('reads the time of day from the fractional part', () => {
    const noon = serial(2026, 7, 25) + 0.5;
    expect(serialToParts(noon)).toMatchObject({ day: 25, hours: 12, minutes: 0, seconds: 0 });
    const almost = serial(2026, 7, 25) + 0.9999999;
    expect(serialToParts(almost)?.day).toBe(25);
  });
});

describe('DATE normalization', () => {
  it('remaps two-digit years into the 1900s', () => {
    expect(evaluate('=YEAR(DATE(24,1,1))')).toBe('1924');
    expect(evaluate('=YEAR(DATE(0,3,1))')).toBe('1900');
    expect(evaluate('=YEAR(DATE(2024,1,1))')).toBe('2024');
  });

  it('rolls month and day overflow into neighbouring months and years', () => {
    expect(evaluate('=YEAR(DATE(2020,13,1))')).toBe('2021');
    expect(evaluate('=MONTH(DATE(2020,13,1))')).toBe('1');
    expect(evaluate('=MONTH(DATE(2020,0,1))')).toBe('12');
    expect(evaluate('=YEAR(DATE(2020,0,1))')).toBe('2019');
    expect(evaluate('=MONTH(DATE(2020,1,32))')).toBe('2');
    // The conventional "last day of the month" idiom.
    expect(evaluate('=DAY(DATE(2020,3,0))')).toBe('29'); // 2020 is a leap year
    expect(evaluate('=DAY(DATE(2021,3,0))')).toBe('28');
  });

  it('reports an out-of-range date as #NUM!', () => {
    // 1899 is inside the two-digit-year window, so DATE(1899,1,1) means the
    // year 3799 — a valid date. A 1899 calendar date cannot be written with
    // DATE at all, which is a property of the function, not of the scale.
    expect(evaluate('=YEAR(DATE(1899,1,1))')).toBe('3799');
    expect(evaluate('=DATE(10000,1,1)')).toBe('#NUM!');
    expect(evaluate('=DATE(-1,1,1)')).toBe('#NUM!');
    expect(evaluate('=DATE(1900,1,-40)')).toBe('#NUM!'); // rolls before the epoch
    expect(evaluate('=YEAR(-1)')).toBe('#NUM!');
    expect(evaluate('=MONTH(99999999)')).toBe('#NUM!');
  });
});

describe('DATEDIF', () => {
  const d = (y: number, m: number, day: number): number => serial(y, m, day);

  it('counts elapsed days', () => {
    expect(dateDif(d(2020, 1, 1), d(2020, 1, 31), 'D')).toBe(30);
    expect(dateDif(d(2020, 1, 1), d(2020, 1, 1), 'D')).toBe(0);
  });

  it('counts complete years and months', () => {
    expect(dateDif(d(2020, 1, 31), d(2021, 1, 30), 'Y')).toBe(0); // one day short
    expect(dateDif(d(2020, 1, 31), d(2021, 1, 31), 'Y')).toBe(1);
    expect(dateDif(d(2020, 1, 31), d(2021, 3, 1), 'Y')).toBe(1);
    expect(dateDif(d(2020, 1, 15), d(2020, 4, 14), 'M')).toBe(2);
    expect(dateDif(d(2020, 1, 15), d(2020, 4, 15), 'M')).toBe(3);
  });

  it('supports YM, YD, and MD without producing a negative result', () => {
    expect(dateDif(d(2020, 1, 15), d(2022, 4, 20), 'YM')).toBe(3);
    expect(dateDif(d(2020, 1, 15), d(2022, 4, 20), 'MD')).toBe(5);
    // 2022-01-15 (the last anniversary) to 2022-04-20 is 16 + 28 + 31 + 20.
    expect(dateDif(d(2020, 1, 15), d(2022, 4, 20), 'YD')).toBe(95);
    // A month-end start is where Excel's MD is known to go negative.
    expect(dateDif(d(2020, 1, 31), d(2020, 3, 1), 'MD')).toBeGreaterThanOrEqual(0);
    expect(dateDif(d(2020, 1, 31), d(2020, 3, 1), 'MD')).toBe(1);
  });

  it('rejects reversed ranges and unknown units', () => {
    expect(dateDif(d(2021, 1, 1), d(2020, 1, 1), 'D')).toBeNull();
    expect(evaluate('=DATEDIF(DATE(2021,1,1),DATE(2020,1,1),"D")')).toBe('#NUM!');
    expect(evaluate('=DATEDIF(DATE(2020,1,1),DATE(2021,1,1),"Q")')).toBe('#VALUE!');
    expect(evaluate('=DATEDIF(DATE(2020,1,1),DATE(2021,1,1),"y")')).toBe('1'); // case-insensitive
  });
});

describe('the UTC timezone policy', () => {
  it('computes the same serial regardless of the host timezone', () => {
    // Every conversion goes through Date.UTC / getUTC*, so a serial is a pure
    // function of its calendar fields. Building the same date via two paths
    // that a local-time implementation would disagree on must agree here.
    const viaFields = serial(2026, 7, 25);
    const viaOverflow = serial(2026, 6, 55); // 25 July expressed as 55 June
    expect(viaOverflow).toBe(viaFields);
    const parts = serialToParts(viaFields);
    expect(parts).toMatchObject({ year: 2026, month: 7, day: 25 });
  });

  it('TODAY and NOW read the clock as UTC', () => {
    const noon2026 = Date.UTC(2026, 6, 25, 12, 0, 0);
    expect(todaySerial(noon2026)).toBe(serial(2026, 7, 25));
    expect(nowSerial(noon2026)).toBeCloseTo(serial(2026, 7, 25) + 0.5, 9);
    // Just before UTC midnight is still the same UTC day, whatever the host's
    // local date happens to be.
    expect(todaySerial(Date.UTC(2026, 6, 25, 23, 59, 59))).toBe(serial(2026, 7, 25));
    expect(todaySerial(Date.UTC(2026, 6, 26, 0, 0, 0))).toBe(serial(2026, 7, 26));
  });
});

describe('the workbook timezone', () => {
  afterEach(() => vi.useRealTimers());

  it('defaults a new workbook to the local timezone and a loaded one with none stored to UTC', () => {
    const fresh = RsfDocument.empty('t.rsf', 2, 2);
    expect(fresh.timezone).toBe(localTimeZone());

    const bytes = RsfDocument.empty('t.rsf', 2, 2).toBytes();
    const reloaded = RsfDocument.fromBytes(bytes, 't.rsf');
    expect(reloaded.ok).toBe(true);
    if (reloaded.ok) expect(reloaded.doc.timezone).toBe(DEFAULT_TIMEZONE);
  });

  it('ignores an unresolvable zone name and a no-op change to the current zone', () => {
    const doc = RsfDocument.empty('t.rsf', 2, 2);
    const before = doc.timezone;
    doc.setTimezone('Not/AZone');
    expect(doc.timezone).toBe(before);
    doc.setTimezone(before);
    expect(doc.timezone).toBe(before);
  });

  it('shifts TODAY()/NOW() to the stored zone and recalculates without dirtying the document', () => {
    vi.useFakeTimers();
    // 2026-01-01T23:00:00Z: still Jan 1 in UTC, already Jan 2 in Asia/Tokyo (UTC+9).
    vi.setSystemTime(Date.UTC(2026, 0, 1, 23, 0, 0));
    const doc = RsfDocument.empty('t.rsf', 2, 2);
    doc.setTimezone(DEFAULT_TIMEZONE);
    doc.setCell(0, 0, '=TODAY()');
    const utcToday = partsToSerial(2026, 0 + 1, 1);
    expect(Number(doc.getDisplayValue(0, 0))).toBe(utcToday);

    doc.markSaved();
    doc.setTimezone('Asia/Tokyo');
    expect(doc.timezone).toBe('Asia/Tokyo');
    expect(doc.isDirty).toBe(false); // changes no cell input, like Recalculate
    const tokyoToday = partsToSerial(2026, 0 + 1, 2);
    expect(Number(doc.getDisplayValue(0, 0))).toBe(tokyoToday);
  });

  it('round-trips a saved timezone through toBytes()/fromBytes()', () => {
    const doc = RsfDocument.empty('t.rsf', 2, 2);
    doc.setTimezone('Asia/Tokyo');
    const reloaded = RsfDocument.fromBytes(doc.toBytes(), 't.rsf');
    expect(reloaded.ok).toBe(true);
    if (reloaded.ok) expect(reloaded.doc.timezone).toBe('Asia/Tokyo');
  });
});

describe('volatile functions', () => {
  it('marks exactly TODAY and NOW as volatile', () => {
    expect([...VOLATILE_FUNCTIONS].sort()).toEqual(['NOW', 'TODAY']);
  });

  it('agree with each other within one recalculation', () => {
    const doc = RsfDocument.empty('t.rsf', 5, 5);
    doc.setCell(0, 0, '=TODAY()');
    doc.setCell(0, 1, '=TODAY()');
    doc.setCell(0, 2, '=NOW()');
    expect(doc.getDisplayValue(0, 0)).toBe(doc.getDisplayValue(0, 1));
    expect(Math.floor(Number(doc.getDisplayValue(0, 2)))).toBe(Number(doc.getDisplayValue(0, 0)));
  });

  it('hold still until an edit or an explicit recalculation', () => {
    const doc = RsfDocument.empty('t.rsf', 5, 5);
    doc.setCell(0, 0, '=NOW()');
    const first = doc.getDisplayValue(0, 0);
    // Reading again does not advance the clock: there is no timer.
    expect(doc.getDisplayValue(0, 0)).toBe(first);
    expect(doc.getDisplayValue(0, 0)).toBe(first);
    // recalculate() is the explicit path and must not dirty the document.
    doc.markSaved();
    doc.recalculate();
    expect(doc.isDirty).toBe(false);
    expect(Number(doc.getDisplayValue(0, 0))).toBeGreaterThanOrEqual(Number(first));
  });
});
