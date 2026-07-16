// SPDX-License-Identifier: MIT
import { afterEach, describe, expect, it } from 'vitest';
import { CATALOGS, getLocale, setLocale, t } from '../src/app/i18n';

function placeholders(template: string): string[] {
  return [...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
}

describe('locale catalogs', () => {
  it('en and ja have exactly the same keys', () => {
    const enKeys = Object.keys(CATALOGS.en).sort();
    const jaKeys = Object.keys(CATALOGS.ja).sort();
    expect(jaKeys).toEqual(enKeys);
  });

  it('no catalog value is empty', () => {
    for (const catalog of Object.values(CATALOGS)) {
      for (const [key, value] of Object.entries(catalog)) {
        expect(value.length, `empty value for ${key}`).toBeGreaterThan(0);
      }
    }
  });

  it('en and ja use the same substitution placeholders per key', () => {
    for (const key of Object.keys(CATALOGS.en)) {
      expect(placeholders(CATALOGS.ja[key] ?? ''), `placeholder mismatch for ${key}`).toEqual(
        placeholders(CATALOGS.en[key]),
      );
    }
  });
});

describe('t()', () => {
  afterEach(() => setLocale('en'));

  it('translates in the current locale', () => {
    setLocale('ja');
    expect(getLocale()).toBe('ja');
    expect(t('menu.file')).toBe('ファイル');
    setLocale('en');
    expect(t('menu.file')).toBe('File');
  });

  it('falls back to English, then to the key itself', () => {
    setLocale('ja');
    // Every real key exists in both catalogs; a fabricated key must fall
    // back to the key text instead of crashing.
    expect(t('nonexistent.key')).toBe('nonexistent.key');
  });

  it('substitutes parameters', () => {
    setLocale('en');
    expect(t('status.cell', { row: 3, col: 7 })).toBe('Row 3, Col 7');
    expect(t('find.count', { matches: 5, cells: 2 })).toBe('5 matches in 2 cells');
  });

  it('leaves unknown placeholders intact', () => {
    expect(t('status.cell', { row: 1 })).toBe('Row 1, Col {col}');
  });
});
