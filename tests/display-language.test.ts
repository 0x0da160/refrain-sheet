// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { DEFAULT_DISPLAY_LANGUAGE, isValidDisplayLanguage } from '../src/core/display-language';

describe('isValidDisplayLanguage', () => {
  it('accepts the two shipped catalogs', () => {
    expect(isValidDisplayLanguage('en')).toBe(true);
    expect(isValidDisplayLanguage('ja')).toBe(true);
  });

  it('rejects anything else, including empty and unrelated strings', () => {
    expect(isValidDisplayLanguage('')).toBe(false);
    expect(isValidDisplayLanguage('fr')).toBe(false);
    expect(isValidDisplayLanguage('EN')).toBe(false); // case-sensitive, unlike TEXT()'s format tokens
  });
});

describe('DEFAULT_DISPLAY_LANGUAGE', () => {
  it('is English, the fallback for absent or unrecognized stored values', () => {
    expect(DEFAULT_DISPLAY_LANGUAGE).toBe('en');
    expect(isValidDisplayLanguage(DEFAULT_DISPLAY_LANGUAGE)).toBe(true);
  });
});
