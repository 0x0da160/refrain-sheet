// SPDX-License-Identifier: MIT
/**
 * The precedence of layered display settings (zoom, wrap long rows).
 *
 * A setting can be specified at three levels, from narrowest to broadest:
 * the worksheet, the file (an RSF workbook), and this browser. Every level is
 * optional — "not specified" defers to the next one — and the **narrowest
 * level that specifies a value wins**, in {@link SETTING_PRECEDENCE} order, so
 * the browser level acts as this browser's default. When no level specifies
 * anything, the caller's fallback (the value last used in this browser)
 * applies.
 *
 * Pure and DOM-free: callers read each level from wherever it lives and pass
 * the values in.
 */

/** Where an effective setting came from. */
export type SettingSource = 'browser' | 'file' | 'sheet' | 'default';

/** Levels in precedence order: an earlier level beats every later one. */
export const SETTING_PRECEDENCE = ['sheet', 'file', 'browser'] as const;

/** The value each level specifies; `undefined` means "not specified". */
export type SettingLayers<T> = Partial<Record<(typeof SETTING_PRECEDENCE)[number], T>>;

/** The effective value of a layered setting and the level it came from. */
export interface ResolvedSetting<T> {
  value: T;
  source: SettingSource;
}

/** Resolve a layered setting: the first specified level wins, else `fallback`. */
export function resolveSetting<T>(layers: SettingLayers<T>, fallback: T): ResolvedSetting<T> {
  for (const level of SETTING_PRECEDENCE) {
    const value = layers[level];
    if (value !== undefined) {
      return { value, source: level };
    }
  }
  return { value: fallback, source: 'default' };
}
