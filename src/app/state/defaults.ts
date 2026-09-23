// SPDX-License-Identifier: MIT
import { t } from '../i18n';

/**
 * Leaf-level application defaults shared by `AppState` and its state slices
 * (`src/app/state/*`). Kept in their own module so the slices never import
 * runtime values back from `app-state.ts`, which imports them.
 */

/**
 * The localized name of a workbook's first worksheet (`Sheet1` / `シート1`).
 * The core layer defaults to the English name because it must stay free of
 * i18n; every workbook created through the application passes this instead.
 */
export function defaultSheetName(): string {
  return t('sheet.defaultName', { n: 1 });
}

/** localStorage keys for the sticky first row / first column view settings. */
export const STICKY_KEY = 'refrain-csv-html.stickyFirstRow';
export const STICKY_COL_KEY = 'refrain-csv-html.stickyFirstColumn';
