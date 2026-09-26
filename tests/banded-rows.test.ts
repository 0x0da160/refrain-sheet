// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { applyBandedRows, getBandedRows, setBandedRows } from '../src/app/banded-rows';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-banded-rows');
});

describe('banded rows preference', () => {
  it('is off by default (design system: bands compete with user fills)', () => {
    expect(getBandedRows()).toBe(false);
    applyBandedRows();
    expect(document.documentElement.hasAttribute('data-banded-rows')).toBe(false);
  });

  it('persists on this device and reflects on the document root', () => {
    setBandedRows(true);
    expect(localStorage.getItem('refrain-csv-html.bandedRows')).toBe('1');
    expect(getBandedRows()).toBe(true);
    expect(document.documentElement.hasAttribute('data-banded-rows')).toBe(true);
    setBandedRows(false);
    expect(getBandedRows()).toBe(false);
    expect(document.documentElement.hasAttribute('data-banded-rows')).toBe(false);
  });
});
