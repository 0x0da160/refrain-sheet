// SPDX-License-Identifier: MIT
/**
 * The content check behind "open as": a file whose name does not say what it
 * is is identified by its first bytes when they settle it (RSF, XLSX, JSON),
 * and is left undecided — so the user picks — otherwise.
 */
import { describe, expect, it } from 'vitest';
import { OPEN_AS_KINDS, sniffContentKind } from '../../src/core/interchange/open-kind';

const text = (value: string): Uint8Array => new TextEncoder().encode(value);

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

describe('sniffContentKind', () => {
  it('recognizes an RSF file by its skippable-frame magic', () => {
    const rsf = concat(
      new Uint8Array([0x5a, 0x2a, 0x4d, 0x18, 0x0c, 0, 0, 0]),
      text('RSF2'),
      new Uint8Array(8),
    );
    expect(sniffContentKind(rsf)).toBe('rsf');
  });

  it('recognizes an XLSX workbook by its ZIP header and workbook part', () => {
    const xlsx = concat(
      new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
      text('[Content_Types].xml'),
      text('xl/workbook.xml'),
    );
    expect(sniffContentKind(xlsx)).toBe('xlsx');
  });

  it('does not take any other ZIP archive for a workbook', () => {
    const zip = concat(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), text('readme.txt'));
    expect(sniffContentKind(zip)).toBeNull();
  });

  it('recognizes a JSON object or array, after whitespace or a byte-order mark', () => {
    expect(sniffContentKind(text('  {"a": 1}\n'))).toBe('json');
    expect(sniffContentKind(text('[1, 2, 3]'))).toBe('json');
    expect(sniffContentKind(concat(new Uint8Array([0xef, 0xbb, 0xbf]), text('{}')))).toBe('json');
  });

  it('leaves text that is not a whole JSON document undecided', () => {
    expect(sniffContentKind(text('{"a":'))).toBeNull();
    expect(sniffContentKind(text('[not json'))).toBeNull();
  });

  it('leaves CSV, Markdown and empty content undecided', () => {
    expect(sniffContentKind(text('name,qty\napple,3\n'))).toBeNull();
    expect(sniffContentKind(text('# Title\n\nBody\n'))).toBeNull();
    expect(sniffContentKind(new Uint8Array(0))).toBeNull();
  });

  it('lists the kinds a file can open as', () => {
    expect(OPEN_AS_KINDS).toEqual(['csv', 'rsf', 'markdown', 'json', 'yaml', 'text']);
  });
});
