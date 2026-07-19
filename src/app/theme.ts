// SPDX-License-Identifier: MIT
/**
 * Color-theme preference (light / dark / follow the system).
 *
 * The choice is an **application-level** preference stored only in
 * `localStorage` — it never touches document bytes, RCSV data, formulas, or
 * calculations; it is pure display state. The resolved theme is applied by
 * setting a single `data-theme` attribute (`"light"` or `"dark"`) plus the
 * matching `color-scheme` on the document root; every surface reads its colors
 * from CSS custom properties keyed off that attribute (see `styles.css`), so no
 * per-element work is needed.
 *
 * When the choice is `"system"` the resolved theme follows
 * `prefers-color-scheme`, and a `matchMedia` listener re-applies it live when
 * the OS/browser theme changes. Nothing is ever sent anywhere.
 */

export type ThemeChoice = 'system' | 'light' | 'dark';

/** All choices, in menu order. */
export const THEMES: readonly ThemeChoice[] = ['system', 'light', 'dark'];

/** New users follow the operating-system / browser preference. */
export const DEFAULT_THEME: ThemeChoice = 'system';

const STORAGE_KEY = 'refrain-csv-html.theme';

/** The i18n label key for a theme choice (localized in en/ja catalogs). */
export function themeLabelKey(id: ThemeChoice): string {
  return `theme.${id}`;
}

function safeStorageGet(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function safeStorageSet(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // Storage may be unavailable (private mode, file:// restrictions); the
    // preference simply is not persisted. Nothing is ever sent anywhere.
  }
}

/** True for a recognized theme choice. */
export function isThemeChoice(value: unknown): value is ThemeChoice {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}

/** The current theme choice: the stored preference, or the default. */
export function getTheme(): ThemeChoice {
  const stored = safeStorageGet(STORAGE_KEY);
  return isThemeChoice(stored) ? stored : DEFAULT_THEME;
}

function darkMedia(): MediaQueryList | null {
  return typeof globalThis.matchMedia === 'function'
    ? globalThis.matchMedia('(prefers-color-scheme: dark)')
    : null;
}

/** Resolve a choice to a concrete theme; `"system"` follows `prefers-color-scheme`. */
export function resolveTheme(choice: ThemeChoice): 'light' | 'dark' {
  if (choice === 'system') {
    return darkMedia()?.matches ? 'dark' : 'light';
  }
  return choice;
}

let currentChoice: ThemeChoice = DEFAULT_THEME;
let mediaListenerAttached = false;

function applyResolved(): void {
  const root = globalThis.document?.documentElement;
  if (!root) {
    return;
  }
  const resolved = resolveTheme(currentChoice);
  root.setAttribute('data-theme', resolved);
  // Hint native form controls / scrollbars to match, alongside the CSS tokens.
  root.style.setProperty('color-scheme', resolved);
}

/**
 * Apply a theme to the document root. Attaches a one-time `matchMedia`
 * listener so a `"system"` choice tracks OS/browser theme changes at runtime.
 * Safe to call without a DOM (non-DOM tests): it simply does nothing visible.
 */
export function applyTheme(choice: ThemeChoice = getTheme()): void {
  currentChoice = isThemeChoice(choice) ? choice : DEFAULT_THEME;
  if (!mediaListenerAttached) {
    const media = darkMedia();
    if (media) {
      const onSystemChange = (): void => {
        if (currentChoice === 'system') {
          applyResolved();
        }
      };
      if (typeof media.addEventListener === 'function') {
        media.addEventListener('change', onSystemChange);
      } else if (typeof (media as { addListener?: (fn: () => void) => void }).addListener === 'function') {
        // Safari < 14 / older engines.
        (media as { addListener: (fn: () => void) => void }).addListener(onSystemChange);
      }
      mediaListenerAttached = true;
    }
  }
  applyResolved();
}

/** Persist and apply a new theme choice (invalid values fall back to the default). */
export function setTheme(choice: ThemeChoice): ThemeChoice {
  const valid = isThemeChoice(choice) ? choice : DEFAULT_THEME;
  safeStorageSet(STORAGE_KEY, valid);
  applyTheme(valid);
  return valid;
}
