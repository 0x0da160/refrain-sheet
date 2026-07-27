// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TIMEZONE,
  isValidTimeZone,
  listTimeZones,
  localTimeZone,
  timeZoneOffsetMs,
} from '../src/core/timezone';

describe('isValidTimeZone', () => {
  it('accepts UTC and real IANA zone names', () => {
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Asia/Tokyo')).toBe(true);
    expect(isValidTimeZone('America/New_York')).toBe(true);
  });

  it('rejects empty, non-string, and unresolvable names', () => {
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone('Not/AZone')).toBe(false);
    expect(isValidTimeZone(undefined as unknown as string)).toBe(false);
    expect(isValidTimeZone(42 as unknown as string)).toBe(false);
  });
});

describe('localTimeZone', () => {
  it('returns a name Intl itself resolves', () => {
    expect(isValidTimeZone(localTimeZone())).toBe(true);
  });
});

describe('listTimeZones', () => {
  it('includes UTC and the local zone, sorted with no duplicates', () => {
    const zones = listTimeZones();
    expect(zones).toContain(DEFAULT_TIMEZONE);
    expect(zones).toContain(localTimeZone());
    expect(zones).toEqual([...zones].sort());
    expect(new Set(zones).size).toBe(zones.length);
  });
});

describe('timeZoneOffsetMs', () => {
  it('is always zero for UTC', () => {
    expect(timeZoneOffsetMs(Date.UTC(2026, 6, 25, 12, 0, 0), 'UTC')).toBe(0);
    expect(timeZoneOffsetMs(0, 'UTC')).toBe(0);
  });

  it('reproduces a fixed, DST-free offset (Asia/Tokyo, UTC+9)', () => {
    const noonUtc = Date.UTC(2026, 6, 25, 12, 0, 0);
    const offset = timeZoneOffsetMs(noonUtc, 'Asia/Tokyo');
    expect(offset).toBe(9 * 60 * 60 * 1000);
  });

  it('is not thrown by, and returns 0 for, an unresolvable zone name', () => {
    expect(timeZoneOffsetMs(Date.now(), 'Not/AZone')).toBe(0);
  });

  it('shifts the wall-clock reading so treating the result as UTC matches the zone', () => {
    const ms = Date.UTC(2026, 0, 1, 3, 30, 0); // 2026-01-01T03:30:00Z
    const offset = timeZoneOffsetMs(ms, 'Asia/Tokyo');
    const shifted = new Date(ms + offset);
    expect(shifted.getUTCFullYear()).toBe(2026);
    expect(shifted.getUTCMonth()).toBe(0);
    expect(shifted.getUTCDate()).toBe(1);
    expect(shifted.getUTCHours()).toBe(12); // 03:30 UTC + 9h = 12:30 JST
    expect(shifted.getUTCMinutes()).toBe(30);
  });
});
