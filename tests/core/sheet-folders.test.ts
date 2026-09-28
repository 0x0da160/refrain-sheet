// SPDX-License-Identifier: MIT
/** The sheet-folder tree derived from the worksheet order (src/core/workbook/sheet-folders.ts). */
import { describe, expect, it } from 'vitest';
import {
  buildSheetTree,
  folderSubtree,
  isValidFolderTree,
  normalizeOrganization,
  placeAtEndOf,
  sheetsInFolder,
  type SheetFolder,
  type SheetOrganization,
} from '../../src/core/workbook/sheet-folders';

const folders: SheetFolder[] = [
  { id: 'f1', name: 'Sales' },
  { id: 'f2', name: '2026', parentId: 'f1' },
  { id: 'f3', name: 'Empty' },
];

function org(order: string[], folderOf: Record<string, string | undefined>): SheetOrganization {
  return { folders, order, folderOf };
}

describe('sheet folder tree', () => {
  it('shows a folder where its first worksheet is and an empty folder last', () => {
    const tree = buildSheetTree(['a', 'b', 'c', 'd'], (id) => ({ b: 'f2', c: 'f1' })[id], folders);
    expect(tree).toEqual([
      { kind: 'sheet', id: 'a' },
      {
        kind: 'folder',
        folder: folders[0],
        children: [
          { kind: 'folder', folder: folders[1], children: [{ kind: 'sheet', id: 'b' }] },
          { kind: 'sheet', id: 'c' },
        ],
      },
      { kind: 'sheet', id: 'd' },
      { kind: 'folder', folder: folders[2], children: [] },
    ]);
  });

  it('gathers a folder’s worksheets next to one another when normalized', () => {
    const normalized = normalizeOrganization(org(['a', 'b', 'c', 'd'], { a: 'f1', c: 'f1', d: 'f9' }));
    expect(normalized.order).toEqual(['a', 'c', 'b', 'd']);
    // A folder id that names no folder means the top level.
    expect(normalized.folderOf.d).toBeUndefined();
  });

  it('lists a folder’s worksheets at any depth and its nested folders', () => {
    const o = org(['a', 'b', 'c'], { a: 'f2', b: 'f1' });
    expect(sheetsInFolder(o, 'f1')).toEqual(['a', 'b']);
    expect([...folderSubtree(folders, 'f1')].sort()).toEqual(['f1', 'f2']);
  });

  it('places worksheets after the last one in a folder', () => {
    const o = org(['a', 'b', 'c', 'd'], { a: 'f1', b: 'f1' });
    expect(placeAtEndOf(o, ['d'], 'f1')).toEqual(['a', 'b', 'd', 'c']);
    // An empty folder: the worksheet stays where it is.
    expect(placeAtEndOf(o, ['d'], 'f3')).toEqual(['a', 'b', 'c', 'd']);
  });

  it('rejects unknown parents, duplicates, and cycles', () => {
    expect(isValidFolderTree(folders)).toBe(true);
    expect(isValidFolderTree([{ id: 'f1', name: 'A', parentId: 'x' }])).toBe(false);
    expect(
      isValidFolderTree([
        { id: 'f1', name: 'A' },
        { id: 'f1', name: 'B' },
      ]),
    ).toBe(false);
    expect(
      isValidFolderTree([
        { id: 'f1', name: 'A', parentId: 'f2' },
        { id: 'f2', name: 'B', parentId: 'f1' },
      ]),
    ).toBe(false);
  });
});
