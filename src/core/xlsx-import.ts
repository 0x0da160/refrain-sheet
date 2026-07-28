// SPDX-License-Identifier: MIT
/**
 * XLSX (Excel Open XML) → workbook import.
 *
 * The counterpart to `xlsx-export.ts`: reads an arbitrary, untrusted `.xlsx`
 * file (a ZIP archive of OOXML parts) into row-major worksheet values,
 * symmetric with export's lossy scope — only calculated/display values are
 * read. Formulas, cell styles/number formats, merged cells, column widths,
 * and charts are not parsed; a numeric cell formatted as a date by
 * `styles.xml` therefore imports as its raw serial-number text, matching
 * export's own display-value-only round trip.
 *
 * A real `.xlsx` is normally DEFLATE-compressed (Excel, LibreOffice, and
 * Google Sheets never write STORE-only archives, unlike this app's own
 * export), so — unlike the writer — this reader needs an actual ZIP central
 * directory walk and DEFLATE decompression. The DEFLATE step reuses the
 * existing bounded WASM `rcsvInflate` export (via `getRsfCodec`), already
 * trusted for `.rsf`'s own compressed container, so no new dependency or new
 * WASM surface is introduced.
 */

import { getRsfCodec, RSF_COMPRESSION_DEFLATE } from './csv-engine';
import { parseRef } from './formula';

export interface XlsxImportSheet {
  /** Worksheet display name, taken from `xl/workbook.xml`. */
  name: string;
  /** Display values, row-major, dense (padded to `columnCount`). */
  rows: string[][];
  columnCount: number;
}

export type XlsxImportError = 'not-a-zip' | 'missing-workbook' | 'no-sheets' | 'corrupt-entry' | 'too-large';

export type XlsxImportResult =
  { ok: true; sheets: XlsxImportSheet[] } | { ok: false; error: XlsxImportError };

// ----- ZIP container reader (central directory; STORE and DEFLATE methods) -----

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;
const EOCD_SIZE = 22;
const MAX_ZIP_COMMENT_LENGTH = 0xffff;

const ZIP_METHOD_STORE = 0;
const ZIP_METHOD_DEFLATE = 8;

/**
 * Bound on a single decompressed ZIP entry, independent of Excel's own grid
 * limits below: this guards the decompression step itself (a decompression
 * bomb) before any cell data is even parsed.
 */
const MAX_INFLATED_ENTRY_BYTES = 512 * 1024 * 1024;

interface RawZipEntry {
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  dataOffset: number;
  crc32: number;
}

/** Find the End Of Central Directory record, searching back past any archive comment. */
function findEndOfCentralDirectory(view: DataView, length: number): number | null {
  if (length < EOCD_SIZE) {
    return null;
  }
  const searchStart = Math.max(0, length - EOCD_SIZE - MAX_ZIP_COMMENT_LENGTH);
  for (let pos = length - EOCD_SIZE; pos >= searchStart; pos--) {
    if (view.getUint32(pos, true) === EOCD_SIGNATURE) {
      return pos;
    }
  }
  return null;
}

/** Walk the ZIP central directory, returning every entry keyed by its stored path. */
function readCentralDirectory(bytes: Uint8Array): Map<string, RawZipEntry> | null {
  if (bytes.length < EOCD_SIZE) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdOffset = findEndOfCentralDirectory(view, bytes.length);
  if (eocdOffset === null) {
    return null;
  }
  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);
  if (cdOffset > bytes.length) {
    return null;
  }

  const entries = new Map<string, RawZipEntry>();
  const textDecoder = new TextDecoder();
  let pos = cdOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (pos + 46 > bytes.length || view.getUint32(pos, true) !== CENTRAL_DIR_SIGNATURE) {
      return null;
    }
    const method = view.getUint16(pos + 10, true);
    const crc32 = view.getUint32(pos + 16, true);
    const compressedSize = view.getUint32(pos + 20, true);
    const uncompressedSize = view.getUint32(pos + 24, true);
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const localHeaderOffset = view.getUint32(pos + 42, true);
    const nameStart = pos + 46;
    if (nameStart + nameLen > bytes.length) {
      return null;
    }
    const name = textDecoder.decode(bytes.subarray(nameStart, nameStart + nameLen)).replace(/\\/g, '/');

    if (
      localHeaderOffset + 30 > bytes.length ||
      view.getUint32(localHeaderOffset, true) !== LOCAL_FILE_SIGNATURE
    ) {
      return null;
    }
    const localNameLen = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
    const dataOffset = localHeaderOffset + 30 + localNameLen + localExtraLen;
    if (dataOffset + compressedSize > bytes.length) {
      return null;
    }

    entries.set(name, { method, compressedSize, uncompressedSize, dataOffset, crc32 });
    pos = nameStart + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Decompress one ZIP entry's bytes, or `null` on an unsupported method or a corrupt/oversized payload. */
