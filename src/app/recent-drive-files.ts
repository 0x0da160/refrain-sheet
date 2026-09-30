// SPDX-License-Identifier: MIT

/**
 * The Google Drive half of File > Open Recent… (hosted build only): the Drive
 * files this browser last opened or saved, so one can be opened again without
 * the Picker. The app's Drive access (`drive.file`) already covers every file
 * the user picked or the app created, so reopening needs only a sign-in.
 *
 * Privacy: the list lives only in this browser's `localStorage` — a file
 * name, its Drive file id, and when it was opened — and is never sent
 * anywhere. File contents and tokens are never stored. File > Open Recent…
 * clears it together with the list of files on this device.
 */

import { safeStorageGet, safeStorageRemove, safeStorageSet } from './storage';
import { MAX_RECENT_FILES } from './recent-files';

export interface RecentDriveEntry {
  /** The Drive file id. */
  fileId: string;
  name: string;
  /** Epoch milliseconds of the last open or save. */
  openedAt: number;
}

const STORAGE_KEY = 'refrain-sheet.recentDriveFiles';

function isEntry(value: unknown): value is RecentDriveEntry {
  const v = value as Partial<RecentDriveEntry> | null;
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof v.fileId === 'string' &&
    v.fileId !== '' &&
    typeof v.name === 'string' &&
    typeof v.openedAt === 'number'
  );
}

/** Newest first. A stored value this release cannot read counts as an empty list. */
export function listRecentDriveFiles(): RecentDriveEntry[] {
  try {
    const parsed: unknown = JSON.parse(safeStorageGet(STORAGE_KEY) ?? '[]');
    return (Array.isArray(parsed) ? parsed.filter(isEntry) : []).sort((a, b) => b.openedAt - a.openedAt);
  } catch {
    return [];
  }
}

function save(entries: RecentDriveEntry[]): void {
  if (entries.length === 0) {
    safeStorageRemove(STORAGE_KEY);
  } else {
    safeStorageSet(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_RECENT_FILES)));
  }
}

/** Puts the Drive file at the top of the list, replacing its older entry. */
export function recordRecentDriveFile(fileId: string, name: string, now = Date.now()): void {
  save([{ fileId, name, openedAt: now }, ...listRecentDriveFiles().filter((e) => e.fileId !== fileId)]);
}

export function removeRecentDriveFile(fileId: string): void {
  save(listRecentDriveFiles().filter((e) => e.fileId !== fileId));
}

export function clearRecentDriveFiles(): void {
  save([]);
}
