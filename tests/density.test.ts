// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyDensity,
  DEFAULT_DENSITY,
  DENSITIES,
  densityLabelKey,
  getDensity,
  isDensityChoice,
  setDensity,
  type DensityChoice,
} from '../src/app/density';
import en from '../src/locales/en.json';
import ja from '../src/locales/ja.json';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-density');
});

describe('UI density preference', () => {
  it('defaults to standard when nothing is stored', () => {
    expect(DEFAULT_DENSITY).toBe('standard');
    expect(getDensity()).toBe('standard');
  });

  it('offers compact, standard and comfortable in menu order', () => {
    expect(DENSITIES).toEqual(['compact', 'standard', 'comfortable']);
  });

  it('applies the choice as data-density on the document root', () => {
    applyDensity('compact');
    expect(document.documentElement.getAttribute('data-density')).toBe('compact');
    applyDensity();
    expect(document.documentElement.getAttribute('data-density')).toBe('standard');
  });

  it('persists the choice locally and reads it back', () => {
    expect(setDensity('comfortable')).toBe('comfortable');
    expect(localStorage.getItem('refrain-csv-html.density')).toBe('comfortable');
    expect(getDensity()).toBe('comfortable');
    expect(document.documentElement.getAttribute('data-density')).toBe('comfortable');
  });

  it('falls back to the default for unknown stored or passed values', () => {
    localStorage.setItem('refrain-csv-html.density', 'spacious');
    expect(getDensity()).toBe('standard');
    expect(isDensityChoice('spacious')).toBe(false);
    expect(setDensity('huge' as DensityChoice)).toBe('standard');
  });

  it('has a localized label for every choice in both catalogs', () => {
    for (const id of DENSITIES) {
      const key = densityLabelKey(id) as keyof typeof en;
      expect(en[key]).toBeTruthy();
      expect((ja as Record<string, string>)[key]).toBeTruthy();
    }
  });
});
