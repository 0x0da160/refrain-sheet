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
  it('defaults to BIZ UD Gothic', () => {
    expect(DEFAULT_SHEET_FONT).toBe('biz-ud');
    expect(getSheetFont()).toBe('biz-ud');
  });

  it('persists and reports a chosen font', () => {
    expect(setSheetFont('ms')).toBe('ms');
    expect(getSheetFont()).toBe('ms');
    expect(localStorage.getItem('refrain-csv-html.sheetFont')).toBe('ms');
  });

  it('falls back to the default for corrupt/invalid stored values', () => {
    localStorage.setItem('refrain-csv-html.sheetFont', 'comic-sans');
    expect(getSheetFont()).toBe('biz-ud');
    expect(setSheetFont('nope' as never)).toBe('biz-ud');
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

  it('recognizes exactly the three supported ids', () => {
    expect([...SHEET_FONTS]).toEqual(['biz-ud', 'ms', 'ms-ui']);
    expect(SHEET_FONTS.every(isSheetFontId)).toBe(true);
    expect(isSheetFontId('other')).toBe(false);
  });
});
