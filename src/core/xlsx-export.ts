// SPDX-License-Identifier: MIT
/**
 * Lossy workbook → XLSX (Excel Open XML) export.
 *
 * Like CSV export, this serializes only the *displayed* (calculated) values
 * of one or more worksheets — no formulas, styles, column widths, or other
 * spreadsheet-only data — and never touches the source document. Unlike CSV,
 * XLSX natively holds multiple worksheets, so a whole workbook can be
 * exported in one file with no per-sheet choice required.
 *
 * The `.xlsx` container is a ZIP archive of OOXML parts. Every entry is
 * written with the ZIP STORE method (no compression), which is fully
 * spec-valid and needs no compression codec, so this module has no
 * dependency beyond the standard `TextEncoder`. Timestamps are fixed to the
 * DOS epoch (1980-01-01) so the same input always produces byte-identical
 * output.
 */

export interface XlsxSheetInput {
  /** Display name for the worksheet tab; sanitized and de-duplicated on write. */
  name: string;
  /** Display values, row-major. Rows may be ragged; missing cells are blank. */
  rows: string[][];
}

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** XML forbids these control code points outright, even escaped. */
// eslint-disable-next-line no-control-regex
const XML_ILLEGAL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

function escapeXmlText(text: string): string {
  return text
    .replace(XML_ILLEGAL_CHARS, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Column index (0-based) to spreadsheet letters: 0 -> A, 25 -> Z, 26 -> AA. */
function columnLetters(index: number): string {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

const EXCEL_SHEET_NAME_FORBIDDEN = /[[\]:*?/\\]/g;
const MAX_SHEET_NAME_LENGTH = 31;

/** Excel worksheet names forbid `[ ] : * ? / \` and are capped at 31 characters. */
function sanitizeSheetName(name: string, index: number, taken: Set<string>): string {
  let base = name.replace(EXCEL_SHEET_NAME_FORBIDDEN, '_').slice(0, MAX_SHEET_NAME_LENGTH);
  if (base.length === 0) {
    base = `Sheet${index + 1}`;
  }
  let candidate = base;
  let suffix = 2;
  while (taken.has(candidate.toLowerCase())) {
    const tag = ` (${suffix})`;
    candidate = base.slice(0, MAX_SHEET_NAME_LENGTH - tag.length) + tag;
    suffix++;
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}

/**
 * A cell counts as a plain number only when its text is the exact canonical
 * decimal form Excel would display back (no leading zeros, no plus sign, no
 * exponent) — anything else (formatted numbers, leading zeros, dates) is kept
 * as text so the visible characters never change on export.
 */
const CANONICAL_NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?$/;

function isCanonicalNumber(text: string): boolean {
  return CANONICAL_NUMBER.test(text) && Number.isFinite(Number(text)) && String(Number(text)) === text;
}

function buildSheetXml(rows: string[][]): string {
  let maxCol = 0;
  const rowsXml: string[] = [];
  for (let r = 0; r < rows.length; r++) {
    const values = rows[r];
    const cellsXml: string[] = [];
    for (let c = 0; c < values.length; c++) {
      const text = values[c];
      if (text === '') continue;
      maxCol = Math.max(maxCol, c + 1);
      const ref = `${columnLetters(c)}${r + 1}`;
      if (isCanonicalNumber(text)) {
        cellsXml.push(`<c r="${ref}"><v>${text}</v></c>`);
      } else {
        cellsXml.push(
          `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXmlText(text)}</t></is></c>`,
        );
      }
    }
    rowsXml.push(`<row r="${r + 1}">${cellsXml.join('')}</row>`);
  }
  const lastRow = Math.max(1, rows.length);
  const lastCol = Math.max(1, maxCol);
  const dimension = `A1:${columnLetters(lastCol - 1)}${lastRow}`;
  return (
    XML_DECLARATION +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<dimension ref="${dimension}"/>` +
    `<sheetData>${rowsXml.join('')}</sheetData>` +
    '</worksheet>'
  );
}

function buildWorkbookXml(names: string[]): string {
  const sheetsXml = names
    .map((name, i) => `<sheet name="${escapeXmlText(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join('');
  return (
    XML_DECLARATION +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<sheets>${sheetsXml}</sheets>` +
    '</workbook>'
  );
}

function buildWorkbookRelsXml(count: number): string {
  const rels: string[] = [];
  for (let i = 0; i < count; i++) {
    rels.push(
      `<Relationship Id="rId${i + 1}" ` +
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" ' +
        `Target="worksheets/sheet${i + 1}.xml"/>`,
    );
  }
  return (
    XML_DECLARATION +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    rels.join('') +
    '</Relationships>'
  );
}

const ROOT_RELS_XML =
  XML_DECLARATION +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" ' +
  'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" ' +
  'Target="xl/workbook.xml"/>' +
  '</Relationships>';

function buildContentTypesXml(count: number): string {
  const overrides: string[] = [];
  for (let i = 0; i < count; i++) {
    overrides.push(
      `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ` +
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>',
    );
  }
  return (
    XML_DECLARATION +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ' +
    'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    overrides.join('') +
    '</Types>'
  );
}

// ----- ZIP container (STORE method only) -----

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

interface ZipEntry {
  name: string;
  data: Uint8Array;
}

// 1980-01-01 00:00:00, the minimum representable DOS date/time — used for
// every entry so exporting the same document twice yields identical bytes.
const DOS_DATE = 0x21;
const DOS_TIME = 0x00;
const ZIP_VERSION = 20;

function buildZip(entries: ZipEntry[]): Uint8Array {
  const textEncoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = textEncoder.encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const localHeader = concatBytes([
      le32(0x04034b50),
      le16(ZIP_VERSION),
      le16(0), // general purpose flag
      le16(0), // compression method: store
      le16(DOS_TIME),
      le16(DOS_DATE),
      le32(crc),
      le32(size), // compressed size
      le32(size), // uncompressed size
      le16(nameBytes.length),
      le16(0), // extra field length
      nameBytes,
    ]);
    localParts.push(localHeader, entry.data);
    const localHeaderOffset = offset;
    offset += localHeader.length + entry.data.length;

    centralParts.push(
      concatBytes([
        le32(0x02014b50),
        le16(ZIP_VERSION), // version made by
        le16(ZIP_VERSION), // version needed to extract
        le16(0), // general purpose flag
        le16(0), // compression method: store
        le16(DOS_TIME),
        le16(DOS_DATE),
        le32(crc),
        le32(size),
        le32(size),
        le16(nameBytes.length),
        le16(0), // extra field length
        le16(0), // file comment length
        le16(0), // disk number start
        le16(0), // internal file attributes
        le32(0), // external file attributes
        le32(localHeaderOffset),
        nameBytes,
      ]),
    );
  }

  const centralDirectory = concatBytes(centralParts);
  const centralDirOffset = offset;

  const eocd = concatBytes([
    le32(0x06054b50),
    le16(0), // disk number
    le16(0), // disk where central directory starts
    le16(entries.length), // central directory records on this disk
    le16(entries.length), // total central directory records
    le32(centralDirectory.length),
    le32(centralDirOffset),
    le16(0), // comment length
  ]);

  return concatBytes([...localParts, centralDirectory, eocd]);
}

/** Build a minimal, valid `.xlsx` package from already-scanned display values. */
export function buildXlsxExport(sheets: XlsxSheetInput[]): Uint8Array {
  const taken = new Set<string>();
  const names = sheets.map((s, i) => sanitizeSheetName(s.name, i, taken));
  const textEncoder = new TextEncoder();

  const entries: ZipEntry[] = [
    { name: '[Content_Types].xml', data: textEncoder.encode(buildContentTypesXml(sheets.length)) },
    { name: '_rels/.rels', data: textEncoder.encode(ROOT_RELS_XML) },
    { name: 'xl/workbook.xml', data: textEncoder.encode(buildWorkbookXml(names)) },
    { name: 'xl/_rels/workbook.xml.rels', data: textEncoder.encode(buildWorkbookRelsXml(sheets.length)) },
  ];
  sheets.forEach((sheet, i) => {
    entries.push({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      data: textEncoder.encode(buildSheetXml(sheet.rows)),
    });
  });

  return buildZip(entries);
}
