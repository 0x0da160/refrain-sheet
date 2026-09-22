// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * The theme-aware application icon and logotype: both use the light asset in
 * the light theme and the dark asset in dark, follow a runtime system-theme
 * change under the "system" choice, and keep their explicit dimensions so a
 * theme switch never shifts layout. The plain icon (used only as the
 * narrow/mobile-width menu-bar fallback) stays decorative (aria-hidden, empty
 * alt) since the product name is stated elsewhere at that width; the
 * logotype (icon + wordmark, used everywhere else the product name appears)
 * carries a real accessible name since nothing else does.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import iconUrl from '../src/assets/icon.svg';
import iconDarkUrl from '../src/assets/icon-dark.svg';
import logotypeUrl from '../src/assets/logotype.svg';
import logotypeDarkUrl from '../src/assets/logotype-dark.svg';
import {
  appIconUrl,
  appLogotypeUrl,
  createAppIcon,
  createAppLogotype,
  refreshAppIcons,
} from '../src/ui/app-icon';
import { applyTheme, setTheme } from '../src/app/theme';
import { t } from '../src/app/i18n';

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

describe('theme-aware application logotype', () => {
  it('selects the light asset in the light theme', () => {
    setTheme('light');
    expect(appLogotypeUrl()).toBe(logotypeUrl);
    const img = createAppLogotype('app-logotype', 22);
    expect(img.getAttribute('src')).toBe(logotypeUrl);
  });

  it('selects the dark (reverse) asset in the dark theme', () => {
    setTheme('dark');
    expect(appLogotypeUrl()).toBe(logotypeDarkUrl);
    expect(createAppLogotype('app-logotype', 22).getAttribute('src')).toBe(logotypeDarkUrl);
  });

  it('follows the system theme under the "system" choice', () => {
    setSystemDark(false);
    setTheme('system');
    const img = createAppLogotype('welcome-logotype', 44);
    document.body.append(img);
    expect(img.getAttribute('src')).toBe(logotypeUrl);
    setSystemDark(true);
    expect(img.getAttribute('src')).toBe(logotypeDarkUrl);
    setSystemDark(false);
    expect(img.getAttribute('src')).toBe(logotypeUrl);
  });

  it('carries a real accessible name and derives width from the master aspect ratio', () => {
    setTheme('light');
    const img = createAppLogotype('app-logotype', 22);
    document.body.append(img);
    expect(img.getAttribute('alt')).toBe(t('app.title'));
    expect(img.hasAttribute('aria-hidden')).toBe(false);
    expect(img.getAttribute('height')).toBe('22');
    // 573.37:120 master ratio, rounded.
    expect(img.getAttribute('width')).toBe('105');
  });

  it('keeps stable dimensions across a theme switch', () => {
    setTheme('light');
    const img = createAppLogotype('app-logotype', 22);
    document.body.append(img);
    setTheme('dark');
    refreshAppIcons(document);
    expect(img.getAttribute('width')).toBe('105');
    expect(img.getAttribute('height')).toBe('22');
    expect(img.getAttribute('src')).toBe(logotypeDarkUrl);
  });

  it('never issues a remote request for either asset', () => {
    expect(logotypeUrl).not.toMatch(/^https?:/);
    expect(logotypeDarkUrl).not.toMatch(/^https?:/);
  });
});
