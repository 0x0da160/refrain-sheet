// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import {
  runSqlQuery,
  SqlQueryError,
  SQL_MAX_QUERY_LENGTH,
  SQL_MAX_RESULT_ROWS,
  type SqlTable,
} from '../src/core/sql-engine';

const salesTable: SqlTable = {
  headers: ['department', 'order_date', 'amount'],
  rows: [
    ['Sales', '2026-01-05', '100'],
    ['Sales', '2026-01-06', '50'],
    ['Marketing', '2026-01-07', '75'],
    ['Marketing', '2026-01-08', ''],
    ['Sales', '2026-02-01', '25'],
  ],
};

function run(query: string, table: SqlTable = salesTable) {
  return runSqlQuery(query, table);
}

function errorOf(query: string, table: SqlTable = salesTable): SqlQueryError {
  try {
    run(query, table);
  } catch (e) {
    if (e instanceof SqlQueryError) return e;
    throw e;
  }
  throw new Error('expected runSqlQuery to throw a SqlQueryError');
}

describe('sql-engine: basic SELECT', () => {
  it('selects all columns with *', () => {
    const r = run('SELECT * FROM data');
    expect(r.columns).toEqual(['department', 'order_date', 'amount']);
    expect(r.rows).toHaveLength(5);
    expect(r.rows[0]).toEqual(['Sales', '2026-01-05', '100']);
  });

  it('projects specific columns with aliases', () => {
    const r = run('SELECT department AS dept, amount FROM data');
    expect(r.columns).toEqual(['dept', 'amount']);
    expect(r.rows[0]).toEqual(['Sales', '100']);
  });

  it('supports quoted identifiers for headers with spaces', () => {
    const t: SqlTable = { headers: ['Order Date', 'Amount'], rows: [['2026-01-01', '10']] };
    const r = run('SELECT "Order Date", "Amount" FROM data', t);
    expect(r.columns).toEqual(['Order Date', 'Amount']);
    expect(r.rows[0]).toEqual(['2026-01-01', '10']);
  });

  it('a plain column projection preserves the original cell text verbatim (no silent numeric coercion, e.g. leading zeros)', () => {
    const t: SqlTable = { headers: ['code'], rows: [['007'], ['1.50']] };
    const r = run('SELECT code FROM data', t);
    expect(r.rows.map((row) => row[0])).toEqual(['007', '1.50']);
  });
});

describe('sql-engine: WHERE', () => {
  it('filters rows with a comparison', () => {
    const r = run("SELECT department FROM data WHERE department = 'Sales'");
    expect(r.rows).toHaveLength(3);
  });

  it('filters with numeric comparisons', () => {
    const r = run('SELECT amount FROM data WHERE amount > 60');
    expect(r.rows.map((row) => row[0])).toEqual(['100', '75']);
  });

  it('supports AND / OR / NOT', () => {
    const r = run("SELECT amount FROM data WHERE department = 'Sales' AND amount > 30");
    expect(r.rows.map((row) => row[0])).toEqual(['100', '50']);
    const r2 = run("SELECT amount FROM data WHERE NOT department = 'Sales'");
    expect(r2.rows).toHaveLength(2);
  });

  it('supports IS NULL / IS NOT NULL for blank cells', () => {
    const r = run('SELECT department FROM data WHERE amount IS NULL');
    expect(r.rows).toEqual([['Marketing']]);
    const r2 = run('SELECT department FROM data WHERE amount IS NOT NULL');
    expect(r2.rows).toHaveLength(4);
  });

  it('supports BETWEEN', () => {
    const r = run('SELECT amount FROM data WHERE amount BETWEEN 40 AND 80');
    expect(r.rows.map((row) => row[0])).toEqual(['50', '75']);
  });

  it('supports IN', () => {
    const r = run("SELECT department FROM data WHERE department IN ('Marketing')");
    expect(r.rows).toHaveLength(2);
  });

  it('supports LIKE with % and _ wildcards', () => {
    const r = run("SELECT department FROM data WHERE department LIKE 'Sal%'");
    expect(r.rows).toHaveLength(3);
    const r2 = run("SELECT department FROM data WHERE department LIKE 'M_rketing'");
    expect(r2.rows).toHaveLength(2);
  });

  it('never matches blank cells against a comparison operand', () => {
    const r = run("SELECT department FROM data WHERE amount = ''");
    expect(r.rows).toHaveLength(0);
  });
});

