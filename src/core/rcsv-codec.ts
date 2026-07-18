// SPDX-License-Identifier: MIT
import type { DelimiterId } from './byte-csv-parser';
import { getRcsvCodec, RCSV_COMPRESSION_DEFLATE, RCSV_COMPRESSION_STORE } from './csv-engine';

/**
 * Binary `.rcsv` container format (version 2). Replaces the legacy JSON
 * format entirely. The container is a small fixed header followed by a
 * (optionally DEFLATE-compressed) binary body describing the sheet. The
 * header records the uncompressed body length and a CRC-32 checksum so
 * corruption is detected, and decompression is bounded by the stored length
 * so a crafted payload cannot exhaust memory. See `docs/rcsv-format.md`.
 *
 * Container layout (little-endian):
 *
 * ```
 * off  size  field
 * 0    4     magic "RCSV" (0x52 0x43 0x53 0x56)
 * 4    1     container version (2)
 * 5    1     compression method (0 = store, 1 = deflate)
 * 6    1     flags (reserved, 0)
 * 7    1     reserved (0)
 * 8    4     uncompressed body length (u32)
 * 12   4     CRC-32 of the uncompressed body (u32)
 * 16   4     compressed payload length (u32)
 * 20   …     payload
 * ```
 *
 * Body layout (little-endian), all strings UTF-8:
 *
 * ```
 * 0    1     body version (1)
 * 1    1     delimiter byte (',' ';' or TAB)
 * 2    2     sheet-name length (u16)
 * 4    …     sheet name
 * …    4     row count (u32)
 * …    4     column count (u32)
 * …    4     cell count (u32)
 * …    per cell: row (u32), col (u32), input length (u32), input bytes
 * ```
 */
export const RCSV_MAGIC = new Uint8Array([0x52, 0x43, 0x53, 0x56]); // "RCSV"
export const RCSV_CONTAINER_VERSION = 2;
export const RCSV_BODY_VERSION = 1;
const HEADER_SIZE = 20;

export const MAX_RCSV_ROWS = 2_000_000;
export const MAX_RCSV_COLS = 16_384;
export const MAX_RCSV_CELLS = 20_000_000;
export const MAX_RCSV_CELL_LENGTH = 1_000_000;
/** Decompression-bomb ceiling for the uncompressed body (512 MiB). */
export const MAX_RCSV_BODY_BYTES = 512 * 1024 * 1024;

export interface RcsvData {
  name: string;
  delimiter: DelimiterId;
  rowCount: number;
  columnCount: number;
  /** Non-empty cells as [row, col, input] triples. */
  cells: Array<[number, number, string]>;
}

export type RcsvDecodeError =
  'bad-magic' | 'bad-version' | 'bad-shape' | 'checksum' | 'unsupported-compression' | 'too-large';

export type RcsvDecodeResult = { ok: true; data: RcsvData } | { ok: false; error: RcsvDecodeError };

const DELIMS: Record<number, DelimiterId> = { 0x2c: ',', 0x3b: ';', 0x09: '\t' };

/** Encode a sheet into the binary `.rcsv` container. */
export function encodeRcsv(data: RcsvData): Uint8Array {
  const body = encodeBody(data);
  const codec = getRcsvCodec();
  const { method, payload } = codec.compress(body);
  const crc = codec.crc32(body);

  const out = new Uint8Array(HEADER_SIZE + payload.length);
  out.set(RCSV_MAGIC, 0);
  const view = new DataView(out.buffer);
  out[4] = RCSV_CONTAINER_VERSION;
  out[5] = method;
  out[6] = 0;
  out[7] = 0;
  view.setUint32(8, body.length, true);
  view.setUint32(12, crc, true);
  view.setUint32(16, payload.length, true);
  out.set(payload, HEADER_SIZE);
  return out;
}