function readZipEntryBytes(bytes: Uint8Array, entry: RawZipEntry): Uint8Array | null {
  if (entry.uncompressedSize > MAX_INFLATED_ENTRY_BYTES) {
    return null;
  }
  const payload = bytes.subarray(entry.dataOffset, entry.dataOffset + entry.compressedSize);
  const codec = getRsfCodec();
  let data: Uint8Array | null;
  if (entry.method === ZIP_METHOD_STORE) {
    data = entry.compressedSize === entry.uncompressedSize ? payload.slice() : null;
  } else if (entry.method === ZIP_METHOD_DEFLATE) {
    // Raw ZIP DEFLATE is exactly the container format `getRsfCodec` already
    // decompresses for `.rsf`; reusing it needs no new WASM export.
    data = codec.decompress(payload, RSF_COMPRESSION_DEFLATE, entry.uncompressedSize);
  } else {
    return null; // e.g. a legacy method this reader does not implement
  }
  return data && codec.crc32(data) === entry.crc32 ? data : null;
}

function readZipTextPart(entries: Map<string, RawZipEntry>, bytes: Uint8Array, path: string): string | null {
  const entry = entries.get(path);
  if (!entry) {
    return null;
  }
  const decoded = readZipEntryBytes(bytes, entry);
  return decoded ? new TextDecoder('utf-8').decode(decoded) : null;
}

// ----- Minimal XML text extraction (only the OOXML shapes this reader needs) -----

const XML_ENTITY_RE = /&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g;

function decodeXmlEntities(text: string): string {
  return text.replace(XML_ENTITY_RE, (match, entity: string) => {
    switch (entity) {
      case 'amp':
        return '&';
      case 'lt':
        return '<';
      case 'gt':
        return '>';
      case 'quot':
        return '"';
      case 'apos':
        return "'";
    }
    const codePoint = entity[1] === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    if (Number.isFinite(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff) {
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return match;
      }
    }
    return match;
  });
}

/** First attribute value for `name` on a tag's raw attribute text, either quote style. */
function getAttr(attrs: string, name: string): string | null {
  const re = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"|\\b${name}\\s*=\\s*'([^']*)'`);
  const m = re.exec(attrs);
  if (!m) {
    return null;
  }
  return decodeXmlEntities(m[1] ?? m[2] ?? '');
}

/** Concatenate every `<t>` run's text found anywhere inside `fragment` (plain or rich text). */
function extractRunText(fragment: string): string {
  const T_RE = /<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g;
  let out = '';
  let m: RegExpExecArray | null;
  while ((m = T_RE.exec(fragment))) {
    if (m[1] !== undefined) {
      out += decodeXmlEntities(m[1]);
    }
  }
  return out;
}

function extractCellValueText(cellContent: string): string | null {
  const m = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(cellContent);
  return m ? decodeXmlEntities(m[1]) : null;
}

// ----- Workbook structure -----

interface WorkbookSheetRef {
  name: string;
  relId: string | null;
}

