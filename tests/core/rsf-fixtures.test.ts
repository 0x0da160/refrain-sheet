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
 *     also pins the embedded WASM codec's output (src/generated/). An
 *     intentional output change fails here: keep the old fixture (its decode
 *     check stays), mark its `encodes` as `false`, and add a new fixture.
 *
 * The files directly in tests/fixtures/rsf/ are the binary format releases
 * up to 0.8.x wrote. That format is no longer read (#602); they stay, never
 * edited, to prove such a file is refused with `legacy-format` rather than
 * misread.
 *
 * To add a fixture, add a case below and run
 * `RSF_FIXTURES_WRITE=1 npx vitest run tests/core/rsf-fixtures.test.ts`, which
 * writes only fixture files that do not exist yet — never an existing one.
 * See knowledge/formats/rsf/compatibility.md.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initCsvEngine, setCsvEngineForTesting, type CsvEngineName } from '../../src/core/csv/csv-engine';
import {
  decodeRsfWorkbook,
  encodeRsfBody,
  encodeRsfWorkbook,
  type RsfWorkbookData,
  type RsfWorksheetData,
} from '../../src/core/workbook/rsf-codec';

const LEGACY_DIR = new URL('../fixtures/rsf/', import.meta.url);
const V1_DIR = new URL('../fixtures/rsf/v1/', import.meta.url);
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

const prettyCases: FixtureCase[] = [
  {
    file: 'features.rsf',
    engine: 'wasm',
    encodes: false, // pretty-printed, full-copy history: what releases before compact JSON wrote
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
    encodes: false, // pretty-printed, full-copy history: what releases before compact JSON wrote
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
    encodes: false, // pretty-printed, full-copy history: what releases before compact JSON wrote
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
    encodes: false, // pretty-printed, full-copy history: what releases before compact JSON wrote
    data: { delimiter: ',', activeSheetId: 'bulk', sheets: [bulk] },
  },
  {
    // What the JavaScript fallback writes: a Zstandard frame of Raw blocks.
    file: 'raw-blocks.rsf',
    engine: 'js',
    encodes: false, // pretty-printed, full-copy history: what releases before compact JSON wrote
    data: { delimiter: ',', activeSheetId: 's1', sheets: [grid] },
  },
];

/** A version history of several saves, stored as deltas. */
const historyDeltas: RsfWorkbookData = {
  delimiter: ',',
  activeSheetId: 's1',
  sheets: [
    { ...grid, cells: [...grid.cells, [3, 2, 'third save']] },
    { ...bulk, rowCount: 201 },
  ],
  history: [
    {
      timestamp: 1_758_585_600_000,
      bytes: encodeRsfBody({ delimiter: ',', activeSheetId: 's1', sheets: [grid] }),
    },
    {
      timestamp: 1_758_589_200_000,
      bytes: encodeRsfBody({ delimiter: ',', activeSheetId: 's1', sheets: [grid, bulk] }),
    },
    {
      timestamp: 1_758_592_800_000,
      bytes: encodeRsfBody({
        delimiter: ',',
        activeSheetId: 's1',
        timezone: 'Asia/Tokyo',
        sheets: [{ ...grid, cells: [...grid.cells, [3, 2, 'third save']] }, bulk],
      }),
    },
  ],
};

/**
 * Compact JSON with history stored as deltas, as this release writes: the
 * same inputs as the pretty-printed fixtures, plus a longer history.
 */
