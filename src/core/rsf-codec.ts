// SPDX-License-Identifier: MIT
import type { DelimiterId } from './byte-csv-parser';
import {
  getRsfCodec,
  RSF_COMPRESSION_DEFLATE,
  RSF_COMPRESSION_LZ4,
  RSF_COMPRESSION_STORE,
  RSF_COMPRESSION_ZSTD,
  RSF_METHODS,
} from './csv-engine';

export {
  RSF_COMPRESSION_STORE,
  RSF_COMPRESSION_DEFLATE,
  RSF_COMPRESSION_ZSTD,
  RSF_COMPRESSION_LZ4,
  RSF_METHODS,
};

/**
 * Binary Refrain Sheet Format (`.rsf`) container. The container is a small
 * fixed header followed by a (optionally compressed) binary body describing
 * the sheet. The header records the uncompressed body length and a CRC-32
 * checksum so corruption is detected, and decompression is bounded by the
 * stored length so a crafted payload cannot exhaust memory. See
 * `docs/rsf-format.md`.
 *
 * Container layout (little-endian):
 *
 * ```
 * off  size  field
 * 0    4     magic "RSF1" (0x52 0x53 0x46 0x31)
 * 4    1     container version (3)
 * 5    1     compression method (0 = store, 1 = deflate, 2 = zstd, 3 = lz4 frame)
 * 6    1     flags (reserved, 0)
 * 7    1     codec profile version (0)
 * 8    4     uncompressed body length (u32)
 * 12   4     CRC-32 of the uncompressed body (u32)
 * 16   4     compressed payload length (u32)
 * 20   …     payload
 * ```
 *
 * **Compatibility.** The format was previously named "Refrain CSV Format"
 * (RCSV) and used the magic "RCSV" (0x52 0x43 0x53 0x56) with container
 * version 2. Only the container name, magic bytes, and version number changed
 * in the rename to RSF — the header shape and body layout are byte-identical.
 * Legacy `.rcsv` files (magic "RCSV", container version 2) are therefore read
 * transparently as a legacy *import* format; the document is then saved as
 * `.rsf` (new magic, version 3). Writing only ever produces the current
 * format, so old readers safely reject the new magic rather than
 * misinterpreting it.
 *
 * The compression method is per-file: a container records which codec packed
 * its payload, so any supported method round-trips and unknown methods are
 * rejected safely. The default for new documents is Zstandard (method 2). CRC-32
 * detects accidental corruption only — it is not tamper protection.
 *
 * Body layout (little-endian), all strings UTF-8. Body version 2 adds the
 * creating/updating application metadata after the delimiter; version 1 (no
 * metadata) is still accepted on read for forward compatibility:
 *
 * ```
 * 0    1     body version (2; 1 also readable)
 * 1    1     delimiter byte (',' ';' or TAB)
 * --- body version 2 only ---
 * 2    2     application-name length (u16)
 * …    …     application name
 * …    2     application-version length (u16)
 * …    …     application version
 * --- both versions ---
 * …    2     sheet-name length (u16)
 * …    …     sheet name
 * …    4     row count (u32)
 * …    4     column count (u32)
 * …    4     cell count (u32)
 * …    per cell: row (u32), col (u32), input length (u32), input bytes
 * ```
 */
export const RSF_MAGIC = new Uint8Array([0x52, 0x53, 0x46, 0x31]); // "RSF1"
export const RSF_CONTAINER_VERSION = 3;
/**
 * Legacy "Refrain CSV Format" container magic ("RCSV") and version, read for
 * backward compatibility so existing `.rcsv` files open. Never written.
 */
export const RSF_LEGACY_MAGIC = new Uint8Array([0x52, 0x43, 0x53, 0x56]); // "RCSV"
export const RSF_LEGACY_CONTAINER_VERSION = 2;
/** Body version written by this release (metadata-bearing). Version 1 is still read. */
export const RSF_BODY_VERSION = 2;
/** Maximum stored length (bytes) of the application name/version metadata strings. */
const MAX_META_LENGTH = 255;
const HEADER_SIZE = 20;
/**
 * Codec profile version stored at header byte 7. All current codecs use stable
 * frame formats (DEFLATE/RFC-1951, Zstandard, LZ4 Frame) at profile 0; the byte
 * is reserved so a future codec revision can be distinguished and rejected
 * safely by older readers. Non-zero profiles are unsupported for now.
 */
export const RSF_CODEC_PROFILE = 0;

export const MAX_RSF_ROWS = 2_000_000;
export const MAX_RSF_COLS = 16_384;
export const MAX_RSF_CELLS = 20_000_000;
export const MAX_RSF_CELL_LENGTH = 1_000_000;
/** Decompression-bomb ceiling for the uncompressed body (512 MiB). */
export const MAX_RSF_BODY_BYTES = 512 * 1024 * 1024;

