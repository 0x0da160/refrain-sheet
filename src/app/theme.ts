// SPDX-License-Identifier: MIT
/**
 * Color-theme preference (light / dark / follow the system).
 *
 * The choice is an **application-level** preference stored only in
 * `localStorage` — it never touches document bytes, RSF data, formulas, or
 * calculations; it is pure display state. The resolved theme is applied by
 * setting a single `data-theme` attribute (`"light"` or `"dark"`) plus the
 * matching `color-scheme` on the document root; every surface reads its colors
 * from CSS custom properties keyed off that attribute (see `styles.css`), so no
 * per-element work is needed.
 *
 * When the choice is `"system"` the resolved theme follows
 * `prefers-color-scheme`, and a `matchMedia` listener re-applies it live when
 * the OS/browser theme changes. Nothing is ever sent anywhere.
 *
 * `"hybrid"` resolves the document root the same way `"system"` does (so the
 * UI chrome still follows the OS/browser preference), but also tags the root
 * with `data-theme-choice="hybrid"`; `styles.css` uses that tag to force the
 * spreadsheet/grid area back to its light colors whenever the resolved theme
 * is dark, independent of the rest of the UI (#363).
 */

export type ThemeChoice = 'system' | 'light' | 'dark' | 'hybrid';

/** All choices, in menu order. */
export const THEMES: readonly ThemeChoice[] = ['system', 'light', 'dark', 'hybrid'];

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

/**
 * Resolve a choice to a concrete theme for the document root; `"system"` and
 * `"hybrid"` both follow `prefers-color-scheme` (hybrid's grid-stays-light
 * behavior is a CSS override on top of this, not a different root theme).
 */
export function resolveTheme(choice: ThemeChoice): 'light' | 'dark' {
  if (choice === 'system' || choice === 'hybrid') {
    return darkMedia()?.matches ? 'dark' : 'light';
  }
  return choice;
}

let currentChoice: ThemeChoice = DEFAULT_THEME;
let mediaListenerAttached = false;

/**
 * Observers of the **resolved** theme (`"light"` / `"dark"`). Almost every
 * surface reacts through CSS custom properties keyed off `data-theme` and
 * needs nothing here; this exists for the few things CSS cannot express — the
 * theme-specific application icon, whose `src` is a different asset per theme
 * (see `src/ui/app-icon.ts`). Notified for explicit switches *and* for
 * `prefers-color-scheme` changes while the choice is `"system"`.
 */
const resolvedListeners = new Set<(resolved: 'light' | 'dark') => void>();
let lastNotified: 'light' | 'dark' | null = null;

/**
 * Observe the resolved theme. The callback fires whenever the resolved value
 * actually changes (never on a no-op re-apply). Returns an unsubscribe
 * function.
 */
export function onResolvedThemeChange(fn: (resolved: 'light' | 'dark') => void): () => void {
  resolvedListeners.add(fn);
  return () => {
    resolvedListeners.delete(fn);
  };
}

function applyResolved(): void {
  const resolved = resolveTheme(currentChoice);
  const root = globalThis.document?.documentElement;
  if (root) {
    root.setAttribute('data-theme', resolved);
    // Lets styles.css scope the hybrid grid-stays-light override to exactly
    // the active choice, without affecting "system" (#363).
    root.setAttribute('data-theme-choice', currentChoice);
    // Hint native form controls / scrollbars to match, alongside the CSS tokens.
    root.style.setProperty('color-scheme', resolved);
  }
  if (resolved !== lastNotified) {
    lastNotified = resolved;
    for (const fn of resolvedListeners) {
      fn(resolved);
    }
  }
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
