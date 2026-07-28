// SPDX-License-Identifier: MIT
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  getRsfCodec,
  initCsvEngine,
  RSF_COMPRESSION_DEFLATE,
  setCsvEngineForTesting,
} from '../src/core/csv-engine';
import { parseXlsxWorkbook } from '../src/core/xlsx-import';
import { buildXlsxExport, type XlsxSheetInput } from '../src/core/xlsx-export';

// ----- Minimal ZIP writer, independent of the reader under test -----
// (STORE and DEFLATE methods, with hooks to inject corruption for negative tests.)

let crcTable: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function le16(n: number): Uint8Array {
  return new Uint8Array([n & 0xff, (n >>> 8) & 0xff]);
}
function le32(n: number): Uint8Array {
  return new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);
}
function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

interface ZipWriteEntry {
  name: string;
  method: 0 | 8;
  compressedData: Uint8Array;
  crc32: number;
  uncompressedSize: number;
  /** Overrides the size field written to the archive, without changing the real payload (for negative tests). */
  declaredUncompressedSize?: number;
}

function storeEntry(name: string, text: string): ZipWriteEntry {
  const data = new TextEncoder().encode(text);
  return { name, method: 0, compressedData: data, crc32: crc32(data), uncompressedSize: data.length };
}

function deflateEntry(name: string, text: string): ZipWriteEntry {
  const data = new TextEncoder().encode(text);
  const compressed = getRsfCodec().compress(data, RSF_COMPRESSION_DEFLATE);
  if (!compressed) {
    throw new Error('DEFLATE compression unavailable in this test run (WASM engine not active)');
  }
  return { name, method: 8, compressedData: compressed, crc32: crc32(data), uncompressedSize: data.length };
}

function writeZip(entries: ZipWriteEntry[]): Uint8Array {
  const textEncoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = textEncoder.encode(entry.name);
    const compressedSize = entry.compressedData.length;
    const declaredSize = entry.declaredUncompressedSize ?? entry.uncompressedSize;

    const localHeader = concatBytes([
      le32(0x04034b50),
      le16(20),
      le16(0),
      le16(entry.method),
      le16(0),
      le16(0x21),
      le32(entry.crc32),
      le32(compressedSize),
      le32(declaredSize),
      le16(nameBytes.length),
      le16(0),
      nameBytes,
    ]);
    localParts.push(localHeader, entry.compressedData);
    const localHeaderOffset = offset;
    offset += localHeader.length + entry.compressedData.length;

    centralParts.push(
      concatBytes([
        le32(0x02014b50),
        le16(20),
        le16(20),
        le16(0),
        le16(entry.method),
        le16(0),
        le16(0x21),
        le32(entry.crc32),
        le32(compressedSize),
        le32(declaredSize),
        le16(nameBytes.length),
        le16(0),
        le16(0),
        le16(0),
        le16(0),
        le32(0),
        le32(localHeaderOffset),
        nameBytes,
      ]),
    );
  }

  const centralDirectory = concatBytes(centralParts);
  const centralDirOffset = offset;
  const eocd = concatBytes([
    le32(0x06054b50),
    le16(0),
    le16(0),
    le16(entries.length),
    le16(entries.length),
    le32(centralDirectory.length),
    le32(centralDirOffset),
    le16(0),
  ]);
  return concatBytes([...localParts, centralDirectory, eocd]);
}

// ----- Minimal OOXML part builders -----

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function workbookXml(sheetNames: string[]): string {
  const sheets = sheetNames
    .map((name, i) => `<sheet name="${escapeXml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<sheets>${sheets}</sheets></workbook>`
  );
}

function workbookRelsXml(targets: string[]): string {
  const rels = targets
    .map(
      (target, i) =>
        `<Relationship Id="rId${i + 1}" ` +
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" ' +
        `Target="${target}"/>`,
    )
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    `${rels}</Relationships>`
  );
}

function sharedStringsXml(strings: string[]): string {
  const items = strings.map((s) => `<si><t xml:space="preserve">${escapeXml(s)}</t></si>`).join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    `count="${strings.length}" uniqueCount="${strings.length}">${items}</sst>`
  );
}

