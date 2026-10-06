// SPDX-License-Identifier: MIT
/**
 * The worksheet strip's active marks: which tab is selected, and which
 * closed folder header stands in for the active worksheet folded inside it.
 * `SheetBar` builds them on a full render and moves them here on a plain
 * worksheet switch, so the two always agree.
 */
import { t } from '../app/i18n';
import type { RsfDocument } from '../core/workbook/rsf-document';
import { folderPath, type SheetFolder } from '../core/workbook/sheet-folders';

/** A folder header's tooltip: what a click does, and the active worksheet inside a closed folder. */
export function folderHeaderTitle(
  doc: RsfDocument,
  folder: SheetFolder,
  open: boolean,
  holdsActive: boolean,
): string {
  const title = t(open ? 'sheets.folder.close' : 'sheets.folder.open', { name: folder.name });
  return holdsActive ? `${title}\n${t('sheets.folder.holdsActive', { name: doc.activeSheet.name })}` : title;
}

/** Move the active marks in an already built strip onto `doc`'s active worksheet. */
export function markActiveSheet(strip: HTMLElement, doc: RsfDocument): void {
  for (const tabEl of strip.querySelectorAll<HTMLElement>('.sheet-tab')) {
    const active = tabEl.dataset.sheetId === doc.activeSheetId;
    tabEl.classList.toggle('active', active);
    tabEl.setAttribute('tabindex', active ? '0' : '-1');
    tabEl.setAttribute('aria-selected', active ? 'true' : 'false');
  }
  const path = folderPath(doc.folders, doc.activeSheet.folderId);
  for (const header of strip.querySelectorAll<HTMLElement>('.sheet-folder-header')) {
    const folder = doc.folders.find((f) => f.id === header.dataset.folderId);
    const open = header.getAttribute('aria-expanded') === 'true';
    const holdsActive = folder !== undefined && !open && path.includes(folder);
    header.classList.toggle('active', holdsActive);
    if (folder) {
      header.title = folderHeaderTitle(doc, folder, open, holdsActive);
    }
    if (holdsActive) {
      header.setAttribute('aria-current', 'true');
    } else {
      header.removeAttribute('aria-current');
    }
  }
}