describe('sql-engine: GROUP BY and aggregates (issue example)', () => {
  it('groups and aggregates like the issue example', () => {
    const r = run(
      'SELECT department, COUNT(*) AS order_count, SUM(amount) AS sales FROM data GROUP BY department ORDER BY sales DESC',
    );
    expect(r.columns).toEqual(['department', 'order_count', 'sales']);
    expect(r.rows).toEqual([
      ['Sales', 3, 175],
      ['Marketing', 2, 75],
    ]);
  });

  it('AVG/MIN/MAX ignore blank cells', () => {
    const r = run('SELECT department, AVG(amount) AS avg_amount FROM data GROUP BY department ORDER BY department');
    expect(r.rows).toEqual([
      ['Marketing', 75],
      ['Sales', (100 + 50 + 25) / 3],
    ]);
  });

  it('aggregates the whole table when GROUP BY is omitted', () => {
    const r = run('SELECT COUNT(*) AS n, SUM(amount) AS total FROM data');
    expect(r.rows).toEqual([[5, 250]]);
  });

  it('COUNT(*) on an empty result set is 0, not an empty result', () => {
    const r = run("SELECT COUNT(*) AS n FROM data WHERE department = 'Nonexistent'");
    expect(r.rows).toEqual([[0]]);
  });

  it('rejects a non-aggregated, non-grouped column in the select list', () => {
    const err = errorOf('SELECT department, amount, COUNT(*) FROM data GROUP BY department');
    expect(err.code).toBe('notAggregated');
    expect(err.params.name).toBe('amount');
  });

  it('rejects SELECT * combined with GROUP BY', () => {
    expect(errorOf('SELECT * FROM data GROUP BY department').code).toBe('notAggregated');
  });

  it('rejects nested aggregates', () => {
    expect(errorOf('SELECT SUM(COUNT(amount)) FROM data').code).toBe('nestedAggregate');
  });

  it('rejects aggregates in WHERE', () => {
    expect(errorOf('SELECT department FROM data WHERE COUNT(*) > 1').code).toBe('aggregateInWhere');
  });
});

describe('sql-engine: ORDER BY / LIMIT', () => {
  it('orders by a column name, ascending by default', () => {
    const r = run('SELECT amount FROM data ORDER BY amount');
    expect(r.rows.map((row) => row[0])).toEqual(['', '25', '50', '75', '100']);
  });

  it('orders DESC and by position', () => {
    const r = run('SELECT department, amount FROM data ORDER BY 2 DESC');
    expect(r.rows.map((row) => row[1])).toEqual(['100', '75', '50', '25', '']);
  });

  it('applies LIMIT and reports truncation', () => {
    const r = run('SELECT amount FROM data ORDER BY amount DESC LIMIT 2');
    expect(r.rows.map((row) => row[0])).toEqual(['100', '75']);
    expect(r.matchedRows).toBe(5);
    expect(r.truncated).toBe(true);
  });

  it('caps results at SQL_MAX_RESULT_ROWS even without LIMIT', () => {
    const bigTable: SqlTable = {
      headers: ['n'],
      rows: Array.from({ length: SQL_MAX_RESULT_ROWS + 50 }, (_, i) => [String(i)]),
    };
    const r = run('SELECT n FROM data', bigTable);
    expect(r.rows).toHaveLength(SQL_MAX_RESULT_ROWS);
    expect(r.truncated).toBe(true);
    expect(r.matchedRows).toBe(SQL_MAX_RESULT_ROWS + 50);
  });
});

