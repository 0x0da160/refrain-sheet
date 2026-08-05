// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import {
  computeDiff,
  DiffError,
  DIFF_MAX_KEY_COLUMNS,
  DIFF_MAX_RESULT_ROWS,
  type DiffOptions,
  type DiffResult,
  type DiffRow,
} from '../src/core/diff-engine';
import type { SqlTable } from '../src/core/sql-engine';

const baseline: SqlTable = {
  headers: ['order_id', 'amount', 'status'],
  rows: [
    ['A-1', '100', 'open'],
    ['A-2', '50', 'open'],
    ['A-3', '75', 'closed'],
  ],
};

const current: SqlTable = {
  headers: ['order_id', 'amount', 'status'],
  rows: [
    ['A-1', '100', 'open'],
    ['A-2', '65', 'open'],
    ['A-4', '10', 'open'],
  ],
};

function diff(opts: DiffOptions, b: SqlTable = baseline, c: SqlTable = current): DiffResult {
  return computeDiff(b, c, opts);
}

function rowsOfType(result: DiffResult, type: DiffRow['type']): DiffRow[] {
  return result.rows.filter((r) => r.type === type);
}

function errorOf(fn: () => void): DiffError {
  try {
    fn();
  } catch (e) {
    if (e instanceof DiffError) return e;
    throw e;
  }
  throw new Error('expected computeDiff to throw a DiffError');
}

describe('diff-engine: basic classification', () => {
  it('classifies unchanged, modified, added, and deleted rows by a single key', () => {
    const r = diff({ keyColumns: ['order_id'] });
    expect(r.counts).toEqual({ unchanged: 1, modified: 1, added: 1, deleted: 1, keyInvalid: 0 });

    const unchanged = rowsOfType(r, 'unchanged');
    expect(unchanged).toHaveLength(1);
    expect(unchanged[0].key).toEqual(['A-1']);

    const modified = rowsOfType(r, 'modified');
    expect(modified).toHaveLength(1);
    expect(modified[0].key).toEqual(['A-2']);
    expect(modified[0].before).toEqual(['A-2', '50', 'open']);
    expect(modified[0].after).toEqual(['A-2', '65', 'open']);
    const amountIdx = r.columns.indexOf('amount');
    expect(modified[0].changedColumns).toEqual([amountIdx]);

    const deleted = rowsOfType(r, 'deleted');
    expect(deleted).toHaveLength(1);
    expect(deleted[0].key).toEqual(['A-3']);
    expect(deleted[0].after).toBeNull();

    const added = rowsOfType(r, 'added');
    expect(added).toHaveLength(1);
    expect(added[0].key).toEqual(['A-4']);
    expect(added[0].before).toBeNull();
  });

  it('supports a composite key across multiple columns', () => {
    const b: SqlTable = {
      headers: ['region', 'sku', 'qty'],
      rows: [
        ['east', 'X', '1'],
        ['west', 'X', '2'],
      ],
    };
    const c: SqlTable = {
      headers: ['region', 'sku', 'qty'],
      rows: [
        ['east', 'X', '9'],
        ['west', 'X', '2'],
      ],
    };
    const r = diff({ keyColumns: ['region', 'sku'] }, b, c);
    expect(r.counts.modified).toBe(1);
    expect(r.counts.unchanged).toBe(1);
    expect(rowsOfType(r, 'modified')[0].key).toEqual(['east', 'X']);
  });
});

describe('diff-engine: key_invalid rows', () => {
  it('flags a blank key part as key_invalid on whichever side it occurs', () => {
    const b: SqlTable = { headers: ['id', 'v'], rows: [['', '1']] };
    const c: SqlTable = { headers: ['id', 'v'], rows: [['K1', '2']] };
    const r = diff({ keyColumns: ['id'] }, b, c);
    expect(r.counts.keyInvalid).toBe(1);
    expect(r.counts.added).toBe(1);
    const invalid = rowsOfType(r, 'key_invalid');
    expect(invalid[0].reason).toBe('blankKey');
    expect(invalid[0].key).toBeNull();
    expect(invalid[0].before).toEqual(['', '1']);
    expect(invalid[0].after).toBeNull();
  });

  it('flags a missing part of a composite key (blank) as key_invalid', () => {
    const b: SqlTable = { headers: ['region', 'sku'], rows: [['east', '']] };
    const c: SqlTable = { headers: ['region', 'sku'], rows: [] };
    const r = diff({ keyColumns: ['region', 'sku'] }, b, c);
    expect(r.counts.keyInvalid).toBe(1);
    expect(rowsOfType(r, 'key_invalid')[0].reason).toBe('blankKey');
  });

  it('flags every occurrence of a key duplicated within one table as key_invalid', () => {
    const b: SqlTable = {
      headers: ['id', 'v'],
      rows: [
        ['K1', '1'],
        ['K1', '2'],
      ],
    };
    const c: SqlTable = { headers: ['id', 'v'], rows: [['K1', '9']] };
    const r = diff({ keyColumns: ['id'] }, b, c);
    expect(r.counts.keyInvalid).toBe(2);
    // The current-side row with the same key has no unique baseline partner, so it is 'added'.
    expect(r.counts.added).toBe(1);
    expect(r.counts.deleted).toBe(0);
    for (const row of rowsOfType(r, 'key_invalid')) {
      expect(row.reason).toBe('duplicateKey');
    }
  });

  it('flags a duplicate key on the current side and reports the baseline row as deleted', () => {
    const b: SqlTable = { headers: ['id', 'v'], rows: [['K1', '1']] };
    const c: SqlTable = {
      headers: ['id', 'v'],
      rows: [
        ['K1', '2'],
        ['K1', '3'],
      ],
    };
    const r = diff({ keyColumns: ['id'] }, b, c);
    expect(r.counts.keyInvalid).toBe(2);
    expect(r.counts.deleted).toBe(1);
    expect(r.counts.added).toBe(0);
  });
});

