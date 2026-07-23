// SPDX-License-Identifier: MIT
/**
 * RSF display-settings persistence (body version 3): serialization round
 * trips, version selection, validation/clamping of malformed values,
 * corruption handling, migration from older bodies, and the document-level
 * reopen flow (zoom and column widths restored, precedence over app
 * defaults).
 */
import { describe, expect, it } from 'vitest';
import { getRsfCodec, RSF_COMPRESSION_STORE } from '../src/core/csv-engine';
import {
  decodeRsf,
  encodeRsf,
  RSF_COL_WIDTH_MAX,
  RSF_COL_WIDTH_MIN,
  RSF_ZOOM_MAX,
  RSF_ZOOM_MIN,
  type RsfData,
} from '../src/core/rsf-codec';
import { RsfDocument } from '../src/core/rsf-document';

const base: RsfData = {
  name: 'Sheet1',
  delimiter: ',',
  rowCount: 5,
  columnCount: 4,
  cells: [[0, 0, 'x']],
};

const HEADER_SIZE = 20;

/** Patch a store-method container body byte and re-stamp length + CRC. */
function patchBody(bytes: Uint8Array, mutate: (body: Uint8Array) => void): Uint8Array {
  const out = bytes.slice();
  const body = out.subarray(HEADER_SIZE);
  mutate(body);
  const view = new DataView(out.buffer);
  view.setUint32(12, getRsfCodec().crc32(body), true);
  return out;
}

describe('codec: display block (body version 3)', () => {
  it('round-trips zoom and column widths', () => {
    const bytes = encodeRsf(
      {
        ...base,
        display: {
          zoom: 150,
          colWidths: [
            [0, 200],
            [2, 88],
          ],
        },
      },
      RSF_COMPRESSION_STORE,
    );
    const decoded = decodeRsf(bytes);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.data.display).toEqual({
      zoom: 150,
      colWidths: [
        [0, 200],
        [2, 88],
      ],
    });
  });

  it('writes body version 3 only when display settings exist', () => {
    const noDisplay = encodeRsf(base, RSF_COMPRESSION_STORE);
    expect(noDisplay[HEADER_SIZE]).toBe(1); // no meta either -> v1
    const withMeta = encodeRsf({ ...base, appName: 'App', appVersion: '1.0' }, RSF_COMPRESSION_STORE);
    expect(withMeta[HEADER_SIZE]).toBe(2);
    const withDisplay = encodeRsf({ ...base, display: { zoom: 100 } }, RSF_COMPRESSION_STORE);
    expect(withDisplay[HEADER_SIZE]).toBe(3);
  });

  it('older bodies (v1/v2) still decode, with no display settings', () => {
    const v2 = encodeRsf({ ...base, appName: 'App', appVersion: '1.0' }, RSF_COMPRESSION_STORE);
    const decoded = decodeRsf(v2);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.data.display).toBeUndefined();
  });

  it('clamps an out-of-range stored zoom instead of failing', () => {
    const bytes = encodeRsf({ ...base, display: { zoom: 150 } }, RSF_COMPRESSION_STORE);
    // Body layout: version(1) + delimiter(1) + appName len(2)+0 + appVersion
    // len(2)+0 puts the zoom u16 at body offset 6.
    const tooBig = patchBody(bytes, (body) => {
      new DataView(body.buffer, body.byteOffset).setUint16(6, 999, true);
    });
    const decodedBig = decodeRsf(tooBig);
    expect(decodedBig.ok).toBe(true);
    if (decodedBig.ok) {
      expect(decodedBig.data.display?.zoom).toBe(RSF_ZOOM_MAX);
    }
    const tooSmall = patchBody(bytes, (body) => {
      new DataView(body.buffer, body.byteOffset).setUint16(6, 10, true);
    });
    const decodedSmall = decodeRsf(tooSmall);
    expect(decodedSmall.ok).toBe(true);
    if (decodedSmall.ok) {
      expect(decodedSmall.data.display?.zoom).toBe(RSF_ZOOM_MIN);
    }
  });

  it('clamps stored widths and drops entries for unknown columns', () => {
    const bytes = encodeRsf(
      { ...base, display: { zoom: 100, colWidths: [[1, 100]] } },
      RSF_COMPRESSION_STORE,
    );
    // Width entry: body offset 6 (zoom u16) + 2 + count u32 -> entry at 12:
    // col u32 at 12, width u16 at 16.
    const unknownCol = patchBody(bytes, (body) => {
      new DataView(body.buffer, body.byteOffset).setUint32(12, 99, true);
    });
    const decodedUnknown = decodeRsf(unknownCol);
    expect(decodedUnknown.ok).toBe(true);
    if (decodedUnknown.ok) {
      expect(decodedUnknown.data.display?.colWidths).toBeUndefined();
    }
    const hugeWidth = patchBody(bytes, (body) => {
      new DataView(body.buffer, body.byteOffset).setUint16(16, 65_000, true);
    });
    const decodedHuge = decodeRsf(hugeWidth);
    expect(decodedHuge.ok).toBe(true);
    if (decodedHuge.ok) {
      expect(decodedHuge.data.display?.colWidths).toEqual([[1, RSF_COL_WIDTH_MAX]]);
    }
    const tinyWidth = patchBody(bytes, (body) => {
      new DataView(body.buffer, body.byteOffset).setUint16(16, 1, true);
    });
    const decodedTiny = decodeRsf(tinyWidth);
    expect(decodedTiny.ok).toBe(true);
    if (decodedTiny.ok) {
      expect(decodedTiny.data.display?.colWidths).toEqual([[1, RSF_COL_WIDTH_MIN]]);
    }
  });

  it('rejects a truncated display block as bad-shape', () => {
    const bytes = encodeRsf(
      { ...base, display: { zoom: 100, colWidths: [[1, 100]] } },
      RSF_COMPRESSION_STORE,
    );
    // Claim more width entries than the body holds.
    const badCount = patchBody(bytes, (body) => {
      new DataView(body.buffer, body.byteOffset).setUint32(8, 1000, true);
    });
    const decoded = decodeRsf(badCount);
    expect(decoded).toEqual({ ok: false, error: 'bad-shape' });
  });

  it('encode clamps out-of-range inputs defensively', () => {
    const bytes = encodeRsf({ ...base, display: { zoom: 9999, colWidths: [[0, 5]] } }, RSF_COMPRESSION_STORE);
    const decoded = decodeRsf(bytes);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.data.display?.zoom).toBe(RSF_ZOOM_MAX);
    expect(decoded.data.display?.colWidths).toEqual([[0, RSF_COL_WIDTH_MIN]]);
  });
});