export interface RsfData {
  name: string;
  delimiter: DelimiterId;
  rowCount: number;
  columnCount: number;
  /** Non-empty cells as [row, col, input] triples. */
  cells: Array<[number, number, string]>;
  /**
   * Creating/updating application metadata. When either field is provided the
   * body is written in version 2 (metadata-bearing); when both are omitted the
   * body is written in the legacy version 1. On decode these are populated
   * only for version-2 bodies (left undefined for version 1).
   */
  appName?: string;
  appVersion?: string;
  /**
   * Compression method the container was packed with (one of the
   * `RSF_COMPRESSION_*` ids). Populated on decode so a document can preserve
   * its method on the next save; ignored on encode (the method is passed to
   * {@link encodeRsf} explicitly).
   */
  compression?: number;
}

export type RsfDecodeError =
  'bad-magic' | 'bad-version' | 'bad-shape' | 'checksum' | 'unsupported-compression' | 'too-large';

export type RsfDecodeResult = { ok: true; data: RsfData } | { ok: false; error: RsfDecodeError };

/** Thrown by {@link encodeRsf} when the requested method cannot be written here. */
export class RsfEncodeError extends Error {
  constructor(readonly method: number) {
    super(`rsf: compression method ${method} is not available in this build`);
    this.name = 'RsfEncodeError';
  }
}

/** True when `method` is a defined container compression method. */
export function isRsfMethod(method: number): boolean {
  return RSF_METHODS.includes(method);
}

/** i18n key stub for a method (`rsf.method.<name>`) used for labels/descriptions. */
export function rsfMethodKey(method: number): string {
  switch (method) {
    case RSF_COMPRESSION_ZSTD:
      return 'rsf.method.zstd';
    case RSF_COMPRESSION_LZ4:
      return 'rsf.method.lz4';
    case RSF_COMPRESSION_DEFLATE:
      return 'rsf.method.deflate';
    default:
      return 'rsf.method.store';
  }
}

const DELIMS: Record<number, DelimiterId> = { 0x2c: ',', 0x3b: ';', 0x09: '\t' };

/**
 * Encode a sheet into the binary `.rsf` container using `method` (defaults to
 * the active codec's preferred method — Zstandard when the WASM engine is
 * available). Throws {@link RsfEncodeError} when `method` cannot be written in
 * this build, so the caller can surface a localized error and never silently
 * substitutes a different codec.
 */
export function encodeRsf(data: RsfData, method: number = getRsfCodec().defaultMethod()): Uint8Array {
  const body = encodeBody(data);
  const codec = getRsfCodec();
  const payload = codec.compress(body, method);
  if (payload === null) {
    throw new RsfEncodeError(method);
  }
  const crc = codec.crc32(body);

  const out = new Uint8Array(HEADER_SIZE + payload.length);
  out.set(RSF_MAGIC, 0);
  const view = new DataView(out.buffer);
  out[4] = RSF_CONTAINER_VERSION;
  out[5] = method;
  out[6] = 0;
  out[7] = RSF_CODEC_PROFILE;
  view.setUint32(8, body.length, true);
  view.setUint32(12, crc, true);
  view.setUint32(16, payload.length, true);
  out.set(payload, HEADER_SIZE);
  return out;
}

/** Decode and strictly validate a binary `.rsf` container (or a legacy `.rcsv`
 *  container — see the compatibility note above). Never executes anything. */
