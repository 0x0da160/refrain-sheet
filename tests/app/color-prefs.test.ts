// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  getFavoriteColors,
  getRecentColors,
  MAX_RECENT_COLORS,
  rememberColor,
  toggleFavoriteColor,
} from '../../src/app/color-prefs';

describe('color picker memory', () => {
  beforeEach(() => localStorage.clear());

  it('keeps recent colors newest first, without repeats, up to the limit', () => {
    rememberColor('#AABBCC');
    rememberColor('#112233');
    rememberColor('#aabbcc');
    expect(getRecentColors()).toEqual(['#aabbcc', '#112233']);
    for (let i = 0; i < MAX_RECENT_COLORS + 3; i++) {
      rememberColor(`#0000${i.toString(16).padStart(2, '0')}`);
    }
    expect(getRecentColors()).toHaveLength(MAX_RECENT_COLORS);
  });

  it('toggles favorites and ignores anything that is not a color', () => {
    expect(toggleFavoriteColor('#123456')).toBe(true);
    expect(toggleFavoriteColor('not a color')).toBe(false);
    expect(getFavoriteColors()).toEqual(['#123456']);
    expect(toggleFavoriteColor('#123456')).toBe(false);
    expect(getFavoriteColors()).toEqual([]);
  });

  it('reads damaged storage as empty', () => {
    localStorage.setItem('refrain-csv-html.recentColors', '{oops');
    localStorage.setItem('refrain-csv-html.favoriteColors', JSON.stringify(['#abc', 1, '#a1b2c3']));
    expect(getRecentColors()).toEqual([]);
    expect(getFavoriteColors()).toEqual(['#a1b2c3']);
  });
});
