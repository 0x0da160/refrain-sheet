// SPDX-License-Identifier: MIT
/**
 * Frozen `.rsf` compatibility corpus.
 *
 * Every other RSF test builds its bytes with the *current* encoder, so an
 * encoder and decoder that drift together still pass. These fixtures are
 * committed bytes (tests/fixtures/rsf/), checked two ways:
 *
 *  1. **Decode (the compatibility guarantee).** The committed bytes of the
 *     current format (`v1/`) must still decode to the input they were
 *     written from. A fixture is never rewritten: a file saved by a release
 *     must open in every later release that reads its format version.
 *  2. **Encode (output stability).** Encoding the same input must still
 *     reproduce the fixture byte-for-byte — for the compressed fixtures this
 *     also pins the embedded WASM codec's output (src/wasm-gen/). An
 *     intentional output change fails here: keep the old fixture (its decode
 *     check stays), mark its `encodes` as `false`, and add a new fixture.
 *
 * The files directly in tests/fixtures/rsf/ are the binary format releases
 * up to 0.8.x wrote. That format is no longer read (#602); they stay, never
 * edited, to prove such a file is refused with `legacy-format` rather than
 * misread.
 *
 * To add a fixture, add a case below and run
 * `RSF_FIXTURES_WRITE=1 npx vitest run tests/rsf-fixtures.test.ts`, which
 * writes only fixture files that do not exist yet — never an existing one.
 * See knowledge/formats/rsf/compatibility.md.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initCsvEngine, setCsvEngineForTesting, type CsvEngineName } from '../src/core/csv-engine';
import {
  decodeRsfWorkbook,
  encodeRsfBody,
  encodeRsfWorkbook,
  type RsfWorkbookData,
  type RsfWorksheetData,
} from '../src/core/rsf-codec';

const LEGACY_DIR = new URL('./fixtures/rsf/', import.meta.url);
const V1_DIR = new URL('./fixtures/rsf/v1/', import.meta.url);
const WRITE_MISSING = import.meta.env.RSF_FIXTURES_WRITE === '1';

const grid: RsfWorksheetData = {
  id: 's1',
  name: 'Sheet1',
  rowCount: 4,
  columnCount: 3,
  cells: [
    [0, 0, 'id'],
    [0, 1, 'name'],
    [1, 0, '1'],
    [1, 1, 'multi\nline — ünïcödé 日本語'],
    [2, 2, '=SUM(A2:A3)'],
    [3, 0, '"quoted", comma'],
  ],
};

/** A larger, repetitive sheet so the compressed fixture actually compresses. */
const bulk: RsfWorksheetData = {
  id: 'bulk',
  name: 'Bulk',
  rowCount: 200,
  columnCount: 4,
  cells: Array.from({ length: 200 }, (_, r) =>
    Array.from({ length: 4 }, (_, c): [number, number, string] => [
      r,
      c,
      `row ${r} col ${c} ${'x'.repeat(c)}`,
    ]),
  ).flat(),
};

interface FixtureCase {
  file: string;
  data: RsfWorkbookData;
  /** The engine the fixture is written with: `wasm` compresses, `js` writes Raw blocks. */
  engine: CsvEngineName;
  /** False once the encoder intentionally stops producing these bytes. */
  encodes: boolean;
}

