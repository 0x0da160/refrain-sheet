// SPDX-License-Identifier: MIT
/**
 * Sheet folders: named, nestable groups of a workbook's worksheets
 * (knowledge/ui/tabs-and-worksheet-strip.md, "Sheet folders"). A worksheet
 * sits in at most one folder (`Worksheet.folderId`); a folder sits in at most
 * one parent folder. The worksheets' own order stays the one canonical order
 * (what cross-sheet features and older readers see); the tree is derived
 * from it, so a folder shows where its first worksheet is, and an empty
 * folder shows after its parent's other items.
 */

/** One folder. `parentId` absent means the top level. */
export interface SheetFolder {
  id: string;
  name: string;
  parentId?: string;
}

/**
 * Everything a folder operation changes, as one value: the folders, the
 * worksheet order, and each worksheet's folder. Undo swaps a whole snapshot
 * back, so every folder operation is one atomic history step.
 */
export interface SheetOrganization {
  folders: SheetFolder[];
  /** Worksheet ids in order. */
  order: string[];
  /** Each worksheet's folder id (`undefined` = top level), keyed by worksheet id. */
  folderOf: Record<string, string | undefined>;
}

/** An item of the derived tree: a worksheet, or a folder with its items. */
export type SheetTreeNode =
  { kind: 'sheet'; id: string } | { kind: 'folder'; folder: SheetFolder; children: SheetTreeNode[] };

/** At most this many folders in a workbook (the same bound as worksheets). */
export const MAX_SHEET_FOLDERS = 256;

/**
 * A folder's ancestors, outermost first, ending with the folder itself.
 * Stops at an unknown or repeated id, so a malformed list cannot loop.
 */
export function folderPath(folders: readonly SheetFolder[], folderId: string | undefined): SheetFolder[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const path: SheetFolder[] = [];
  const seen = new Set<string>();
  let current = folderId === undefined ? undefined : byId.get(folderId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current);
    current = current.parentId === undefined ? undefined : byId.get(current.parentId);
  }
  return path;
}

/** `folderId` and every folder nested inside it, at any depth. */
export function folderSubtree(folders: readonly SheetFolder[], folderId: string): Set<string> {
  const ids = new Set<string>([folderId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const folder of folders) {
      if (folder.parentId !== undefined && ids.has(folder.parentId) && !ids.has(folder.id)) {
        ids.add(folder.id);
        grew = true;
      }
    }
  }
  return ids;
}

/** Whether the parent links form no cycle and name only known folders. */
export function isValidFolderTree(folders: readonly SheetFolder[]): boolean {
  const ids = new Set(folders.map((f) => f.id));
  if (ids.size !== folders.length) {
    return false;
  }
  for (const folder of folders) {
    if (folder.parentId !== undefined && !ids.has(folder.parentId)) {
      return false;
    }
    if (depthByWalk(folders, folder.id) === Infinity) {
      return false;
    }
  }
  return true;
}

/** Steps from a folder up to the top level, or Infinity on a cycle. */
function depthByWalk(folders: readonly SheetFolder[], folderId: string): number {
  const byId = new Map(folders.map((f) => [f.id, f]));
  let depth = 0;
  let current = byId.get(folderId);
  while (current) {
    depth += 1;
    if (depth > folders.length) {
      return Infinity;
    }
    current = current.parentId === undefined ? undefined : byId.get(current.parentId);
  }
  return depth;
}

/** The tree the worksheet strip shows (see the module comment). */
export function buildSheetTree(
  order: readonly string[],
  folderOf: (sheetId: string) => string | undefined,
  folders: readonly SheetFolder[],
): SheetTreeNode[] {
  const root: SheetTreeNode[] = [];
  const nodes = new Map<string, Extract<SheetTreeNode, { kind: 'folder' }>>();
  const childrenOf = (path: SheetFolder[]): SheetTreeNode[] => {
    let children = root;
    for (const folder of path) {
      let node = nodes.get(folder.id);
      if (!node) {
        node = { kind: 'folder', folder, children: [] };
        nodes.set(folder.id, node);
        children.push(node);
      }
      children = node.children;
    }
    return children;
  };
  for (const id of order) {
    childrenOf(folderPath(folders, folderOf(id))).push({ kind: 'sheet', id });
  }
  for (const folder of folders) {
    childrenOf(folderPath(folders, folder.id));
  }
  return root;
}

/** The worksheet ids of a tree, in the order it shows them. */
function treeSheetOrder(nodes: readonly SheetTreeNode[]): string[] {
  const out: string[] = [];
  for (const node of nodes) {
    if (node.kind === 'sheet') {
      out.push(node.id);
    } else {
      out.push(...treeSheetOrder(node.children));
    }
  }
  return out;
}

/** The worksheets inside a folder, at any depth, in order. */
export function sheetsInFolder(org: SheetOrganization, folderId: string): string[] {
  const inside = folderSubtree(org.folders, folderId);
  return org.order.filter((id) => {
    const folder = org.folderOf[id];
    return folder !== undefined && inside.has(folder);
  });
}

/**
 * Reorders `org.order` to the tree's order, so each folder's worksheets are
 * next to one another and the canonical order matches what the strip shows.
 * Every folder operation ends with this.
 */
export function normalizeOrganization(org: SheetOrganization): SheetOrganization {
  const known = new Set(org.folders.map((f) => f.id));
  const folderOf: Record<string, string | undefined> = {};
  for (const id of org.order) {
    const folder = org.folderOf[id];
    folderOf[id] = folder !== undefined && known.has(folder) ? folder : undefined;
  }
  const tree = buildSheetTree(org.order, (id) => folderOf[id], org.folders);
  return { folders: org.folders, order: treeSheetOrder(tree), folderOf };
}

/**
 * Moves `ids` (kept in their current order) to just after the last worksheet
 * inside `folderId`. When the folder holds none of the others, the worksheets
 * stay where they are.
 */
export function placeAtEndOf(org: SheetOrganization, ids: readonly string[], folderId: string): string[] {
  const moving = new Set(ids);
  const rest = org.order.filter((id) => !moving.has(id));
  const inside = sheetsInFolder({ ...org, order: rest }, folderId);
  if (inside.length === 0) {
    return org.order.slice();
  }
  const at = rest.indexOf(inside[inside.length - 1]) + 1;
  const block = org.order.filter((id) => moving.has(id));
  return [...rest.slice(0, at), ...block, ...rest.slice(at)];
}
