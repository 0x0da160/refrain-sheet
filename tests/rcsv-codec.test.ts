// SPDX-License-Identifier: MIT
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  getRcsvCodec,
  initCsvEngine,
  RCSV_COMPRESSION_DEFLATE,
  RCSV_COMPRESSION_LZ4,
  RCSV_COMPRESSION_STORE,
  RCSV_COMPRESSION_ZSTD,
  setCsvEngineForTesting,
} from '../src/core/csv-engine';
import {
  decodeRcsv,
  encodeRcsv,
  isRcsvMethod,
  RCSV_MAGIC,
  RcsvEncodeError,
  type RcsvData,
} from '../src/core/rcsv-codec';
import { RcsvDocument } from '../src/core/rcsv-document';

const sample: RcsvData = {
  name: 'Sheet1',
  delimiter: ';',
  rowCount: 4,
  columnCount: 3,
  cells: [
    [0, 0, 'value'],
    [1, 2, '=SUM(A1:A2)'],
    [3, 1, 'multi\nline — ünïcödé'],
  ],
};

/** Compare a decoded sheet to `sample` ignoring the stamped compression id. */
function expectSample(data: RcsvData): void {
  const rest = { ...data };
  delete rest.compression;
  expect(rest).toEqual(sample);
}

describe('binary container codec (JS store engine)', () => {
  it('round-trips a sheet through the store codec', () => {
    const bytes = encodeRcsv(sample);
    expect(bytes[5]).toBe(RCSV_COMPRESSION_STORE);
    const decoded = decodeRcsv(bytes);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expectSample(decoded.data);
    // The container's method is reported back so a document can preserve it.
    expect(decoded.data.compression).toBe(RCSV_COMPRESSION_STORE);
  });

  it('only stores under the JS fallback and refuses compressed methods', () => {
    const codec = getRcsvCodec();
    expect(codec.defaultMethod()).toBe(RCSV_COMPRESSION_STORE);
    expect(codec.writableMethods()).toEqual([RCSV_COMPRESSION_STORE]);
    expect(codec.canWrite(RCSV_COMPRESSION_ZSTD)).toBe(false);
    expect(() => encodeRcsv(sample, RCSV_COMPRESSION_ZSTD)).toThrow(RcsvEncodeError);
  });

  it('exposes the magic bytes and a 20-byte header', () => {
    const bytes = encodeRcsv({ ...sample, cells: [] });
    expect(Array.from(bytes.subarray(0, 4))).toEqual(Array.from(RCSV_MAGIC));
  });

  it('round-trips application metadata (body version 2)', () => {
    const withMeta: RcsvData = { ...sample, appName: 'Refrain Sheet', appVersion: '0.1.1' };
    const decoded = decodeRcsv(encodeRcsv(withMeta));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.data.appName).toBe('Refrain Sheet');
    expect(decoded.data.appVersion).toBe('0.1.1');
    expect(decoded.data.cells).toEqual(sample.cells);
  });

  it('omits metadata for a legacy version-1 body', () => {
    const decoded = decodeRcsv(encodeRcsv(sample));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.data.appName).toBeUndefined();
    expect(decoded.data.appVersion).toBeUndefined();
  });

  it('rejects a truncated payload', () => {
    const bytes = encodeRcsv(sample);
    const decoded = decodeRcsv(bytes.subarray(0, bytes.length - 2));
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) expect(decoded.error).toBe('bad-shape');
  });

  it('rejects a checksum mismatch', () => {
    const bytes = encodeRcsv(sample);
    bytes[bytes.length - 1] ^= 0x01;
    const decoded = decodeRcsv(bytes);
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) expect(['checksum', 'bad-shape']).toContain(decoded.error);
  });

  it('rejects an oversize declared sheet', () => {
    const decoded = decodeRcsv(
      encodeRcsv({ name: 's', delimiter: ',', rowCount: 100_000_000, columnCount: 100, cells: [] }),
    );
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) expect(decoded.error).toBe('too-large');
  });

  it('rejects an unsupported compression method byte', () => {
    expect(isRcsvMethod(42)).toBe(false);
    const bytes = encodeRcsv(sample);
    bytes[5] = 42;
    const decoded = decodeRcsv(bytes);
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) expect(decoded.error).toBe('unsupported-compression');
  });

  it('rejects an unknown codec profile version', () => {
    const bytes = encodeRcsv(sample);
    bytes[7] = 1; // a future profile this build cannot decode
    const decoded = decodeRcsv(bytes);
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) expect(decoded.error).toBe('unsupported-compression');
  });
});

