// SPDX-License-Identifier: MIT
/**
 * The pivot table links of a tab: which sheet was made, or last updated, with
 * which settings (see `PivotLink` in `src/core/pivot.ts`). A link to a worksheet
 * of the file is kept on that worksheet (its `pivot` key), so it is saved with
 * the file and reopens with it. A link to a CSV tab is kept in `tab.pivotLinks`
 * for the open session only. Undo and redo set them through the `pivot` history
 * operation; a tab that was just made is linked directly, outside history.
 */
import { workbookOf } from '../../core/editor-document';
import type { PivotLink, PivotRecord } from '../../core/pivot';
import type { Tab } from './types';

/** The link on one sheet of `tab`, if it has one. */
export function pivotLinkOn(tab: Tab, sheetId: string): PivotLink | null {
  const session = tab.pivotLinks?.[sheetId];
  if (session) {
    return session;
  }
  const record = workbookOf(tab.doc)?.sheetById(sheetId)?.pivot;
  return record ? { ...record, request: { ...record.request }, sourceTabId: tab.id } : null;
}

/**
 * Set or clear one sheet's pivot table link on `tab`. A link to a worksheet of
 * the file goes on that worksheet; a link to a CSV tab stays in the session.
 */
export function setPivotLinkOn(tab: Tab, sheetId: string, link: PivotLink | null): void {
  const doc = workbookOf(tab.doc);
  if (doc && (link === null || link.sourceId !== 'csv')) {
    if (doc.sheetById(sheetId)) {
      doc.setPivotOn(sheetId, link ? recordOf(link) : null);
    }
    setSessionLink(tab, sheetId, null);
    return;
  }
  setSessionLink(tab, sheetId, link);
}

/**
 * Forget every session-only pivot table link on `tab`, for a change that replaces
 * its content outside history. Links saved with a worksheet stay: an update
 * checks them against the cells before it writes.
 */
export function clearPivotLinks(tab: Tab): void {
  tab.pivotLinks = undefined;
}

function setSessionLink(tab: Tab, sheetId: string, link: PivotLink | null): void {
  const links = { ...tab.pivotLinks };
  if (link) {
    links[sheetId] = link;
  } else {
    delete links[sheetId];
  }
  tab.pivotLinks = links;
}

/** A link as a file keeps it: the same fields, without the open tab it reads. */
function recordOf(link: PivotLink): PivotRecord {
  return {
    sourceId: link.sourceId,
    request: { ...link.request },
    rows: link.rows,
    cols: link.cols,
    digest: link.digest,
  };
}