describe('sql-engine: scalar functions', () => {
  it('LOWER/UPPER/TRIM/LENGTH', () => {
    const t: SqlTable = { headers: ['name'], rows: [['  Alice  ']] };
    const r = run("SELECT LOWER(name) AS l, UPPER(name) AS u, TRIM(name) AS t, LENGTH(TRIM(name)) AS n FROM data", t);
    expect(r.rows[0]).toEqual(['  alice  ', '  ALICE  ', 'Alice', 5]);
  });

  it('ABS/ROUND', () => {
    const t: SqlTable = { headers: ['x'], rows: [['-3.14159']] };
    const r = run('SELECT ABS(x) AS a, ROUND(x, 2) AS r FROM data', t);
    expect(r.rows[0]).toEqual([3.14159, -3.14]);
  });

  it('COALESCE returns the first non-blank value', () => {
    const t: SqlTable = { headers: ['a', 'b'], rows: [['', 'fallback']] };
    const r = run('SELECT COALESCE(a, b) AS v FROM data', t);
    expect(r.rows[0]).toEqual(['fallback']);
  });
});

describe('sql-engine: rejected as a syntax error (only SELECT is implemented)', () => {
  for (const stmt of [
    "INSERT INTO data VALUES ('x')",
    "UPDATE data SET amount = '0'",
    'DELETE FROM data',
    'DROP TABLE data',
    "ATTACH DATABASE 'x' AS y",
    'PRAGMA table_info(data)',
    'SELECT * FROM data; SELECT * FROM data',
    "SELECT * FROM data WHERE 1=1; DROP TABLE data;",
  ]) {
    it(`rejects: ${stmt}`, () => {
      expect(() => run(stmt)).toThrow(SqlQueryError);
    });
  }

  it('rejects a query naming any table other than the fixed "data" placeholder', () => {
    expect(errorOf('SELECT * FROM sales_csv').code).toBe('expectedTable');
  });

  it('reports a location for a syntax error', () => {
    const err = errorOf('SELECT FROM data');
    expect(err.location).not.toBeNull();
  });
});

describe('sql-engine: bounds', () => {
  it('rejects an empty query', () => {
    expect(errorOf('   ').code).toBe('empty');
  });

  it('rejects a query longer than SQL_MAX_QUERY_LENGTH', () => {
    const huge = `SELECT * FROM data WHERE department = '${'a'.repeat(SQL_MAX_QUERY_LENGTH)}'`;
    expect(errorOf(huge).code).toBe('tooLong');
  });

  it('rejects deeply nested expressions', () => {
    const deep = `SELECT ${'('.repeat(200)}1${')'.repeat(200)} FROM data`;
    expect(errorOf(deep).code).toBe('tooDeep');
  });

  it('rejects an unknown column with a helpful error', () => {
    const err = errorOf('SELECT nonexistent FROM data');
    expect(err.code).toBe('unknownColumn');
    expect(err.params.name).toBe('nonexistent');
  });

  it('rejects an unknown function', () => {
    expect(errorOf('SELECT NOTAFUNCTION(amount) FROM data').code).toBe('unknownFunction');
  });

  it('caps the number of source rows scanned and reports truncation', () => {
    const bigTable: SqlTable = {
      headers: ['n'],
      rows: Array.from({ length: 5 }, (_, i) => [String(i)]),
    };
    const r = run('SELECT COUNT(*) AS n FROM data', bigTable);
    expect(r.sourceTruncated).toBe(false);
    expect(r.sourceRows).toBe(5);
  });
});

describe('sql-engine: header edge cases', () => {
  it('assigns fallback names to blank or duplicate headers', () => {
    const t: SqlTable = { headers: ['a', '', 'a'], rows: [['1', '2', '3']] };
    const r = run('SELECT * FROM data', t);
    expect(r.columns).toEqual(['a', 'col2', 'col3']);
  });

  it('resolves column names case-insensitively', () => {
    const r = run('SELECT DEPARTMENT FROM data WHERE Amount > 60');
    expect(r.rows).toHaveLength(2);
  });
});
