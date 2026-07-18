// SPDX-License-Identifier: MIT
/**
 * Reproducible performance benchmarks for the data-volume-dependent core
 * paths (run with `npm run bench`, inside the project's Docker toolchain).
 *
 * Fixtures are generated deterministically in code — no fixture files, no
 * randomness — so runs are comparable across machines and revisions. The
 * numbers themselves depend on the host; docs/performance.md records the
 * reference environment and the measured results for this revision.
 *
 * These benches run in Node (V8), not a browser. They measure the pure data
 * processing cost; DOM-related responsiveness is covered by tests
 * (tests/perf.test.ts, tests/virtual-grid.test.ts) and by the manual
 * profiling steps documented in docs/performance.md.
 */
import { bench, describe } from 'vitest';
import { initCsvEngine, setCsvEngineForTesting } from '../src/core/csv-engine';
import { LosslessDocument } from '../src/core/lossless-document';
import { encodeRcsv, decodeRcsv, type RcsvData } from '../src/core/rcsv-codec';
import { RcsvDocument } from '../src/core/rcsv-document';
import { compileQuery, replaceAllInValue } from '../src/core/search';
import { computeSelectionStats } from '../src/core/stats';

const wasmAvailable = (await initCsvEngine()) === 'wasm';

// Fast, comparable runs: a fixed number of iterations instead of a time budget.
const OPTS = { warmupIterations: 1, iterations: 5, warmupTime: 0, time: 0 };

/** Deterministic CSV bytes: `rows` rows of `cols` short mixed text/number fields. */
function makeCsvBytes(rows: number, cols: number, valueLen = 0): Uint8Array {
  const lines: string[] = [];
  const pad = valueLen > 0 ? 'x'.repeat(valueLen) : '';
  for (let r = 0; r < rows; r++) {
    const parts: string[] = [];
    for (let c = 0; c < cols; c++) {
      parts.push(c % 2 === 0 ? String((r * 31 + c * 7) % 100000) : `v${r}-${c}${pad}`);
    }
    lines.push(parts.join(','));
  }
  return new TextEncoder().encode(lines.join('\n') + '\n');
}

// ----- CSV open path: byte parsing + row/field indexing -----

describe('parse + index 200,000×6 CSV (~11 MB)', () => {
  const bytes = makeCsvBytes(200_000, 6);
  bench(
    'js engine',
    () => {
      setCsvEngineForTesting('js');
      LosslessDocument.fromBytes(bytes);
    },
    OPTS,
  );
  bench.skipIf(!wasmAvailable)(
    'wasm engine',
    () => {
      setCsvEngineForTesting('wasm');
      LosslessDocument.fromBytes(bytes);
    },
    OPTS,
  );
});

describe('parse + index 10,000×2 CSV with 500-char values (~10 MB)', () => {
  const bytes = makeCsvBytes(10_000, 2, 500);
  bench.skipIf(!wasmAvailable)(
    'wasm engine',
    () => {
      setCsvEngineForTesting('wasm');
      LosslessDocument.fromBytes(bytes);
    },
    OPTS,
  );
});

// ----- Selection statistics: the scan that used to run synchronously on -----
// ----- every selection event and is now time-sliced off that path       -----

describe('selection statistics over 200,000×5 cells (1,000,000-cell range)', () => {
  const rows = 200_000;
  const cols = 5;
  const data: string[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: string[] = [];
    for (let c = 0; c < cols; c++) {
      row.push(c % 2 === 0 ? String(r % 9973) : `t${r}`);
    }
    data.push(row);
  }
  const range = { top: 0, bottom: rows - 1, left: 0, right: cols - 1 };
  bench.skipIf(!wasmAvailable)(
    'full scan (wasm aggregate)',
    () => {
      setCsvEngineForTesting('wasm');
      computeSelectionStats(range, (r, c) => data[r][c]);
    },
    OPTS,
  );
  bench(
    'full scan (js aggregate)',
    () => {
      setCsvEngineForTesting('js');
      computeSelectionStats(range, (r, c) => data[r][c]);
    },
    OPTS,
  );
});

// ----- Replace All: the sliced read-only scan phase -----

describe('Replace-All match scan over 200,000×6 cells', () => {
  const rows = 200_000;
  const cols = 6;
  const values: string[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: string[] = [];
    for (let c = 0; c < cols; c++) {
      row.push(r % 10 === 0 && c === 2 ? `cat-${r}` : `dog-${r}-${c}`);
    }
    values.push(row);
  }
  const query = compileQuery({ text: 'cat', matchCase: true, regex: false });
  bench(
    'literal scan',
    () => {
      let hits = 0;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (replaceAllInValue(values[r][c], query, 'cow').count > 0) hits += 1;
        }
      }
      if (hits !== rows / 10) throw new Error(`unexpected hits: ${hits}`);
    },
    OPTS,
  );
});

// ----- RCSV container: encode (compress + CRC) and decode (validate + inflate) -----

describe('RCSV container round-trip, 100,000 non-empty cells', () => {
  const cells: Array<[number, number, string]> = [];
  for (let i = 0; i < 100_000; i++) {
    cells.push([i % 20_000, i % 5, `value-${i % 977}`]);
  }
  const payload: RcsvData = {
    name: 'Sheet1',
    delimiter: ',',
    rowCount: 20_000,
    columnCount: 5,
    cells,
  };
  bench.skipIf(!wasmAvailable)(
    'encode (wasm deflate)',
    () => {
      setCsvEngineForTesting('wasm');
      encodeRcsv(payload);
    },
    OPTS,
  );
  const encodedForDecode = (() => {
    setCsvEngineForTesting(wasmAvailable ? 'wasm' : 'js');
    return encodeRcsv(payload);
  })();
  bench.skipIf(!wasmAvailable)(
    'decode (validate + inflate)',
    () => {
      setCsvEngineForTesting('wasm');
      const out = decodeRcsv(encodedForDecode);
      if (!out.ok) throw new Error('decode failed');
    },
    OPTS,
  );
});

// ----- Formula evaluation: dependency chain with memoization -----

describe('formula evaluation, 5,000-cell dependency chain', () => {
  bench(
    'evaluate all (cold memo each run)',
    () => {
      const doc = RcsvDocument.empty('bench.rcsv', 5_000, 2);
      doc.setCell(0, 0, '1');
      for (let r = 1; r < 5_000; r++) {
        doc.setCell(r, 0, String(r));
        doc.setCell(r, 1, `=A${r}+A${r + 1}`);
      }
      for (let r = 1; r < 5_000; r++) {
        doc.getDisplayValue(r, 1);
      }
    },
    OPTS,
  );
});
