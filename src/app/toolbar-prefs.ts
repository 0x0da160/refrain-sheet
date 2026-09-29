// SPDX-License-Identifier: MIT
/**
 * The main toolbar's settings: whether it is shown, and which commands it
 * holds in which order (View > Customize Toolbar…). Kept in this browser's
 * `localStorage` only, never in a file, so a file opens the same on every
 * device whatever toolbar each one has. Only command ids are stored: nothing
 * private, so this stays in storage even under `file://`.
 */
import type { CommandId } from './commands';
import { safeStorageGet, safeStorageRemove, safeStorageSet } from './storage';

const SHOWN_KEY = 'refrain-csv-html.toolbar';
const ITEMS_KEY = 'refrain-csv-html.toolbarItems';

/** Most commands a toolbar may hold (more are ignored). */
const MAX_TOOLBAR_ITEMS = 100;

/** The toolbar before anything is customized, and after Reset. */
export const DEFAULT_TOOLBAR_ITEMS: readonly CommandId[] = [
  'file.save',
  'edit.undo',
  'edit.redo',
  'edit.cut',
  'edit.copy',
  'edit.paste',
  'format.bold',
  'format.italic',
  'format.underline',
  'format.font',
  'format.textColor',
  'format.backgroundColor',
  'format.borders',
  'sheet.sort',
  'sheet.filter',
];

/** Whether the toolbar is shown (it is unless hidden from the View menu). */
export function getToolbarShown(): boolean {
  return safeStorageGet(SHOWN_KEY) !== 'false';
}

export function setToolbarShown(shown: boolean): void {
  if (shown) {
    safeStorageRemove(SHOWN_KEY);
  } else {
    safeStorageSet(SHOWN_KEY, 'false');
  }
}

/**
 * The commands on the toolbar, in order, as stored; the default when none
 * are stored or the stored value is unreadable. Callers skip any id they do
 * not know (one a later release removed).
 */
export function getToolbarItems(): readonly string[] {
  const raw = safeStorageGet(ITEMS_KEY);
  if (raw === null) {
    return DEFAULT_TOOLBAR_ITEMS;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const ids = parsed.filter((id): id is string => typeof id === 'string');
      return [...new Set(ids)].slice(0, MAX_TOOLBAR_ITEMS);
    }
  } catch {
    // Unreadable: fall back to the default below.
  }
  return DEFAULT_TOOLBAR_ITEMS;
}

/** Store the toolbar's commands, or (with `null`) go back to the default. */
export function setToolbarItems(ids: readonly string[] | null): void {
  if (ids === null) {
    safeStorageRemove(ITEMS_KEY);
  } else {
    safeStorageSet(ITEMS_KEY, JSON.stringify([...new Set(ids)].slice(0, MAX_TOOLBAR_ITEMS)));
  }
}
