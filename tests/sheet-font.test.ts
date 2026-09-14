// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  applySheetFont,
  DEFAULT_SHEET_FONT,
  getSheetFont,
  isSheetFontId,
  setSheetFont,
  SHEET_FONTS,
  SHEET_FONT_PROPERTY,
} from '../src/app/sheet-font';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.style.removeProperty(SHEET_FONT_PROPERTY);
});

describe('sheet-font preference', () => {
  it('defaults to Noto Sans JP', () => {
    expect(DEFAULT_SHEET_FONT).toBe('noto-sans-jp');
    expect(getSheetFont()).toBe('noto-sans-jp');
  });

  it('persists and reports a chosen font', () => {
    expect(setSheetFont('ms')).toBe('ms');
    expect(getSheetFont()).toBe('ms');
    expect(localStorage.getItem('refrain-csv-html.sheetFont')).toBe('ms');
  });

  it('falls back to the default for corrupt/invalid stored values', () => {
    localStorage.setItem('refrain-csv-html.sheetFont', 'comic-sans');
    expect(getSheetFont()).toBe('noto-sans-jp');
    expect(setSheetFont('nope' as never)).toBe('noto-sans-jp');
  });

  it('applies the choice as a --font-sheet override on the document root', () => {
    setSheetFont('ms-ui');
    expect(document.documentElement.style.getPropertyValue(SHEET_FONT_PROPERTY)).toBe(
      'var(--sheet-font-ms-ui)',
    );
    applySheetFont('biz-ud');
    expect(document.documentElement.style.getPropertyValue(SHEET_FONT_PROPERTY)).toBe(
      'var(--sheet-font-biz-ud)',
    );
  });

  it('recognizes exactly the six supported ids', () => {
    expect([...SHEET_FONTS]).toEqual(['biz-ud', 'ms', 'ms-ui', 'noto-sans-jp', 'meiryo-ui', 'yu-gothic-ui']);
    expect(SHEET_FONTS.every(isSheetFontId)).toBe(true);
    expect(isSheetFontId('other')).toBe(false);
  });

  it('applies the three fonts added in #396 as their own --font-sheet overrides', () => {
    applySheetFont('noto-sans-jp');
    expect(document.documentElement.style.getPropertyValue(SHEET_FONT_PROPERTY)).toBe(
      'var(--sheet-font-noto-sans-jp)',
    );
    applySheetFont('meiryo-ui');
    expect(document.documentElement.style.getPropertyValue(SHEET_FONT_PROPERTY)).toBe(
      'var(--sheet-font-meiryo-ui)',
    );
    applySheetFont('yu-gothic-ui');
    expect(document.documentElement.style.getPropertyValue(SHEET_FONT_PROPERTY)).toBe(
      'var(--sheet-font-yu-gothic-ui)',
    );
  });
});
