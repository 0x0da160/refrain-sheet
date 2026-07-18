// SPDX-License-Identifier: MIT
import { detectDelimiterJs, parseCsvIndexJs, type DelimiterId, type ParsedIndex } from './byte-csv-parser';
import initWasm, {
  applyReplacements as wasmApplyReplacements,
  countLiteral as wasmCountLiteral,
  parseCsv as wasmParseCsv,
  planReplacements as wasmPlanReplacements,
  rcsvCrc32 as wasmCrc32,
  rcsvDeflate as wasmDeflate,
  rcsvInflate as wasmInflate,
  sniffDelimiter as wasmSniffDelimiter,
  statsAggregate as wasmStatsAggregate,
} from '../wasm-gen/refrain_csv_core';
import { WASM_BASE64 } from '../wasm-gen/wasm-payload';

/**
 * The performance-critical byte-level CSV operations (parsing, structural
 * validation, delimiter sniffing, row indexing, serialization planning) are
 * implemented in Rust and compiled to WebAssembly. The WASM binary is
 * embedded in the bundle as Base64 and instantiated locally — it is never
 * fetched from the filesystem, a server, or a CDN, so the app keeps working
 * when dist/index.html is opened directly via file://.
 *
 * A TypeScript fallback with identical semantics exists for environments
 * where WebAssembly is unavailable or blocked; parity between the two is
 * covered by tests.
 */
export type CsvEngineName = 'wasm' | 'js';

export interface CsvEngine {
  readonly name: CsvEngineName;
  sniffDelimiter(bytes: Uint8Array): DelimiterId;
  parseIndex(bytes: Uint8Array, delimiter: DelimiterId, treatUtf8Bom: boolean): ParsedIndex;
  /**
   * Serialization planning: ordered [kind, a, b] triples describing the
   * output as verbatim copies of the original bytes (kind 0, byte range
   * a..b) plus replacement payload segments (kind 1, payload range a..b).
   */
  planReplacements(bytesLength: number, ranges: Uint32Array, payloadLens: Uint32Array): Uint32Array;
  /** Execute the plan: replace byte ranges, copying all other bytes verbatim. */
  applyReplacements(
    bytes: Uint8Array,
    ranges: Uint32Array,
    payload: Uint8Array,
    payloadLens: Uint32Array,
  ): Uint8Array;
  /**
   * Reduce finite numbers (in cell order) to `[sum, min, max]` for selection
   * statistics. The summation order matches the JS fallback exactly.
   */
  statsAggregate(values: Float64Array): { sum: number; min: number; max: number };
  /** Count non-overlapping occurrences of a literal needle in a haystack. */
  countLiteral(haystack: Uint8Array, needle: Uint8Array): number;
}

/** Compression methods recorded in the binary `.rcsv` container header. */
export const RCSV_COMPRESSION_STORE = 0;
export const RCSV_COMPRESSION_DEFLATE = 1;

/**
 * Compression + checksum primitives for the binary `.rcsv` container. The
 * WASM-backed codec compresses with DEFLATE (implemented in Rust); the JS
 * fallback stores payloads uncompressed. Both can read the "store" method, so
 * a document written under the JS fallback always round-trips; reading a
 * DEFLATE-compressed container requires the WASM engine.
 */
export interface RcsvCodec {
  /** Compression method this codec writes: STORE or DEFLATE. */
  readonly writeMethod: number;
  /** Compress the body; returns [method, payload]. */
  compress(body: Uint8Array): { method: number; payload: Uint8Array };
  /**
   * Decompress `payload` (encoded with `method`) to exactly `expectedLen`
   * bytes. Bounded by `expectedLen` as a decompression-bomb guard. Returns
   * null on corruption, length mismatch, or an unsupported method.
   */
  decompress(payload: Uint8Array, method: number, expectedLen: number): Uint8Array | null;
  /** CRC-32 (IEEE) of the uncompressed body. */
  crc32(bytes: Uint8Array): number;
}

let crcTable: Uint32Array | null = null;
function crc32Js(bytes: Uint8Array): number {
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

const jsCodec: RcsvCodec = {
  writeMethod: RCSV_COMPRESSION_STORE,
  compress(body) {
    return { method: RCSV_COMPRESSION_STORE, payload: body };
  },
  decompress(payload, method, expectedLen) {
    if (method !== RCSV_COMPRESSION_STORE) {
      return null; // DEFLATE requires the WASM engine
    }
    return payload.length === expectedLen ? payload : null;
  },
  crc32: crc32Js,
};

const wasmCodec: RcsvCodec = {
  writeMethod: RCSV_COMPRESSION_DEFLATE,
  compress(body) {
    return { method: RCSV_COMPRESSION_DEFLATE, payload: wasmDeflate(body) };
  },
  decompress(payload, method, expectedLen) {
    if (method === RCSV_COMPRESSION_STORE) {
      return payload.length === expectedLen ? payload : null;
    }
    if (method !== RCSV_COMPRESSION_DEFLATE) {
      return null;
    }
    const out = wasmInflate(payload, expectedLen);
    return out && out.length === expectedLen ? out : null;
  },
  crc32(bytes) {
    return wasmCrc32(bytes) >>> 0;
  },
};

/** The active compression codec (WASM when available, else the JS store codec). */
export function getRcsvCodec(): RcsvCodec {
  return activeEngine.name === 'wasm' ? wasmCodec : jsCodec;
}

const DELIMITER_BY_BYTE: Record<number, DelimiterId> = { 0x2c: ',', 0x3b: ';', 0x09: '\t' };

export const PLAN_COPY = 0;
export const PLAN_PAYLOAD = 1;

/** JS implementation of serialization planning (mirrors wasm/src/csv.rs). */
export function planReplacementsJs(
  bytesLength: number,
  ranges: Uint32Array,
  payloadLens: Uint32Array,
): Uint32Array {
  const n = ranges.length / 2;
  const payloadOffsets = new Uint32Array(n);
  let off = 0;
  for (let i = 0; i < n; i++) {
    payloadOffsets[i] = off;
    off += payloadLens[i];
  }
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => ranges[a * 2] - ranges[b * 2]);
  const plan: number[] = [];
  let src = 0;
  for (const i of order) {
    const start = ranges[i * 2];
    const end = ranges[i * 2 + 1];
    if (start > src) {
      plan.push(PLAN_COPY, src, start);
    }
    if (payloadLens[i] > 0) {
      plan.push(PLAN_PAYLOAD, payloadOffsets[i], payloadOffsets[i] + payloadLens[i]);
    }
    src = end;
  }
  if (bytesLength > src) {
    plan.push(PLAN_COPY, src, bytesLength);
  }
  return Uint32Array.from(plan);
}

