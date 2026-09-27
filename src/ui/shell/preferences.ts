// SPDX-License-Identifier: MIT
/**
 * Everything applied before the first paint: the UI language, the persisted
 * display preferences (sheet font, theme, density, banded rows), storage
 * hygiene, icons and viewport workarounds, and the background start of the
 * embedded WASM engines.
 */
import { applyBandedRows, getBandedRows } from '../../app/banded-rows';
import { applyDensity, getDensity } from '../../app/density';
import { getLocale, initLocale } from '../../app/i18n';
import { listRecentFiles } from '../../app/recent-files';
import { applySheetFont, getSheetFont } from '../../app/sheet-font';
import { getSqlHistory } from '../../app/sql-queries';
import { storageSharedWithOtherLocalFiles } from '../../app/storage';
import { applyTheme, getTheme } from '../../app/theme';
import { initCsvEngine } from '../../core/csv/csv-engine';
import { initSqlEngine } from '../../core/sql-engine';
import { initAppIcons } from '../app-icon';
import { installKeyboardViewportFix } from '../popup';
import { installViewportDebug } from '../viewport-debug';

export function applyInitialPreferences(): void {
  initLocale();
  document.documentElement.lang = getLocale();
  // Apply the persisted spreadsheet font before first paint (pure CSS var).
  applySheetFont(getSheetFont());
  // Resolve and apply the color theme before first paint (no flash of the
  // wrong theme); a "system" choice tracks OS changes live via matchMedia.
  applyTheme(getTheme());
  // UI density (bar and control heights), also a pure CSS attribute.
  applyDensity(getDensity());
  applyBandedRows(getBandedRows());
  // From file://, other local HTML files share this storage: the first access
  // to each list switches it to memory-only and deletes what an earlier
  // release stored there, so do that now rather than when first used.
  if (storageSharedWithOtherLocalFiles()) {
    void listRecentFiles();
    getSqlHistory();
  }
  // Keep every product-identity icon on the theme's variant, including live
  // `prefers-color-scheme` changes while the choice is "system".
  initAppIcons();
  // Works around an iOS Safari bug where the page stays visually shifted
  // upward after the on-screen keyboard closes (#402) — see
  // `installKeyboardViewportFix` for why.
  installKeyboardViewportFix();
  // Opt-in on-device diagnostics for the keyboard/viewport behavior above,
  // only with the URL hash `#debug-viewport` (#582).
  installViewportDebug();
}

/**
 * Start instantiating the embedded WASM engines in the background (decoded
 * locally from Base64 — never fetched). The UI builds and paints without
 * waiting; every code path that needs an engine awaits the same idempotent
 * promise.
 *
 * - The CSV core falls back to the identical JS engine if WASM is unavailable,
 *   and is still used for the first opened file.
 * - sql.js (SQLite/WASM) behind Data > Run SQL Query… is normally ready by
 *   the time a user opens the dialog (see src/app/commands/sql.ts).
 */
export function startEngines(): void {
  void initCsvEngine();
  void initSqlEngine();
}
