// SPDX-License-Identifier: MIT
/**
 * UI density preference (View > Density): compact / standard / comfortable.
 *
 * Like the theme and the spreadsheet font, the choice is an **application-level**
 * display preference stored only in `localStorage` on this device — it never
 * touches document bytes, RSF data, formulas, or calculations. It is applied
 * as one `data-density` attribute on the document root; the design system's
 * app tokens (`--bar-h`, `--statusbar-h`, `--control-h`, `--field-h`,
 * `--control-px`, `--inset`, `--stack-gap`) are keyed off it, so bars,
 * controls and fields change height with no per-element work. Density never
 * changes text size or the grid's geometry (cell size stays 104 × 24 px at
 * 100% zoom), and a coarse pointer (touch) keeps the design system's touch
 * floors whatever the choice.
 */

export type DensityChoice = 'compact' | 'standard' | 'comfortable';

/** All choices, in menu order. */
export const DENSITIES: readonly DensityChoice[] = ['compact', 'standard', 'comfortable'];

export const DEFAULT_DENSITY: DensityChoice = 'standard';

const STORAGE_KEY = 'refrain-csv-html.density';

/** The i18n label key for a density choice (localized in en/ja catalogs). */
export function densityLabelKey(id: DensityChoice): string {
  return `density.${id}`;
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

/** True for a recognized density choice. */
export function isDensityChoice(value: unknown): value is DensityChoice {
  return typeof value === 'string' && (DENSITIES as readonly string[]).includes(value);
}

/** The current density: the stored preference, or the default. */
export function getDensity(): DensityChoice {
  const stored = safeStorageGet(STORAGE_KEY);
  return isDensityChoice(stored) ? stored : DEFAULT_DENSITY;
}

/** Apply a density to the document root. Safe to call without a DOM. */
export function applyDensity(choice: DensityChoice = getDensity()): void {
  const valid = isDensityChoice(choice) ? choice : DEFAULT_DENSITY;
  globalThis.document?.documentElement.setAttribute('data-density', valid);
}

/** Persist and apply a new density (invalid values fall back to the default). */
export function setDensity(choice: DensityChoice): DensityChoice {
  const valid = isDensityChoice(choice) ? choice : DEFAULT_DENSITY;
  safeStorageSet(STORAGE_KEY, valid);
  applyDensity(valid);
  return valid;
}