function parseWorkbookSheets(xml: string): WorkbookSheetRef[] {
  const sheets: WorkbookSheetRef[] = [];
  const SHEET_RE = /<sheet\b([^>]*)\/>|<sheet\b([^>]*)>/g;
  let m: RegExpExecArray | null;
  while ((m = SHEET_RE.exec(xml))) {
    const attrs = m[1] ?? m[2] ?? '';
    const name = getAttr(attrs, 'name');
    if (name === null) {
      continue;
    }
    const relId = getAttr(attrs, 'r:id');
    sheets.push({ name, relId });
  }
  return sheets;
}

/** `xl/_rels/workbook.xml.rels`: relationship id -> worksheet part path (resolved from `xl/`). */
function parseWorkbookRels(xml: string): Map<string, string> {
  const rels = new Map<string, string>();
  const REL_RE = /<Relationship\b([^>]*)\/>|<Relationship\b([^>]*)>/g;
  let m: RegExpExecArray | null;
  while ((m = REL_RE.exec(xml))) {
    const attrs = m[1] ?? m[2] ?? '';
    const id = getAttr(attrs, 'Id');
    const target = getAttr(attrs, 'Target');
    if (id === null || target === null) {
      continue;
    }
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
    rels.set(id, path);
  }
  return rels;
}

function parseSharedStrings(xml: string): string[] {
  const strings: string[] = [];
  const SI_RE = /<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g;
  let m: RegExpExecArray | null;
  while ((m = SI_RE.exec(xml))) {
    strings.push(m[1] !== undefined ? extractRunText(m[1]) : '');
  }
  return strings;
}

// Excel's own worksheet grid limits (rows 1..1,048,576; columns A..XFD).
// Enforced independently of the ZIP/entry size guards above: without it, one
// maliciously sparse cell reference near the edge of the grid would force
// materializing a dense array with billions of blank cells.
const EXCEL_MAX_ROW_INDEX = 1_048_575;
const EXCEL_MAX_COL_INDEX = 16_383;
const MAX_IMPORTED_CELLS = 20_000_000;

interface ParsedCell {
  row: number;
  col: number;
  value: string;
}

/** Parse one `xl/worksheets/sheetN.xml` part into sparse cells, or `null` if the XML is invalid. */
function parseWorksheetCells(xml: string, sharedStrings: string[]): ParsedCell[] | null {
  const cells: ParsedCell[] = [];
  const ROW_RE = /<row\b([^>]*)\/>|<row\b([^>]*)>([\s\S]*?)<\/row>/g;
  let rowMatch: RegExpExecArray | null;
  let fallbackRow = -1;
  while ((rowMatch = ROW_RE.exec(xml))) {
    const attrs = rowMatch[1] ?? rowMatch[2] ?? '';
    const content = rowMatch[3] ?? '';
    const rAttr = getAttr(attrs, 'r');
    const rowIndex = rAttr !== null ? Number(rAttr) - 1 : fallbackRow + 1;
    if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex > EXCEL_MAX_ROW_INDEX) {
      return null;
    }
    fallbackRow = rowIndex;

    const CELL_RE = /<c\b([^>]*)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/g;
    let cellMatch: RegExpExecArray | null;
    let fallbackCol = -1;
    while ((cellMatch = CELL_RE.exec(content))) {
      const cAttrs = cellMatch[1] ?? cellMatch[2] ?? '';
      const cContent = cellMatch[3] ?? '';
      const ref = getAttr(cAttrs, 'r');
      let colIndex: number;
      if (ref !== null) {
        const parsed = parseRef(ref);
        if (!parsed) {
          return null;
        }
        colIndex = parsed.col;
      } else {
        colIndex = fallbackCol + 1;
      }
      if (colIndex > EXCEL_MAX_COL_INDEX) {
        return null;
      }
      fallbackCol = colIndex;

      if (cellMatch[3] === undefined) {
        continue; // self-closed cell: no value
      }
      const type = getAttr(cAttrs, 't');
      let value: string;
      switch (type) {
        case null:
        case 'n':
        case 'str':
        case 'd':
        case 'e':
          value = extractCellValueText(cContent) ?? '';
          break;
        case 's': {
          const idxText = extractCellValueText(cContent);
          const idx = idxText !== null ? Number(idxText) : NaN;
          if (!Number.isInteger(idx) || idx < 0 || idx >= sharedStrings.length) {
            return null;
          }
          value = sharedStrings[idx];
          break;
        }
        case 'b': {
          const raw = extractCellValueText(cContent);
          value = raw === '1' ? 'TRUE' : raw === '0' ? 'FALSE' : '';
          break;
        }
        case 'inlineStr': {
          const isMatch = /<is\b[^>]*>([\s\S]*?)<\/is>/.exec(cContent);
          value = isMatch ? extractRunText(isMatch[1]) : '';
          break;
        }
        default:
          return null; // not a value defined by the OOXML cell-type enumeration
      }
      if (value !== '') {
        cells.push({ row: rowIndex, col: colIndex, value });
      }
    }
  }
  return cells;
}