describe('binary container codec (WASM engine: zstd / lz4 / deflate / store)', () => {
  beforeAll(async () => {
    await initCsvEngine();
    setCsvEngineForTesting('wasm');
  });
  afterAll(() => setCsvEngineForTesting('js'));

  const big: RcsvData = {
    name: 'big',
    delimiter: ',',
    rowCount: 1000,
    columnCount: 1,
    cells: Array.from({ length: 1000 }, (_, r) => [r, 0, 'repeated payload row'] as [number, number, string]),
  };

  it('defaults new documents to Zstandard and lists all writable methods', () => {
    const codec = getRcsvCodec();
    expect(codec.defaultMethod()).toBe(RCSV_COMPRESSION_ZSTD);
    expect(codec.writableMethods()).toEqual([
      RCSV_COMPRESSION_ZSTD,
      RCSV_COMPRESSION_LZ4,
      RCSV_COMPRESSION_DEFLATE,
      RCSV_COMPRESSION_STORE,
    ]);
    // No explicit method → Zstandard.
    expect(encodeRcsv(sample)[5]).toBe(RCSV_COMPRESSION_ZSTD);
  });

  for (const [name, method] of [
    ['zstd', RCSV_COMPRESSION_ZSTD],
    ['lz4', RCSV_COMPRESSION_LZ4],
    ['deflate', RCSV_COMPRESSION_DEFLATE],
    ['store', RCSV_COMPRESSION_STORE],
  ] as const) {
    it(`round-trips through ${name} with the method recorded in the header`, () => {
      const bytes = encodeRcsv(big, method);
      expect(bytes[5]).toBe(method);
      expect(bytes[7]).toBe(0); // codec profile
      if (method !== RCSV_COMPRESSION_STORE) {
        // Highly repetitive content compresses well below the raw body size.
        expect(bytes.length).toBeLessThan(1000 * 20);
      }
      const decoded = decodeRcsv(bytes);
      expect(decoded.ok).toBe(true);
      if (!decoded.ok) return;
      expect(decoded.data.compression).toBe(method);
      expect(decoded.data.cells.length).toBe(1000);
      expect(decoded.data.cells[999][2]).toBe('repeated payload row');
    });
  }

  it('preserves a container’s method across a decode → re-encode', () => {
    const lz4 = encodeRcsv(sample, RCSV_COMPRESSION_LZ4);
    const decoded = decodeRcsv(lz4);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    // Re-encoding with the decoded method reproduces the same method byte.
    const again = encodeRcsv({ ...sample }, decoded.data.compression);
    expect(again[5]).toBe(RCSV_COMPRESSION_LZ4);
  });

  it('detects compressed-payload corruption', () => {
    for (const method of [RCSV_COMPRESSION_ZSTD, RCSV_COMPRESSION_LZ4, RCSV_COMPRESSION_DEFLATE]) {
      // Corrupt the start of the compressed frame (offset 20 = first payload
      // byte) and a byte mid-payload; either a decode failure or a checksum
      // mismatch must reject the file (never a silent wrong read).
      const bytes = encodeRcsv(big, method);
      bytes[20] ^= 0xff;
      bytes[20 + Math.floor((bytes.length - 20) / 2)] ^= 0xff;
      const decoded = decodeRcsv(bytes);
      expect(decoded.ok).toBe(false);
    }
  });

  it('RcsvDocument preserves the loaded method on save; new docs default to Zstd', () => {
    const original = encodeRcsv(sample, RCSV_COMPRESSION_LZ4);
    const loaded = RcsvDocument.fromBytes(original, 'x.rcsv');
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.doc.compression).toBe(RCSV_COMPRESSION_LZ4);
    expect(loaded.doc.toBytes()[5]).toBe(RCSV_COMPRESSION_LZ4); // normal save reuses it
    loaded.doc.setCompression(RCSV_COMPRESSION_ZSTD); // explicit change (Save dialog)
    expect(loaded.doc.toBytes()[5]).toBe(RCSV_COMPRESSION_ZSTD);
    // A brand-new document defaults to Zstandard.
    expect(RcsvDocument.empty('new.rcsv', 2, 2).toBytes()[5]).toBe(RCSV_COMPRESSION_ZSTD);
  });

  it('a store file written by the JS engine still reads under WASM', () => {
    setCsvEngineForTesting('js');
    const stored = encodeRcsv(sample);
    setCsvEngineForTesting('wasm');
    const decoded = decodeRcsv(stored);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expectSample(decoded.data);
  });

  it('a compressed container is reported unsupported under the store-only JS fallback', () => {
    // A zstd file written under WASM cannot be read by the store-only JS
    // fallback: it lacks the decoder, so the error is "unsupported", not shape.
    const zstd = encodeRcsv(sample, RCSV_COMPRESSION_ZSTD);
    setCsvEngineForTesting('js');
    const decoded = decodeRcsv(zstd);
    setCsvEngineForTesting('wasm');
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) expect(decoded.error).toBe('unsupported-compression');
  });
});
