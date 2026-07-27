// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { buildXlsxExport, type XlsxSheetInput } from '../src/core/xlsx-export';

// ----- Minimal STORE-only ZIP reader, independent of the writer under test -----

interface ZipEntry {
  name: string;
  data: Uint8Array;
  crc32: number;
}

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

function parseZip(bytes: Uint8Array): Map<string, ZipEntry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // No archive comment is ever written, so the EOCD record is always the last 22 bytes.
  const eocdOffset = bytes.length - 22;
  expect(view.getUint32(eocdOffset, true)).toBe(0x06054b50);
  const totalRecords = view.getUint16(eocdOffset + 10, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);

  const entries = new Map<string, ZipEntry>();
  let pos = cdOffset;
  for (let i = 0; i < totalRecords; i++) {
    expect(view.getUint32(pos, true)).toBe(0x02014b50);
    const method = view.getUint16(pos + 10, true);
    expect(method).toBe(0); // STORE only
    const declaredCrc = view.getUint32(pos + 16, true);
    const compressedSize = view.getUint32(pos + 20, true);
    const uncompressedSize = view.getUint32(pos + 24, true);
    expect(compressedSize).toBe(uncompressedSize); // no compression, so sizes match
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const localHeaderOffset = view.getUint32(pos + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(pos + 46, pos + 46 + nameLen));

    expect(view.getUint32(localHeaderOffset, true)).toBe(0x04034b50);
    const localNameLen = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const data = bytes.slice(dataStart, dataStart + uncompressedSize);
    expect(crc32(data)).toBe(declaredCrc);

    entries.set(name, { name, data, crc32: declaredCrc });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function textOf(entries: Map<string, ZipEntry>, name: string): string {
  const entry = entries.get(name);
  expect(entry, `missing ZIP entry ${name}`).toBeDefined();
  return new TextDecoder().decode(entry!.data);
}

function expectWellFormedXml(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  expect(doc.querySelector('parsererror'), `not well-formed:\n${xml}`).toBeNull();
  return doc;
}

describe('buildXlsxExport (pure)', () => {
  it('produces a structurally valid ZIP with every required OOXML part', () => {
    const sheets: XlsxSheetInput[] = [
      { name: 'Sheet1', rows: [['a', 'b']] },
      { name: 'Sheet2', rows: [['c']] },
    ];
    const entries = parseZip(buildXlsxExport(sheets));
    expect([...entries.keys()].sort()).toEqual(
      [
        '[Content_Types].xml',
        '_rels/.rels',
        'xl/_rels/workbook.xml.rels',
        'xl/workbook.xml',
        'xl/worksheets/sheet1.xml',
        'xl/worksheets/sheet2.xml',
      ].sort(),
    );
  });

  it('produces well-formed XML for every part', () => {
    const sheets: XlsxSheetInput[] = [
      { name: 'One', rows: [['x', '1']] },
      { name: 'Two', rows: [['y', '2']] },
    ];
    const entries = parseZip(buildXlsxExport(sheets));
    for (const name of entries.keys()) {
      expectWellFormedXml(textOf(entries, name));
    }
  });

  it('lists worksheets in order with the given names', () => {
    const sheets: XlsxSheetInput[] = [
      { name: 'Alpha', rows: [['1']] },
      { name: 'Beta', rows: [['2']] },
      { name: 'Gamma', rows: [['3']] },
    ];
    const entries = parseZip(buildXlsxExport(sheets));
    const workbook = expectWellFormedXml(textOf(entries, 'xl/workbook.xml'));
    const sheetEls = [...workbook.querySelectorAll('sheet')];
    expect(sheetEls.map((s) => s.getAttribute('name'))).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(sheetEls.map((s) => s.getAttribute('sheetId'))).toEqual(['1', '2', '3']);
    expect(sheetEls.map((s) => s.getAttribute('r:id'))).toEqual(['rId1', 'rId2', 'rId3']);
  });

  it('sanitizes forbidden characters, truncates, and de-duplicates worksheet names', () => {
    const longName = 'x'.repeat(40);
    const sheets: XlsxSheetInput[] = [
      { name: 'Sales/Q1:2026', rows: [['1']] },
      { name: longName, rows: [['2']] },
      { name: 'Sales_Q1_2026', rows: [['3']] }, // collides with the sanitized first name
    ];
    const entries = parseZip(buildXlsxExport(sheets));
    const workbook = expectWellFormedXml(textOf(entries, 'xl/workbook.xml'));
    const names = [...workbook.querySelectorAll('sheet')].map((s) => s.getAttribute('name'));
    expect(names[0]).toBe('Sales_Q1_2026');
    expect(names[1]).toHaveLength(31);
    expect(names[2]).toBe('Sales_Q1_2026 (2)');
  });

  it('supports a single-sheet workbook (the CSV-tab export shape)', () => {
    const entries = parseZip(buildXlsxExport([{ name: 'data', rows: [['1', '2']] }]));
    expect([...entries.keys()]).toContain('xl/worksheets/sheet1.xml');
    expect([...entries.keys()]).not.toContain('xl/worksheets/sheet2.xml');
  });

  it('encodes canonical-decimal text as numeric cells and everything else as inline strings', () => {
    const rows = [['42', '-3.5', '007', '1.0', 'hello', '']];
    const entries = parseZip(buildXlsxExport([{ name: 'S', rows }]));
    const sheet = expectWellFormedXml(textOf(entries, 'xl/worksheets/sheet1.xml'));
    const cellByRef = new Map([...sheet.querySelectorAll('c')].map((c) => [c.getAttribute('r'), c]));

    expect(cellByRef.get('A1')?.getAttribute('t')).toBeNull();
    expect(cellByRef.get('A1')?.querySelector('v')?.textContent).toBe('42');

    expect(cellByRef.get('B1')?.getAttribute('t')).toBeNull();
    expect(cellByRef.get('B1')?.querySelector('v')?.textContent).toBe('-3.5');

    // Leading zeros, trailing ".0", and any other non-canonical numeric text
    // must stay as text so the visible characters never change.
    expect(cellByRef.get('C1')?.getAttribute('t')).toBe('inlineStr');
    expect(cellByRef.get('C1')?.querySelector('t')?.textContent).toBe('007');
    expect(cellByRef.get('D1')?.getAttribute('t')).toBe('inlineStr');
    expect(cellByRef.get('D1')?.querySelector('t')?.textContent).toBe('1.0');

    expect(cellByRef.get('E1')?.getAttribute('t')).toBe('inlineStr');
    expect(cellByRef.get('E1')?.querySelector('t')?.textContent).toBe('hello');

    // An empty cell is omitted entirely rather than written as a blank cell.
    expect(cellByRef.has('F1')).toBe(false);
  });

  it('escapes XML-special characters and strips characters XML forbids outright', () => {
    const illegal = String.fromCharCode(0x0b); // a vertical tab: legal JS, illegal raw XML
    const rows = [['<a & b> "quoted"', `tab\tkeep\ncontrol${illegal}drop`]];
    const entries = parseZip(buildXlsxExport([{ name: 'S', rows }]));
    const sheet = expectWellFormedXml(textOf(entries, 'xl/worksheets/sheet1.xml'));
    const cells = [...sheet.querySelectorAll('c')];
    expect(cells[0].querySelector('t')?.textContent).toBe('<a & b> "quoted"');
    // Tab and newline are legal XML text and survive; the control character is
    // not legal even escaped, so it is dropped.
    expect(cells[1].querySelector('t')?.textContent).toBe('tab\tkeep\ncontroldrop');
  });

  it('marks the used range in <dimension> and writes one <row> per sheet row', () => {
    const rows = [
      ['1', '2', ''],
      ['', '', ''],
      ['', '', '3'],
    ];
    const entries = parseZip(buildXlsxExport([{ name: 'S', rows }]));
    const sheet = expectWellFormedXml(textOf(entries, 'xl/worksheets/sheet1.xml'));
    expect(sheet.querySelector('dimension')?.getAttribute('ref')).toBe('A1:C3');
    expect(sheet.querySelectorAll('row')).toHaveLength(3);
  });

  it('produces byte-identical output for the same input (deterministic export)', () => {
    const sheets: XlsxSheetInput[] = [{ name: 'S', rows: [['a', '1']] }];
    const first = buildXlsxExport(sheets);
    const second = buildXlsxExport(sheets);
    expect([...first]).toEqual([...second]);
  });
});
