// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { dateStamp } from '../src/core/date-stamp';
import { pageStep } from '../src/ui/grid/page-step';

describe('pageStep', () => {
  it('moves by the rows that fit on one screen', () => {
    expect(pageStep(500, 24)).toBe(20);
    expect(pageStep(240, 24)).toBe(10);
    expect(pageStep(10, 24)).toBe(1);
  });

  it('falls back to 20 rows before the grid is laid out', () => {
    expect(pageStep(0, 24)).toBe(20);
    expect(pageStep(500, 0)).toBe(20);
  });
});

describe('dateStamp', () => {
  it('applies the timezone offset', () => {
    const utc = Date.UTC(2026, 8, 25, 23, 30);
    expect(dateStamp('date', utc, 0)).toBe('2026-09-25');
    expect(dateStamp('date', utc, 9 * 3_600_000)).toBe('2026-09-26');
    expect(dateStamp('time', utc, 9 * 3_600_000)).toBe('08:30');
  });
});
