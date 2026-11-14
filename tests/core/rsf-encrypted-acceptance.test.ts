// SPDX-License-Identifier: MIT
/**
 * Acceptance for the encrypted `.rsf` file, over a workbook that uses the
 * sections the requirements name: version history, embedded pictures, shapes
 * and a chart, a Markdown sheet, and data validation (the requirements' schema
 * rules), with cell text alongside. None of those sections' text or picture
 * bytes appear in the sealed file. With the password it opens back to the same
 * workbook, its history restores, and a normal save of the reopened file stays
 * encrypted. Uses the small Argon2 cost so the cases stay fast.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { initCsvEngine } from '../../src/core/csv/csv-engine';
import { packRsfJsonText, unpackRsfJsonText } from '../../src/core/workbook/rsf-codec';
import { RsfDocument } from '../../src/core/workbook/rsf-document';
import { openEncryptedRsf, sealPlainRsf } from '../../src/core/workbook/rsf-encrypted-file';
import {
  type Argon2Params,
  defaultRsfEncryptionDeps,
  isRsfEncryptedContainer,
  type RsfEncryptionDeps,
  startRsfEncryption,
} from '../../src/core/workbook/rsf-encryption';

const SMALL: Argon2Params = { memoryKiB: 8, passes: 1, lanes: 1 };
const PASSWORD = 'correct horse battery';

/** One marker per text section. Each one is in the workbook's JSON, so finding it in a sealed file would be a leak. */
const MARK = {
  cell: 'MARK-CELL-1001',
  markdown: 'MARK-MD-6602',
  shape: 'MARK-SHAPE-3094',
  chart: 'MARK-CHART-8120',
  validation: 'MARK-LIST-1177',
  history: 'MARK-HIST-5150',
} as const;

/** The picture is stored as Base64 in the JSON, so its marker is that Base64 text. */
const PICTURE_BASE64 = btoa(
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><text>MARK-PICTURE-7733</text></svg>',
);

/** Every marker that must stay out of a sealed file. */
const HIDDEN: readonly string[] = [...Object.values(MARK), PICTURE_BASE64];

/**
 * The workbook as JSON text, with every section filled in. The one history
 * entry turns the workbook into an older version whose cell B1 held MARK.history.
 */
function workbookJson(): string {
  return JSON.stringify({
    format: 'refrain-sheet',
    version: 1,
    activeSheet: 'budget',
    images: { 'img-logo': { type: 'image/svg+xml', data: PICTURE_BASE64 } },
    history: {
      enabled: true,
      limit: 20,
      deltas: [
        {
          at: '2026-11-10T09:00:00.000Z',
          delta: {
            o: { sheets: { a: [[0, { o: { cells: { a: [[0, { a: [[1, { v: MARK.history }]] }]] } } }]] } },
          },
        },
      ],
    },
    sheets: [
      {
        id: 'budget',
        name: 'Budget',
        rows: 10,
        cols: 3,
        cells: [[MARK.cell, '4200'], ['Rejected']],
        validations: [{ range: 'A2:A9', list: [`Approved ${MARK.validation}`, 'Rejected'], required: true }],
        objects: [
          {
            id: 'obj-logo',
            name: 'Logo',
            kind: 'image',
            at: 'A5',
            dx: 0,
            dy: 0,
            width: 120,
            height: 60,
            image: 'img-logo',
          },
          {
            id: 'obj-chart',
            name: 'Revenue chart',
            kind: 'chart',
            at: 'A8',
            dx: 0,
            dy: 0,
            width: 320,
            height: 200,
            chart: {
              type: 'bar',
              title: 'Revenue',
              data: {
                categories: ['Q1', 'Q2'],
                series: [{ name: `Series ${MARK.chart}`, values: [100, 200] }],
              },
            },
          },
          {
            id: 'obj-box',
            name: 'Callout',
            kind: 'rect',
            at: 'B2',
            dx: 0,
            dy: 0,
            width: 160,
            height: 60,
            text: `Callout ${MARK.shape}`,
          },
        ],
      },
      {
        id: 'notes',
        name: 'Notes',
        kind: 'markdown',
        lines: [`# Meeting notes ${MARK.markdown}`, '', 'Body text'],
      },
    ],
  });
}

/** Whether `text` occurs in `haystack`, byte for byte. */
function contains(haystack: Uint8Array, text: string): boolean {
  const needle = new TextEncoder().encode(text);
  for (let start = 0; start + needle.length <= haystack.length; start++) {
    if (needle.every((byte, i) => haystack[start + i] === byte)) {
      return true;
    }
  }
  return false;
}

/** Load plain `.rsf` bytes with the same strict reader the app uses. */
function loadOrThrow(plain: Uint8Array): RsfDocument {
  const loaded = RsfDocument.fromBytes(plain, 'book.rsf');
  if (!loaded.ok) {
    throw new Error(`the workbook did not load: ${loaded.error}`);
  }
  return loaded.doc;
}

