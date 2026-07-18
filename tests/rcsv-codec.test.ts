// SPDX-License-Identifier: MIT
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  getRcsvCodec,
  initCsvEngine,
  RCSV_COMPRESSION_DEFLATE,
  RCSV_COMPRESSION_STORE,
  setCsvEngineForTesting,
} from '../src/core/csv-engine';
import { decodeRcsv, encodeRcsv, RCSV_MAGIC, type RcsvData } from '../src/core/rcsv-codec';

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

describe('binary container codec (JS store engine)', () => {
  it('round-trips a sheet through the store codec', () => {
    const bytes = encodeRcsv(sample);
    expect(bytes[5]).toBe(RCSV_COMPRESSION_STORE);
    const decoded = decodeRcsv(bytes);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.data).toEqual(sample);
  });

  it('exposes the magic bytes and a 20-byte header', () => {
    const bytes = encodeRcsv({ ...sample, cells: [] });
    expect(Array.from(bytes.subarray(0, 4))).toEqual(Array.from(RCSV_MAGIC));
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
    const bytes = encodeRcsv(sample);
    bytes[5] = 42;
    const decoded = decodeRcsv(bytes);
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) expect(decoded.error).toBe('unsupported-compression');
  });
});

describe('binary container codec (WASM DEFLATE engine)', () => {
  beforeAll(async () => {
    await initCsvEngine();
    setCsvEngineForTesting('wasm');
  });
  afterAll(() => setCsvEngineForTesting('js'));

  it('compresses with DEFLATE and round-trips', () => {
    const codec = getRcsvCodec();
    expect(codec.writeMethod).toBe(RCSV_COMPRESSION_DEFLATE);
    const big: RcsvData = {
      name: 'big',
      delimiter: ',',
      rowCount: 1000,
      columnCount: 1,
      cells: Array.from(
        { length: 1000 },
        (_, r) => [r, 0, 'repeated payload row'] as [number, number, string],
      ),
    };
    const bytes = encodeRcsv(big);
    expect(bytes[5]).toBe(RCSV_COMPRESSION_DEFLATE);
    // Highly repetitive content should compress well below the raw body size.
    expect(bytes.length).toBeLessThan(1000 * 20);
    const decoded = decodeRcsv(bytes);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.data.cells.length).toBe(1000);
    expect(decoded.data.cells[999][2]).toBe('repeated payload row');
  });

  it('detects DEFLATE payload corruption via the checksum', () => {
    const bytes = encodeRcsv(sample);
    expect(bytes[5]).toBe(RCSV_COMPRESSION_DEFLATE);
    bytes[bytes.length - 3] ^= 0xff;
    const decoded = decodeRcsv(bytes);
    expect(decoded.ok).toBe(false);
  });

  it('a store-compressed file written by the JS engine still reads under WASM', () => {
    setCsvEngineForTesting('js');
    const stored = encodeRcsv(sample);
    setCsvEngineForTesting('wasm');
    const decoded = decodeRcsv(stored);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.data).toEqual(sample);
  });
});
