// SPDX-License-Identifier: MIT
/**
 * The `.rsf` keys that place a worksheet in the strip: a worksheet's
 * `tabColor` and `folder`, and the file's `folders` list
 * (knowledge/formats/rsf/json-document.md). `rsf-codec.ts` calls these to
 * read and write them; like every key there, a known key with the wrong
 * shape fails the whole file.
 */
import { normalizeHexColor } from './cell-style';
import { isValidFolderTree, MAX_SHEET_FOLDERS, type SheetFolder } from './sheet-folders';

/** The placement fields of a worksheet record. */
export interface RsfSheetPlacement {
  /** `#rrggbb`, lowercase. */
  tabColor?: string;
  /** The id of the folder the worksheet is in; absent = top level. */
  folderId?: string;
}

/** The file's folders; absent or empty when it has none. */
export interface RsfFolderList {
  folders?: SheetFolder[];
}

const MAX_ID_LENGTH = 255;
/** The same bound as a worksheet name. */
const MAX_FOLDER_NAME_BYTES = 400;

/** Fails the file: `bad-shape`, or the given reason. */
type Fail = (reason?: 'too-large') => never;

function id(value: unknown, fail: Fail): string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH ? value : fail();
}

/** A worksheet's `tabColor` and `folder`, for its JSON object. */
export function placementToJson(sheet: RsfSheetPlacement): { tabColor?: string; folder?: string } {
  const out: { tabColor?: string; folder?: string } = {};
  if (sheet.tabColor !== undefined) out.tabColor = sheet.tabColor;
  if (sheet.folderId !== undefined) out.folder = sheet.folderId;
  return out;
}

/** Reads a worksheet's `tabColor` and `folder`. Whether the folder exists is checked with the file's list. */
export function placementFromJson(value: { [key: string]: unknown }, fail: Fail): RsfSheetPlacement {
  const out: RsfSheetPlacement = {};
  if (value.tabColor !== undefined) {
    out.tabColor = (typeof value.tabColor === 'string' ? normalizeHexColor(value.tabColor) : null) ?? fail();
  }
  if (value.folder !== undefined) out.folderId = id(value.folder, fail);
  return out;
}

/** The file's `folders` key, left out when it has none. */
export function foldersToJson(data: RsfFolderList): {
  folders?: Array<{ id: string; name: string; parent?: string }>;
} {
  if (!data.folders || data.folders.length === 0) {
    return {};
  }
  const folders = data.folders.slice(0, MAX_SHEET_FOLDERS).map((folder) => ({
    id: folder.id,
    name: folder.name,
    ...(folder.parentId !== undefined ? { parent: folder.parentId } : {}),
  }));
  return { folders };
}

/**
 * Reads the file's `folders` and checks every worksheet's `folder` against
 * it: ids unique, every parent and every worksheet's folder known, no
 * folder inside itself. Anything else fails the file.
 */
export function foldersFromJson(
  value: unknown,
  sheets: readonly RsfSheetPlacement[],
  fail: Fail,
): RsfFolderList {
  if (value === undefined) {
    return sheets.some((s) => s.folderId !== undefined) ? fail() : {};
  }
  if (!Array.isArray(value)) {
    return fail();
  }
  if (value.length > MAX_SHEET_FOLDERS) {
    return fail('too-large');
  }
  const folders = value.map((raw: unknown): SheetFolder => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return fail();
    }
    const entry = raw as { [key: string]: unknown };
    const name = entry.name;
    if (
      typeof name !== 'string' ||
      name.trim() === '' ||
      new TextEncoder().encode(name).length > MAX_FOLDER_NAME_BYTES
    ) {
      return fail();
    }
    const folder: SheetFolder = { id: id(entry.id, fail), name };
    if (entry.parent !== undefined) folder.parentId = id(entry.parent, fail);
    return folder;
  });
  const ids = new Set(folders.map((f) => f.id));
  if (!isValidFolderTree(folders) || sheets.some((s) => s.folderId !== undefined && !ids.has(s.folderId))) {
    return fail();
  }
  return folders.length > 0 ? { folders } : {};
}
