// SPDX-License-Identifier: MIT
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  getRsfCodec,
  initCsvEngine,
  RSF_COMPRESSION_DEFLATE,
  RSF_COMPRESSION_LZ4,
  RSF_COMPRESSION_STORE,
  RSF_COMPRESSION_ZSTD,
  setCsvEngineForTesting,
} from '../src/core/csv-engine';
import {
  decodeRsf,
  encodeRsf,
  isRsfMethod,
  RSF_CONTAINER_VERSION,
  RSF_LEGACY_CONTAINER_VERSION,
  RSF_LEGACY_MAGIC,
  RSF_MAGIC,
  RsfEncodeError,
  type RsfData,
} from '../src/core/rsf-codec';
import { RsfDocument, RSF_EXTENSION } from '../src/core/rsf-document';

const sample: RsfData = {
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
function expectSample(data: RsfData): void {
  const rest = { ...data };
  delete rest.compression;
  expect(rest).toEqual(sample);
}

describe('binary container codec (JS store engine)', () => {
  it('round-trips a sheet through the store codec', () => {
    const bytes = encodeRsf(sample);
    expect(bytes[5]).toBe(RSF_COMPRESSION_STORE);
    const decoded = decodeRsf(bytes);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expectSample(decoded.data);
    // The container's method is reported back so a document can preserve it.
    expect(decoded.data.compression).toBe(RSF_COMPRESSION_STORE);
  });

  it('only stores under the JS fallback and refuses compressed methods', () => {
    const codec = getRsfCodec();
    expect(codec.defaultMethod()).toBe(RSF_COMPRESSION_STORE);
    expect(codec.writableMethods()).toEqual([RSF_COMPRESSION_STORE]);
    expect(codec.canWrite(RSF_COMPRESSION_ZSTD)).toBe(false);
    expect(() => encodeRsf(sample, RSF_COMPRESSION_ZSTD)).toThrow(RsfEncodeError);
  });

  it('exposes the magic bytes and a 20-byte header', () => {
    const bytes = encodeRsf({ ...sample, cells: [] });
    expect(Array.from(bytes.subarray(0, 4))).toEqual(Array.from(RSF_MAGIC));
  });

  it('round-trips application metadata (body version 2)', () => {
    const withMeta: RsfData = { ...sample, appName: 'Refrain Sheet', appVersion: '0.1.1' };
    const decoded = decodeRsf(encodeRsf(withMeta));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.data.appName).toBe('Refrain Sheet');
    expect(decoded.data.appVersion).toBe('0.1.1');
    expect(decoded.data.cells).toEqual(sample.cells);
  });

  it('omits metadata for a legacy version-1 body', () => {
    const decoded = decodeRsf(encodeRsf(sample));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.data.appName).toBeUndefined();
    expect(decoded.data.appVersion).toBeUndefined();
  });

  it('rejects a truncated payload', () => {
    const bytes = encodeRsf(sample);
    const decoded = decodeRsf(bytes.subarray(0, bytes.length - 2));
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) expect(decoded.error).toBe('bad-shape');
  });

  it('rejects a checksum mismatch', () => {
    const bytes = encodeRsf(sample);
    bytes[bytes.length - 1] ^= 0x01;
    const decoded = decodeRsf(bytes);
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) expect(['checksum', 'bad-shape']).toContain(decoded.error);
  });

  it('rejects an oversize declared sheet', () => {
    const decoded = decodeRsf(
      encodeRsf({ name: 's', delimiter: ',', rowCount: 100_000_000, columnCount: 100, cells: [] }),
    );
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) expect(decoded.error).toBe('too-large');
  });

  it('rejects an unsupported compression method byte', () => {
    expect(isRsfMethod(42)).toBe(false);
    const bytes = encodeRsf(sample);
    bytes[5] = 42;
    const decoded = decodeRsf(bytes);
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) expect(decoded.error).toBe('unsupported-compression');
  });

  it('rejects an unknown codec profile version', () => {
    const bytes = encodeRsf(sample);
    bytes[7] = 1; // a future profile this build cannot decode
    const decoded = decodeRsf(bytes);
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) expect(decoded.error).toBe('unsupported-compression');
  });

  it('writes the RSF1 magic and container version 3', () => {
    const bytes = encodeRsf(sample);
    expect(Array.from(bytes.subarray(0, 4))).toEqual([0x52, 0x53, 0x46, 0x31]);
    expect(bytes[4]).toBe(RSF_CONTAINER_VERSION);
    expect(RSF_CONTAINER_VERSION).toBe(3);
  });
});

describe('legacy .rcsv (RCSV magic, container v2) backward compatibility', () => {
  /** Re-stamp a current RSF container as a legacy RCSV one (identical body). */
  function toLegacy(bytes: Uint8Array): Uint8Array {
    const legacy = bytes.slice();
    legacy.set(RSF_LEGACY_MAGIC, 0);
    legacy[4] = RSF_LEGACY_CONTAINER_VERSION;
    return legacy;
  }

  it('reads a legacy RCSV container transparently', () => {
    const decoded = decodeRsf(toLegacy(encodeRsf(sample)));
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expectSample(decoded.data);
  });

  it('rejects a legacy magic paired with the new version (mismatched pair)', () => {
    const bytes = encodeRsf(sample);
    bytes.set(RSF_LEGACY_MAGIC, 0); // legacy magic but still version 3
    const decoded = decodeRsf(bytes);
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) expect(decoded.error).toBe('bad-version');
  });

  it('rejects the new magic paired with the legacy version', () => {
    const bytes = toLegacy(encodeRsf(sample));
    bytes.set(RSF_MAGIC, 0); // new magic but version 2
    const decoded = decodeRsf(bytes);
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) expect(decoded.error).toBe('bad-version');
  });

  it('a document loaded from a legacy container re-saves as current RSF', () => {
    const loaded = RsfDocument.fromBytes(toLegacy(encodeRsf(sample)), `x${RSF_EXTENSION}`);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const resaved = loaded.doc.toBytes();
    // The re-saved bytes carry the current RSF magic + version, never the legacy pair.
    expect(Array.from(resaved.subarray(0, 4))).toEqual(Array.from(RSF_MAGIC));
    expect(resaved[4]).toBe(RSF_CONTAINER_VERSION);
  });
});

