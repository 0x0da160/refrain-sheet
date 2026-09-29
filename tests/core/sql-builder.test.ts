// SPDX-License-Identifier: MIT
import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildSqlQuery,
  EMPTY_SQL_BUILDER_SPEC,
  sqlBuilderOutputColumns,
  type SqlBuilderSpec,
} from '../../src/core/sql-builder';
import {
  checkSqlSyntax,
  initSqlEngine,
  runSqlQuery,
  sqlColumnNames,
  type SqlTable,
} from '../../src/core/sql-engine';

beforeAll(async () => {
  await initSqlEngine();
});

const table: SqlTable = {
  headers: ['dept', 'amount', 'note "x"', ''],
  rows: [
    ['Sales', '100', "it's 50%", 'a'],
    ['Sales', '50', '', 'b'],
    ['Ops', '75', '50_off', 'c'],
    ['Ops', '', 'x', 'd'],
  ],
};
const columns = sqlColumnNames(table.headers);

function spec(changes: Partial<SqlBuilderSpec>): SqlBuilderSpec {
  return { ...EMPTY_SQL_BUILDER_SPEC, ...changes };
}

function run(changes: Partial<SqlBuilderSpec>) {
  const query = buildSqlQuery(spec(changes), columns);
  expect(checkSqlSyntax(query)).toBeNull();
  return runSqlQuery(query, table);
}

describe('buildSqlQuery', () => {
  it('uses the engine column names, including a blank header', () => {
    expect(columns).toEqual(['dept', 'amount', 'note "x"', 'col4']);
  });

  it('selects every column when nothing is chosen', () => {
    expect(buildSqlQuery(EMPTY_SQL_BUILDER_SPEC, columns)).toBe('SELECT *\nFROM data');
    expect(run({}).rows).toHaveLength(4);
  });

  it('quotes chosen columns, even ones holding quotes', () => {
    const result = run({ columns: ['note "x"', 'dept'] });
    expect(result.columns).toEqual(['note "x"', 'dept']);
    expect(result.rows[0]).toEqual(["it's 50%", 'Sales']);
  });

  it('compares numbers as numbers and text as text', () => {
    expect(run({ filters: [{ column: 'amount', op: 'gt', value: '60' }] }).rows.map((r) => r[1])).toEqual([
      100, 75,
    ]);
    expect(run({ filters: [{ column: 'dept', op: 'eq', value: 'Ops' }] }).rows).toHaveLength(2);
  });

  it('treats quotes, % and _ in a typed value as plain text', () => {
    const contains = (value: string) =>
      run({ columns: ['col4'], filters: [{ column: 'note "x"', op: 'contains', value }] }).rows.map(
        (r) => r[0],
      );
    expect(contains("it's")).toEqual(['a']);
    expect(contains('50%')).toEqual(['a']);
    expect(contains('_')).toEqual(['c']);
    expect(contains("'; DROP TABLE data; --")).toEqual([]);
  });

  it('matches starts with, ends with and blank', () => {
    const pick = (changes: Partial<SqlBuilderSpec>) =>
      run({ columns: ['col4'], ...changes }).rows.map((r) => r[0]);
    expect(pick({ filters: [{ column: 'note "x"', op: 'startsWith', value: '50' }] })).toEqual(['c']);
    expect(pick({ filters: [{ column: 'note "x"', op: 'endsWith', value: '%' }] })).toEqual(['a']);
    expect(pick({ filters: [{ column: 'amount', op: 'blank', value: '' }] })).toEqual(['d']);
    expect(pick({ filters: [{ column: 'note "x"', op: 'notBlank', value: '' }] })).toEqual(['a', 'c', 'd']);
  });

  it('combines conditions with all or any', () => {
    const filters = [
      { column: 'dept', op: 'eq' as const, value: 'Sales' },
      { column: 'amount', op: 'lt' as const, value: '80' },
    ];
    expect(run({ filters }).rows).toHaveLength(1);
    expect(run({ filters, match: 'any' }).rows).toHaveLength(3);
  });

  it('groups, totals, sorts and limits', () => {
    const result = run({
      groupBy: ['dept'],
      totals: [
        { fn: 'count', column: null },
        { fn: 'sum', column: 'amount' },
      ],
      sort: { column: 'SUM(amount)', descending: true },
      limit: 1,
    });
    expect(result.columns).toEqual(['dept', 'COUNT(*)', 'SUM(amount)']);
    expect(result.rows).toEqual([['Sales', 2, 150]]);
  });

  it('totals over every row when nothing is grouped', () => {
    const result = run({ totals: [{ fn: 'avg', column: 'amount' }], columns: ['dept'] });
    expect(result.columns).toEqual(['AVG(amount)']);
    expect(result.rows).toEqual([[75]]);
  });

  it('drops choices naming a column the source lacks, and a sort it cannot apply', () => {
    const query = buildSqlQuery(
      spec({
        columns: ['gone', 'dept'],
        filters: [{ column: 'gone', op: 'eq', value: '1' }],
        totals: [{ fn: 'sum', column: null }],
        sort: { column: 'amount', descending: false },
      }),
      columns,
    );
    expect(query).toBe('SELECT "dept"\nFROM data');
    expect(sqlBuilderOutputColumns(spec({ groupBy: ['dept'] }), columns)).toEqual(['dept']);
  });
});