describe('document-level persistence and reopen', () => {
  it('round-trips display settings through RsfDocument save/load', () => {
    const doc = RsfDocument.empty('t.rsf', 4, 4);
    doc.setCell(0, 0, 'a');
    doc.setDisplaySettings(125, [0, 210, 0, 96]);
    const loaded = RsfDocument.fromBytes(doc.toBytes(), 't.rsf');
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.doc.displayZoom).toBe(125);
    expect(loaded.doc.displayColWidths[1]).toBe(210);
    expect(loaded.doc.displayColWidths[3]).toBe(96);
    expect(loaded.doc.displayColWidths[0]).toBeUndefined();
    // Display settings are presentational: the reloaded document is not dirty
    // and its cell data round-tripped unchanged.
    expect(loaded.doc.getValue(0, 0)).toBe('a');
    expect(loaded.doc.isDirty).toBe(false);
  });

  it('display settings never mark the document dirty', () => {
    const doc = RsfDocument.empty('t.rsf', 2, 2);
    doc.markSaved();
    doc.setDisplaySettings(150, [180]);
    expect(doc.isDirty).toBe(false);
  });

  it('a document without stored settings reports none (app defaults apply)', () => {
    const doc = RsfDocument.empty('t.rsf', 2, 2);
    const loaded = RsfDocument.fromBytes(doc.toBytes(), 't.rsf');
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.doc.displayZoom).toBeUndefined();
    expect(loaded.doc.displayColWidths).toEqual([]);
  });
});

describe('codec: wrap-long-rows flag (body version 5)', () => {
  it('round-trips the wrap flag and writes body version 5 only when set', () => {
    const bytes = encodeRsf({ ...base, display: { wrap: true } }, RSF_COMPRESSION_STORE);
    // Body version byte sits immediately after the 20-byte header.
    expect(bytes[HEADER_SIZE]).toBe(5);
    const decoded = decodeRsf(bytes);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.data.display?.wrap).toBe(true);
  });

  it('does not raise the body version when wrap is absent', () => {
    const bytes = encodeRsf({ ...base, display: { zoom: 125 } }, RSF_COMPRESSION_STORE);
    expect(bytes[HEADER_SIZE]).toBe(3); // display present, no wrap → version 3
    const decoded = decodeRsf(bytes);
    expect(decoded.ok && decoded.data.display?.wrap).toBeFalsy();
  });

  it('persists and restores wrap through the document reopen flow', () => {
    const doc = RsfDocument.empty('t.rsf', 3, 2);
    doc.setDisplaySettings(undefined, [], true);
    const loaded = RsfDocument.fromBytes(doc.toBytes(), 't.rsf');
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.doc.displayWrap).toBe(true);
  });
});
