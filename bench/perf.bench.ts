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
import { AppState } from '../src/app/app-state';
import {
  initCsvEngine,
  setCsvEngineForTesting,
  RSF_COMPRESSION_DEFLATE,
  RSF_COMPRESSION_LZ4,
  RSF_COMPRESSION_STORE,
  RSF_COMPRESSION_ZSTD,
} from '../src/core/csv-engine';
import type { CellChange } from '../src/core/history';
import { LosslessDocument } from '../src/core/lossless-document';
import { encodeRsf, decodeRsf, type RsfData } from '../src/core/rsf-codec';
import { RsfDocument } from '../src/core/rsf-document';
import { compileQuery, replaceAllInValue } from '../src/core/search';
import { serializeDocument, KEEP_SAVE_OPTIONS } from '../src/core/serializer';
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

// ----- RSF container: encode (compress + CRC) and decode (validate + inflate) -----

describe('RSF container round-trip, 100,000 non-empty cells', () => {
  const cells: Array<[number, number, string]> = [];
  for (let i = 0; i < 100_000; i++) {
    cells.push([i % 20_000, i % 5, `value-${i % 977}`]);
  }
  const payload: RsfData = {
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
      encodeRsf(payload);
    },
    OPTS,
  );
  const encodedForDecode = (() => {
    setCsvEngineForTesting(wasmAvailable ? 'wasm' : 'js');
    return encodeRsf(payload);
  })();
  bench.skipIf(!wasmAvailable)(
    'decode (validate + inflate)',
    () => {
      setCsvEngineForTesting('wasm');
      const out = decodeRsf(encodedForDecode);
      if (!out.ok) throw new Error('decode failed');
    },
    OPTS,
  );
});

// ----- CSV save paths: byte-identity (no edits) and minimal-diff patch -----

describe('CSV save, 200,000×6 (~11 MB)', () => {
  const bytes = makeCsvBytes(200_000, 6);
  bench.skipIf(!wasmAvailable)(
    'unedited save (identity path)',
    () => {
      setCsvEngineForTesting('wasm');
      const doc = LosslessDocument.fromBytes(bytes);
      const result = serializeDocument(doc, KEEP_SAVE_OPTIONS, false);
      if (!result.ok || result.mode !== 'identity') throw new Error('expected identity save');
    },
    OPTS,
  );
  bench.skipIf(!wasmAvailable)(
    '10 edited cells, minimal-diff save (patch path)',
    () => {
      setCsvEngineForTesting('wasm');
      const doc = LosslessDocument.fromBytes(bytes);
      for (let i = 0; i < 10; i++) {
        doc.setValue(i * 19_777, 3, `edited-${i}`);
      }
      const result = serializeDocument(doc, KEEP_SAVE_OPTIONS, false);
      if (!result.ok || result.mode !== 'patch') throw new Error('expected patch save');
    },
    OPTS,
  );
});

// ----- CSV → RSF conversion (the value-collection core of the Convert command) -----

describe('CSV → RSF conversion, 200,000×6', () => {
  const bytes = makeCsvBytes(200_000, 6);
  bench.skipIf(!wasmAvailable)(
    'RsfDocument.fromLossless',
    () => {
      setCsvEngineForTesting('wasm');
      const doc = LosslessDocument.fromBytes(bytes);
      RsfDocument.fromLossless(doc, 'bench.rsf');
    },
    OPTS,
  );
});

// ----- RSF container: every supported compression method -----

