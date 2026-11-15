// SPDX-License-Identifier: MIT
/**
 * The pivot table links of a tab: which sheet was made, or last updated, with
 * which settings (see `PivotLink` in `src/core/pivot.ts`). They are kept in
 * memory for the open session and never saved in the file. Undo and redo set
 * them through the `pivot` history operation; a tab that was just made is
 * linked directly, outside history.
 */
import type { PivotLink } from '../../core/pivot';
import type { Tab } from './types';

/** Forget every pivot table link on `tab`, for a change that replaces its content outside history. */
export function clearPivotLinks(tab: Tab): void {
  tab.pivotLinks = undefined;
}

/** Set or clear one sheet's pivot table link on `tab`. */
export function setPivotLinkOn(tab: Tab, sheetId: string, link: PivotLink | null): void {
  const links = { ...tab.pivotLinks };
  if (link) {
    links[sheetId] = link;
  } else {
    delete links[sheetId];
  }
  tab.pivotLinks = links;
}
