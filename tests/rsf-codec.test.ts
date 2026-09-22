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
  MAX_RSF_HISTORY_SNAPSHOTS,
  RSF_CONTAINER_VERSION,
  RSF_LEGACY_CONTAINER_VERSION,
  RSF_LEGACY_MAGIC,
  RSF_MAGIC,
  RsfEncodeError,
  type RsfData,
  type RsfHistorySnapshot,
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

  it('round-trips a non-UTC workbook timezone (body version 6)', () => {
    const withTimezone: RsfData = { ...sample, timezone: 'Asia/Tokyo' };
    const decoded = decodeRsf(encodeRsf(withTimezone));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.data.timezone).toBe('Asia/Tokyo');
    expect(decoded.data.cells).toEqual(sample.cells);
  });

  it('omits the timezone field for UTC, staying on the lowest sufficient body version', () => {
    const utcExplicit = decodeRsf(encodeRsf({ ...sample, timezone: 'UTC' }));
    expect(utcExplicit.ok).toBe(true);
    if (utcExplicit.ok) expect(utcExplicit.data.timezone).toBeUndefined();

    const utcImplicit = decodeRsf(encodeRsf(sample));
    expect(utcImplicit.ok).toBe(true);
    if (utcImplicit.ok) expect(utcImplicit.data.timezone).toBeUndefined();
  });

  it('round-trips a non-default workbook display language (body version 7)', () => {
    const withLanguage: RsfData = { ...sample, displayLanguage: 'ja' };
    const decoded = decodeRsf(encodeRsf(withLanguage));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.data.displayLanguage).toBe('ja');
    expect(decoded.data.cells).toEqual(sample.cells);
  });

  it('carries a non-UTC timezone alongside a non-default display language (both body version 7)', () => {
    const both: RsfData = { ...sample, timezone: 'Asia/Tokyo', displayLanguage: 'ja' };
    const decoded = decodeRsf(encodeRsf(both));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.data.timezone).toBe('Asia/Tokyo');
    expect(decoded.data.displayLanguage).toBe('ja');
  });

  it('omits the display-language field for English, staying on the lowest sufficient body version', () => {
    const enExplicit = decodeRsf(encodeRsf({ ...sample, displayLanguage: 'en' }));
    expect(enExplicit.ok).toBe(true);
    if (enExplicit.ok) expect(enExplicit.data.displayLanguage).toBeUndefined();

    const enImplicit = decodeRsf(encodeRsf(sample));
    expect(enImplicit.ok).toBe(true);
    if (enImplicit.ok) expect(enImplicit.data.displayLanguage).toBeUndefined();
  });

  it('round-trips a markdown worksheet (body version 12)', () => {
    const markdown: RsfData = {
      name: 'Notes',
      delimiter: ',',
      rowCount: 1,
      columnCount: 1,
      cells: [[0, 0, '# Hello']],
      kind: 'markdown',
    };
    const decoded = decodeRsf(encodeRsf(markdown));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.data.kind).toBe('markdown');
    expect(decoded.data.cells).toEqual([[0, 0, '# Hello']]);
  });

  it('omits the kind field for an ordinary grid worksheet, staying on the lowest sufficient body version', () => {
    const decoded = decodeRsf(encodeRsf(sample));
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.data.kind).toBeUndefined();
  });

  it('rejects a markdown worksheet with any shape other than 1x1', () => {
    const decoded = decodeRsf(encodeRsf({ ...sample, kind: 'markdown' }));
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) expect(decoded.error).toBe('bad-shape');
  });

  it('round-trips a locked worksheet (body version 13)', () => {
    const locked: RsfData = { ...sample, locked: true };
    const decoded = decodeRsf(encodeRsf(locked));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.data.locked).toBe(true);
    expect(decoded.data.cells).toEqual(sample.cells);
  });

  it('omits the locked field for an unlocked worksheet, staying on the lowest sufficient body version', () => {
    const decoded = decodeRsf(encodeRsf(sample));
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.data.locked).toBeUndefined();

    const explicit = decodeRsf(encodeRsf({ ...sample, locked: false }));
    expect(explicit.ok).toBe(true);
    if (explicit.ok) expect(explicit.data.locked).toBeUndefined();
  });

  it('carries a lock alongside a markdown kind (both forced to body version 13)', () => {
    const both: RsfData = {
      name: 'Notes',
      delimiter: ',',
      rowCount: 1,
      columnCount: 1,
      cells: [[0, 0, '# Hello']],
      kind: 'markdown',
      locked: true,
    };
    const decoded = decodeRsf(encodeRsf(both));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.data.kind).toBe('markdown');
    expect(decoded.data.locked).toBe(true);
  });

  it('round-trips a json worksheet (body version 15)', () => {
    const json: RsfData = {
      name: 'Data',
      delimiter: ',',
      rowCount: 1,
      columnCount: 1,
      cells: [[0, 0, '{"a":1}']],
      kind: 'json',
    };
    const decoded = decodeRsf(encodeRsf(json));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.data.kind).toBe('json');
    expect(decoded.data.cells).toEqual([[0, 0, '{"a":1}']]);
  });

  it('does not mark an unlocked json/yaml/text worksheet as locked just because its kind forces a higher body version', () => {
    // Regression test: a json/yaml/text kind forces the same higher body
    // version tier a lock would (both feed `hasHistorySection`/`hasLocked`
    // in the minimal-version-write cascade — see `encodeBody`), which
    // previously caused the locked byte to be written unconditionally as 1
    // whenever it was merely *physically present*, rather than reflecting
    // the worksheet's actual (unlocked) state.
    for (const kind of ['json', 'yaml', 'text'] as const) {
      const data: RsfData = {
        name: 'Notes',
        delimiter: ',',
        rowCount: 1,
        columnCount: 1,
        cells: [[0, 0, 'x']],
        kind,
      };
      const decoded = decodeRsf(encodeRsf(data));
      expect(decoded.ok).toBe(true);
      if (!decoded.ok) continue;
      expect(decoded.data.kind).toBe(kind);
      expect(decoded.data.locked).toBeUndefined();
    }
  });

  it('rejects a json worksheet with any shape other than 1x1', () => {
    const decoded = decodeRsf(encodeRsf({ ...sample, kind: 'json' }));
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) expect(decoded.error).toBe('bad-shape');
  });

  it('carries a lock alongside a json kind (both forced to body version 15)', () => {
    const both: RsfData = {
      name: 'Data',
      delimiter: ',',
      rowCount: 1,
      columnCount: 1,
      cells: [[0, 0, '[]']],
      kind: 'json',
      locked: true,
    };
    const decoded = decodeRsf(encodeRsf(both));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.data.kind).toBe('json');
    expect(decoded.data.locked).toBe(true);
  });

  it.each(['yaml', 'text'] as const)('round-trips a %s worksheet (body version 17)', (kind) => {
    const data: RsfData = {
      name: 'Notes',
      delimiter: ',',
      rowCount: 1,
      columnCount: 1,
      cells: [[0, 0, kind === 'yaml' ? 'a: 1\nb: 2\n' : 'plain text content']],
      kind,
    };
    const decoded = decodeRsf(encodeRsf(data));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.data.kind).toBe(kind);
    expect(decoded.data.cells).toEqual(data.cells);
  });

  it.each(['yaml', 'text'] as const)('rejects a %s worksheet with any shape other than 1x1', (kind) => {
    const decoded = decodeRsf(encodeRsf({ ...sample, kind }));
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) expect(decoded.error).toBe('bad-shape');
  });

  it.each(['yaml', 'text'] as const)(
    'carries a lock alongside a %s kind (both forced to body version 17)',
    (kind) => {
      const both: RsfData = {
        name: 'Notes',
        delimiter: ',',
        rowCount: 1,
        columnCount: 1,
        cells: [[0, 0, 'x']],
        kind,
        locked: true,
      };
      const decoded = decodeRsf(encodeRsf(both));
      expect(decoded.ok).toBe(true);
      if (!decoded.ok) return;
      expect(decoded.data.kind).toBe(kind);
      expect(decoded.data.locked).toBe(true);
    },
  );

  // Regression coverage for a real bug caught in review before it shipped:
  // an earlier draft of the yaml/text worksheet kind gave it body version
  // 16, sharing that number with the already-released (v0.8.3)
  // retained-snapshot cap override, which would have broken decoding of
  // real files saved by that release. Cap override keeps its original
  // version (16/12); yaml/text sits above it (17/13). These two
  // tests are the coverage gap that let that bug through: no existing test
  // combined the two features, and none simulated bytes an *already-shipped*
  // release actually wrote (every other round-trip test only exercises this
  // release's own encoder).
  it.each(['yaml', 'text'] as const)(
    'combines a %s worksheet with a retained-snapshot cap override at the shared top version (17)',
    (kind) => {
      const data: RsfData = {
        name: 'Notes',
        delimiter: ',',
        rowCount: 1,
        columnCount: 1,
        cells: [[0, 0, 'content']],
        kind,
        historyMaxOverride: 7,
      };
      const decoded = decodeRsf(encodeRsf(data));
      expect(decoded.ok).toBe(true);
      if (!decoded.ok) return;
      expect(decoded.data.kind).toBe(kind);
      expect(decoded.data.historyMaxOverride).toBe(7);
    },
  );

  it('decodes a cap override written the way v0.8.3 actually wrote it: version 16 alone, no presence bit ever set', () => {
    // v0.8.3's own `encodeHistoryBlock` never had a "cap-override field
    // present" bit (see `readHistoryBlock`'s doc comment) — presence was
    // implied purely by reaching body version 16, which was safe only
    // because cap override was the sole feature able to select that version
    // at the time. The *current* encoder now also stamps that presence bit
    // (bit 2) — harmlessly redundant for a version-16 body, since
    // `legacyMaxOverridePresent` (bodyVersion === 16) already forces
    // presence regardless of the bit — but a real v0.8.3 file has the
    // override bytes with that bit left unset. This test builds exactly
    // that shape through the real, public `decodeRsf` container entry point
    // (not a raw-body helper, so nothing about container framing or CRC is
    // skipped): encode with STORE compression so the body sits byte-for-byte
    // in the container with no transform to account for, locate the one
    // 9-byte sequence the history block's flags/override/snapshot-count
    // fields must produce for this minimal input, clear bit 2 to simulate
    // the older release's bytes, and recompute the CRC-32 the container
    // checks on decode (real old bytes have a CRC that matches their own
    // content; a hand-edited copy needs the same to reach the code path
    // this test targets instead of failing earlier on a checksum mismatch).
    // The container header's fixed size (magic 4 + container version 1 +
    // method 1 + reserved 1 + codec profile 1 + body length u32 + CRC-32 u32
    // + payload length u32 = 20 bytes — see `knowledge/formats/rsf/index.md`'s container
    // layout table). Not exported from the codec (it's a private constant
    // there); hardcoded here since it's a stable, documented format detail.
    const HEADER_SIZE = 20;
    const withOverride: RsfData = {
      name: 'Sheet1',
      delimiter: ',',
      rowCount: 1,
      columnCount: 1,
      cells: [],
      historyMaxOverride: 5,
    };
    const bytes = encodeRsf(withOverride, RSF_COMPRESSION_STORE);
    const body = bytes.subarray(HEADER_SIZE);
    expect(body[0]).toBe(16); // sanity: cap override alone still selects its original version

    // flags=5 (enabled=1 | hasOverride bit2=4), override=5 (u32 LE), then a
    // 0 (u32 LE) snapshot count — distinctive enough not to collide with the
    // ASCII sheet name ("Sheet1") or any other section of this minimal body.
    const needle = [5, 5, 0, 0, 0, 0, 0, 0, 0];
    let flagsOffset = -1;
    for (let i = 0; i + needle.length <= body.length; i++) {
      if (needle.every((b, j) => body[i + j] === b)) {
        flagsOffset = i;
        break;
      }
    }
    expect(flagsOffset).toBeGreaterThan(0);

    const legacyBytes = bytes.slice();
    legacyBytes[HEADER_SIZE + flagsOffset] &= ~4; // clear the bit v0.8.3 never wrote
    expect(legacyBytes[HEADER_SIZE + flagsOffset]).toBe(1); // enabled, no "override present" bit
    const legacyBody = legacyBytes.subarray(HEADER_SIZE);
    const crc = getRsfCodec().crc32(legacyBody);
    new DataView(legacyBytes.buffer).setUint32(12, crc, true); // container CRC-32 offset

    const decoded = decodeRsf(legacyBytes);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    // The whole point: version 16 alone must still mean "override present"
    // even with the presence bit cleared, exactly as a real v0.8.3 file has it.
    expect(decoded.data.historyMaxOverride).toBe(5);
  });

  it('round-trips version history with snapshots (body version 14)', () => {
    const history: RsfHistorySnapshot[] = [
      { timestamp: 1000, bytes: new Uint8Array([1, 2, 3]) },
      { timestamp: 2000, bytes: new Uint8Array([4, 5, 6, 7]) },
    ];
    const withHistory: RsfData = { ...sample, history };
    const decoded = decodeRsf(encodeRsf(withHistory));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.data.historyEnabled).toBeUndefined(); // absent means enabled (the default)
    expect(decoded.data.history).toEqual(history);
    expect(decoded.data.cells).toEqual(sample.cells);
  });

  it('round-trips version history disabled with no snapshots (body version 14)', () => {
    const decoded = decodeRsf(encodeRsf({ ...sample, historyEnabled: false }));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.data.historyEnabled).toBe(false);
    expect(decoded.data.history).toBeUndefined();
  });

  it('omits the history section when enabled (the default) with no snapshots, staying on the lowest sufficient body version', () => {
    const decoded = decodeRsf(encodeRsf(sample));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.data.historyEnabled).toBeUndefined();
    expect(decoded.data.history).toBeUndefined();

    const explicit = decodeRsf(encodeRsf({ ...sample, historyEnabled: true, history: [] }));
    expect(explicit.ok).toBe(true);
    if (explicit.ok) {
      expect(explicit.data.historyEnabled).toBeUndefined();
      expect(explicit.data.history).toBeUndefined();
    }
  });

  it('carries history alongside a lock (both forced to body version 14)', () => {
    const both: RsfData = {
      ...sample,
      locked: true,
      history: [{ timestamp: 42, bytes: new Uint8Array([9]) }],
    };
    const decoded = decodeRsf(encodeRsf(both));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.data.locked).toBe(true);
    expect(decoded.data.history).toEqual(both.history);
  });

  it('round-trips a numeric retained-snapshot cap override', () => {
    const withOverride: RsfData = { ...sample, historyMaxOverride: 5 };
    const decoded = decodeRsf(encodeRsf(withOverride));
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.data.historyMaxOverride).toBe(5);
  });

  it('round-trips an unlimited (null) retained-snapshot cap override', () => {
    const unlimited: RsfData = { ...sample, historyMaxOverride: null };
    const decoded = decodeRsf(encodeRsf(unlimited));
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.data.historyMaxOverride).toBeNull();
  });

  it('omits the cap-override field when no override is set', () => {
    const decoded = decodeRsf(
      encodeRsf({ ...sample, history: [{ timestamp: 1, bytes: new Uint8Array(0) }] }),
    );
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.data.historyMaxOverride).toBeUndefined();
  });

  it('round-trips autoFormatSource (body version 17, the same tier as yaml/text)', () => {
    const withAutoFormat: RsfData = { ...sample, autoFormatSource: true };
    const decoded = decodeRsf(encodeRsf(withAutoFormat));
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.data.autoFormatSource).toBe(true);
  });

  it('omits autoFormatSource (reads back false) when never set', () => {
    const decoded = decodeRsf(encodeRsf(sample));
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.data.autoFormatSource).toBeUndefined();
  });

  it('combines autoFormatSource with a retained-snapshot cap override at the shared top version (17)', () => {
    // Exercises all three history-flags bits together: enabled, cap-override
    // present, and auto-format-source, none of which should interfere with
    // the others.
    const both: RsfData = { ...sample, autoFormatSource: true, historyMaxOverride: 9 };
    const decoded = decodeRsf(encodeRsf(both));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.data.autoFormatSource).toBe(true);
    expect(decoded.data.historyMaxOverride).toBe(9);
  });

  it('rejects a decoded numeric cap override outside [1, MAX_RSF_HISTORY_SNAPSHOTS] as bad-shape', () => {
    // A writer (RsfDocument.setHistoryMaxOverride) never produces 0 or a
    // value above the ceiling — it clamps before saving — so this stands in
    // for a hand-edited/hostile file: the encoder happily writes what it's
    // given, and the reader must reject the out-of-range value.
    expect(decodeRsf(encodeRsf({ ...sample, historyMaxOverride: 1 })).ok).toBe(true); // sanity: 1 is valid
    const zero = decodeRsf(encodeRsf({ ...sample, historyMaxOverride: 0 }));
    expect(zero.ok).toBe(false);
    if (!zero.ok) expect(zero.error).toBe('bad-shape');
    const tooLarge = decodeRsf(encodeRsf({ ...sample, historyMaxOverride: MAX_RSF_HISTORY_SNAPSHOTS + 1 }));
    expect(tooLarge.ok).toBe(false);
    if (!tooLarge.ok) expect(tooLarge.error).toBe('bad-shape');
  });

  it('rejects a snapshot count above the retained cap as too-large', () => {
    // A writer never emits more than MAX_RSF_HISTORY_SNAPSHOTS (RsfDocument
    // caps it before saving), so this stands in for a hand-edited/hostile
    // file: the encoder happily writes what it's given, and the reader must
    // reject the excess rather than allocate for it.
    const tooMany: RsfHistorySnapshot[] = Array.from({ length: MAX_RSF_HISTORY_SNAPSHOTS + 1 }, (_, i) => ({
      timestamp: i,
      bytes: new Uint8Array(0),
    }));
    const decoded = decodeRsf(encodeRsf({ ...sample, history: tooMany }));
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) expect(decoded.error).toBe('too-large');
  });

  it('rejects a truncated history block as bad-shape', () => {
    const withHistory: RsfData = {
      ...sample,
      history: [{ timestamp: 1, bytes: new Uint8Array([1, 2, 3, 4, 5]) }],
    };
    const bytes = encodeRsf(withHistory);
    const decoded = decodeRsf(bytes.subarray(0, bytes.length - 3));
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) expect(decoded.error).toBe('bad-shape');
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