const cases: FixtureCase[] = [
  ...prettyCases,
  ...prettyCases.map((c) => ({ ...c, file: c.file.replace('.rsf', '-compact.rsf'), encodes: true })),
  { file: 'history-deltas.rsf', engine: 'wasm', encodes: true, data: historyDeltas },
  {
    // Worksheet tab colors (`tabColor`), added after the compact fixtures.
    file: 'tab-color.rsf',
    engine: 'wasm',
    encodes: true,
    data: {
      delimiter: ',',
      activeSheetId: 's1',
      sheets: [
        { ...grid, tabColor: '#287ccf' },
        { id: 's2', name: 'Sheet2', rowCount: 1, columnCount: 1, cells: [] },
      ],
    },
  },
  {
    // Nested sheet folders (`folders`, a worksheet's `folder`).
    file: 'sheet-folders.rsf',
    engine: 'wasm',
    encodes: true,
    data: {
      delimiter: ',',
      activeSheetId: 's1',
      folders: [
        { id: 'f1', name: 'Sales' },
        { id: 'f2', name: '2026', parentId: 'f1' },
      ],
      sheets: [
        { ...grid, folderId: 'f2' },
        { id: 's2', name: 'Sheet2', rowCount: 1, columnCount: 1, cells: [], folderId: 'f1' },
        { id: 's3', name: 'Sheet3', rowCount: 1, columnCount: 1, cells: [] },
      ],
    },
  },
  {
    // Data-validation rules (a worksheet's `validations`).
    file: 'validations.rsf',
    engine: 'wasm',
    encodes: true,
    data: {
      delimiter: ',',
      activeSheetId: 's1',
      sheets: [
        {
          ...grid,
          validations: [
            { top: 1, left: 1, bottom: 3, right: 1, rule: { kind: 'list', values: ['Yes', 'No', '保留'] } },
            { top: 1, left: 0, bottom: 3, right: 0, rule: { kind: 'number', min: 0, max: null } },
          ],
        },
      ],
    },
  },
  {
    // Column-schema rules: whole numbers, text length, dates, required, to the last row.
    file: 'validation-schema.rsf',
    engine: 'wasm',
    encodes: true,
    data: {
      delimiter: ',',
      activeSheetId: 's1',
      sheets: [
        {
          ...grid,
          validations: [
            {
              top: 1,
              left: 0,
              bottom: 3,
              right: 0,
              rule: { kind: 'number', min: 1, max: null, integer: true },
              required: true,
              toEnd: true,
            },
            { top: 1, left: 1, bottom: 3, right: 1, rule: { kind: 'textLength', min: null, max: 40 } },
            {
              top: 0,
              left: 2,
              bottom: 3,
              right: 2,
              rule: { kind: 'date', min: '2026-01-01', max: '2026-12-31' },
            },
          ],
        },
      ],
    },
  },
  {
    // A cell's own font and size, and a rich-text part's (`fontFamily`, `fontSize`).
    file: 'text-font.rsf',
    engine: 'wasm',
    encodes: true,
    data: {
      delimiter: ',',
      activeSheetId: 's1',
      sheets: [
        {
          ...grid,
          styles: [
            [0, 0, { fontFamily: 'Meiryo UI', fontSize: 10.5 }],
            [
              0,
              1,
              {
                bold: true,
                fontSize: 14,
                runs: [{ text: 'na' }, { text: 'me', fontFamily: 'Courier New', fontSize: 20, bold: false }],
              },
            ],
          ],
        },
      ],
    },
  },
  {
    // Shapes over a worksheet (`objects`), bottom to top, with the two locks.
    file: 'objects.rsf',
    engine: 'wasm',
    encodes: true,
    data: {
      delimiter: ',',
      activeSheetId: 's1',
      sheets: [
        {
          ...grid,
          objects: [
            { id: 'o1', name: 'Box', kind: 'rect', row: 1, col: 1, dx: 4, dy: 3, width: 120, height: 60 },
            {
              id: 'o2',
              name: 'Note',
              kind: 'text',
              row: 0,
              col: 2,
              dx: 0,
              dy: 0,
              width: 160,
              height: 48,
              rotation: 15,
              fill: '#fff2cc',
              stroke: 'none',
              text: 'Check\nthis',
              textColor: '#1f4e79',
              fontSize: 12,
              bold: true,
              align: 'center',
              valign: 'middle',
              lockEdit: true,
            },
            {
              id: 'o3',
              name: 'Arrow 1',
              kind: 'arrow',
              row: 3,
              col: 0,
              dx: 8,
              dy: 10,
              width: 128,
              height: 0,
              flipH: true,
              strokeWidth: 2.5,
              hidden: true,
              lockPosition: true,
            },
          ],
        },
      ],
    },
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
