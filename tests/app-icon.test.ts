// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * The theme-aware application icon: the header logo and the welcome-screen icon
 * use the light asset in the light theme and the dark asset in dark, follow a
 * runtime system-theme change under the "system" choice, stay decorative
 * (aria-hidden, empty alt), and keep their explicit dimensions so a theme
 * switch never shifts layout.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import iconUrl from '../src/assets/icon.svg';
import iconDarkUrl from '../src/assets/icon-dark.svg';
import { appIconUrl, createAppIcon, refreshAppIcons } from '../src/ui/app-icon';
import { applyTheme, setTheme } from '../src/app/theme';

let darkMatches = false;
const listeners = new Set<() => void>();
const sharedMql = {
  get matches() {
    return darkMatches;
  },
  media: '(prefers-color-scheme: dark)',
  addEventListener: (_t: string, fn: () => void) => listeners.add(fn),
  removeEventListener: (_t: string, fn: () => void) => listeners.delete(fn),
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
  document.body.textContent = '';
  vi.stubGlobal(
    'matchMedia',
    vi.fn((q: string) => (q.includes('dark') ? sharedMql : { ...sharedMql, matches: false })),
  );
});

describe('theme-aware application icon', () => {
  it('selects the light asset in the light theme', () => {
    setTheme('light');
    expect(appIconUrl()).toBe(iconUrl);
    const img = createAppIcon('app-icon', 20);
    expect(img.getAttribute('src')).toBe(iconUrl);
  });

  it('selects the dark asset in the dark theme', () => {
    setTheme('dark');
    expect(appIconUrl()).toBe(iconDarkUrl);
    expect(createAppIcon('app-icon', 20).getAttribute('src')).toBe(iconDarkUrl);
  });

  it('follows the system theme under the "system" choice', () => {
    setSystemDark(false);
    setTheme('system');
    const img = createAppIcon('welcome-icon', 72);
    document.body.append(img);
    expect(img.getAttribute('src')).toBe(iconUrl);
    // A runtime OS switch to dark rewrites the mounted icon in place.
    setSystemDark(true);
    expect(img.getAttribute('src')).toBe(iconDarkUrl);
    // …and back.
    setSystemDark(false);
    expect(img.getAttribute('src')).toBe(iconUrl);
  });

  it('is decorative and keeps stable dimensions across a theme switch', () => {
    setTheme('light');
    const img = createAppIcon('app-icon', 20);
    document.body.append(img);
    expect(img.getAttribute('alt')).toBe('');
    expect(img.getAttribute('aria-hidden')).toBe('true');
    expect(img.getAttribute('width')).toBe('20');
    expect(img.getAttribute('height')).toBe('20');
    setTheme('dark');
    refreshAppIcons(document);
    // The same element, re-pointed — never resized.
    expect(img.getAttribute('width')).toBe('20');
    expect(img.getAttribute('height')).toBe('20');
    expect(img.getAttribute('src')).toBe(iconDarkUrl);
  });

  it('never issues a remote request for either asset', () => {
    // Both are bundled local assets (data/relative URLs), never http(s).
    expect(iconUrl).not.toMatch(/^https?:/);
    expect(iconDarkUrl).not.toMatch(/^https?:/);
    void applyTheme;
  });
});
