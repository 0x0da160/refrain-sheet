// SPDX-License-Identifier: MIT
/**
 * Local persistence for the SQL query dialog (`src/ui/dialogs/sql.ts`):
 * recent run history and named saved queries. Stored only in
 * `localStorage`, device-local, and never embedded in an exported CSV or RSF
 * workbook — the same application-preference pattern as `settings.ts` /
 * `sheet-font.ts`. Storage may be unavailable (private browsing, `file://`
 * restrictions, quota exceeded); every read is defensive, so corrupt or
 * missing storage contents simply fall back to an empty list rather than
 * throwing.
 */

import { safeStorageGet, safeStorageSet } from './storage';

/** One past query run, most-recent-first in {@link getSqlHistory}. */
export interface SqlHistoryEntry {
  query: string;
  sourceId: string;
  sourceName: string;
  /** `Date.now()` at the time the query was run. */
  ranAt: number;
}

/** One named, user-saved query. */
export interface SqlSavedQuery {
  id: string;
  name: string;
  query: string;
  sourceId: string;
  /** `Date.now()` at the time the query was saved. */
  savedAt: number;
}

const HISTORY_KEY = 'refrain-csv-html.sqlHistory';
const SAVED_KEY = 'refrain-csv-html.sqlSavedQueries';

/** Oldest history entries beyond this count are dropped. */
export const SQL_MAX_HISTORY_ENTRIES = 50;
/** Saved queries beyond this count are refused (the UI should surface this before calling {@link saveSqlQuery}). */
export const SQL_MAX_SAVED_QUERIES = 100;
/** Saved-query names longer than this are truncated. */
export const SQL_MAX_SAVED_NAME_LENGTH = 100;

function isHistoryEntry(v: unknown): v is SqlHistoryEntry {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.query === 'string' &&
    typeof e.sourceId === 'string' &&
    typeof e.sourceName === 'string' &&
    typeof e.ranAt === 'number'
  );
}

function isSavedQuery(v: unknown): v is SqlSavedQuery {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.id === 'string' &&
    typeof e.name === 'string' &&
    typeof e.query === 'string' &&
    typeof e.sourceId === 'string' &&
    typeof e.savedAt === 'number'
  );
}

function readList<T>(key: string, isEntry: (v: unknown) => v is T): T[] {
  const raw = safeStorageGet(key);
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isEntry) : [];
  } catch {
    return [];
  }
}

function writeList<T>(key: string, list: T[]): void {
  safeStorageSet(key, JSON.stringify(list));
}

// ----- History -----

/** Past query runs, most-recent-first. */
export function getSqlHistory(): SqlHistoryEntry[] {
  return readList(HISTORY_KEY, isHistoryEntry);
}

/** Record a query run at the front of the history, capped at {@link SQL_MAX_HISTORY_ENTRIES}. */
export function addSqlHistoryEntry(entry: SqlHistoryEntry): SqlHistoryEntry[] {
  const next = [entry, ...getSqlHistory()].slice(0, SQL_MAX_HISTORY_ENTRIES);
  writeList(HISTORY_KEY, next);
  return next;
}

/** Remove one history entry by its position in {@link getSqlHistory}'s order. */
export function removeSqlHistoryEntry(index: number): SqlHistoryEntry[] {
  const next = getSqlHistory().filter((_, i) => i !== index);
  writeList(HISTORY_KEY, next);
  return next;
}

/** Discard the entire run history. */
export function clearSqlHistory(): void {
  writeList<SqlHistoryEntry>(HISTORY_KEY, []);
}

// ----- Saved queries -----

/** Saved queries, most-recently-saved-first. */
export function getSqlSavedQueries(): SqlSavedQuery[] {
  return readList(SAVED_KEY, isSavedQuery);
}

/** Save a new named query at the front of the list. The name is trimmed and length-capped; a blank name is rejected. */
export function saveSqlQuery(name: string, query: string, sourceId: string): SqlSavedQuery[] | null {
  const trimmedName = name.trim().slice(0, SQL_MAX_SAVED_NAME_LENGTH);
  if (trimmedName === '') return null;
  const current = getSqlSavedQueries();
  if (current.length >= SQL_MAX_SAVED_QUERIES) return null;
  const entry: SqlSavedQuery = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: trimmedName,
    query,
    sourceId,
    savedAt: Date.now(),
  };
  const next = [entry, ...current];
  writeList(SAVED_KEY, next);
  return next;
}

/** Delete one saved query by id. */
export function deleteSqlSavedQuery(id: string): SqlSavedQuery[] {
  const next = getSqlSavedQueries().filter((q) => q.id !== id);
  writeList(SAVED_KEY, next);
  return next;
}
