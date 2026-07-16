// SPDX-License-Identifier: MIT
import en from '../locales/en.json';
import ja from '../locales/ja.json';

export type LocaleId = 'en' | 'ja';

export const CATALOGS: Record<LocaleId, Record<string, string>> = { en, ja };

const STORAGE_KEY = 'refrain-csv-html.locale';

let current: LocaleId = 'en';
const listeners = new Set<() => void>();

function safeLocalStorageGet(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function safeLocalStorageSet(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // Storage may be unavailable (private mode, file:// restrictions); the
    // language preference simply is not persisted. Nothing is ever sent
    // anywhere.
  }
}

/** Pick the initial locale: stored preference first, then browser language (Japanese preferred in Japanese environments). */
export function initLocale(): LocaleId {
  const stored = safeLocalStorageGet(STORAGE_KEY);
  if (stored === 'en' || stored === 'ja') {
    current = stored;
    return current;
  }
  const lang = globalThis.navigator?.language ?? '';
  current = lang.toLowerCase().startsWith('ja') ? 'ja' : 'en';
  return current;
}

export function getLocale(): LocaleId {
  return current;
}

export function setLocale(locale: LocaleId): void {
  if (locale === current) {
    return;
  }
  current = locale;
  safeLocalStorageSet(STORAGE_KEY, locale);
  for (const fn of listeners) {
    fn();
  }
}

export function onLocaleChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Translate a key with `{param}` substitution. Missing keys fall back to
 * English, then to the key itself.
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const template = CATALOGS[current][key] ?? CATALOGS.en[key] ?? key;
  if (!params) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole,
  );
}