function applyPlan(plan: Uint32Array, bytes: Uint8Array, payload: Uint8Array): Uint8Array {
  let total = 0;
  for (let i = 0; i < plan.length; i += 3) {
    total += plan[i + 2] - plan[i + 1];
  }
  const out = new Uint8Array(total);
  let dst = 0;
  for (let i = 0; i < plan.length; i += 3) {
    const source = plan[i] === PLAN_COPY ? bytes : payload;
    out.set(source.subarray(plan[i + 1], plan[i + 2]), dst);
    dst += plan[i + 2] - plan[i + 1];
  }
  return out;
}

/** JS reduction of finite numbers to sum/min/max (mirrors wasm/src/ops.rs). */
export function statsAggregateJs(values: Float64Array): { sum: number; min: number; max: number } {
  if (values.length === 0) {
    return { sum: 0, min: 0, max: 0 };
  }
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { sum, min, max };
}

/** JS non-overlapping literal byte-count (mirrors wasm/src/ops.rs). */
export function countLiteralJs(haystack: Uint8Array, needle: Uint8Array): number {
  const n = needle.length;
  if (n === 0 || n > haystack.length) {
    return 0;
  }
  let count = 0;
  let i = 0;
  outer: while (i + n <= haystack.length) {
    for (let j = 0; j < n; j++) {
      if (haystack[i + j] !== needle[j]) {
        i += 1;
        continue outer;
      }
    }
    count += 1;
    i += n;
  }
  return count;
}

const jsEngine: CsvEngine = {
  name: 'js',
  sniffDelimiter: detectDelimiterJs,
  parseIndex: parseCsvIndexJs,
  planReplacements: planReplacementsJs,
  applyReplacements(bytes, ranges, payload, payloadLens) {
    return applyPlan(planReplacementsJs(bytes.length, ranges, payloadLens), bytes, payload);
  },
  statsAggregate: statsAggregateJs,
  countLiteral: countLiteralJs,
};

const wasmEngine: CsvEngine = {
  name: 'wasm',
  sniffDelimiter(bytes) {
    return DELIMITER_BY_BYTE[wasmSniffDelimiter(bytes)] ?? ',';
  },
  parseIndex(bytes, delimiter, treatUtf8Bom) {
    const index = wasmParseCsv(bytes, delimiter.charCodeAt(0), treatUtf8Bom);
    try {
      return {
        records: index.records,
        fields: index.fields,
        diagnostics: index.diagnostics,
        lineEndings: { crlf: index.crlf, lf: index.lf, cr: index.cr },
        hasFinalNewline: index.hasFinalNewline,
        bomLength: index.bomLength,
      };
    } finally {
      index.free();
    }
  },
  planReplacements(bytesLength, ranges, payloadLens) {
    return wasmPlanReplacements(bytesLength, ranges, payloadLens);
  },
  applyReplacements(bytes, ranges, payload, payloadLens) {
    return wasmApplyReplacements(bytes, ranges, payload, payloadLens);
  },
  statsAggregate(values) {
    const [sum, min, max] = wasmStatsAggregate(values);
    return { sum, min, max };
  },
  countLiteral(haystack, needle) {
    return wasmCountLiteral(haystack, needle);
  },
};

/** Decode the embedded Base64 WASM binary locally (no fetch, no network). */
export function decodeEmbeddedWasm(base64: string = WASM_BASE64): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

let activeEngine: CsvEngine = jsEngine;
let initPromise: Promise<CsvEngineName> | null = null;

/**
 * Instantiate the embedded WASM core and make it the active engine.
 * Falls back to the TypeScript engine (identical semantics) when
 * WebAssembly is unavailable or blocked; the returned name reports which
 * engine is active. Idempotent.
 */
export function initCsvEngine(): Promise<CsvEngineName> {
  initPromise ??= (async () => {
    try {
      await initWasm({ module_or_path: decodeEmbeddedWasm() });
      activeEngine = wasmEngine;
    } catch (err) {
      console.warn('refrain-csv-core: WASM engine unavailable, using the JS fallback engine.', err);
      activeEngine = jsEngine;
    }
    return activeEngine.name;
  })();
  return initPromise;
}

export function getCsvEngine(): CsvEngine {
  return activeEngine;
}

/** Test hook: force a specific engine (the wasm engine requires initCsvEngine() first). */
export function setCsvEngineForTesting(name: CsvEngineName): void {
  activeEngine = name === 'wasm' ? wasmEngine : jsEngine;
}