export function decodeRsf(bytes: Uint8Array): RsfDecodeResult {
  if (bytes.length < HEADER_SIZE) {
    return { ok: false, error: 'bad-magic' };
  }
  const matchesMagic = (magic: Uint8Array): boolean => magic.every((b, i) => bytes[i] === b);
  // Accept the current RSF magic and the legacy RCSV magic; each pins its own
  // container version so a mismatched magic/version pair is rejected.
  const isRsf = matchesMagic(RSF_MAGIC);
  const isLegacy = !isRsf && matchesMagic(RSF_LEGACY_MAGIC);
  if (!isRsf && !isLegacy) {
    return { ok: false, error: 'bad-magic' };
  }
  const expectedVersion = isRsf ? RSF_CONTAINER_VERSION : RSF_LEGACY_CONTAINER_VERSION;
  if (bytes[4] !== expectedVersion) {
    return { ok: false, error: 'bad-version' };
  }
  const method = bytes[5];
  if (!isRsfMethod(method)) {
    // Unknown / future compression method — reject safely, never guess.
    return { ok: false, error: 'unsupported-compression' };
  }
  // A future codec profile is not something this build can decode safely.
  if (bytes[7] !== RSF_CODEC_PROFILE) {
    return { ok: false, error: 'unsupported-compression' };
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const bodyLen = view.getUint32(8, true);
  const crc = view.getUint32(12, true);
  const payloadLen = view.getUint32(16, true);
  if (bodyLen > MAX_RSF_BODY_BYTES) {
    return { ok: false, error: 'too-large' };
  }
  if (HEADER_SIZE + payloadLen !== bytes.length) {
    return { ok: false, error: 'bad-shape' };
  }
  const payload = bytes.subarray(HEADER_SIZE, HEADER_SIZE + payloadLen);
  const codec = getRsfCodec();
  const body = codec.decompress(payload, method, bodyLen);
  if (!body) {
    // Reconstruction failed. If this build cannot even write the method it
    // lacks the matching decoder (the JS fallback for any compressed method),
    // so report it as unsupported; otherwise the payload is corrupt/truncated.
    const decodable = method === RSF_COMPRESSION_STORE || codec.canWrite(method);
    return { ok: false, error: decodable ? 'bad-shape' : 'unsupported-compression' };
  }
  if (codec.crc32(body) !== crc) {
    return { ok: false, error: 'checksum' };
  }
  const decoded = decodeBody(body);
  if (decoded.ok) {
    decoded.data.compression = method;
  }
  return decoded;
}

function encodeBody(data: RsfData): Uint8Array {
  const enc = new TextEncoder();
  const name = enc.encode(data.name.slice(0, 255));
  // Any metadata present selects the version-2 (metadata-bearing) body.
  const hasMeta = data.appName !== undefined || data.appVersion !== undefined;
  const appName = hasMeta ? enc.encode((data.appName ?? '').slice(0, MAX_META_LENGTH)) : null;
  const appVersion = hasMeta ? enc.encode((data.appVersion ?? '').slice(0, MAX_META_LENGTH)) : null;
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
  const metaSize = hasMeta ? 2 + appName!.length + 2 + appVersion!.length : 0;
  const total = 1 + 1 + metaSize + 2 + name.length + 4 + 4 + 4 + cellsSize;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let off = 0;
  out[off++] = hasMeta ? 2 : 1;
  out[off++] = data.delimiter.charCodeAt(0);
  if (hasMeta) {
    view.setUint16(off, appName!.length, true);
    off += 2;
    out.set(appName!, off);
    off += appName!.length;
    view.setUint16(off, appVersion!.length, true);
    off += 2;
    out.set(appVersion!, off);
    off += appVersion!.length;
  }
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

function decodeBody(body: Uint8Array): RsfDecodeResult {
  const dec = new TextDecoder('utf-8', { fatal: true });
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  let off = 0;
  const need = (n: number): boolean => off + n <= body.length;
  if (!need(2)) {
    return { ok: false, error: 'bad-shape' };
  }
  const bodyVersion = body[off++];
  if (bodyVersion !== 1 && bodyVersion !== 2) {
    return { ok: false, error: 'bad-version' };
  }
  const delimByte = body[off++];
  const delimiter = DELIMS[delimByte];
  if (!delimiter) {
    return { ok: false, error: 'bad-shape' };
  }
  // A length-prefixed UTF-8 string reader shared by the metadata and name.
  const readString = (): string | null => {
    if (!need(2)) {
      return null;
    }
    const len = view.getUint16(off, true);
    off += 2;
    if (!need(len)) {
      return null;
    }
    try {
      const s = dec.decode(body.subarray(off, off + len));
      off += len;
      return s;
    } catch {
      return null;
    }
  };
  let appName: string | undefined;
  let appVersion: string | undefined;
  if (bodyVersion === 2) {
    const readName = readString();
    if (readName === null) {
      return { ok: false, error: 'bad-shape' };
    }
    const readVersion = readString();
    if (readVersion === null) {
      return { ok: false, error: 'bad-shape' };
    }
    appName = readName;
    appVersion = readVersion;
  }
  const name = readString();
  if (name === null) {
    return { ok: false, error: 'bad-shape' };
  }
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
    rowCount > MAX_RSF_ROWS ||
    columnCount > MAX_RSF_COLS ||
    rowCount * columnCount > MAX_RSF_CELLS ||
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
    if (r >= rowCount || c >= columnCount || inputLen > MAX_RSF_CELL_LENGTH || !need(inputLen)) {
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
  const data: RsfData = { name, delimiter, rowCount, columnCount, cells };
  if (appName !== undefined) {
    data.appName = appName;
  }
  if (appVersion !== undefined) {
    data.appVersion = appVersion;
  }
  return { ok: true, data };
}