/** Cheap pass over the sparse cells to size the dense output, before allocating anything. */
function sheetCellBounds(cells: ParsedCell[]): { maxRow: number; maxCol: number } {
  let maxRow = -1;
  let maxCol = -1;
  for (const cell of cells) {
    maxRow = Math.max(maxRow, cell.row);
    maxCol = Math.max(maxCol, cell.col);
  }
  return { maxRow, maxCol };
}

function buildSheetRows(cells: ParsedCell[], maxRow: number, columnCount: number): string[][] {
  const rows: string[][] = [];
  for (let r = 0; r <= maxRow; r++) {
    rows.push(new Array<string>(columnCount).fill(''));
  }
  for (const cell of cells) {
    rows[cell.row][cell.col] = cell.value;
  }
  return rows;
}

/**
 * Parse a `.xlsx` file's bytes into row-major worksheet values, one entry per
 * worksheet in workbook order. Never throws: any structural problem (not a
 * ZIP, missing required parts, invalid XML, a size guard tripping) is
 * reported as a typed error instead, and nothing is partially returned.
 */
export function parseXlsxWorkbook(bytes: Uint8Array): XlsxImportResult {
  const entries = readCentralDirectory(bytes);
  if (!entries) {
    return { ok: false, error: 'not-a-zip' };
  }

  const workbookXml = readZipTextPart(entries, bytes, 'xl/workbook.xml');
  if (workbookXml === null) {
    return { ok: false, error: 'missing-workbook' };
  }
  const sheetRefs = parseWorkbookSheets(workbookXml);
  if (sheetRefs.length === 0) {
    return { ok: false, error: 'no-sheets' };
  }

  const relsXml = readZipTextPart(entries, bytes, 'xl/_rels/workbook.xml.rels');
  const rels = relsXml !== null ? parseWorkbookRels(relsXml) : new Map<string, string>();

  const sharedStringsXml = readZipTextPart(entries, bytes, 'xl/sharedStrings.xml');
  const sharedStrings = sharedStringsXml !== null ? parseSharedStrings(sharedStringsXml) : [];

  const sheets: XlsxImportSheet[] = [];
  let totalCells = 0;
  for (let i = 0; i < sheetRefs.length; i++) {
    const ref = sheetRefs[i];
    const path = (ref.relId !== null ? rels.get(ref.relId) : undefined) ?? `xl/worksheets/sheet${i + 1}.xml`;
    const sheetXml = readZipTextPart(entries, bytes, path);
    if (sheetXml === null) {
      return { ok: false, error: 'corrupt-entry' };
    }
    const cells = parseWorksheetCells(sheetXml, sharedStrings);
    if (cells === null) {
      return { ok: false, error: 'corrupt-entry' };
    }
    const { maxRow, maxCol } = sheetCellBounds(cells);
    const columnCount = Math.max(1, maxCol + 1);
    totalCells += Math.max(0, maxRow + 1) * columnCount;
    if (totalCells > MAX_IMPORTED_CELLS) {
      return { ok: false, error: 'too-large' };
    }
    const rows = buildSheetRows(cells, maxRow, columnCount);
    sheets.push({ name: ref.name, rows, columnCount });
  }

  return { ok: true, sheets };
}