/** The workbook sealed under a new password, the way File > Encrypt with Password… writes it. */
async function sealedWorkbook() {
  const deps = defaultRsfEncryptionDeps();
  const json = workbookJson();
  const plain = packRsfJsonText(json);
  const session = await startRsfEncryption(PASSWORD, deps, SMALL);
  const sealed = await sealPlainRsf(session, plain, deps);
  return { deps, json, plain, sealed };
}

/**
 * Deps that leave the payload in the clear: the same container, with a
 * pass-through "cipher" and no compression. Used only as a control, to show
 * the marker scan finds each section when the section is there.
 */
function clearPayloadDeps(): RsfEncryptionDeps {
  const TAG_BYTES = 16;
  return {
    ...defaultRsfEncryptionDeps(),
    aes: {
      async seal(_key, _nonce, _aad, plaintext) {
        const out = new Uint8Array(plaintext.length + TAG_BYTES);
        out.set(plaintext);
        return out;
      },
      async open(_key, _nonce, _aad, sealed) {
        return sealed.length < TAG_BYTES ? null : sealed.slice(0, sealed.length - TAG_BYTES);
      },
    },
    compress: (body) => body,
    decompress: (frame, expectedLength) => (frame.length === expectedLength ? frame : null),
  };
}

beforeAll(async () => {
  await initCsvEngine();
});

describe('an encrypted .rsf file with the required sections in it', () => {
  it('keeps the text and picture of each required section out of the sealed bytes', async () => {
    const { json, plain, sealed } = await sealedWorkbook();
    // The reader must actually see each section. It ignores unknown keys, so a misspelt key
    // would otherwise let the checks below pass without covering that section.
    const doc = loadOrThrow(plain);
    expect(doc.sheets[0].objects.map((item) => item.id)).toEqual(['obj-logo', 'obj-chart', 'obj-box']);
    expect(doc.sheets[0].validations).toHaveLength(1);
    expect(doc.sheets[1].kind).toBe('markdown');
    expect(doc.images.get('img-logo')).toBeDefined();
    expect(doc.history).toHaveLength(1);
    expect(new TextDecoder().decode(doc.history[0].bytes)).toContain(MARK.history);

    expect(isRsfEncryptedContainer(sealed)).toBe(true);
    for (const marker of HIDDEN) {
      // A marker the workbook never held would pass trivially, so each one must appear in the JSON first.
      expect(json).toContain(marker);
      expect(contains(sealed, marker)).toBe(false);
    }
  });

  it('opens back to the same workbook, and its version history restores', async () => {
    const { deps, json, sealed } = await sealedWorkbook();
    const opened = await openEncryptedRsf(sealed, PASSWORD, deps);
    if (!opened.ok) {
      throw new Error(`the sealed file did not open: ${opened.error}`);
    }
    expect(unpackRsfJsonText(opened.plain)).toBe(json);

    const reopened = loadOrThrow(opened.plain);
    expect(reopened.sheets[0].objects.map((item) => item.id)).toEqual(['obj-logo', 'obj-chart', 'obj-box']);
    expect(reopened.images.get('img-logo')).toBeDefined();
    expect(reopened.restoreFromSnapshot(0)).toBe(true);
    expect(reopened.sheets[0].getValue(0, 1)).toBe(MARK.history);
  });

  it('keeps every section encrypted on a normal save of the reopened file', async () => {
    const { deps, json, sealed } = await sealedWorkbook();
    const opened = await openEncryptedRsf(sealed, PASSWORD, deps);
    if (!opened.ok) {
      throw new Error(`the sealed file did not open: ${opened.error}`);
    }
    // A save seals under the keys the file was opened with: no password, and no Argon2 run.
    const saved = await sealPlainRsf(opened.session, opened.plain, deps);
    expect(isRsfEncryptedContainer(saved)).toBe(true);
    for (const marker of HIDDEN) {
      expect(contains(saved, marker)).toBe(false);
    }
    const again = await openEncryptedRsf(saved, PASSWORD, deps);
    if (!again.ok) {
      throw new Error(`the saved file did not open: ${again.error}`);
    }
    expect(unpackRsfJsonText(again.plain)).toBe(json);
  });

  it('finds every marker in the sealed bytes when the payload is left in the clear', async () => {
    // Zstandard hides most of these markers in its raw bytes, so a clean scan proves little by itself.
    // Here the same container holds the payload unencrypted, and the scan must find every marker.
    const plain = packRsfJsonText(workbookJson());
    const session = await startRsfEncryption(PASSWORD, defaultRsfEncryptionDeps(), SMALL);
    const clear = await sealPlainRsf(session, plain, clearPayloadDeps());
    for (const marker of HIDDEN) {
      expect(contains(clear, marker)).toBe(true);
    }
  });
});
