// SPDX-License-Identifier: MIT

/**
 * The recently opened files list (File > Open Recent…). Each entry keeps the
 * File System Access API handle the file was opened or saved through, so the
 * app can read it again later without a picker — only browsers with that API
 * (Chromium-based) ever record anything; a file opened through a plain
 * `<input type="file">` or a drop without a handle has nothing to reopen.
 *
 * Privacy: the list lives only in this browser's IndexedDB for this origin —
 * a file name, the opaque handle, and when it was opened — and is never sent
 * anywhere. File contents are never stored. File > Open Recent… can clear it,
 * and reopening still asks the browser for read permission each session.
 */

export interface RecentFileEntry {
  id: string;
  name: string;
  /** Epoch milliseconds of the last open or save. */
  openedAt: number;
  handle: FileSystemFileHandle;
}

/** Where the list is kept; swappable so tests can run without IndexedDB. */
export interface RecentFilesStore {
  load(): Promise<RecentFileEntry[]>;
  save(entries: RecentFileEntry[]): Promise<void>;
}

/** How many files the list remembers. */
export const MAX_RECENT_FILES = 10;

const DB_NAME = 'refrain-sheet';
const DB_VERSION = 1;
const STORE_NAME = 'recent-files';
const LIST_KEY = 'list';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('indexedDB.open failed'));
  });
}

/** The list as one IndexedDB record (handles are structured-cloneable). */
class IndexedDbRecentFilesStore implements RecentFilesStore {
  async load(): Promise<RecentFileEntry[]> {
    const db = await openDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(LIST_KEY);
        request.onsuccess = () =>
          resolve(Array.isArray(request.result) ? (request.result as RecentFileEntry[]) : []);
        request.onerror = () => reject(request.error ?? new Error('read failed'));
      });
    } finally {
      db.close();
    }
  }

  async save(entries: RecentFileEntry[]): Promise<void> {
    const db = await openDatabase();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(entries, LIST_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('write failed'));
      });
    } finally {
      db.close();
    }
  }
}

/** A list kept in memory only: used where IndexedDB is missing, and by tests. */
export class MemoryRecentFilesStore implements RecentFilesStore {
  private entries: RecentFileEntry[] = [];

  async load(): Promise<RecentFileEntry[]> {
    return [...this.entries];
  }

  async save(entries: RecentFileEntry[]): Promise<void> {
    this.entries = [...entries];
  }
}

let store: RecentFilesStore | null = null;

function currentStore(): RecentFilesStore {
  store ??= typeof indexedDB === 'undefined' ? new MemoryRecentFilesStore() : new IndexedDbRecentFilesStore();
  return store;
}

/** Replaces the backing store (tests). */
export function setRecentFilesStore(next: RecentFilesStore): void {
  store = next;
}

async function loadSafely(): Promise<RecentFileEntry[]> {
  try {
    return await currentStore().load();
  } catch {
    return []; // storage blocked or corrupt: behave as an empty list
  }
}

async function saveSafely(entries: RecentFileEntry[]): Promise<void> {
  try {
    await currentStore().save(entries);
  } catch {
    // Storage blocked (e.g. a private window): the list just isn't kept.
  }
}

async function sameEntry(a: FileSystemFileHandle, b: FileSystemFileHandle): Promise<boolean> {
  if (a === b) {
    return true;
  }
  try {
    return typeof a.isSameEntry === 'function' && (await a.isSameEntry(b));
  } catch {
    return false;
  }
}

/** Newest first. */
export async function listRecentFiles(): Promise<RecentFileEntry[]> {
  const entries = await loadSafely();
  return entries.sort((a, b) => b.openedAt - a.openedAt);
}

/**
 * Puts `handle` at the top of the list (replacing an older entry for the
 * same file) and trims the list to `MAX_RECENT_FILES`.
 */
export async function recordRecentFile(
  handle: FileSystemFileHandle,
  name: string,
  now = Date.now(),
): Promise<void> {
  const entries = await listRecentFiles();
  const kept: RecentFileEntry[] = [];
  for (const entry of entries) {
    if (!(await sameEntry(entry.handle, handle))) {
      kept.push(entry);
    }
  }
  const id = `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  kept.unshift({ id, name, openedAt: now, handle });
  await saveSafely(kept.slice(0, MAX_RECENT_FILES));
}

export async function removeRecentFile(id: string): Promise<void> {
  const entries = await listRecentFiles();
  await saveSafely(entries.filter((entry) => entry.id !== id));
}

export async function clearRecentFiles(): Promise<void> {
  await saveSafely([]);
}

interface PermissionCapableHandle {
  queryPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
}

/**
 * Makes sure the browser lets the app read `handle` again. A stored handle
 * loses its permission when the page reloads, so this usually shows the
 * browser's own prompt; it must run from a user gesture.
 */
export async function ensureReadPermission(handle: FileSystemFileHandle): Promise<boolean> {
  const h = handle as FileSystemFileHandle & PermissionCapableHandle;
  try {
    if (
      typeof h.queryPermission === 'function' &&
      (await h.queryPermission({ mode: 'read' })) === 'granted'
    ) {
      return true;
    }
    if (typeof h.requestPermission === 'function') {
      return (await h.requestPermission({ mode: 'read' })) === 'granted';
    }
    // No permission API (older builds): let the read itself decide.
    return true;
  } catch {
    return false;
  }
}