function sheetXml(rowsXml: string): string {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<sheetData>${rowsXml}</sheetData></worksheet>`
  );
}

function row(r: number, cellsXml: string): string {
  return `<row r="${r}">${cellsXml}</row>`;
}

function numCell(ref: string, v: string): string {
  return `<c r="${ref}"><v>${v}</v></c>`;
}
function typedCell(ref: string, t: string, v: string): string {
  return `<c r="${ref}" t="${t}"><v>${v}</v></c>`;
}
function inlineCell(ref: string, text: string): string {
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
}

describe('parseXlsxWorkbook: round trip with this app’s own export', () => {
  it('reads back a single-sheet workbook produced by buildXlsxExport', () => {
    const sheets: XlsxSheetInput[] = [
      {
        name: 'Sheet1',
        rows: [
          ['a', 'b'],
          ['1', '2'],
        ],
      },
    ];
    const result = parseXlsxWorkbook(buildXlsxExport(sheets));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sheets).toHaveLength(1);
    expect(result.sheets[0].name).toBe('Sheet1');
    expect(result.sheets[0].rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('reads back every worksheet, in order, from a multi-sheet workbook', () => {
    const sheets: XlsxSheetInput[] = [
      { name: 'Alpha', rows: [['x1', 'y1']] },
      { name: 'Beta', rows: [['x2']] },
    ];
    const result = parseXlsxWorkbook(buildXlsxExport(sheets));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sheets.map((s) => s.name)).toEqual(['Alpha', 'Beta']);
    expect(result.sheets[0].rows).toEqual([['x1', 'y1']]);
    expect(result.sheets[1].rows).toEqual([['x2']]);
  });
});

describe('parseXlsxWorkbook: cell types and shared/inline strings', () => {
  it('reads numeric, shared-string, inline-string, formula-string, boolean, error, and date cells', () => {
    const sharedStrings = sharedStringsXml(['shared hello']);
    const sheet = sheetXml(
      row(1, numCell('A1', '42') + typedCell('B1', 's', '0') + inlineCell('C1', 'inline text')) +
        row(2, typedCell('A2', 'str', 'computed') + typedCell('B2', 'b', '1') + typedCell('C2', 'b', '0')) +
        row(3, typedCell('A3', 'e', '#DIV/0!') + typedCell('B3', 'd', '2026-01-01')),
    );
    const zip = writeZip([
      storeEntry('xl/workbook.xml', workbookXml(['Sheet1'])),
      storeEntry('xl/_rels/workbook.xml.rels', workbookRelsXml(['worksheets/sheet1.xml'])),
      storeEntry('xl/sharedStrings.xml', sharedStrings),
      storeEntry('xl/worksheets/sheet1.xml', sheet),
    ]);
    const result = parseXlsxWorkbook(zip);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rows = result.sheets[0].rows;
    expect(rows[0]).toEqual(['42', 'shared hello', 'inline text']);
    expect(rows[1]).toEqual(['computed', 'TRUE', 'FALSE']);
    expect(rows[2]).toEqual(['#DIV/0!', '2026-01-01', '']);
  });

  it('resolves worksheet parts through workbook.xml.rels, independent of sheet order', () => {
    // "Second" is listed first in the workbook but its part is sheet2.xml;
    // resolution must follow the relationship, not positional numbering.
    const zip = writeZip([
      storeEntry('xl/workbook.xml', workbookXml(['Second', 'First'])),
      storeEntry(
        'xl/_rels/workbook.xml.rels',
        workbookRelsXml(['worksheets/sheet2.xml', 'worksheets/sheet1.xml']),
      ),
      storeEntry('xl/worksheets/sheet1.xml', sheetXml(row(1, numCell('A1', '1')))),
      storeEntry('xl/worksheets/sheet2.xml', sheetXml(row(1, numCell('A1', '2')))),
    ]);
    const result = parseXlsxWorkbook(zip);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sheets.map((s) => s.name)).toEqual(['Second', 'First']);
    expect(result.sheets[0].rows).toEqual([['2']]);
    expect(result.sheets[1].rows).toEqual([['1']]);
  });

  it('falls back to positional sheetN.xml when workbook.xml.rels is absent', () => {
    const zip = writeZip([
      storeEntry('xl/workbook.xml', workbookXml(['Only'])),
      storeEntry('xl/worksheets/sheet1.xml', sheetXml(row(1, numCell('A1', '7')))),
    ]);
    const result = parseXlsxWorkbook(zip);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sheets[0].rows).toEqual([['7']]);
  });
});

describe('parseXlsxWorkbook: DEFLATE-compressed entries (WASM engine)', () => {
  beforeAll(async () => {
    await initCsvEngine();
    setCsvEngineForTesting('wasm');
  });
  afterAll(() => setCsvEngineForTesting('js'));

  it('reads a workbook whose parts are DEFLATE-compressed, like a real Excel/LibreOffice file', () => {
    const zip = writeZip([
      deflateEntry('xl/workbook.xml', workbookXml(['Sheet1'])),
      deflateEntry('xl/_rels/workbook.xml.rels', workbookRelsXml(['worksheets/sheet1.xml'])),
      deflateEntry(
        'xl/worksheets/sheet1.xml',
        sheetXml(row(1, numCell('A1', '99') + inlineCell('B1', 'hi'))),
      ),
    ]);
    const result = parseXlsxWorkbook(zip);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sheets[0].rows).toEqual([['99', 'hi']]);
  });
});

describe('parseXlsxWorkbook: malformed input is rejected, never partially imported', () => {
  it('rejects bytes that are not a ZIP archive at all', () => {
    const result = parseXlsxWorkbook(new TextEncoder().encode('not a zip file'));
    expect(result).toEqual({ ok: false, error: 'not-a-zip' });
  });

  it('rejects a ZIP missing xl/workbook.xml', () => {
    const zip = writeZip([storeEntry('readme.txt', 'nothing useful here')]);
    const result = parseXlsxWorkbook(zip);
    expect(result).toEqual({ ok: false, error: 'missing-workbook' });
  });

  it('rejects a workbook with no worksheets', () => {
    const zip = writeZip([storeEntry('xl/workbook.xml', workbookXml([]))]);
    const result = parseXlsxWorkbook(zip);
    expect(result).toEqual({ ok: false, error: 'no-sheets' });
  });

  it('rejects a workbook whose worksheet part is missing', () => {
    const zip = writeZip([storeEntry('xl/workbook.xml', workbookXml(['Sheet1']))]);
    const result = parseXlsxWorkbook(zip);
    expect(result).toEqual({ ok: false, error: 'corrupt-entry' });
  });

  it('rejects a worksheet entry whose bytes were corrupted (CRC-32 mismatch)', () => {
    const sheet = storeEntry('xl/worksheets/sheet1.xml', sheetXml(row(1, numCell('A1', '1'))));
    sheet.compressedData = sheet.compressedData.slice();
    sheet.compressedData[sheet.compressedData.length - 1] ^= 0xff; // flip a byte, CRC now stale
    const zip = writeZip([storeEntry('xl/workbook.xml', workbookXml(['Sheet1'])), sheet]);
    const result = parseXlsxWorkbook(zip);
    expect(result).toEqual({ ok: false, error: 'corrupt-entry' });
  });

  it('rejects a shared-string index out of range', () => {
    const zip = writeZip([
      storeEntry('xl/workbook.xml', workbookXml(['Sheet1'])),
      storeEntry('xl/worksheets/sheet1.xml', sheetXml(row(1, typedCell('A1', 's', '0')))),
      // no xl/sharedStrings.xml part at all: index 0 is out of range.
    ]);
    const result = parseXlsxWorkbook(zip);
    expect(result).toEqual({ ok: false, error: 'corrupt-entry' });
  });

  it('rejects a cell reference beyond the Excel column limit', () => {
    const zip = writeZip([
      storeEntry('xl/workbook.xml', workbookXml(['Sheet1'])),
      storeEntry('xl/worksheets/sheet1.xml', sheetXml(row(1, numCell('ZZZZ1', '1')))),
    ]);
    const result = parseXlsxWorkbook(zip);
    expect(result).toEqual({ ok: false, error: 'corrupt-entry' });
  });

  it('rejects a declared uncompressed size beyond the decompression-bomb guard', () => {
    const wb = storeEntry('xl/workbook.xml', workbookXml(['Sheet1']));
    wb.declaredUncompressedSize = 1024 * 1024 * 1024; // 1 GiB, well past the 512 MiB guard
    const zip = writeZip([wb]);
    const result = parseXlsxWorkbook(zip);
    expect(result).toEqual({ ok: false, error: 'missing-workbook' });
  });

  it('rejects a workbook whose materialized grid would exceed the total-cell guard', () => {
    // A single cell near the edge of Excel's own grid (row 1,048,576, column T)
    // is enough to force a ~21M-cell dense array if not caught before allocating.
    const zip = writeZip([
      storeEntry('xl/workbook.xml', workbookXml(['Sheet1'])),
      storeEntry('xl/worksheets/sheet1.xml', sheetXml(row(1_048_576, numCell('T1048576', '1')))),
    ]);
    const result = parseXlsxWorkbook(zip);
    expect(result).toEqual({ ok: false, error: 'too-large' });
  });
});
