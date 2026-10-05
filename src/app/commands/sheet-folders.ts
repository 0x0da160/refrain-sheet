// SPDX-License-Identifier: MIT
/**
 * Sheet folder commands: the dialogs around `SheetFoldersState`
 * (knowledge/ui/tabs-and-worksheet-strip.md, "Sheet folders"). The Sheet
 * menu acts on the active worksheet; a folder's own context menu in the
 * worksheet strip acts on that folder.
 */
import type { FolderPickerOption, NotifyPort, WorksheetDialogsPort } from '../ui-port';
import { isWorkbook } from '../../core/editor-document';
import { MAX_SHEET_NAME_LENGTH } from '../../core/formula';
import type { RsfDocument } from '../../core/workbook/rsf-document';
import {
  buildSheetTree,
  folderSubtree,
  MAX_SHEET_FOLDERS,
  sheetsInFolder,
  type SheetTreeNode,
} from '../../core/workbook/sheet-folders';
import type { AppState, Tab } from '../state';
import { t } from '../i18n';

/** What a folder's context menu can do to it. */
export type FolderAction = 'rename' | 'move' | 'ungroup' | 'delete';

export class SheetFolderCommands {
  constructor(
    private readonly state: AppState,
    private readonly ui: WorksheetDialogsPort & NotifyPort,
  ) {}

  /** Put the active worksheet into a new folder, asking for its name. */
  async newFolder(tab: Tab): Promise<void> {
    const doc = workbook(tab);
    if (!doc) {
      return;
    }
    if (doc.folders.length >= MAX_SHEET_FOLDERS) {
      this.ui.notify(t('notify.tooManyFolders', { max: MAX_SHEET_FOLDERS }), 'warn');
      return;
    }
    const sheet = doc.activeSheet;
    const name = await this.ui.promptFolderName('create', t('sheets.folder.defaultName'), validateFolderName);
    if (name !== null && tab.doc === doc) {
      this.state.folders.createFolder(tab, sheet.id, name);
    }
  }

  /** Create an empty folder, asking for its name; worksheets are dragged into it. */
  async createFolder(tab: Tab): Promise<void> {
    const doc = workbook(tab);
    if (!doc) {
      return;
    }
    if (doc.folders.length >= MAX_SHEET_FOLDERS) {
      this.ui.notify(t('notify.tooManyFolders', { max: MAX_SHEET_FOLDERS }), 'warn');
      return;
    }
    const name = await this.ui.promptFolderName('create', t('sheets.folder.defaultName'), validateFolderName);
    if (name !== null && tab.doc === doc) {
      this.state.folders.createEmptyFolder(tab, name);
    }
  }

  /** Move the active worksheet into a folder, or to the top level. */
  async moveSheetToFolder(tab: Tab): Promise<void> {
    const doc = workbook(tab);
    if (!doc) {
      return;
    }
    const sheet = doc.activeSheet;
    const result = await this.ui.chooseFolder({
      subject: 'sheet',
      name: sheet.name,
      options: folderOptions(doc, new Set()),
      current: sheet.folderId ?? null,
    });
    if (result && tab.doc === doc) {
      this.state.folders.moveSheetToFolder(tab, sheet.id, result.folderId ?? undefined);
    }
  }

  /** Drop a worksheet onto a folder in the strip. */
  dropSheetOnFolder(tab: Tab, sheetId: string, folderId: string): boolean {
    return this.state.folders.moveSheetToFolder(tab, sheetId, folderId);
  }

  /**
   * Rename folder `folderId` to `name`, typed on its header. Returns what is
   * wrong with the name (nothing changes), or null once renamed or unchanged.
   */
  renameFolderTo(tab: Tab, folderId: string, name: string): string | null {
    const problem = validateFolderName(name);
    if (problem === null) {
      this.state.folders.renameFolder(tab, folderId, name.trim());
    }
    return problem;
  }

  /** Run one of a folder's context-menu actions. */
  async folderAction(tab: Tab, action: FolderAction, folderId: string): Promise<void> {
    const doc = workbook(tab);
    const folder = doc?.folders.find((f) => f.id === folderId);
    if (!doc || !folder) {
      return;
    }
    switch (action) {
      case 'rename': {
        const name = await this.ui.promptFolderName('rename', folder.name, validateFolderName);
        if (name !== null && tab.doc === doc) {
          this.state.folders.renameFolder(tab, folderId, name);
        }
        return;
      }
      case 'move': {
        const result = await this.ui.chooseFolder({
          subject: 'folder',
          name: folder.name,
          options: folderOptions(doc, folderSubtree(doc.folders, folderId)),
          current: folder.parentId ?? null,
        });
        if (result && tab.doc === doc) {
          this.state.folders.moveFolder(tab, folderId, result.folderId ?? undefined);
        }
        return;
      }
      case 'ungroup':
        this.state.folders.ungroupFolder(tab, folderId);
        return;
      case 'delete':
        await this.deleteFolder(tab, doc, folderId, folder.name);
        return;
    }
  }

  private async deleteFolder(tab: Tab, doc: RsfDocument, folderId: string, name: string): Promise<void> {
    if (!this.state.folders.canDeleteFolder(doc, folderId)) {
      this.ui.notify(t('notify.cannotDeleteAllSheets'), 'warn');
      return;
    }
    const count = sheetsInFolder(doc.organization(), folderId).length;
    const ok = await this.ui.confirm(
      t('dialog.deleteFolder.title'),
      t('dialog.deleteFolder.message', { name, count }),
      t('dialog.deleteFolder.ok'),
      t('dialog.deleteFolder.cancel'),
    );
    if (ok && tab.doc === doc && this.state.folders.deleteFolder(tab, folderId)) {
      this.ui.notify(t('notify.folderDeleted', { name }), 'info');
    }
  }
}

function workbook(tab: Tab): RsfDocument | null {
  return isWorkbook(tab.doc) ? tab.doc : null;
}

/** A folder name must have text and fit the worksheet-name length. */
function validateFolderName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return t('sheets.folder.error.empty');
  }
  if (trimmed.length > MAX_SHEET_NAME_LENGTH) {
    return t('sheet.error.tooLong', { max: MAX_SHEET_NAME_LENGTH });
  }
  return null;
}

/** The top level, then every folder in the order the strip shows them, leaving out `exclude`. */
function folderOptions(doc: RsfDocument, exclude: ReadonlySet<string>): FolderPickerOption[] {
  const options: FolderPickerOption[] = [{ id: null, name: t('sheets.folder.topLevel'), depth: 0 }];
  const walk = (nodes: readonly SheetTreeNode[], depth: number): void => {
    for (const node of nodes) {
      if (node.kind === 'folder' && !exclude.has(node.folder.id)) {
        options.push({ id: node.folder.id, name: node.folder.name, depth });
        walk(node.children, depth + 1);
      }
    }
  };
  walk(
    buildSheetTree(
      doc.sheets.map((s) => s.id),
      (id) => doc.sheetById(id)?.folderId,
      doc.folders,
    ),
    0,
  );
  return options;
}