describe('diff-engine: mismatched columns between tables', () => {
  it('treats a column missing from one side as blank, and can still flag it as changed', () => {
    const b: SqlTable = { headers: ['id', 'note'], rows: [['K1', 'hello']] };
    const c: SqlTable = { headers: ['id'], rows: [['K1']] };
    const r = diff({ keyColumns: ['id'] }, b, c);
    expect(r.columns).toEqual(['id', 'note']);
    const modified = rowsOfType(r, 'modified');
    expect(modified).toHaveLength(1);
    expect(modified[0].before).toEqual(['K1', 'hello']);
    expect(modified[0].after).toEqual(['K1', '']);
  });

  it('appends current-only columns after the baseline columns', () => {
    const b: SqlTable = { headers: ['id'], rows: [['K1']] };
    const c: SqlTable = { headers: ['id', 'extra'], rows: [['K1', 'x']] };
    const r = diff({ keyColumns: ['id'] }, b, c);
    expect(r.columns).toEqual(['id', 'extra']);
  });
});

describe('diff-engine: normalization options', () => {
  it('matches keys case-insensitively and after trimming when requested', () => {
    const b: SqlTable = { headers: ['id', 'v'], rows: [[' K1 ', 'A']] };
    const c: SqlTable = { headers: ['id', 'v'], rows: [['k1', 'a']] };
    const r = diff({ keyColumns: ['id'], normalize: { trim: true, caseInsensitive: true } }, b, c);
    expect(r.counts.unchanged).toBe(1);
    expect(r.counts.modified).toBe(0);
  });

  it('treats differently-cased/whitespace-padded keys as distinct without normalization', () => {
    const b: SqlTable = { headers: ['id', 'v'], rows: [[' K1 ', 'A']] };
    const c: SqlTable = { headers: ['id', 'v'], rows: [['k1', 'a']] };
    const r = diff({ keyColumns: ['id'] }, b, c);
    expect(r.counts.deleted).toBe(1);
    expect(r.counts.added).toBe(1);
  });
});

describe('diff-engine: compare column selection', () => {
  it('defaults compareColumns to every non-key combined column', () => {
    const r = diff({ keyColumns: ['order_id'] });
    const idIdx = r.columns.indexOf('order_id');
    expect(r.compareColumnIndexes).not.toContain(idIdx);
    expect(r.compareColumnIndexes).toHaveLength(r.columns.length - 1);
  });

  it('restricts comparison to an explicit compareColumns list', () => {
    const r = diff({ keyColumns: ['order_id'], compareColumns: ['status'] });
    // A-2's amount changed but status did not, so with only "status" compared it reads unchanged
    // (alongside A-1, which was already fully unchanged).
    expect(r.counts.modified).toBe(0);
    expect(r.counts.unchanged).toBe(2);
  });
});

describe('diff-engine: errors', () => {
  it('rejects an empty key column list', () => {
    expect(errorOf(() => diff({ keyColumns: [] })).code).toBe('noKeyColumns');
  });

  it('rejects more key columns than the limit', () => {
    const many = Array.from({ length: DIFF_MAX_KEY_COLUMNS + 1 }, (_, i) => `k${i}`);
    expect(errorOf(() => diff({ keyColumns: many })).code).toBe('tooManyKeyColumns');
  });

  it('rejects an unknown key column', () => {
    expect(errorOf(() => diff({ keyColumns: ['does_not_exist'] })).code).toBe('unknownKeyColumn');
  });

  it('rejects an unknown compare column', () => {
    expect(errorOf(() => diff({ keyColumns: ['order_id'], compareColumns: ['nope'] })).code).toBe(
      'unknownCompareColumn',
    );
  });
});

describe('diff-engine: result cap', () => {
  it('caps rows at DIFF_MAX_RESULT_ROWS, prioritizing changed rows over unchanged ones', () => {
    const n = DIFF_MAX_RESULT_ROWS + 50;
    const rows = Array.from({ length: n }, (_, i) => [String(i), '1']);
    const b: SqlTable = { headers: ['id', 'v'], rows };
    // Every row's value changes, so nothing is 'unchanged'.
    const c: SqlTable = { headers: ['id', 'v'], rows: rows.map(([id]) => [id, '2']) };
    const r = diff({ keyColumns: ['id'] }, b, c);
    expect(r.rows).toHaveLength(DIFF_MAX_RESULT_ROWS);
    expect(r.matchedRows).toBe(n);
    expect(r.truncated).toBe(true);
    expect(r.counts.modified).toBe(n);
    expect(r.rows.every((row) => row.type === 'modified')).toBe(true);
  });

  it('fills remaining capacity with unchanged rows after all changed rows fit', () => {
    const rows = Array.from({ length: 10 }, (_, i) => [String(i), '1']);
    const b: SqlTable = { headers: ['id', 'v'], rows };
    const c: SqlTable = { headers: ['id', 'v'], rows: rows.map(([id], i) => [id, i === 0 ? '2' : '1']) };
    const r = diff({ keyColumns: ['id'] }, b, c);
    expect(r.truncated).toBe(false);
    expect(r.counts.modified).toBe(1);
    expect(r.counts.unchanged).toBe(9);
    expect(r.rows).toHaveLength(10);
  });
});