const cases: FixtureCase[] = [
  {
    file: 'features.rsf',
    engine: 'wasm',
    encodes: true,
    data: {
      delimiter: ';',
      appName: 'Refrain Sheet',
      appVersion: '0.9.0',
      docId: 'doc-1',
      createdAt: 1_758_585_600_000,
      updatedAt: 1_758_589_200_000,
      timezone: 'Asia/Tokyo',
      displayLanguage: 'ja',
      activeSheetId: 's1',
      sheets: [
        {
          ...grid,
          locked: true,
          display: { zoom: 125, colWidths: [[1, 240]], wrap: true },
          filter: {
            top: 0,
            left: 0,
            bottom: 3,
            right: 2,
            headerRow: true,
            columns: [
              {
                col: 0,
                join: 'or',
                conditions: [
                  { kind: 'text', op: 'contains', value: 'a' },
                  { kind: 'number', op: 'numBetween', value: 1, value2: 9 },
                ],
                values: ['1'],
              },
            ],
          },
          styles: [
            [1, 1, { bold: true, italic: true, textColor: '#c0392b', backgroundColor: '#fdf2e9' }],
            [1, 0, { numberFormat: { kind: 'currency', decimals: 2, thousands: true, currencySymbol: '¥' } }],
            [2, 2, { borderTop: '#000000', borderTopStyle: 'dashed', borderTopWidth: 'thick' }],
          ],
          comments: [[1, 1, 'a note — ünïcödé']],
        },
      ],
    },
  },
  {
    file: 'source-sheets.rsf',
    engine: 'wasm',
    encodes: true,
    data: {
      delimiter: ',',
      autoFormatSource: true,
      activeSheetId: 'md',
      sheets: [
        {
          id: 'md',
          name: 'Notes',
          kind: 'markdown',
          rowCount: 1,
          columnCount: 1,
          cells: [[0, 0, '# Title\n\nBody']],
        },
        { id: 'js', name: 'Data', kind: 'json', rowCount: 1, columnCount: 1, cells: [[0, 0, '{"a":[1,2]}']] },
        {
          id: 'ym',
          name: 'Config',
          kind: 'yaml',
          rowCount: 1,
          columnCount: 1,
          cells: [[0, 0, 'a: 1\nb: [2, 3]\n']],
        },
        {
          id: 'tx',
          name: 'Plain',
          kind: 'text',
          rowCount: 1,
          columnCount: 1,
          cells: [[0, 0, 'line one\nline two']],
        },
      ],
    },
  },
  {
    file: 'history.rsf',
    engine: 'wasm',
    encodes: true,
    data: {
      delimiter: ',',
      activeSheetId: 's1',
      sheets: [grid],
      historyMaxOverride: 7,
      history: [
        {
          timestamp: 1_758_585_600_000,
          bytes: encodeRsfBody({
            delimiter: ',',
            activeSheetId: 's1',
            sheets: [{ ...grid, cells: [[0, 0, 'old']] }],
          }),
        },
      ],
    },
  },
  {
    file: 'bulk-zstd.rsf',
    engine: 'wasm',
    encodes: true,
    data: { delimiter: ',', activeSheetId: 'bulk', sheets: [bulk] },
  },
  {
    // What the JavaScript fallback writes: a Zstandard frame of Raw blocks.
    file: 'raw-blocks.rsf',
    engine: 'js',
    encodes: true,
    data: { delimiter: ',', activeSheetId: 's1', sheets: [grid] },
  },
];

function loadFixture(file: string, encode: () => Uint8Array): Uint8Array {
  const url = new URL(file, V1_DIR);
  if (!existsSync(url)) {
    if (!WRITE_MISSING) throw new Error(`missing fixture v1/${file} (see this file's header to add one)`);
    mkdirSync(V1_DIR, { recursive: true });
    writeFileSync(url, encode());
  }
  return new Uint8Array(readFileSync(url));
}

function withEngine<T>(engine: CsvEngineName, run: () => T): T {
  setCsvEngineForTesting(engine);
  try {
    return run();
  } finally {
    setCsvEngineForTesting('wasm');
  }
}

describe('frozen .rsf fixtures (format version 1)', () => {
  beforeAll(async () => {
    // Compressed fixtures need the embedded WASM codec engine.
    await initCsvEngine();
    setCsvEngineForTesting('wasm');
  });
  afterAll(() => setCsvEngineForTesting('js'));

  describe.each(cases)('$file', ({ file, data, engine, encodes }) => {
    const bytes = () => loadFixture(file, () => withEngine(engine, () => encodeRsfWorkbook(data)));

    it('decodes to the workbook it was written from', () => {
      const decoded = decodeRsfWorkbook(bytes());
      expect(decoded.ok).toBe(true);
      if (decoded.ok) expect(decoded.data).toMatchObject(data);
    });

    it.runIf(encodes)('is still reproduced byte-for-byte by the encoder', () => {
      expect(withEngine(engine, () => encodeRsfWorkbook(data))).toEqual(bytes());
    });
  });

  it('reads the Raw-block fixture without the WASM engine too', () => {
    const decoded = withEngine('js', () => decodeRsfWorkbook(bytes('raw-blocks.rsf')));
    expect(decoded.ok).toBe(true);
  });

  it('refuses a compressed fixture without the WASM engine, rather than misreading it', () => {
    const decoded = withEngine('js', () => decodeRsfWorkbook(bytes('bulk-zstd.rsf')));
    expect(decoded).toEqual({ ok: false, error: 'unsupported-compression' });
  });
});

function bytes(file: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(file, V1_DIR)));
}

describe('frozen binary-format files from releases up to 0.8.x', () => {
  const legacy = readdirSync(LEGACY_DIR).filter((name) => name.endsWith('.rsf'));

  it('the corpus is still present', () => {
    expect(legacy.length).toBeGreaterThan(20);
  });

  it.each(legacy)('%s is refused as legacy-format', (file) => {
    const decoded = decodeRsfWorkbook(new Uint8Array(readFileSync(new URL(file, LEGACY_DIR))));
    expect(decoded).toEqual({ ok: false, error: 'legacy-format' });
  });
});
