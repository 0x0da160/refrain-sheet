// SPDX-License-Identifier: MIT
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { detectDelimiterJs, parseCsvIndexJs, type DelimiterId } from '../src/core/byte-csv-parser';
import {
  countLiteralJs,
  decodeEmbeddedWasm,
  getCsvEngine,
  initCsvEngine,
  planReplacementsJs,
  setCsvEngineForTesting,
  statsAggregateJs,
} from '../src/core/csv-engine';
import { LosslessDocument } from '../src/core/lossless-document';
import { serializeDocument } from '../src/core/serializer';
import { WASM_BASE64, WASM_BYTE_LENGTH } from '../src/wasm-gen/wasm-payload';
import { utf8 } from './helpers';

/**
 * The embedded-WASM engine: local instantiation from the Base64 payload
 * (never fetched from anywhere) and byte-exact parity with the JS fallback
 * across parsing, validation, sniffing, indexing, and serialization
 * planning.
 */

const originalFetch = globalThis.fetch;

beforeAll(async () => {
  // Prove no fetch happens during instantiation: any network/file fetch throws.
  globalThis.fetch = (() => {
    throw new Error('fetch must never be called: the WASM binary is embedded');
  }) as unknown as typeof fetch;
  const engine = await initCsvEngine();
  expect(engine).toBe('wasm');
  setCsvEngineForTesting('wasm');
});

afterAll(() => {
  globalThis.fetch = originalFetch;
  setCsvEngineForTesting('js');
});

describe('embedded WASM payload', () => {
  it('decodes locally to the exact binary with the WebAssembly magic number', () => {
    const bytes = decodeEmbeddedWasm(WASM_BASE64);
    expect(bytes.length).toBe(WASM_BYTE_LENGTH);
    expect(Array.from(bytes.subarray(0, 4))).toEqual([0x00, 0x61, 0x73, 0x6d]);
  });

  it('instantiates without any external .wasm asset (fetch is poisoned)', () => {
    expect(getCsvEngine().name).toBe('wasm');
  });
});

function expectSameIndex(bytes: Uint8Array, delimiter: DelimiterId, treatBom: boolean): void {
  const wasm = getCsvEngine().parseIndex(bytes, delimiter, treatBom);
  const js = parseCsvIndexJs(bytes, delimiter, treatBom);
  expect(Array.from(wasm.records)).toEqual(Array.from(js.records));
  expect(Array.from(wasm.fields)).toEqual(Array.from(js.fields));
  expect(Array.from(wasm.diagnostics)).toEqual(Array.from(js.diagnostics));
  expect(wasm.lineEndings).toEqual(js.lineEndings);
  expect(wasm.hasFinalNewline).toBe(js.hasFinalNewline);
  expect(wasm.bomLength).toBe(js.bomLength);
}

