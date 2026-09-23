// SPDX-License-Identifier: MIT
/**
 * Frozen `.rsf` compatibility corpus.
 *
 * Every other RSF test builds its bytes with the *current* encoder, so an
 * encoder and decoder that drift together still pass. These fixtures are
 * committed bytes (tests/fixtures/rsf/), one per step of the body-version
 * ladder plus each compression method and the multi-sheet workbook
 * container. Two independent checks run against each:
 *
 *  1. **Decode (the compatibility guarantee).** The committed bytes must
 *     still decode to the input they were written from. A fixture is never
 *     rewritten: a file saved by an older release must open forever.
 *  2. **Encode (output stability).** Encoding the same input must still
 *     reproduce the fixture byte-for-byte — for the compressed fixtures this
 *     also pins the embedded WASM codecs' output (src/wasm-gen/). An
 *     intentional format change fails here: keep the old fixture (its decode
 *     check stays), mark its `encodes` as `false`, and add a new fixture for
 *     the new output.
 *
 * To add a fixture, add a case below and run
 * `RSF_FIXTURES_WRITE=1 npx vitest run tests/rsf-fixtures.test.ts`, which
 * writes only fixture files that do not exist yet — never an existing one.
 * See knowledge/formats/rsf/compatibility.md.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  initCsvEngine,
  RSF_COMPRESSION_DEFLATE,
  RSF_COMPRESSION_LZ4,
  RSF_COMPRESSION_STORE,
  RSF_COMPRESSION_ZSTD,
} from '../src/core/csv-engine';
import {
  decodeRsf,
  decodeRsfWorkbook,
  encodeRsf,
  encodeRsfWorkbook,
  type RsfData,
  type RsfWorkbookData,
} from '../src/core/rsf-codec';

const FIXTURE_DIR = new URL('./fixtures/rsf/', import.meta.url);
const WRITE_MISSING = import.meta.env.RSF_FIXTURES_WRITE === '1';
const HEADER_SIZE = 20;

const base: RsfData = {
  name: 'Sheet1',
  delimiter: ',',
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

/** A larger, repetitive sheet so the compressed fixtures actually compress. */
const bulk: RsfData = {
  ...base,
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

interface SheetCase {
  file: string;
  data: RsfData;
  method: number;
  /** Body version the fixture was written with (store fixtures only). */
  bodyVersion?: number;
  /** False once the encoder intentionally stops producing these bytes. */
  encodes: boolean;
}

const sheetCases: SheetCase[] = [
  { file: 'v01-cells.rsf', data: base, bodyVersion: 1 },
  { file: 'v02-meta.rsf', data: { ...base, appName: 'Refrain Sheet', appVersion: '0.8.6' }, bodyVersion: 2 },
  {
    file: 'v03-display.rsf',
    data: { ...base, display: { zoom: 125, colWidths: [[1, 240]] } },
    bodyVersion: 3,
  },
  {
    file: 'v04-filter.rsf',
    data: {
      ...base,
      filter: {
        top: 0,
        left: 0,
        bottom: 3,
        right: 2,
        headerRow: true,
        columns: [{ col: 0, join: 'and', conditions: [], values: ['1'] }],
      },
    },
    bodyVersion: 4,
  },
  { file: 'v05-wrap.rsf', data: { ...base, display: { wrap: true } }, bodyVersion: 5 },
  { file: 'v06-timezone.rsf', data: { ...base, timezone: 'Asia/Tokyo' }, bodyVersion: 6 },
  { file: 'v07-display-language.rsf', data: { ...base, displayLanguage: 'ja' }, bodyVersion: 7 },
  {
    file: 'v08-styles.rsf',
    data: {
      ...base,
      styles: [[1, 1, { bold: true, italic: true, textColor: '#c0392b', backgroundColor: '#fdf2e9' }]],
    },
    bodyVersion: 8,
  },
  {
    file: 'v09-number-format.rsf',
    data: {
      ...base,
      styles: [
        [1, 0, { numberFormat: { kind: 'currency', decimals: 2, thousands: true, currencySymbol: '¥' } }],
      ],
    },
    bodyVersion: 9,
  },
  {
    file: 'v10-borders.rsf',
    data: {
      ...base,
      styles: [[2, 2, { borderTop: '#000000', borderTopStyle: 'dashed', borderTopWidth: 'thick' }]],
    },
    bodyVersion: 10,
  },
  { file: 'v11-comments.rsf', data: { ...base, comments: [[1, 1, 'a note — ünïcödé']] }, bodyVersion: 11 },
  {
    file: 'v12-markdown.rsf',
    data: { ...base, kind: 'markdown', rowCount: 1, columnCount: 1, cells: [[0, 0, '# Title\n\nBody']] },
    bodyVersion: 12,
  },
  { file: 'v13-locked.rsf', data: { ...base, locked: true }, bodyVersion: 13 },
  {
    file: 'v14-history.rsf',
    data: { ...base, history: [{ timestamp: 1_758_585_600_000, bytes: new Uint8Array([1, 2, 3, 4, 5]) }] },
    bodyVersion: 14,
  },
  {
    file: 'v15-json.rsf',
    data: { ...base, kind: 'json', rowCount: 1, columnCount: 1, cells: [[0, 0, '{"a":[1,2]}']] },
    bodyVersion: 15,
  },
  { file: 'v16-history-cap.rsf', data: { ...base, historyMaxOverride: 7 }, bodyVersion: 16 },
  {
    file: 'v17-yaml.rsf',
    data: { ...base, kind: 'yaml', rowCount: 1, columnCount: 1, cells: [[0, 0, 'a: 1\nb: [2, 3]\n']] },
    bodyVersion: 17,
  },
  { file: 'v17-auto-format.rsf', data: { ...base, autoFormatSource: true }, bodyVersion: 17 },
  { file: 'method-deflate.rsf', data: bulk, method: RSF_COMPRESSION_DEFLATE },
  { file: 'method-zstd.rsf', data: bulk, method: RSF_COMPRESSION_ZSTD },
  { file: 'method-lz4.rsf', data: bulk, method: RSF_COMPRESSION_LZ4 },
].map((c) => ({ method: RSF_COMPRESSION_STORE, encodes: true, ...c }) as SheetCase);

interface WorkbookCase {
  file: string;
  data: RsfWorkbookData;
  method: number;
  encodes: boolean;
}

const workbookCases: WorkbookCase[] = [
  {
    file: 'workbook-two-sheets.rsf',
    method: RSF_COMPRESSION_STORE,
    encodes: true,
    data: {
      delimiter: ',',
      appName: 'Refrain Sheet',
      appVersion: '0.8.6',
      timezone: 'Asia/Tokyo',
      activeSheetId: 'b',
      sheets: [
        {
          id: 'a',
          name: 'Data',
          rowCount: 3,
          columnCount: 2,
          cells: [
            [0, 0, 'x'],
            [1, 0, '2'],
          ],
        },
        {
          id: 'b',
          name: 'Sum',
          rowCount: 2,
          columnCount: 2,
          cells: [[0, 0, '=SUM(Data!A1:A2)']],
          comments: [[0, 0, 'cross-sheet']],
        },
      ],
    },
  },
  {
    file: 'workbook-zstd.rsf',
    method: RSF_COMPRESSION_ZSTD,
    encodes: true,
    data: {
      delimiter: ';',
      sheets: [
        { id: 'a', name: 'One', rowCount: bulk.rowCount, columnCount: bulk.columnCount, cells: bulk.cells },
        { id: 'b', name: 'Two', rowCount: 1, columnCount: 1, cells: [[0, 0, 'two']], locked: true },
      ],
    },
  },
];

function loadFixture(file: string, encode: () => Uint8Array): Uint8Array {
  const url = new URL(file, FIXTURE_DIR);
  if (!existsSync(url)) {
    if (!WRITE_MISSING) throw new Error(`missing fixture ${file} (see this file's header to add one)`);
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(url, encode());
  }
  return new Uint8Array(readFileSync(url));
}

describe('frozen .rsf fixtures', () => {
  beforeAll(async () => {
    // The compressed methods need the embedded WASM codec engine.
    await initCsvEngine();
  });

  describe.each(sheetCases)('$file', ({ file, data, method, bodyVersion, encodes }) => {
    const bytes = () => loadFixture(file, () => encodeRsf(data, method));

    it('decodes to the data it was written from', () => {
      const fixture = bytes();
      expect(fixture[5]).toBe(method);
      if (bodyVersion !== undefined) expect(fixture[HEADER_SIZE]).toBe(bodyVersion);
      const decoded = decodeRsf(fixture);
      expect(decoded.ok).toBe(true);
      if (decoded.ok) expect(decoded.data).toMatchObject({ ...data, compression: method });
    });

    it.runIf(encodes)('is still reproduced byte-for-byte by the encoder', () => {
      expect(encodeRsf(data, method)).toEqual(bytes());
    });
  });

  describe.each(workbookCases)('$file', ({ file, data, method, encodes }) => {
    const bytes = () => loadFixture(file, () => encodeRsfWorkbook(data, method));

    it('decodes to the workbook it was written from', () => {
      const fixture = bytes();
      expect(fixture[5]).toBe(method);
      const decoded = decodeRsfWorkbook(fixture);
      expect(decoded.ok).toBe(true);
      if (decoded.ok) expect(decoded.data).toMatchObject(data);
    });

    it.runIf(encodes)('is still reproduced byte-for-byte by the encoder', () => {
      expect(encodeRsfWorkbook(data, method)).toEqual(bytes());
    });
  });
});