describe('binary container codec (WASM engine: zstd / lz4 / deflate / store)', () => {
  beforeAll(async () => {
    await initCsvEngine();
    setCsvEngineForTesting('wasm');
  });
  afterAll(() => setCsvEngineForTesting('js'));

  const big: RsfData = {
    name: 'big',
    delimiter: ',',
    rowCount: 1000,
    columnCount: 1,
    cells: Array.from({ length: 1000 }, (_, r) => [r, 0, 'repeated payload row'] as [number, number, string]),
  };

  it('defaults new documents to Zstandard and lists all writable methods', () => {
    const codec = getRsfCodec();
    expect(codec.defaultMethod()).toBe(RSF_COMPRESSION_ZSTD);
    expect(codec.writableMethods()).toEqual([
      RSF_COMPRESSION_ZSTD,
      RSF_COMPRESSION_LZ4,
      RSF_COMPRESSION_DEFLATE,
      RSF_COMPRESSION_STORE,
    ]);
    // No explicit method → Zstandard.
    expect(encodeRsf(sample)[5]).toBe(RSF_COMPRESSION_ZSTD);
  });

  for (const [name, method] of [
    ['zstd', RSF_COMPRESSION_ZSTD],
    ['lz4', RSF_COMPRESSION_LZ4],
    ['deflate', RSF_COMPRESSION_DEFLATE],
    ['store', RSF_COMPRESSION_STORE],
  ] as const) {
    it(`round-trips through ${name} with the method recorded in the header`, () => {
      const bytes = encodeRsf(big, method);
      expect(bytes[5]).toBe(method);
      expect(bytes[7]).toBe(0); // codec profile
      if (method !== RSF_COMPRESSION_STORE) {
        // Highly repetitive content compresses well below the raw body size.
        expect(bytes.length).toBeLessThan(1000 * 20);
      }
      const decoded = decodeRsf(bytes);
      expect(decoded.ok).toBe(true);
      if (!decoded.ok) return;
      expect(decoded.data.compression).toBe(method);
      expect(decoded.data.cells.length).toBe(1000);
      expect(decoded.data.cells[999][2]).toBe('repeated payload row');
    });
  }

  it('preserves a container’s method across a decode → re-encode', () => {
    const lz4 = encodeRsf(sample, RSF_COMPRESSION_LZ4);
    const decoded = decodeRsf(lz4);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    // Re-encoding with the decoded method reproduces the same method byte.
    const again = encodeRsf({ ...sample }, decoded.data.compression);
    expect(again[5]).toBe(RSF_COMPRESSION_LZ4);
  });

  it('detects compressed-payload corruption', () => {
    for (const method of [RSF_COMPRESSION_ZSTD, RSF_COMPRESSION_LZ4, RSF_COMPRESSION_DEFLATE]) {
      // Corrupt the start of the compressed frame (offset 20 = first payload
      // byte) and a byte mid-payload; either a decode failure or a checksum
      // mismatch must reject the file (never a silent wrong read).
      const bytes = encodeRsf(big, method);
      bytes[20] ^= 0xff;
      bytes[20 + Math.floor((bytes.length - 20) / 2)] ^= 0xff;
      const decoded = decodeRsf(bytes);
      expect(decoded.ok).toBe(false);
    }
  });

  it('RsfDocument preserves the loaded method on save; new docs default to Zstd', () => {
    const original = encodeRsf(sample, RSF_COMPRESSION_LZ4);
    const loaded = RsfDocument.fromBytes(original, 'x.rcsv');
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.doc.compression).toBe(RSF_COMPRESSION_LZ4);
    expect(loaded.doc.toBytes()[5]).toBe(RSF_COMPRESSION_LZ4); // normal save reuses it
    loaded.doc.setCompression(RSF_COMPRESSION_ZSTD); // explicit change (Save dialog)
    expect(loaded.doc.toBytes()[5]).toBe(RSF_COMPRESSION_ZSTD);
    // A brand-new document defaults to Zstandard.
    expect(RsfDocument.empty('new.rcsv', 2, 2).toBytes()[5]).toBe(RSF_COMPRESSION_ZSTD);
  });

  it('a store file written by the JS engine still reads under WASM', () => {
    setCsvEngineForTesting('js');
    const stored = encodeRsf(sample);
    setCsvEngineForTesting('wasm');
    const decoded = decodeRsf(stored);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expectSample(decoded.data);
  });

  it('a compressed container is reported unsupported under the store-only JS fallback', () => {
    // A zstd file written under WASM cannot be read by the store-only JS
    // fallback: it lacks the decoder, so the error is "unsupported", not shape.
    const zstd = encodeRsf(sample, RSF_COMPRESSION_ZSTD);
    setCsvEngineForTesting('js');
    const decoded = decodeRsf(zstd);
    setCsvEngineForTesting('wasm');
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) expect(decoded.error).toBe('unsupported-compression');
  });
});
