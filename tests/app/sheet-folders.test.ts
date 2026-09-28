// SPDX-License-Identifier: MIT
/** Sheet folder operations on the application state: each one undoable (src/app/state/sheet-folders.ts). */
import { describe, expect, it } from 'vitest';
import { AppState, type Tab } from '../../src/app/state';
import { RsfDocument } from '../../src/core/workbook/rsf-document';
import { buildSheetTree } from '../../src/core/workbook/sheet-folders';

function setup(names: string[] = ['A', 'B', 'C', 'D']): {
  state: AppState;
  tab: Tab;
  doc: RsfDocument;
  id: (name: string) => string;
} {
  const state = new AppState();
  const doc = RsfDocument.empty('book.rsf', 4, 3, names[0]);
  const tab = state.addTab('book.rsf', doc, null);
  for (const name of names.slice(1)) {
    state.addSheet(tab, name);
  }
  state.setActiveSheet(tab, doc.sheets[0].id);
  const id = (name: string): string => doc.sheetByName(name)!.id;
  return { state, tab, doc, id };
}

const names = (doc: RsfDocument): string[] => doc.sheets.map((s) => s.name);

describe('sheet folders', () => {
  it('creates a folder around a worksheet, nested inside the worksheet’s folder', () => {
    const { state, tab, doc, id } = setup();
    const outer = state.folders.createFolder(tab, id('B'), 'Outer')!;
    expect(doc.sheetById(id('B'))!.folderId).toBe(outer);
    const inner = state.folders.createFolder(tab, id('B'), 'Inner')!;
    expect(doc.folders.find((f) => f.id === inner)!.parentId).toBe(outer);
    expect(doc.isDirty).toBe(true);
    state.undo(tab);
    expect(doc.folders.map((f) => f.name)).toEqual(['Outer']);
    expect(doc.sheetById(id('B'))!.folderId).toBe(outer);
    state.undo(tab);
    expect(doc.folders).toEqual([]);
    expect(doc.sheetById(id('B'))!.folderId).toBeUndefined();
  });

  it('moves a worksheet to the end of a folder, and back to the top level where it is', () => {
    const { state, tab, doc, id } = setup();
    const folder = state.folders.createFolder(tab, id('A'), 'F')!;
    expect(state.folders.moveSheetToFolder(tab, id('D'), folder)).toBe(true);
    expect(names(doc)).toEqual(['A', 'D', 'B', 'C']);
    expect(state.folders.moveSheetToFolder(tab, id('A'), undefined)).toBe(true);
    // A is before the folder's remaining worksheet, so it shows first.
    expect(names(doc)).toEqual(['A', 'D', 'B', 'C']);
    expect(doc.sheetById(id('A'))!.folderId).toBeUndefined();
    state.undo(tab);
    state.undo(tab);
    expect(names(doc)).toEqual(['A', 'B', 'C', 'D']);
    expect(doc.sheetById(id('D'))!.folderId).toBeUndefined();
  });

  it('renames, moves, and ungroups a folder, never into itself', () => {
    const { state, tab, doc, id } = setup();
    const f1 = state.folders.createFolder(tab, id('A'), 'One')!;
    const f2 = state.folders.createFolder(tab, id('C'), 'Two')!;
    expect(state.folders.renameFolder(tab, f1, 'First')).toBe(true);
    expect(doc.folders.find((f) => f.id === f1)!.name).toBe('First');
    expect(state.folders.moveFolder(tab, f1, f2)).toBe(true);
    expect(state.folders.moveFolder(tab, f2, f1)).toBe(false);
    const tree = buildSheetTree(
      doc.sheets.map((s) => s.id),
      (sid) => doc.sheetById(sid)!.folderId,
      doc.folders,
    );
    expect(tree.map((n) => (n.kind === 'sheet' ? doc.sheetById(n.id)!.name : n.folder.name))).toEqual([
      'B',
      'Two',
      'D',
    ]);
    expect(state.folders.ungroupFolder(tab, f2)).toBe(true);
    expect(doc.folders.map((f) => [f.name, f.parentId])).toEqual([['First', undefined]]);
    expect(doc.sheetById(id('C'))!.folderId).toBeUndefined();
    state.undo(tab);
    expect(doc.folders.map((f) => f.name).sort()).toEqual(['First', 'Two']);
  });

  it('deletes a folder with its folders and worksheets in one undoable step', () => {
    const { state, tab, doc, id } = setup(['Main', 'Beta', 'Gamma', 'Delta']);
    doc.setCellOn(id('Main'), 0, 0, '=Beta!A1');
    doc.setCellOn(id('Main'), 0, 1, '=Gamma!A1');
    const outer = state.folders.createFolder(tab, id('Beta'), 'Outer')!;
    state.folders.moveSheetToFolder(tab, id('Gamma'), outer);
    state.folders.createFolder(tab, id('Gamma'), 'Inner');
    expect(state.folders.deleteFolder(tab, outer)).toBe(true);
    expect(names(doc)).toEqual(['Main', 'Delta']);
    expect(doc.folders).toEqual([]);
    expect([0, 1].map((c) => doc.sheetByName('Main')!.getValue(0, c))).toEqual(['=#REF!', '=#REF!']);
    state.undo(tab);
    expect(names(doc)).toEqual(['Main', 'Beta', 'Gamma', 'Delta']);
    expect(doc.folders.map((f) => f.name)).toEqual(['Outer', 'Inner']);
    expect([0, 1].map((c) => doc.sheetByName('Main')!.getValue(0, c))).toEqual(['=Beta!A1', '=Gamma!A1']);
    state.redo(tab);
    expect(names(doc)).toEqual(['Main', 'Delta']);
  });

  it('refuses to delete a folder that holds every worksheet', () => {
    const { state, tab, doc, id } = setup(['A']);
    const folder = state.folders.createFolder(tab, id('A'), 'All')!;
    expect(state.folders.canDeleteFolder(doc, folder)).toBe(false);
    expect(state.folders.deleteFolder(tab, folder)).toBe(false);
    expect(doc.sheetCount).toBe(1);
  });

  it('adds a new worksheet into the active worksheet’s folder, next to it', () => {
    const { state, tab, doc, id } = setup();
    const folder = state.folders.createFolder(tab, id('B'), 'F')!;
    state.setActiveSheet(tab, id('B'));
    const added = state.addSheet(tab, 'E')!;
    expect(added.folderId).toBe(folder);
    expect(names(doc)).toEqual(['A', 'B', 'E', 'C', 'D']);
  });

  it('keeps folders through a save and reopen, and duplicates stay in the folder', () => {
    const { state, tab, doc, id } = setup();
    const folder = state.folders.createFolder(tab, id('B'), 'F')!;
    state.duplicateSheet(tab, id('B'), 'B copy');
    const reopened = RsfDocument.fromBytes(doc.toBytes(), 'book.rsf');
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect(reopened.doc.folders).toEqual([{ id: folder, name: 'F' }]);
    expect(reopened.doc.sheets.map((s) => s.folderId)).toEqual([
      undefined,
      folder,
      folder,
      undefined,
      undefined,
    ]);
  });
});
