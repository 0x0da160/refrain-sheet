// SPDX-License-Identifier: MIT
// Builds the million-row demo workbook's `.rsf` bytes and its manifest from the
// deterministic data in ./million-rows-data.mjs. The command-line entry is
// ./generate-million-rows.mjs; tests build a small workbook through the same
// functions.
//
// The file is written straight from the format specification
// (knowledge/formats/rsf/): a skippable header frame ("RSF2", the JSON length
// and its CRC-32) followed by one Zstandard frame holding the JSON text. It
// deliberately does not go through the application's own writer, so the same
// input file can be opened by any revision being measured.

import { createHash } from 'node:crypto';
import { crc32, zstdCompressSync } from 'node:zlib';
import {
  aggregate,
  buildRows,
  CATEGORIES,
  countFormulas,
  DEPARTMENTS,
  DETAIL_HEADER,
  detailRow,
  MASTER_HEADER,
  SHEET_DETAIL,
  SHEET_MASTER,
  SHEET_SUMMARY,
  summaryRows,
} from './million-rows-data.mjs';

/** One worksheet's JSON text, its rows streamed so no row-array of the whole sheet is built. */
function sheetJson(head, rowCount, cols, rowAt, widths) {
  const parts = [`{"id":${JSON.stringify(head.id)},"name":${JSON.stringify(head.name)},"kind":"grid"`];
  parts.push(`,"rows":${rowCount},"cols":${cols},"cells":[`);
  const chunk = [];
  for (let r = 0; r < rowCount; r++) {
    chunk.push(JSON.stringify(rowAt(r)));
    if (chunk.length === 50_000 || r === rowCount - 1) {
      parts.push((parts.length > 2 ? ',' : '') + chunk.join(','));
      chunk.length = 0;
    }
  }
  parts.push(`],"view":{"colWidths":${JSON.stringify(widths)}}}`);
  return parts;
}

/** The whole document as UTF-8 bytes. */
function buildBody(data) {
  const summary = summaryRows(data.rows);
  const sheets = [
    sheetJson(
      { id: 's1', name: SHEET_DETAIL },
      data.rows + 1,
      DETAIL_HEADER.length,
      (r) => (r === 0 ? DETAIL_HEADER : detailRow(data, r - 1)),
      { A: 110, B: 120, C: 100, D: 150, E: 70, F: 90, G: 110, H: 130 },
    ),
    sheetJson(
      { id: 's2', name: SHEET_MASTER },
      data.products.length + 1,
      MASTER_HEADER.length,
      (r) => {
        if (r === 0) return MASTER_HEADER;
        const p = data.products[r - 1];
        return [p.code, p.name, CATEGORIES[p.category].name, String(p.price)];
      },
      { A: 110, B: 260, C: 130, D: 100 },
    ),
    sheetJson({ id: 's3', name: SHEET_SUMMARY }, summary.length + 4, 6, (r) => summary[r] ?? [], {
      A: 240,
      B: 160,
      C: 110,
      E: 130,
      F: 260,
    }),
  ];
  const head =
    '{"format":"refrain-sheet","version":1,' +
    '"app":{"name":"refrain-sheet million-row demo generator","version":"1"},' +
    '"id":"wb-million-row-demo","created":"2026-11-15T00:00:00.000Z","updated":"2026-11-15T00:00:00.000Z",' +
    '"delimiter":",","timezone":"Asia/Tokyo","language":"ja","activeSheet":"s1","sheets":[';
  const buffers = [Buffer.from(head, 'utf8')];
  sheets.forEach((parts, index) => {
    if (index > 0) buffers.push(Buffer.from(','));
    for (const part of parts) buffers.push(Buffer.from(part, 'utf8'));
  });
  buffers.push(Buffer.from(']}', 'utf8'));
  return { body: Buffer.concat(buffers), summaryFormulas: countFormulas(summary) };
}

/** The `.rsf` container around a JSON body (see rsf-codec.ts's header comment). */
function packRsf(body) {
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x184d2a5a, 0); // skippable-frame magic
  header.writeUInt32LE(12, 4);
  header.write('RSF2', 8, 'latin1');
  header.writeUInt32LE(body.length, 12);
  header.writeUInt32LE(crc32(body) >>> 0, 16);
  return Buffer.concat([header, zstdCompressSync(body)]);
}

/** The totals the summary sheet must show as generated. */
function expectedTotals(data) {
  return {
    all: aggregate(data),
    byDepartment: Object.fromEntries(DEPARTMENTS.map((d) => [d.name, aggregate(data, { dept: d.name })])),
    byCategory: Object.fromEntries(CATEGORIES.map((c) => [c.name, aggregate(data, { category: c.name })])),
  };
}

/**
 * The demo workbook for `rows` data rows: the `.rsf` file's bytes and the
 * manifest describing it (counts, the JSON document's SHA-256, and the totals
 * a correct application must display).
 */
export function buildDemoWorkbook(rows, seed) {
  const data = buildRows(rows, seed);
  const { body, summaryFormulas } = buildBody(data);
  const file = packRsf(body);
  const manifest = {
    rows,
    seed,
    sheets: {
      [SHEET_DETAIL]: {
        rows: rows + 1,
        cols: DETAIL_HEADER.length,
        // 売上 (=数量*単価) and カテゴリ (=VLOOKUP into the master), one of each per data row.
        formulas: rows * 2,
      },
      [SHEET_MASTER]: { rows: data.products.length + 1, cols: MASTER_HEADER.length, formulas: 0 },
      [SHEET_SUMMARY]: { formulas: summaryFormulas },
    },
    nonEmptyCells: (rows + 1) * DETAIL_HEADER.length,
    jsonBytes: body.length,
    // The file's identity: the compressed bytes may differ between Node releases.
    jsonSha256: createHash('sha256').update(body).digest('hex'),
    fileBytes: file.length,
    expected: expectedTotals(data),
  };
  return { file, manifest };
}
