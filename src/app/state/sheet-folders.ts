// SPDX-License-Identifier: MIT
/**
 * Sheet folder operations (knowledge/ui/tabs-and-worksheet-strip.md, "Sheet
 * folders"). Each one is a single undoable history entry that swaps the
 * workbook's whole organization snapshot (`organize`), so undo restores the
 * folders, the worksheet order, and every worksheet's folder at once.
 * Deleting a folder also deletes its worksheets, through the same path as
 * deleting a worksheet (`WorksheetsState.deleteSheets`).
 */
import { isWorkbook } from '../../core/editor-document';
import type { RsfDocument } from '../../core/workbook/rsf-document';
import {
  folderSubtree,
  normalizeOrganization,
  placeAtEndOf,
  sheetsInFolder,
  type SheetOrganization,
} from '../../core/workbook/sheet-folders';
import type { AppState } from './index';
import type { Tab } from './types';
import type { WorksheetsState } from './worksheets';

export class SheetFoldersState {
  constructor(
    private readonly state: AppState,
    private readonly worksheets: WorksheetsState,
  ) {}

  /** Put a worksheet into a new folder, created where the worksheet is (so inside its current folder). */
  createFolder(tab: Tab, sheetId: string, name: string): string | null {
    const doc = workbookOf(tab);
    const sheet = doc?.sheetById(sheetId);
    if (!doc || !sheet) {
      return null;
    }
    const id = doc.mintFolderId();
    const done = this.organize(tab, doc, 'history.newFolder', (org) => {
      org.folders.push({ id, name, ...(sheet.folderId !== undefined ? { parentId: sheet.folderId } : {}) });
      org.folderOf[sheetId] = id;
      return org;
    });
    return done ? id : null;
  }

  renameFolder(tab: Tab, folderId: string, name: string): boolean {
    const doc = workbookOf(tab);
    return (
      doc !== null &&
      this.organize(tab, doc, 'history.renameFolder', (org) => {
        const folder = org.folders.find((f) => f.id === folderId);
        if (!folder || folder.name === name) {
          return null;
        }
        folder.name = name;
        return org;
      })
    );
  }

  /** Move a worksheet into a folder (at its end), or to the top level (`undefined`, staying where it is). */
  moveSheetToFolder(tab: Tab, sheetId: string, folderId: string | undefined): boolean {
    const doc = workbookOf(tab);
    return (
      doc !== null &&
      this.organize(tab, doc, 'history.moveToFolder', (org) => {
        if (!(sheetId in org.folderOf) || org.folderOf[sheetId] === folderId) {
          return null;
        }
        if (folderId !== undefined && !org.folders.some((f) => f.id === folderId)) {
          return null;
        }
        if (folderId !== undefined) {
          org.order = placeAtEndOf(org, [sheetId], folderId);
        }
        org.folderOf[sheetId] = folderId;
        return org;
      })
    );
  }

  /**
   * Put a worksheet just before or after another one (a drop in the strip),
   * joining that one's folder, as one undoable step.
   */
  placeSheet(tab: Tab, sheetId: string, targetId: string, before: boolean): boolean {
    const doc = workbookOf(tab);
    return (
      doc !== null &&
      this.organize(tab, doc, 'history.moveSheet', (org) => {
        if (sheetId === targetId || !(sheetId in org.folderOf) || !(targetId in org.folderOf)) {
          return null;
        }
        const rest = org.order.filter((id) => id !== sheetId);
        rest.splice(rest.indexOf(targetId) + (before ? 0 : 1), 0, sheetId);
        org.order = rest;
        org.folderOf[sheetId] = org.folderOf[targetId];
        return org;
      })
    );
  }

  /** Move a folder, with everything in it, into another folder or to the top level. */
  moveFolder(tab: Tab, folderId: string, parentId: string | undefined): boolean {
    const doc = workbookOf(tab);
    return (
      doc !== null &&
      this.organize(tab, doc, 'history.moveFolder', (org) => {
        const folder = org.folders.find((f) => f.id === folderId);
        // A folder can never go inside itself or one of its own folders.
        if (
          !folder ||
          folder.parentId === parentId ||
          (parentId && folderSubtree(org.folders, folderId).has(parentId))
        ) {
          return null;
        }
        if (parentId !== undefined) {
          org.order = placeAtEndOf(org, sheetsInFolder(org, folderId), parentId);
          folder.parentId = parentId;
        } else {
          delete folder.parentId;
        }
        return org;
      })
    );
  }

  /** Remove a folder but keep what is in it, which moves up one level. */
  ungroupFolder(tab: Tab, folderId: string): boolean {
    const doc = workbookOf(tab);
    return doc !== null && this.organize(tab, doc, 'history.ungroupFolder', (org) => ungroup(org, folderId));
  }

  /** Whether deleting the folder would leave the file at least one worksheet. */
  canDeleteFolder(doc: RsfDocument, folderId: string): boolean {
    return sheetsInFolder(doc.organization(), folderId).length < doc.sheetCount;
  }

  /**
   * Delete a folder, its folders, and every worksheet in them, as one
   * undoable step (formulas that pointed at them become #REF!, as for
   * deleting a worksheet). Refused when it would leave no worksheet.
   */
  deleteFolder(tab: Tab, folderId: string): boolean {
    const doc = workbookOf(tab);
    if (!doc || !doc.folders.some((f) => f.id === folderId) || !this.canDeleteFolder(doc, folderId)) {
      return false;
    }
    const before = doc.organization();
    const doomed = folderSubtree(before.folders, folderId);
    const ids = sheetsInFolder(before, folderId);
    const after = normalizeOrganization({
      folders: before.folders.filter((f) => !doomed.has(f.id)),
      order: before.order.filter((id) => !ids.includes(id)),
      folderOf: { ...before.folderOf },
    });
    return this.worksheets.deleteSheets(
      tab,
      doc,
      ids,
      [{ type: 'sheets', op: { action: 'organize', before, after } }],
      'history.deleteFolder',
    );
  }

  /** Record `change` (null = nothing to do) as one undoable organize step. */
  private organize(
    tab: Tab,
    doc: RsfDocument,
    label: string,
    change: (org: SheetOrganization) => SheetOrganization | null,
  ): boolean {
    const before = doc.organization();
    const changed = change(doc.organization());
    if (!changed) {
      return false;
    }
    const after = normalizeOrganization(changed);
    if (JSON.stringify(after) === JSON.stringify(normalizeOrganization(before))) {
      return false;
    }
    const applied = this.state.pushEntry(tab, {
      label,
      ops: [{ type: 'sheets', op: { action: 'organize', before, after } }],
    });
    if (applied) {
      this.state.emit('sheets');
    }
    return applied;
  }
}

function workbookOf(tab: Tab): RsfDocument | null {
  return isWorkbook(tab.doc) ? tab.doc : null;
}

/** `org` without `folderId`: its worksheets and folders move to its parent. */
function ungroup(org: SheetOrganization, folderId: string): SheetOrganization | null {
  const folder = org.folders.find((f) => f.id === folderId);
  if (!folder) {
    return null;
  }
  for (const id of Object.keys(org.folderOf)) {
    if (org.folderOf[id] === folderId) {
      org.folderOf[id] = folder.parentId;
    }
  }
  for (const child of org.folders) {
    if (child.parentId === folderId) {
      if (folder.parentId !== undefined) {
        child.parentId = folder.parentId;
      } else {
        delete child.parentId;
      }
    }
  }
  org.folders = org.folders.filter((f) => f !== folder);
  return org;
}