describe('WASM/JS engine parity', () => {
  const corpus = [
    '',
    'a',
    'a,b,c\n1,2,3\n',
    'a;b;c\r\n1;2;3',
    '\tx\t"q"\t\n',
    '"quoted,comma","esc""quote"\n',
    ' leading , trailing ,"  spaced  " \n',
    'a,"unclosed\nrest,of,file',
    '"v"junk,b\n',
    'bare"quote,x\n',
    'a,b\n1\n2,3,4\n',
    'a,b,\n',
    'a,b,',
    '\r\n\r\n\n\r',
    '﻿a,b\n1,2\n',
    '"",""\n',
    ',,,\n,,,\n',
  ];

  it('produces identical indexes on the corpus (all delimiters)', () => {
    for (const text of corpus) {
      for (const delimiter of [',', ';', '\t'] as DelimiterId[]) {
        expectSameIndex(utf8(text), delimiter, true);
        expectSameIndex(utf8(text), delimiter, false);
      }
    }
  });

  it('produces identical indexes on fuzzed arbitrary bytes', () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ maxLength: 300 }),
        fc.constantFrom<DelimiterId>(',', ';', '\t'),
        (bytes, delimiter) => {
          expectSameIndex(bytes, delimiter, true);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('sniffs the same delimiter', () => {
    const samples = ['a,b\n', 'a;b;c\n1;2;3\n', 'a\tb\n', '"a;b",c\n', 'plain', ''];
    for (const s of samples) {
      expect(getCsvEngine().sniffDelimiter(utf8(s))).toBe(detectDelimiterJs(utf8(s)));
    }
  });

  it('plans and applies replacements identically', () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 0, maxLength: 120 }),
        fc.array(
          fc.record({
            start: fc.nat(120),
            len: fc.nat(10),
            payload: fc.uint8Array({ maxLength: 8 }),
          }),
          { maxLength: 5 },
        ),
        (bytes, rawEdits) => {
          // Build non-overlapping, in-bounds ranges.
          const edits = rawEdits
            .map((e) => ({
              start: Math.min(e.start, bytes.length),
              end: Math.min(e.start + e.len, bytes.length),
              payload: e.payload,
            }))
            .sort((a, b) => a.start - b.start);
          let prev = 0;
          const clean: typeof edits = [];
          for (const e of edits) {
            if (e.start >= prev) {
              clean.push(e);
              prev = e.end;
            }
          }
          const ranges = new Uint32Array(clean.length * 2);
          const lens = new Uint32Array(clean.length);
          let total = 0;
          clean.forEach((e, i) => {
            ranges[i * 2] = e.start;
            ranges[i * 2 + 1] = e.end;
            lens[i] = e.payload.length;
            total += e.payload.length;
          });
          const payload = new Uint8Array(total);
          let off = 0;
          for (const e of clean) {
            payload.set(e.payload, off);
            off += e.payload.length;
          }
          const engine = getCsvEngine();
          const viaWasm = engine.applyReplacements(bytes, ranges, payload, lens);
          const planWasm = engine.planReplacements(bytes.length, ranges, lens);
          const planJs = planReplacementsJs(bytes.length, ranges, lens);
          expect(Array.from(planWasm)).toEqual(Array.from(planJs));
          // Reference result computed naively.
          const expected: number[] = [];
          let src = 0;
          for (const e of clean) {
            expected.push(...bytes.subarray(src, e.start), ...e.payload);
            src = e.end;
          }
          expected.push(...bytes.subarray(src));
          expect(Array.from(viaWasm)).toEqual(expected);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('stats and search primitives (WASM/JS parity)', () => {
  it('aggregates finite numbers identically to the JS fallback', () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: -1e6, max: 1e6, noNaN: true }), { maxLength: 200 }), (arr) => {
        const values = Float64Array.from(arr);
        const wasm = getCsvEngine().statsAggregate(values);
        const js = statsAggregateJs(values);
        expect(wasm.sum).toBe(js.sum);
        expect(wasm.min).toBe(js.min);
        expect(wasm.max).toBe(js.max);
      }),
      { numRuns: 200 },
    );
  });

  it('counts literal occurrences identically to the JS fallback', () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    const cases: Array<[string, string]> = [
      ['aaaa', 'aa'],
      ['ababab', 'ab'],
      ['abc', 'xyz'],
      ['', 'a'],
      ['héllo héllo', 'é'],
      ['mississippi', 'issi'],
      ['🙂🙂🙂', '🙂'],
    ];
    for (const [h, n] of cases) {
      const hb = enc(h);
      const nb = enc(n);
      expect(getCsvEngine().countLiteral(hb, nb)).toBe(countLiteralJs(hb, nb));
    }
  });

  it('byte-count matches the JS indexOf loop for ASCII substrings', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 300 }).filter((s) => /^[\x20-\x7e]*$/.test(s)),
        fc.string({ minLength: 1, maxLength: 4 }).filter((s) => /^[\x20-\x7e]+$/.test(s)),
        (haystack, needle) => {
          const engineCount = getCsvEngine().countLiteral(
            new TextEncoder().encode(haystack),
            new TextEncoder().encode(needle),
          );
          let js = 0;
          let from = 0;
          for (;;) {
            const idx = haystack.indexOf(needle, from);
            if (idx < 0) break;
            js += 1;
            from = idx + needle.length;
          }
          expect(engineCount).toBe(js);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('documents on the WASM engine', () => {
  it('keeps the byte-identical unedited save guarantee', () => {
    const inputs = ['a,b\r\n1,2\r\n', '﻿x,"y↵""z"\n', 'a,"unclosed\nmalformed', 'ミックス,エンコード\n'];
    for (const text of inputs) {
      const bytes = utf8(text);
      const doc = LosslessDocument.fromBytes(bytes);
      expect(doc.engineName).toBe('wasm');
      const result = serializeDocument(doc);
      expect(result.ok && result.mode === 'identity' && result.bytes === doc.bytes).toBe(true);
    }
  });

  it('patches edited fields through WASM serialization planning', () => {
    const doc = LosslessDocument.fromBytes(utf8('a,b,c\n1,2,3\n'));
    doc.setValue(1, 1, 'edited');
    const result = serializeDocument(doc);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(new TextDecoder().decode(result.bytes)).toBe('a,b,c\n1,edited,3\n');
      expect(result.mode).toBe('patch');
    }
  });
});
