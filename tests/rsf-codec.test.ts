// SPDX-License-Identifier: MIT
/**
 * The `.rsf` codec (#602): a skippable Zstandard frame carrying the "RSF2"
 * identifier, length, and CRC-32, then one standard Zstandard frame holding
 * the workbook as JSON. Round trips, the defaults the writer leaves out, the
 * readable JSON layout, strict validation of hand-edited files, container
 * failures, and both engines (WASM compresses; the JS fallback writes Raw
 * blocks and cannot read compressed blocks).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getRsfCodec, initCsvEngine, setCsvEngineForTesting } from '../src/core/csv-engine';
import {
  decodeRsfHistorySnapshot,
  decodeRsfWorkbook,
  encodeRsfBody,
  encodeRsfWorkbook,
  MAX_RSF_BODY_BYTES,
  MAX_RSF_HISTORY_SNAPSHOTS,
  packRsfJsonText,
  rsfJsonText,
  unpackRsfJsonText,
  type RsfWorkbookData,
  type RsfWorksheetData,
} from '../src/core/rsf-codec';
import { RsfDocument } from '../src/core/rsf-document';
import { readSimpleZstdFrame, writeRawZstdFrame } from '../src/core/zstd-frame';
import { rsfFromTree, rsfTree } from './rsf-single-sheet';

const sheet: RsfWorksheetData = {
  id: 's1',
  name: 'Sheet1',
  rowCount: 3,
  columnCount: 3,
  cells: [
    [0, 0, 'name'],
    [0, 2, '=A1&"!"'],
    [2, 1, 'multi\nline'],
  ],
};

const book: RsfWorkbookData = { delimiter: ',', activeSheetId: 's1', sheets: [sheet] };

function decodeTree(tree: unknown) {
  return decodeRsfWorkbook(rsfFromTree(tree));
}

describe('.rsf codec: round trips', () => {
  it('round-trips a workbook', () => {
    const decoded = decodeRsfWorkbook(encodeRsfWorkbook(book));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.data).toMatchObject(book);
  });

  it('round-trips workbook metadata', () => {
    const data: RsfWorkbookData = {
      ...book,
      appName: 'Refrain Sheet',
      appVersion: '1.2.3',
      docId: 'abc',
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_360_000,
      timezone: 'Asia/Tokyo',
      displayLanguage: 'ja',
      autoFormatSource: true,
      historyEnabled: false,
      historyMaxOverride: null,
    };
    const decoded = decodeRsfWorkbook(encodeRsfWorkbook(data));
    expect(decoded.ok && decoded.data).toMatchObject(data);
  });

  it.each(['markdown', 'json', 'yaml', 'text'] as const)('round-trips a %s worksheet', (kind) => {
    const text = '# a\n\nb: [1, 2]\n';
    const data: RsfWorkbookData = {
      delimiter: ',',
      sheets: [
        { id: 'x', name: 'X', kind, rowCount: 1, columnCount: 1, cells: [[0, 0, text]], locked: true },
      ],
    };
    const decoded = decodeRsfWorkbook(encodeRsfWorkbook(data));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.data.sheets[0]).toMatchObject({ kind, cells: [[0, 0, text]], locked: true });
  });

  it('round-trips version history snapshots, which decode on their own', () => {
    const snapshot = { timestamp: 1_700_000_000_000, bytes: encodeRsfBody(book) };
    const decoded = decodeRsfWorkbook(
      encodeRsfWorkbook({ ...book, history: [snapshot], historyMaxOverride: 3 }),
    );
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.data.historyMaxOverride).toBe(3);
    expect(decoded.data.history).toHaveLength(1);
    expect(decoded.data.history?.[0].timestamp).toBe(snapshot.timestamp);
    const restored = decodeRsfHistorySnapshot(decoded.data.history![0]);
    expect(restored.ok && restored.data.sheets[0].cells).toEqual(sheet.cells);
  });

  it('keeps hostile-looking text as plain strings', () => {
    const data: RsfWorkbookData = {
      delimiter: ',',
      sheets: [{ ...sheet, cells: [[0, 0, '<script>alert(1)</script>']], name: '"},{"x":1' }],
    };
    const decoded = decodeRsfWorkbook(encodeRsfWorkbook(data));
    expect(decoded.ok && decoded.data.sheets[0]).toMatchObject({
      name: '"},{"x":1',
      cells: [[0, 0, '<script>alert(1)</script>']],
    });
  });
});

describe('.rsf codec: readable JSON', () => {
  it('writes one grid row per line and trims trailing empty cells', () => {
    const text = rsfJsonText(book);
    expect(text).toContain('\n        ["name", "", "=A1&\\"!\\""],\n');
    expect(text).toContain('\n        [],\n');
    expect(text).toContain('\n        ["", "multi\\nline"]\n');
    expect(text.endsWith('}\n')).toBe(true);
  });

  it('writes a source worksheet as one line of text per line', () => {
    const text = rsfJsonText({
      delimiter: ',',
      sheets: [
        { id: 'm', name: 'M', kind: 'markdown', rowCount: 1, columnCount: 1, cells: [[0, 0, '# T\nbody']] },
      ],
    });
    expect(text).toContain('"lines": [\n        "# T",\n        "body"\n      ]');
  });

  it('leaves the defaults out: UTC, English, history on with no snapshots, grid-only fields', () => {
    const tree = rsfTree(
      encodeRsfWorkbook({
        ...book,
        timezone: 'UTC',
        displayLanguage: 'en',
        historyEnabled: true,
        history: [],
      }),
    );
    expect(tree.timezone).toBeUndefined();
    expect(tree.language).toBeUndefined();
    expect(tree.history).toBeUndefined();
    expect(tree.sheets[0].locked).toBeUndefined();
    expect(tree.sheets[0].lines).toBeUndefined();
  });

  it('keys styles and comments by A1 reference', () => {
    const tree = rsfTree(
      encodeRsfWorkbook({
        ...book,
        sheets: [{ ...sheet, styles: [[2, 1, { bold: true }]], comments: [[0, 2, 'note']] }],
      }),
    );
    expect(tree.sheets[0].styles).toEqual({ B3: { bold: true } });
    expect(tree.sheets[0].comments).toEqual({ C1: 'note' });
  });
});

describe('.rsf codec: validation of hand-edited files', () => {
  const tree = () => rsfTree(encodeRsfWorkbook(book));

  it('ignores unknown keys', () => {
    const t = tree();
    t.futureFeature = { a: 1 };
    t.sheets[0].another = true;
    expect(decodeTree(t).ok).toBe(true);
  });

  it('rejects a missing or wrong format name as bad-shape', () => {
    const t = tree();
    t.format = 'something-else';
    expect(decodeTree(t)).toEqual({ ok: false, error: 'bad-shape' });
  });

  it('rejects an unknown document version as bad-version', () => {
    const t = tree();
    t.version = 2;
    expect(decodeTree(t)).toEqual({ ok: false, error: 'bad-version' });
  });

  it.each([
    ['a number as a cell', (t: ReturnType<typeof tree>) => (t.sheets[0].cells[0][0] = 5)],
    ['a row wider than the sheet', (t: ReturnType<typeof tree>) => t.sheets[0].cells[0].push('a', 'b')],
    ['more rows than the sheet', (t: ReturnType<typeof tree>) => t.sheets[0].cells.push([], [], [])],
    ['no sheets', (t: ReturnType<typeof tree>) => (t.sheets = [])],
    ['an unknown worksheet kind', (t: ReturnType<typeof tree>) => (t.sheets[0].kind = 'chart')],
    [
      'a style on a cell outside the sheet',
      (t: ReturnType<typeof tree>) => (t.sheets[0].styles = { Z9: {} }),
    ],
    ['a malformed A1 key', (t: ReturnType<typeof tree>) => (t.sheets[0].comments = { a1: 'x' })],
    [
      'a color that is not hex',
      (t: ReturnType<typeof tree>) => (t.sheets[0].styles = { A1: { textColor: 'red' } }),
    ],
    ['duplicate worksheet ids', (t: ReturnType<typeof tree>) => t.sheets.push({ ...t.sheets[0], name: 'B' })],
    ['a non-boolean flag', (t: ReturnType<typeof tree>) => (t.sheets[0].locked = 'yes')],
    ['a history limit of 0', (t: ReturnType<typeof tree>) => (t.history = { limit: 0 })],
    [
      'a snapshot without a time',
      (t: ReturnType<typeof tree>) => (t.history = { snapshots: [{ workbook: {} }] }),
    ],
  ])('rejects %s as bad-shape', (_label, edit) => {
    const t = tree();
    edit(t);
    expect(decodeTree(t)).toEqual({ ok: false, error: 'bad-shape' });
  });

  it.each([
    ['a sheet over the row limit', (t: ReturnType<typeof tree>) => (t.sheets[0].rows = 2_000_001)],
    [
      'more snapshots than the hard ceiling',
      (t: ReturnType<typeof tree>) =>
        (t.history = {
          snapshots: Array.from({ length: MAX_RSF_HISTORY_SNAPSHOTS + 1 }, () => ({
            at: '2025-01-01T00:00:00Z',
            workbook: {},
          })),
        }),
    ],
  ])('rejects %s as too-large', (_label, edit) => {
    const t = tree();
    edit(t);
    expect(decodeTree(t)).toEqual({ ok: false, error: 'too-large' });
  });

  it('falls back to the first worksheet when the active one does not exist', () => {
    const t = tree();
    t.activeSheet = 'missing';
    const decoded = decodeTree(t);
    expect(decoded.ok && decoded.data.activeSheetId).toBe('s1');
  });

  it('rejects text that is not JSON as bad-shape', () => {
    expect(decodeRsfWorkbook(packRsfJsonText('{"format": "refrain-sheet",'))).toEqual({
      ok: false,
      error: 'bad-shape',
    });
  });
});

describe('.rsf codec: the container', () => {
  it('rejects non-RSF bytes as bad-magic', () => {
    for (const bytes of [
      new Uint8Array(0),
      new Uint8Array([1, 2, 3]),
      new Uint8Array(40),
      writeRawZstdFrame(new Uint8Array(4)),
    ]) {
      expect(decodeRsfWorkbook(bytes)).toEqual({ ok: false, error: 'bad-magic' });
    }
  });

  it('refuses the binary format of earlier releases as legacy-format', () => {
    for (const magic of [
      [0x52, 0x53, 0x46, 0x31],
      [0x52, 0x43, 0x53, 0x56],
    ]) {
      const bytes = new Uint8Array(40);
      bytes.set(magic, 0);
      expect(decodeRsfWorkbook(bytes)).toEqual({ ok: false, error: 'legacy-format' });
    }
  });

  it('rejects a checksum mismatch', () => {
    const bytes = encodeRsfWorkbook(book);
    bytes[16] ^= 0xff; // the stored CRC-32
    expect(decodeRsfWorkbook(bytes)).toEqual({ ok: false, error: 'checksum' });
  });

  it('rejects a declared length over the ceiling as too-large, before decompressing anything', () => {
    const bytes = encodeRsfWorkbook(book);
    new DataView(bytes.buffer).setUint32(12, MAX_RSF_BODY_BYTES + 1, true);
    expect(decodeRsfWorkbook(bytes)).toEqual({ ok: false, error: 'too-large' });
  });

  it('rejects a frame that decompresses to a different length (a bomb or a truncation) as bad-shape', () => {
    const bytes = encodeRsfWorkbook(book);
    const view = new DataView(bytes.buffer);
    view.setUint32(12, view.getUint32(12, true) - 1, true);
    expect(decodeRsfWorkbook(bytes)).toEqual({ ok: false, error: 'bad-shape' });
    expect(decodeRsfWorkbook(encodeRsfWorkbook(book).subarray(0, 30))).toEqual({
      ok: false,
      error: 'bad-shape',
    });
  });

  it('unpackRsfJsonText returns the JSON text, or null for an invalid container', () => {
    expect(unpackRsfJsonText(encodeRsfWorkbook(book))).toBe(rsfJsonText(book));
    expect(unpackRsfJsonText(new Uint8Array(3))).toBeNull();
  });
});

describe('.rsf codec: Raw-block Zstandard frames (JS fallback)', () => {
  it('splits a large body into 128 KiB Raw blocks and reads it back', () => {
    const body = new Uint8Array(300_000).map((_, i) => i % 251);
    const frame = writeRawZstdFrame(body);
    expect(readSimpleZstdFrame(frame, body.length)).toEqual(body);
    expect(readSimpleZstdFrame(frame, body.length - 1)).toBeNull();
  });

  it('writes an empty body as a single empty last block', () => {
    const frame = writeRawZstdFrame(new Uint8Array(0));
    expect(readSimpleZstdFrame(frame, 0)).toEqual(new Uint8Array(0));
  });
});

describe('.rsf codec: WASM engine', () => {
  beforeAll(async () => {
    await initCsvEngine();
    setCsvEngineForTesting('wasm');
  });
  afterAll(() => setCsvEngineForTesting('js'));

  it('compresses, and still reads what the JS fallback wrote', () => {
    const big: RsfWorkbookData = {
      delimiter: ',',
      sheets: [
        {
          ...sheet,
          rowCount: 500,
          cells: Array.from({ length: 500 }, (_, r): [number, number, string] => [
            r,
            0,
            `row ${r} repeated text`,
          ]),
        },
      ],
    };
    const compressed = encodeRsfWorkbook(big);
    expect(getRsfCodec().compresses).toBe(true);
    expect(compressed.length).toBeLessThan(new TextEncoder().encode(rsfJsonText(big)).length / 3);
    expect(decodeRsfWorkbook(compressed).ok).toBe(true);

    setCsvEngineForTesting('js');
    const raw = encodeRsfWorkbook(big);
    const underJs = decodeRsfWorkbook(compressed);
    setCsvEngineForTesting('wasm');
    expect(underJs).toEqual({ ok: false, error: 'unsupported-compression' });
    expect(decodeRsfWorkbook(raw).ok).toBe(true);
  });

  it('detects a corrupted compressed frame', () => {
    const bytes = encodeRsfWorkbook(book);
    // Inside the compressed data (the frame's last 4 bytes are its own
    // XXH64 checksum, which the container's CRC-32 makes redundant).
    bytes[Math.floor((20 + bytes.length) / 2)] ^= 0x55;
    const decoded = decodeRsfWorkbook(bytes);
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) expect(['checksum', 'bad-shape']).toContain(decoded.error);
  });

  it('RsfDocument saves and reopens through the compressed format', () => {
    const doc = RsfDocument.empty('b.rsf', 3, 3);
    doc.setCell(1, 1, '=1+2');
    const reopened = RsfDocument.fromBytes(doc.toBytes(), 'b.rsf');
    expect(reopened.ok && reopened.doc.getDisplayValue(1, 1)).toBe('3');
  });
});
