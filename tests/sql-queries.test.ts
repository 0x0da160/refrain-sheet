// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addSqlHistoryEntry,
  clearSqlHistory,
  deleteSqlSavedQuery,
  getSqlHistory,
  getSqlSavedQueries,
  removeSqlHistoryEntry,
  saveSqlQuery,
  SQL_MAX_HISTORY_ENTRIES,
  SQL_MAX_SAVED_NAME_LENGTH,
  SQL_MAX_SAVED_QUERIES,
} from '../src/app/sql-queries';

beforeEach(() => {
  localStorage.clear();
});

describe('sql-queries: run history', () => {
  it('starts empty', () => {
    expect(getSqlHistory()).toEqual([]);
  });

  it('records an entry at the front, most-recent-first', () => {
    addSqlHistoryEntry({ query: 'SELECT * FROM data', sourceId: 'csv', sourceName: 'sheet1.csv', ranAt: 1 });
    addSqlHistoryEntry({ query: 'SELECT a FROM data', sourceId: 'csv', sourceName: 'sheet1.csv', ranAt: 2 });
    const history = getSqlHistory();
    expect(history).toHaveLength(2);
    expect(history[0].query).toBe('SELECT a FROM data');
    expect(history[1].query).toBe('SELECT * FROM data');
  });

  it('caps history at SQL_MAX_HISTORY_ENTRIES, dropping the oldest', () => {
    for (let i = 0; i < SQL_MAX_HISTORY_ENTRIES + 5; i++) {
      addSqlHistoryEntry({
        query: `SELECT ${i} FROM data`,
        sourceId: 'csv',
        sourceName: 'sheet1.csv',
        ranAt: i,
      });
    }
    const history = getSqlHistory();
    expect(history).toHaveLength(SQL_MAX_HISTORY_ENTRIES);
    expect(history[0].query).toBe(`SELECT ${SQL_MAX_HISTORY_ENTRIES + 4} FROM data`);
  });

  it('removes one entry by index', () => {
    addSqlHistoryEntry({ query: 'SELECT a FROM data', sourceId: 'csv', sourceName: 'sheet1.csv', ranAt: 1 });
    addSqlHistoryEntry({ query: 'SELECT b FROM data', sourceId: 'csv', sourceName: 'sheet1.csv', ranAt: 2 });
    const remaining = removeSqlHistoryEntry(0);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].query).toBe('SELECT a FROM data');
  });

  it('clears the whole history', () => {
    addSqlHistoryEntry({ query: 'SELECT a FROM data', sourceId: 'csv', sourceName: 'sheet1.csv', ranAt: 1 });
    clearSqlHistory();
    expect(getSqlHistory()).toEqual([]);
  });

  it('falls back to an empty list for corrupt stored data', () => {
    localStorage.setItem('refrain-csv-html.sqlHistory', 'not json');
    expect(getSqlHistory()).toEqual([]);
    localStorage.setItem('refrain-csv-html.sqlHistory', JSON.stringify([{ query: 'incomplete' }]));
    expect(getSqlHistory()).toEqual([]);
  });
});

describe('sql-queries: saved queries', () => {
  it('starts empty', () => {
    expect(getSqlSavedQueries()).toEqual([]);
  });

  it('saves a named query at the front of the list', () => {
    saveSqlQuery('Totals', 'SELECT SUM(amount) FROM data', 'csv');
    const saved = getSqlSavedQueries();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      name: 'Totals',
      query: 'SELECT SUM(amount) FROM data',
      sourceId: 'csv',
    });
    expect(typeof saved[0].id).toBe('string');
    expect(saved[0].id.length).toBeGreaterThan(0);
  });

  it('trims and length-caps the saved name', () => {
    const longName = 'x'.repeat(SQL_MAX_SAVED_NAME_LENGTH + 20);
    saveSqlQuery(`  ${longName}  `, 'SELECT * FROM data', 'csv');
    expect(getSqlSavedQueries()[0].name).toBe(longName.slice(0, SQL_MAX_SAVED_NAME_LENGTH));
  });

  it('rejects a blank name without saving', () => {
    expect(saveSqlQuery('   ', 'SELECT * FROM data', 'csv')).toBeNull();
    expect(getSqlSavedQueries()).toEqual([]);
  });

  it('refuses to save beyond SQL_MAX_SAVED_QUERIES', () => {
    for (let i = 0; i < SQL_MAX_SAVED_QUERIES; i++) {
      expect(saveSqlQuery(`q${i}`, 'SELECT * FROM data', 'csv')).not.toBeNull();
    }
    expect(getSqlSavedQueries()).toHaveLength(SQL_MAX_SAVED_QUERIES);
    expect(saveSqlQuery('one more', 'SELECT * FROM data', 'csv')).toBeNull();
    expect(getSqlSavedQueries()).toHaveLength(SQL_MAX_SAVED_QUERIES);
  });

  it('deletes a saved query by id', () => {
    saveSqlQuery('Totals', 'SELECT SUM(amount) FROM data', 'csv');
    const [{ id }] = getSqlSavedQueries();
    const remaining = deleteSqlSavedQuery(id);
    expect(remaining).toEqual([]);
    expect(getSqlSavedQueries()).toEqual([]);
  });

  it('falls back to an empty list for corrupt stored data', () => {
    localStorage.setItem('refrain-csv-html.sqlSavedQueries', '{not valid json');
    expect(getSqlSavedQueries()).toEqual([]);
  });
});