/** Decode and strictly validate a binary `.rcsv` container. Never executes anything. */
export function decodeRcsv(bytes: Uint8Array): RcsvDecodeResult {
  if (bytes.length < HEADER_SIZE) {
    return { ok: false, error: 'bad-magic' };
  }
  for (let i = 0; i < 4; i++) {
    if (bytes[i] !== RCSV_MAGIC[i]) {
      return { ok: false, error: 'bad-magic' };
    }
  }
  if (bytes[4] !== RCSV_CONTAINER_VERSION) {
    return { ok: false, error: 'bad-version' };
  }
  const method = bytes[5];
  if (method !== RCSV_COMPRESSION_STORE && method !== RCSV_COMPRESSION_DEFLATE) {
    return { ok: false, error: 'unsupported-compression' };
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const bodyLen = view.getUint32(8, true);
  const crc = view.getUint32(12, true);
  const payloadLen = view.getUint32(16, true);
  if (bodyLen > MAX_RCSV_BODY_BYTES) {
    return { ok: false, error: 'too-large' };
  }
  if (HEADER_SIZE + payloadLen !== bytes.length) {
    return { ok: false, error: 'bad-shape' };
  }
  const payload = bytes.subarray(HEADER_SIZE, HEADER_SIZE + payloadLen);
  const codec = getRcsvCodec();
  const body = codec.decompress(payload, method, bodyLen);
  if (!body) {
    // A store payload we can always read; a deflate payload needs the WASM
    // engine. Distinguish so the message can be accurate.
    return {
      ok: false,
      error: method === RCSV_COMPRESSION_DEFLATE ? 'unsupported-compression' : 'bad-shape',
    };
  }
  if (codec.crc32(body) !== crc) {
    return { ok: false, error: 'checksum' };
  }
  return decodeBody(body);
}

function encodeBody(data: RcsvData): Uint8Array {
  const enc = new TextEncoder();
  const name = enc.encode(data.name.slice(0, 255));
  const cellBufs = data.cells.map(([r, c, input]) => {
    const value = enc.encode(input);
    const buf = new Uint8Array(12 + value.length);
    const dv = new DataView(buf.buffer);
    dv.setUint32(0, r, true);
    dv.setUint32(4, c, true);
    dv.setUint32(8, value.length, true);
    buf.set(value, 12);
    return buf;
  });
  const cellsSize = cellBufs.reduce((n, b) => n + b.length, 0);
  const total = 1 + 1 + 2 + name.length + 4 + 4 + 4 + cellsSize;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let off = 0;
  out[off++] = RCSV_BODY_VERSION;
  out[off++] = data.delimiter.charCodeAt(0);
  view.setUint16(off, name.length, true);
  off += 2;
  out.set(name, off);
  off += name.length;
  view.setUint32(off, data.rowCount, true);
  off += 4;
  view.setUint32(off, data.columnCount, true);
  off += 4;
  view.setUint32(off, data.cells.length, true);
  off += 4;
  for (const buf of cellBufs) {
    out.set(buf, off);
    off += buf.length;
  }
  return out;
}

function decodeBody(body: Uint8Array): RcsvDecodeResult {
  const dec = new TextDecoder('utf-8', { fatal: true });
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  let off = 0;
  const need = (n: number): boolean => off + n <= body.length;
  if (!need(4) || body[off++] !== RCSV_BODY_VERSION) {
    return { ok: false, error: 'bad-version' };
  }
  const delimByte = body[off++];
  const delimiter = DELIMS[delimByte];
  if (!delimiter) {
    return { ok: false, error: 'bad-shape' };
  }
  const nameLen = view.getUint16(off, true);
  off += 2;
  if (!need(nameLen)) {
    return { ok: false, error: 'bad-shape' };
  }
  let name: string;
  try {
    name = dec.decode(body.subarray(off, off + nameLen));
  } catch {
    return { ok: false, error: 'bad-shape' };
  }
  off += nameLen;
  if (!need(12)) {
    return { ok: false, error: 'bad-shape' };
  }
  const rowCount = view.getUint32(off, true);
  off += 4;
  const columnCount = view.getUint32(off, true);
  off += 4;
  const cellCount = view.getUint32(off, true);
  off += 4;
  if (rowCount < 1 || columnCount < 1) {
    return { ok: false, error: 'bad-shape' };
  }
  if (
    rowCount > MAX_RCSV_ROWS ||
    columnCount > MAX_RCSV_COLS ||
    rowCount * columnCount > MAX_RCSV_CELLS ||
    cellCount > rowCount * columnCount
  ) {
    return { ok: false, error: 'too-large' };
  }
  const cells: Array<[number, number, string]> = [];
  for (let i = 0; i < cellCount; i++) {
    if (!need(12)) {
      return { ok: false, error: 'bad-shape' };
    }
    const r = view.getUint32(off, true);
    off += 4;
    const c = view.getUint32(off, true);
    off += 4;
    const inputLen = view.getUint32(off, true);
    off += 4;
    if (r >= rowCount || c >= columnCount || inputLen > MAX_RCSV_CELL_LENGTH || !need(inputLen)) {
      return { ok: false, error: 'bad-shape' };
    }
    let input: string;
    try {
      input = dec.decode(body.subarray(off, off + inputLen));
    } catch {
      return { ok: false, error: 'bad-shape' };
    }
    off += inputLen;
    cells.push([r, c, input]);
  }
  if (off !== body.length) {
    return { ok: false, error: 'bad-shape' };
  }
  return { ok: true, data: { name, delimiter, rowCount, columnCount, cells } };
}
