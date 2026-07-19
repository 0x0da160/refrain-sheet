// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, DEFAULT_THEME, getTheme, isThemeChoice, resolveTheme, setTheme } from '../src/app/theme';

// One shared MediaQueryList across the file: the theme module attaches its
// `change` listener once (module-level), so a single stable mock lets the
// runtime-change tests exercise that listener. `matches` is toggled per test.
let darkMatches = false;
const listeners = new Set<() => void>();
const sharedMql = {
  get matches() {
    return darkMatches;
  },
  media: '(prefers-color-scheme: dark)',
  addEventListener: (_type: string, fn: () => void) => listeners.add(fn),
  removeEventListener: (_type: string, fn: () => void) => listeners.delete(fn),
  addListener: (fn: () => void) => listeners.add(fn),
  removeListener: (fn: () => void) => listeners.delete(fn),
  dispatchEvent: () => true,
};

function setSystemDark(value: boolean): void {
  darkMatches = value;
  for (const fn of listeners) fn();
}

beforeEach(() => {
  localStorage.clear();
  darkMatches = false;
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.style.removeProperty('color-scheme');
  vi.stubGlobal(
    'matchMedia',
    vi.fn((q: string) => (q.includes('dark') ? sharedMql : { ...sharedMql, matches: false })),
  );
});

describe('theme preference', () => {
  it('defaults new users to the system choice', () => {
    expect(DEFAULT_THEME).toBe('system');
    expect(getTheme()).toBe('system');
  });

  it('validates theme choices', () => {
    expect(isThemeChoice('dark')).toBe(true);
    expect(isThemeChoice('system')).toBe(true);
    expect(isThemeChoice('sepia')).toBe(false);
    expect(isThemeChoice(null)).toBe(false);
  });

  it('resolves the system choice through prefers-color-scheme', () => {
    setSystemDark(true);
    expect(resolveTheme('system')).toBe('dark');
    expect(resolveTheme('light')).toBe('light');
    expect(resolveTheme('dark')).toBe('dark');
  });

  it('applies an explicit choice to the document root regardless of the system', () => {
    setSystemDark(true);
    applyTheme('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(document.documentElement.style.getPropertyValue('color-scheme')).toBe('light');
    applyTheme('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('persists the chosen theme locally and resolves it on the next read', () => {
    setTheme('dark');
    expect(localStorage.getItem('refrain-csv-html.theme')).toBe('dark');
    expect(getTheme()).toBe('dark');
    applyTheme(getTheme());
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('tracks runtime system theme changes while the choice is system', () => {
    setSystemDark(false);
    applyTheme('system');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    // The OS flips to dark → the root follows with no further user action.
    setSystemDark(true);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    setSystemDark(false);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('ignores runtime system changes once an explicit theme is chosen', () => {
    applyTheme('light');
    setSystemDark(true);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
});
