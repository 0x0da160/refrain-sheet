// SPDX-License-Identifier: MIT
import type { DelimiterId } from './byte-csv-parser';
import {
  FILTER_NUMBER_OPS,
  FILTER_TEXT_OPS,
  MAX_FILTER_COLUMNS,
  MAX_FILTER_CONDITIONS,
  MAX_FILTER_STRING,
  MAX_FILTER_VALUES,
  validateFilter,
  type ColumnFilter,
  type FilterCondition,
  type SheetFilter,
} from './filter';
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
 * creating/updating application metadata after the delimiter; version 3 adds
 * the display-settings block; version 4 adds the sheet-filter block. Older
 * versions are still accepted on read:
 *
 * ```
 * 0    1     body version (1–5 readable; lowest sufficient version written)
 * 1    1     delimiter byte (',' ';' or TAB)
 * --- body versions 2+ ---
 * 2    2     application-name length (u16)
 * …    …     application name
 * …    2     application-version length (u16)
 * …    …     application version
 * --- body versions 3+ ---
 * …    2     spreadsheet zoom percent (u16; 0 = not stored)
 * …    4     column-width entry count (u32)
 * …    per entry: column index (u32), width px at 100% zoom (u16)
 * --- body version 5+ ---
 * …    1     display flags (bit 0: wrap long rows)
 * --- body version 4+ ---
 * …    1     filter flags (bit 0: a filter is present)
 * …    …     filter block (only when present — see `docs/rsf-format.md`)
 * --- all versions ---
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
/**
 * Highest body version this release reads and writes. Version selection on
 * write is minimal: 5 when wrap-long-rows is stored, else 4 when a sheet filter
 * is present, else 3 when display settings are present, else 2 when application
 * metadata is present, else 1 — so documents without the newer data stay
 * readable by older releases. Versions 1–5 are all accepted on read; an older
 * reader rejects a version it does not know with `bad-version` (a localized
 * "unsupported version" message) rather than misparsing it.
 */
export const RSF_BODY_VERSION = 5;

// ----- Display-settings bounds (body version 3) -----------------------------
// Persisted display state is validated and clamped on load so a malformed or
// hostile container can never push layout, allocation, or rendering outside
// safe bounds. The width bounds mirror the grid's MIN_COL_WIDTH/MAX_COL_WIDTH
// (src/ui/grid.ts) — the UI clamps again, but the codec enforces them first.

/** Smallest / largest spreadsheet zoom the container may carry (percent). */
export const RSF_ZOOM_MIN = 50;
export const RSF_ZOOM_MAX = 200;
/** Column-width bounds (px at 100% zoom) for persisted display widths. */
export const RSF_COL_WIDTH_MIN = 40;
export const RSF_COL_WIDTH_MAX = 1200;
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

// ----- Workbook container (container version 4) ------------------------------

/**
 * Container version of a **workbook** payload: one or more worksheets, their
 * stable identifiers, order, and the active-worksheet identifier. Written only
 * when a workbook actually holds more than one worksheet — a single-worksheet
 * workbook keeps writing the version-3 single-sheet container, so files that
 * do not use the new capability stay readable by older releases.
 *
 * Older readers validate the magic/version *pair* and therefore reject a
 * version-4 container outright (`bad-version`, surfaced as a localized
 * "unsupported version" explanation) instead of misparsing it.
 */
export const RSF_CONTAINER_VERSION_WORKBOOK = 4;

/** Highest workbook body version this release reads and writes. */
export const RSF_WORKBOOK_BODY_VERSION = 1;

/**
 * Bounds for workbook payloads. A malformed or hostile container can never
 * push allocation or processing beyond these: the worksheet count and every
 * per-worksheet dimension are validated before anything is allocated, and the
 * total cell count across all worksheets is capped by {@link MAX_RSF_CELLS}.
 */
export const MAX_RSF_SHEETS = 256;
/** Maximum stored length (bytes) of a worksheet name or identifier. */
export const MAX_RSF_SHEET_NAME_BYTES = 400;

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
  /**
   * Non-executable display settings (body versions 3+). Purely
   * presentational: they never affect cell data, evaluation, or export. When
   * present on encode the body is written in version 3 (or 4 when a filter
   * is also present); on decode this is populated only for version-3+
   * bodies, already validated and clamped (zoom into
   * [{@link RSF_ZOOM_MIN}, {@link RSF_ZOOM_MAX}]; widths into
   * [{@link RSF_COL_WIDTH_MIN}, {@link RSF_COL_WIDTH_MAX}]; entries for
   * out-of-range columns dropped).
   */
  display?: RsfDisplaySettings;
  /**
   * The sheet's filter state (body version 4). Pure, non-executable criteria
   * data: no expressions, patterns, URLs, or code of any kind — only operator
   * ids, plain comparison strings, and numbers. When present on encode the
   * body is written in version 4; on decode it is populated only when the
   * stored filter passes full structural + bounds validation against the
   * sheet's dimensions.
   */
  filter?: SheetFilter;
  /**
   * Set on decode when a version-4 body carried a structurally readable
   * filter block whose contents failed validation (out-of-range coordinates,
   * unknown operators, bounds violations). The filter is ignored — never
   * guessed at — and the caller shows a localized warning; the sheet itself
   * loads normally.
   */
  filterDropped?: boolean;
}

/**
 * One worksheet inside a workbook container. `id` is the worksheet's stable
 * internal identifier (never shown to the user, unchanged by a rename); `name`
 * is the display name that cross-sheet formulas write.
 */
export interface RsfWorksheetData {
  id: string;
  name: string;
  rowCount: number;
  columnCount: number;
  /** Non-empty cells as [row, col, input] triples. */
  cells: Array<[number, number, string]>;
  /** Per-worksheet presentational state (validated and clamped on decode). */
  display?: RsfDisplaySettings;
  /** Per-worksheet filter (fully validated against this worksheet's dimensions). */
  filter?: SheetFilter;
  /** Set when a stored filter failed validation and was dropped. */
  filterDropped?: boolean;
}

/**
 * A decoded workbook: workbook-level metadata plus its worksheets in order.
 * Legacy single-sheet containers (version 3, and legacy RCSV version 2) decode
 * into this same shape with exactly one worksheet, so the whole application
 * works against one model regardless of which container version was read.
 */
export interface RsfWorkbookData {
  /** Delimiter used as the default for CSV export (workbook-level). */
  delimiter: DelimiterId;
  appName?: string;
  appVersion?: string;
  /** Creation / last-update timestamps (ms since epoch); absent when not stored. */
  createdAt?: number;
  updatedAt?: number;
  /** Stable workbook identifier, preserved across saves. */
  docId?: string;
  /** Identifier of the worksheet to activate on open; falls back to the first. */
  activeSheetId?: string;
  sheets: RsfWorksheetData[];
  /** Compression method the container was packed with (populated on decode). */
  compression?: number;
  /**
   * True when the bytes were a single-worksheet container (version 3, or a
   * legacy RCSV version 2) rather than a workbook container. The document
   * migrates to the workbook schema on its next save *only if* it then holds
   * more than one worksheet.
   */
  legacySingleSheet?: boolean;
}

export type RsfWorkbookDecodeResult =
  { ok: true; data: RsfWorkbookData } | { ok: false; error: RsfDecodeError };

/** Validated presentational state carried by a version-3 body. */
export interface RsfDisplaySettings {
  /** Spreadsheet zoom percent, or undefined when the file stores none. */
  zoom?: number;
  /** Overridden column widths as [columnIndex, widthPx-at-100%] pairs. */
  colWidths?: Array<[number, number]>;
  /**
   * Whether long cells wrap onto several visual lines (body version 5 /
   * workbook display flag bit 2). A single payload-free flag: a reader that
   * does not know it simply does not set it, and — because it carries no bytes
   * — a workbook display block stays perfectly in sync for older readers.
   */
  wrap?: boolean;
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

/**
 * Encode the body-version-4 filter block (its leading flags byte included).
 * Bounds are enforced defensively on write — columns, conditions, values, and
 * strings beyond the documented limits are truncated so an encoded filter
 * always validates on read.
 */
function encodeFilterBlock(filter: SheetFilter | undefined): Uint8Array {
  if (!filter) {
    return Uint8Array.of(0);
  }
  const enc = new TextEncoder();
  const bytes: number[] = [1];
  const u8 = (v: number): void => {
    bytes.push(v & 0xff);
  };
  const u16 = (v: number): void => {
    bytes.push(v & 0xff, (v >> 8) & 0xff);
  };
  const u32 = (v: number): void => {
    bytes.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
  };
  const f64 = (v: number): void => {
    const buf = new Uint8Array(8);
    new DataView(buf.buffer).setFloat64(0, v, true);
    for (const b of buf) {
      bytes.push(b);
    }
  };
  const str = (s: string): void => {
    const encoded = enc.encode(s.slice(0, MAX_FILTER_STRING));
    u16(encoded.length);
    for (const b of encoded) {
      bytes.push(b);
    }
  };
  u8(filter.headerRow ? 1 : 0);
  u32(filter.top);
  u32(filter.left);
  u32(filter.bottom);
  u32(filter.right);
  const columns = filter.columns.slice(0, MAX_FILTER_COLUMNS);
  u16(columns.length);
  for (const column of columns) {
    u32(column.col);
    u8(column.join === 'or' ? 1 : 0);
    const conditions = column.conditions.slice(0, MAX_FILTER_CONDITIONS);
    u8(conditions.length);
    for (const cond of conditions) {
      if (cond.kind === 'text') {
        u8(0);
        u8(Math.max(0, FILTER_TEXT_OPS.indexOf(cond.op)));
        str(cond.value);
      } else {
        u8(1);
        u8(Math.max(0, FILTER_NUMBER_OPS.indexOf(cond.op)));
        f64(cond.value);
        f64(cond.value2 ?? Number.NaN);
      }
    }
    const values = column.values === null ? null : column.values.slice(0, MAX_FILTER_VALUES);
    u8(values === null ? 0 : 1);
    if (values !== null) {
      u16(values.length);
      for (const v of values) {
        str(v);
      }
    }
  }
  return Uint8Array.from(bytes);
}

function encodeBody(data: RsfData): Uint8Array {
  const enc = new TextEncoder();
  const name = enc.encode(data.name.slice(0, 255));
  // Version selection is minimal: stored wrap needs version 5, a filter needs
  // version 4, display settings alone need version 3, metadata alone needs
  // version 2, otherwise the legacy version-1 body is written. A newer section
  // implies every older one, so the layout stays a strict prefix chain.
  const displayWidths = (data.display?.colWidths ?? []).filter(
    ([col, width]) => Number.isInteger(col) && col >= 0 && Number.isInteger(width) && width > 0,
  );
  const displayZoom = data.display?.zoom;
  const hasWrap = data.display?.wrap === true;
  const hasFilterSection = hasWrap || data.filter !== undefined;
  const hasDisplay = hasFilterSection || displayZoom !== undefined || displayWidths.length > 0;
  const hasMeta = hasDisplay || data.appName !== undefined || data.appVersion !== undefined;
  const appName = hasMeta ? enc.encode((data.appName ?? '').slice(0, MAX_META_LENGTH)) : null;
  const appVersion = hasMeta ? enc.encode((data.appVersion ?? '').slice(0, MAX_META_LENGTH)) : null;
  const filterBlock = hasFilterSection ? encodeFilterBlock(data.filter) : null;
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
  const displaySize = hasDisplay ? 2 + 4 + displayWidths.length * 6 : 0;
  const flagsSize = hasWrap ? 1 : 0;
  const filterSize = filterBlock ? filterBlock.length : 0;
  const total =
    1 + 1 + metaSize + displaySize + flagsSize + filterSize + 2 + name.length + 4 + 4 + 4 + cellsSize;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let off = 0;
  out[off++] = hasWrap ? 5 : hasFilterSection ? 4 : hasDisplay ? 3 : hasMeta ? 2 : 1;
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
  if (hasDisplay) {
    // Zoom percent (0 = not stored), clamped into the container bounds.
    const zoom =
      displayZoom === undefined ? 0 : Math.max(RSF_ZOOM_MIN, Math.min(RSF_ZOOM_MAX, Math.round(displayZoom)));
    view.setUint16(off, zoom, true);
    off += 2;
    view.setUint32(off, displayWidths.length, true);
    off += 4;
    for (const [col, width] of displayWidths) {
      view.setUint32(off, col, true);
      off += 4;
      view.setUint16(off, Math.max(RSF_COL_WIDTH_MIN, Math.min(RSF_COL_WIDTH_MAX, Math.round(width))), true);
      off += 2;
    }
  }
  if (hasWrap) {
    // Version-5 display flags. Bit 0: wrap long rows. Written only when set,
    // so a document that does not use wrapping stays a version-4-or-lower body.
    out[off++] = 1;
  }
  if (filterBlock) {
    out.set(filterBlock, off);
    off += filterBlock.length;
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
  if (bodyVersion < 1 || bodyVersion > RSF_BODY_VERSION) {
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
  if (bodyVersion >= 2) {
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
  // Version-3+ display settings. Structural truncation is bad-shape; value
  // problems are handled by clamping (zoom, widths) or dropping (columns out
  // of range, checked after the column count is known below) — a malformed
  // display block must never make the sheet itself unreadable or unsafe.
  let rawZoom = 0;
  const rawWidths: Array<[number, number]> = [];
  if (bodyVersion >= 3) {
    if (!need(6)) {
      return { ok: false, error: 'bad-shape' };
    }
    rawZoom = view.getUint16(off, true);
    off += 2;
    const widthCount = view.getUint32(off, true);
    off += 4;
    if (widthCount > MAX_RSF_COLS || !need(widthCount * 6)) {
      return { ok: false, error: 'bad-shape' };
    }
    for (let i = 0; i < widthCount; i++) {
      const col = view.getUint32(off, true);
      off += 4;
      const width = view.getUint16(off, true);
      off += 2;
      rawWidths.push([col, width]);
    }
  }
  // Version-5 display flags (one byte, no payload). Unknown bits are ignored
  // so a future flag can be added without changing this layout again.
  let rawWrap = false;
  if (bodyVersion >= 5) {
    if (!need(1)) {
      return { ok: false, error: 'bad-shape' };
    }
    rawWrap = (body[off++] & 1) === 1;
  }
  // Version-4 filter block. Structural truncation, undecodable strings, and
  // unreadable shapes are bad-shape (matching the rest of the codec); every
  // *readable* filter is fully validated against the sheet dimensions and the
  // documented bounds after those are known — a filter that fails validation
  // is dropped with a warning flag, never guessed at, and never prevents the
  // sheet itself from loading.
  let rawFilter: SheetFilter | null = null;
  let filterStored = false;
  if (bodyVersion >= 4) {
    // The filter block has the same layout in both container versions, so it
    // is read by the shared, bounds-checked reader (see readFilterBlock).
    const rd = new BodyReader(body, dec);
    rd.off = off;
    const block = readFilterBlock(rd);
    if (block === null) {
      return { ok: false, error: 'bad-shape' };
    }
    off = rd.off;
    filterStored = block.stored;
    rawFilter = block.raw;
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
  if (bodyVersion >= 3) {
    // Validate the display block now that the sheet dimensions are known:
    // out-of-range zoom clamps, widths clamp, unknown columns are dropped,
    // and duplicate column entries resolve to the last one written.
    const display: RsfDisplaySettings = {};
    if (rawZoom !== 0) {
      display.zoom = Math.max(RSF_ZOOM_MIN, Math.min(RSF_ZOOM_MAX, rawZoom));
    }
    const widths = new Map<number, number>();
    for (const [col, width] of rawWidths) {
      if (col < columnCount) {
        widths.set(col, Math.max(RSF_COL_WIDTH_MIN, Math.min(RSF_COL_WIDTH_MAX, width)));
      }
    }
    if (widths.size > 0) {
      display.colWidths = [...widths.entries()];
    }
    if (rawWrap) {
      display.wrap = true;
    }
    if (display.zoom !== undefined || display.colWidths || display.wrap) {
      data.display = display;
    }
  }
  if (filterStored) {
    // Full semantic validation against the (now known) sheet dimensions and
    // the documented bounds. An invalid stored filter is ignored — the sheet
    // loads without it and the caller shows a localized warning.
    const validated = rawFilter === null ? null : validateFilter(rawFilter, rowCount, columnCount);
    if (validated !== null) {
      data.filter = validated;
    } else {
      data.filterDropped = true;
    }
  }
  return { ok: true, data };
}

// ---------------------------------------------------------------------------
// Workbook container (container version 4)
// ---------------------------------------------------------------------------

/**
 * A bounds-checked cursor over an uncompressed body. Every read is guarded by
 * {@link BodyReader.need} so a truncated or crafted container can never read
 * past the buffer; string reads use a fatal UTF-8 decoder so invalid sequences
 * are rejected rather than replaced.
 */
class BodyReader {
  readonly view: DataView;
  off = 0;

  constructor(
    readonly body: Uint8Array,
    private readonly dec: TextDecoder,
  ) {
    this.view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  }

  need(n: number): boolean {
    return n >= 0 && this.off + n <= this.body.length;
  }

  u8(): number {
    return this.body[this.off++];
  }

  u16(): number {
    const v = this.view.getUint16(this.off, true);
    this.off += 2;
    return v;
  }

  u32(): number {
    const v = this.view.getUint32(this.off, true);
    this.off += 4;
    return v;
  }

  f64(): number {
    const v = this.view.getFloat64(this.off, true);
    this.off += 8;
    return v;
  }

  /** A length-prefixed UTF-8 string, or null when truncated/undecodable. */
  str(): string | null {
    if (!this.need(2)) {
      return null;
    }
    const len = this.u16();
    if (!this.need(len)) {
      return null;
    }
    try {
      const s = this.dec.decode(this.body.subarray(this.off, this.off + len));
      this.off += len;
      return s;
    } catch {
      return null;
    }
  }
}

/**
 * Read a filter block (its leading flags byte included). Returns null when the
 * block is structurally unreadable (the container is malformed); otherwise
 * reports whether a filter was stored and the raw filter, which the caller
 * validates against the worksheet's dimensions. A *readable* block whose
 * contents are semantically unknown (unknown operator or join) yields
 * `raw: null` so the caller drops it with a warning instead of guessing.
 */
function readFilterBlock(rd: BodyReader): { stored: boolean; raw: SheetFilter | null } | null {
  if (!rd.need(1)) {
    return null;
  }
  const flags = rd.u8();
  if ((flags & 1) === 0) {
    return { stored: false, raw: null };
  }
  if (!rd.need(1 + 16 + 2)) {
    return null;
  }
  const headerRow = rd.u8() !== 0;
  const top = rd.u32();
  const left = rd.u32();
  const bottom = rd.u32();
  const right = rd.u32();
  const columnCount = rd.u16();
  const columns: ColumnFilter[] = [];
  let readable = true;
  for (let i = 0; i < columnCount; i++) {
    if (!rd.need(4 + 1 + 1)) {
      return null;
    }
    const col = rd.u32();
    const joinByte = rd.u8();
    if (joinByte > 1) {
      readable = false; // unknown join semantics: never guessed at
    }
    const conditionCount = rd.u8();
    const conditions: FilterCondition[] = [];
    for (let j = 0; j < conditionCount; j++) {
      if (!rd.need(2)) {
        return null;
      }
      const kind = rd.u8();
      const opIndex = rd.u8();
      if (kind === 0) {
        const value = rd.str();
        if (value === null) {
          return null;
        }
        const op = FILTER_TEXT_OPS[opIndex];
        if (op === undefined) {
          readable = false;
        } else {
          conditions.push({ kind: 'text', op, value });
        }
      } else if (kind === 1) {
        if (!rd.need(16)) {
          return null;
        }
        const value = rd.f64();
        const value2 = rd.f64();
        const op = FILTER_NUMBER_OPS[opIndex];
        if (op === undefined) {
          readable = false;
        } else {
          conditions.push({
            kind: 'number',
            op,
            value,
            ...(Number.isNaN(value2) ? {} : { value2 }),
          });
        }
      } else {
        // An unknown condition kind has an unknown layout, so the rest of the
        // block cannot be located: the container is malformed.
        return null;
      }
    }
    if (!rd.need(1)) {
      return null;
    }
    const hasValues = rd.u8();
    let values: string[] | null = null;
    if (hasValues === 1) {
      if (!rd.need(2)) {
        return null;
      }
      const valueCount = rd.u16();
      values = [];
      for (let j = 0; j < valueCount; j++) {
        const v = rd.str();
        if (v === null) {
          return null;
        }
        values.push(v);
      }
    } else if (hasValues !== 0) {
      return null;
    }
    columns.push({ col, join: joinByte === 1 ? 'or' : 'and', conditions, values });
  }
  return { stored: true, raw: readable ? { top, left, bottom, right, headerRow, columns } : null };
}

/** Encode a worksheet's display block: a flags byte plus the present parts. */
function encodeDisplayBlock(display: RsfDisplaySettings | undefined, columnCount: number): number[] {
  const widths = (display?.colWidths ?? []).filter(
    ([col, width]) =>
      Number.isInteger(col) && col >= 0 && col < columnCount && Number.isInteger(width) && width > 0,
  );
  const zoom = display?.zoom;
  const bytes: number[] = [];
  // Bit 0: zoom follows. Bit 1: a width table follows. Bit 2: wrap long rows
  // (payload-free, so a reader that ignores it stays byte-aligned).
  const flags = (zoom !== undefined ? 1 : 0) | (widths.length > 0 ? 2 : 0) | (display?.wrap ? 4 : 0);
  bytes.push(flags);
  if (zoom !== undefined) {
    const clamped = Math.max(RSF_ZOOM_MIN, Math.min(RSF_ZOOM_MAX, Math.round(zoom)));
    bytes.push(clamped & 0xff, (clamped >> 8) & 0xff);
  }
  if (widths.length > 0) {
    const n = widths.length;
    bytes.push(n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff);
    for (const [col, width] of widths) {
      bytes.push(col & 0xff, (col >>> 8) & 0xff, (col >>> 16) & 0xff, (col >>> 24) & 0xff);
      const w = Math.max(RSF_COL_WIDTH_MIN, Math.min(RSF_COL_WIDTH_MAX, Math.round(width)));
      bytes.push(w & 0xff, (w >> 8) & 0xff);
    }
  }
  return bytes;
}

/** Read a worksheet display block, clamping every value into the documented bounds. */
function readDisplayBlock(rd: BodyReader, columnCount: number): RsfDisplaySettings | null | 'bad-shape' {
  if (!rd.need(1)) {
    return 'bad-shape';
  }
  const flags = rd.u8();
  const display: RsfDisplaySettings = {};
  if (flags & 1) {
    if (!rd.need(2)) {
      return 'bad-shape';
    }
    display.zoom = Math.max(RSF_ZOOM_MIN, Math.min(RSF_ZOOM_MAX, rd.u16()));
  }
  if (flags & 2) {
    if (!rd.need(4)) {
      return 'bad-shape';
    }
    const count = rd.u32();
    if (count > MAX_RSF_COLS || !rd.need(count * 6)) {
      return 'bad-shape';
    }
    const widths = new Map<number, number>();
    for (let i = 0; i < count; i++) {
      const col = rd.u32();
      const width = rd.u16();
      if (col < columnCount) {
        widths.set(col, Math.max(RSF_COL_WIDTH_MIN, Math.min(RSF_COL_WIDTH_MAX, width)));
      }
    }
    if (widths.size > 0) {
      display.colWidths = [...widths.entries()];
    }
  }
  if (flags & 4) {
    display.wrap = true;
  }
  return display.zoom !== undefined || display.colWidths || display.wrap ? display : null;
}

/** Append a length-prefixed UTF-8 string (bounded to `max` bytes). */
function pushString(bytes: number[], enc: TextEncoder, value: string, max: number): void {
  let encoded = enc.encode(value);
  if (encoded.length > max) {
    encoded = encoded.subarray(0, max);
  }
  bytes.push(encoded.length & 0xff, (encoded.length >> 8) & 0xff);
  for (const b of encoded) {
    bytes.push(b);
  }
}

/** Encode the workbook body (container version 4, workbook body version 1). */
function encodeWorkbookBody(data: RsfWorkbookData): Uint8Array {
  const enc = new TextEncoder();
  const bytes: number[] = [];
  const u32 = (v: number): void => {
    bytes.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
  };
  const f64 = (v: number): void => {
    const buf = new Uint8Array(8);
    new DataView(buf.buffer).setFloat64(0, v, true);
    for (const b of buf) {
      bytes.push(b);
    }
  };
  bytes.push(RSF_WORKBOOK_BODY_VERSION);
  bytes.push(data.delimiter.charCodeAt(0));
  pushString(bytes, enc, data.appName ?? '', MAX_META_LENGTH);
  pushString(bytes, enc, data.appVersion ?? '', MAX_META_LENGTH);
  f64(data.createdAt ?? 0);
  f64(data.updatedAt ?? 0);
  pushString(bytes, enc, data.docId ?? '', MAX_RSF_SHEET_NAME_BYTES);
  pushString(bytes, enc, data.activeSheetId ?? '', MAX_RSF_SHEET_NAME_BYTES);
  const sheets = data.sheets.slice(0, MAX_RSF_SHEETS);
  bytes.push(sheets.length & 0xff, (sheets.length >> 8) & 0xff);
  for (const sheet of sheets) {
    pushString(bytes, enc, sheet.id, MAX_RSF_SHEET_NAME_BYTES);
    pushString(bytes, enc, sheet.name, MAX_RSF_SHEET_NAME_BYTES);
    u32(sheet.rowCount);
    u32(sheet.columnCount);
    u32(sheet.cells.length);
    for (const [r, c, input] of sheet.cells) {
      u32(r);
      u32(c);
      const value = enc.encode(input);
      u32(value.length);
      for (const b of value) {
        bytes.push(b);
      }
    }
    for (const b of encodeDisplayBlock(sheet.display, sheet.columnCount)) {
      bytes.push(b);
    }
    for (const b of encodeFilterBlock(sheet.filter)) {
      bytes.push(b);
    }
  }
  return Uint8Array.from(bytes);
}

/** Decode and strictly validate a workbook body. Never executes anything. */
function decodeWorkbookBody(body: Uint8Array): RsfWorkbookDecodeResult {
  const dec = new TextDecoder('utf-8', { fatal: true });
  const rd = new BodyReader(body, dec);
  if (!rd.need(2)) {
    return { ok: false, error: 'bad-shape' };
  }
  const version = rd.u8();
  if (version < 1 || version > RSF_WORKBOOK_BODY_VERSION) {
    return { ok: false, error: 'bad-version' };
  }
  const delimiter = DELIMS[rd.u8()];
  if (!delimiter) {
    return { ok: false, error: 'bad-shape' };
  }
  const appName = rd.str();
  const appVersion = rd.str();
  if (appName === null || appVersion === null) {
    return { ok: false, error: 'bad-shape' };
  }
  if (!rd.need(16)) {
    return { ok: false, error: 'bad-shape' };
  }
  const createdAt = rd.f64();
  const updatedAt = rd.f64();
  const docId = rd.str();
  const activeSheetId = rd.str();
  if (docId === null || activeSheetId === null) {
    return { ok: false, error: 'bad-shape' };
  }
  if (!rd.need(2)) {
    return { ok: false, error: 'bad-shape' };
  }
  const sheetCount = rd.u16();
  if (sheetCount < 1) {
    return { ok: false, error: 'bad-shape' };
  }
  if (sheetCount > MAX_RSF_SHEETS) {
    return { ok: false, error: 'too-large' };
  }
  const sheets: RsfWorksheetData[] = [];
  const seenIds = new Set<string>();
  // Cells are capped across the whole workbook, not just per worksheet, so a
  // container cannot multiply its way past the ceiling with many worksheets.
  let totalCells = 0;
  for (let s = 0; s < sheetCount; s++) {
    const id = rd.str();
    const name = rd.str();
    if (id === null || name === null || id.length === 0) {
      return { ok: false, error: 'bad-shape' };
    }
    // Worksheet identifiers must be unique: duplicates would make the active
    // worksheet and every cross-sheet reference ambiguous.
    if (seenIds.has(id)) {
      return { ok: false, error: 'bad-shape' };
    }
    seenIds.add(id);
    if (!rd.need(12)) {
      return { ok: false, error: 'bad-shape' };
    }
    const rowCount = rd.u32();
    const columnCount = rd.u32();
    const cellCount = rd.u32();
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
    totalCells += cellCount;
    if (totalCells > MAX_RSF_CELLS) {
      return { ok: false, error: 'too-large' };
    }
    const cells: Array<[number, number, string]> = [];
    for (let i = 0; i < cellCount; i++) {
      if (!rd.need(12)) {
        return { ok: false, error: 'bad-shape' };
      }
      const r = rd.u32();
      const c = rd.u32();
      const inputLen = rd.u32();
      if (r >= rowCount || c >= columnCount || inputLen > MAX_RSF_CELL_LENGTH || !rd.need(inputLen)) {
        return { ok: false, error: 'bad-shape' };
      }
      let input: string;
      try {
        input = dec.decode(rd.body.subarray(rd.off, rd.off + inputLen));
      } catch {
        return { ok: false, error: 'bad-shape' };
      }
      rd.off += inputLen;
      cells.push([r, c, input]);
    }
    const display = readDisplayBlock(rd, columnCount);
    if (display === 'bad-shape') {
      return { ok: false, error: 'bad-shape' };
    }
    const filterBlock = readFilterBlock(rd);
    if (filterBlock === null) {
      return { ok: false, error: 'bad-shape' };
    }
    const sheet: RsfWorksheetData = { id, name, rowCount, columnCount, cells };
    if (display) {
      sheet.display = display;
    }
    if (filterBlock.stored) {
      // Full semantic validation against this worksheet's dimensions. An
      // invalid stored filter is dropped (never guessed at) with a warning.
      const validated =
        filterBlock.raw === null ? null : validateFilter(filterBlock.raw, rowCount, columnCount);
      if (validated !== null) {
        sheet.filter = validated;
      } else {
        sheet.filterDropped = true;
      }
    }
    sheets.push(sheet);
  }
  if (rd.off !== body.length) {
    return { ok: false, error: 'bad-shape' };
  }
  const data: RsfWorkbookData = { delimiter, sheets };
  if (appName !== '') {
    data.appName = appName;
  }
  if (appVersion !== '') {
    data.appVersion = appVersion;
  }
  if (createdAt > 0 && Number.isFinite(createdAt)) {
    data.createdAt = createdAt;
  }
  if (updatedAt > 0 && Number.isFinite(updatedAt)) {
    data.updatedAt = updatedAt;
  }
  if (docId !== '') {
    data.docId = docId;
  }
  // An active-worksheet identifier that names no worksheet falls back to the
  // first one rather than leaving the workbook without an active worksheet.
  if (activeSheetId !== '' && seenIds.has(activeSheetId)) {
    data.activeSheetId = activeSheetId;
  } else {
    data.activeSheetId = sheets[0].id;
  }
  return { ok: true, data };
}

/**
 * Encode a workbook into the binary `.rsf` container. Workbooks holding a
 * single worksheet are written in the version-3 single-sheet container so
 * files that do not use multi-worksheet features stay readable by older
 * releases; workbooks with two or more worksheets are written in the
 * version-4 workbook container.
 */
export function encodeRsfWorkbook(
  data: RsfWorkbookData,
  method: number = getRsfCodec().defaultMethod(),
): Uint8Array {
  if (data.sheets.length === 1) {
    const only = data.sheets[0];
    const single: RsfData = {
      name: only.name,
      delimiter: data.delimiter,
      rowCount: only.rowCount,
      columnCount: only.columnCount,
      cells: only.cells,
    };
    if (data.appName !== undefined) {
      single.appName = data.appName;
    }
    if (data.appVersion !== undefined) {
      single.appVersion = data.appVersion;
    }
    if (only.display) {
      single.display = only.display;
    }
    if (only.filter) {
      single.filter = only.filter;
    }
    return encodeRsf(single, method);
  }
  const body = encodeWorkbookBody(data);
  const codec = getRsfCodec();
  const payload = codec.compress(body, method);
  if (payload === null) {
    throw new RsfEncodeError(method);
  }
  const crc = codec.crc32(body);
  const out = new Uint8Array(HEADER_SIZE + payload.length);
  out.set(RSF_MAGIC, 0);
  const view = new DataView(out.buffer);
  out[4] = RSF_CONTAINER_VERSION_WORKBOOK;
  out[5] = method;
  out[6] = 0;
  out[7] = RSF_CODEC_PROFILE;
  view.setUint32(8, body.length, true);
  view.setUint32(12, crc, true);
  view.setUint32(16, payload.length, true);
  out.set(payload, HEADER_SIZE);
  return out;
}

/**
 * Decode any supported `.rsf` container into the workbook model: a version-4
 * workbook container, a version-3 single-sheet container, or a legacy `.rcsv`
 * (RCSV magic, container version 2) single-sheet container. The two
 * single-sheet forms decode into a one-worksheet workbook and are flagged with
 * `legacySingleSheet` so the caller can report the migration.
 */
export function decodeRsfWorkbook(bytes: Uint8Array): RsfWorkbookDecodeResult {
  if (bytes.length < HEADER_SIZE) {
    return { ok: false, error: 'bad-magic' };
  }
  const isWorkbook = RSF_MAGIC.every((b, i) => bytes[i] === b) && bytes[4] === RSF_CONTAINER_VERSION_WORKBOOK;
  if (!isWorkbook) {
    // Not a workbook container: fall back to the single-sheet decoder, which
    // validates the magic/version pair itself and reads legacy containers.
    const single = decodeRsf(bytes);
    if (!single.ok) {
      return { ok: false, error: single.error };
    }
    const sheet: RsfWorksheetData = {
      // A single-sheet container stores no worksheet identifier; a stable one
      // is minted here so the in-memory workbook model is uniform.
      id: 's1',
      name: single.data.name,
      rowCount: single.data.rowCount,
      columnCount: single.data.columnCount,
      cells: single.data.cells,
    };
    if (single.data.display) {
      sheet.display = single.data.display;
    }
    if (single.data.filter) {
      sheet.filter = single.data.filter;
    }
    if (single.data.filterDropped) {
      sheet.filterDropped = true;
    }
    const data: RsfWorkbookData = {
      delimiter: single.data.delimiter,
      sheets: [sheet],
      activeSheetId: sheet.id,
      legacySingleSheet: true,
    };
    if (single.data.appName !== undefined) {
      data.appName = single.data.appName;
    }
    if (single.data.appVersion !== undefined) {
      data.appVersion = single.data.appVersion;
    }
    if (single.data.compression !== undefined) {
      data.compression = single.data.compression;
    }
    return { ok: true, data };
  }
  const method = bytes[5];
  if (!isRsfMethod(method)) {
    return { ok: false, error: 'unsupported-compression' };
  }
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
    const decodable = method === RSF_COMPRESSION_STORE || codec.canWrite(method);
    return { ok: false, error: decodable ? 'bad-shape' : 'unsupported-compression' };
  }
  if (codec.crc32(body) !== crc) {
    return { ok: false, error: 'checksum' };
  }
  const decoded = decodeWorkbookBody(body);
  if (decoded.ok) {
    decoded.data.compression = method;
  }
  return decoded;
}