describe('RSF encode/decode per compression method, 100,000 cells', () => {
  const cells: Array<[number, number, string]> = [];
  for (let i = 0; i < 100_000; i++) {
    cells.push([i % 20_000, i % 5, `value-${i % 977}`]);
  }
  const payload: RsfData = { name: 'Sheet1', delimiter: ',', rowCount: 20_000, columnCount: 5, cells };
  const methods: Array<[string, number]> = [
    ['zstd', RSF_COMPRESSION_ZSTD],
    ['lz4', RSF_COMPRESSION_LZ4],
    ['deflate', RSF_COMPRESSION_DEFLATE],
    ['store', RSF_COMPRESSION_STORE],
  ];
  for (const [label, method] of methods) {
    bench.skipIf(!wasmAvailable)(
      `encode (${label})`,
      () => {
        setCsvEngineForTesting('wasm');
        encodeRsf(payload, method);
      },
      OPTS,
    );
  }
  for (const [label, method] of methods) {
    const encoded = (() => {
      if (!wasmAvailable && method !== RSF_COMPRESSION_STORE) return null;
      setCsvEngineForTesting(wasmAvailable ? 'wasm' : 'js');
      return encodeRsf(payload, method);
    })();
    bench.skipIf(encoded === null)(
      `decode (${label})`,
      () => {
        setCsvEngineForTesting(wasmAvailable ? 'wasm' : 'js');
        const out = decodeRsf(encoded as Uint8Array);
        if (!out.ok) throw new Error('decode failed');
      },
      OPTS,
    );
  }
});

// ----- Structural edits: row insertion with formula-reference rewriting -----
// Exercises the per-row formula index: only rows containing formulas are
// scanned when the whole sheet's references are adjusted.

describe('insert row into 100,000×6 sheet with 1,000 formula cells', () => {
  // The fixture is built once; each iteration inserts one more row into it
  // (a negligible, deterministic size drift across the 5 iterations).
  const sheetDoc = RsfDocument.empty('bench.rsf', 100_000, 6);
  for (let r = 0; r < 100_000; r++) {
    sheetDoc.setCell(r, 0, String(r));
  }
  for (let i = 0; i < 1_000; i++) {
    sheetDoc.setCell(i * 100, 5, `=A${i * 100 + 1}+1`);
  }
  const sheetState = new AppState();
  const sheetTab = sheetState.addTab('bench.rsf', sheetDoc, null);
  bench(
    'AppState.insertRows (index-assisted formula rewrite scan)',
    () => {
      sheetState.insertRows(sheetTab, 50_000, 1);
    },
    OPTS,
  );
  bench(
    'listFormulaCells on the same sheet',
    () => {
      if (sheetTab.doc.kind !== 'rsf') throw new Error('unexpected');
      const cells = sheetTab.doc.listFormulaCells();
      if (cells.length !== 1_000) throw new Error(`unexpected: ${cells.length}`);
    },
    OPTS,
  );
  // Reference: the pre-index algorithm (scan every cell through the public
  // surface) — kept so the whole-sheet-scan vs indexed-walk gap stays measured.
  bench(
    'full-sheet formula scan (pre-index reference)',
    () => {
      const doc = sheetTab.doc;
      if (doc.kind !== 'rsf') throw new Error('unexpected');
      let n = 0;
      for (let r = 0; r < doc.rowCount; r++) {
        for (let c = 0; c < doc.columnCount; c++) {
          const v = doc.getValue(r, c);
          if (v.length > 1 && v.startsWith('=')) n += 1;
        }
      }
      if (n !== 1_000) throw new Error(`unexpected: ${n}`);
    },
    OPTS,
  );
});

// ----- Large bulk mutation: one atomic 120,000-cell edit (paste/fill apply path) -----

describe('bulk edit apply, 120,000 cells (paste/fill mutation path)', () => {
  const changes: CellChange[] = [];
  for (let r = 0; r < 20_000; r++) {
    for (let c = 0; c < 6; c++) {
      changes.push({ row: r, col: c, before: '', after: `v${r}-${c}` });
    }
  }
  bench(
    'AppState.bulkEdit',
    () => {
      const doc = RsfDocument.empty('bench.rsf', 20_000, 6);
      const state = new AppState();
      const tab = state.addTab('bench.rsf', doc, null);
      if (!state.bulkEdit(tab, changes, 'history.paste')) throw new Error('bulkEdit failed');
    },
    OPTS,
  );
});

// ----- Formula evaluation: dependency chain with memoization -----

describe('formula evaluation, 5,000-cell dependency chain', () => {
  bench(
    'evaluate all (cold memo each run)',
    () => {
      const doc = RsfDocument.empty('bench.rsf', 5_000, 2);
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
