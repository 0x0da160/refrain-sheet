// SPDX-License-Identifier: MIT
/**
 * The kinds of document a file can be opened as, and the content check for a
 * file whose name does not say what it is.
 *
 * A file with a name the app knows (`.rsf`, `.csv`, `.md`, …) is opened as
 * that kind, and its content is not looked at. For any other name, the first
 * bytes decide when they can: an RSF file, an XLSX workbook and a JSON
 * document each have a signature no other kind has. When none of them
 * matches, the user picks the kind (see `FileOpening.choiceFor`). Pure and
 * DOM-free, so the Node tests run it directly.
 */

/** Every kind a file can be opened as. An `.xlsx` file is imported as a new workbook, so it is not one of these. */
export const OPEN_AS_KINDS = ['csv', 'rsf', 'markdown', 'json', 'yaml', 'text'] as const;

/** A kind a file can be opened as (see {@link OPEN_AS_KINDS}). */
export type OpenAsKind = (typeof OPEN_AS_KINDS)[number];

/** What a file's first bytes say it is, when they say it: an RSF file, an XLSX workbook, or a JSON document. */
export type ContentKind = 'rsf' | 'xlsx' | 'json';

/** The skippable-frame magic that begins every `.rsf` file: 0x184D2A5A, little-endian (see `rsf-codec.ts`). */
const RSF_MAGIC: readonly number[] = [0x5a, 0x2a, 0x4d, 0x18];
/** The local-file-header signature "PK\x03\x04" that begins every ZIP archive, and so every `.xlsx` file. */
const ZIP_MAGIC: readonly number[] = [0x50, 0x4b, 0x03, 0x04];
/** The part every XLSX workbook has (see `xlsx-import.ts`). */
const XLSX_WORKBOOK_PART = 'xl/workbook.xml';
/** UTF-8 byte-order mark. */
const UTF8_BOM: readonly number[] = [0xef, 0xbb, 0xbf];
/** Bytes JSON allows before its first token: space, tab, line feed, carriage return. */
const JSON_WHITESPACE: ReadonlySet<number> = new Set([0x20, 0x09, 0x0a, 0x0d]);
const OPEN_BRACE = 0x7b;
const OPEN_BRACKET = 0x5b;

function startsWithBytes(bytes: Uint8Array, magic: readonly number[]): boolean {
  return bytes.length >= magic.length && magic.every((byte, i) => bytes[i] === byte);
}

/** True when the ASCII text `needle` occurs anywhere in `bytes`. */
function containsAscii(bytes: Uint8Array, needle: string): boolean {
  const codes = Array.from(needle, (ch) => ch.charCodeAt(0));
  const first = codes[0];
  for (let i = 0; i + codes.length <= bytes.length; i++) {
    if (bytes[i] === first && codes.every((code, j) => bytes[i + j] === code)) {
      return true;
    }
  }
  return false;
}

/**
 * True when the bytes are one JSON object or array, in UTF-8. Only the start
 * is checked before the whole file is parsed, so a file that plainly is not
 * JSON (a CSV table, Markdown) costs nothing to rule out.
 */
function isJsonDocument(bytes: Uint8Array): boolean {
  let start = startsWithBytes(bytes, UTF8_BOM) ? UTF8_BOM.length : 0;
  while (start < bytes.length && JSON_WHITESPACE.has(bytes[start])) {
    start++;
  }
  const opener = bytes[start];
  if (opener !== OPEN_BRACE && opener !== OPEN_BRACKET) {
    return false;
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(start));
  } catch {
    return false;
  }
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * The kind the first bytes of a file give it, or null when they do not settle
 * it. The signatures are checked from the most specific to the least: an
 * RSF file, then an XLSX workbook (a ZIP archive that holds the workbook
 * part), then a JSON document.
 */
export function sniffContentKind(bytes: Uint8Array): ContentKind | null {
  if (startsWithBytes(bytes, RSF_MAGIC)) {
    return 'rsf';
  }
  if (startsWithBytes(bytes, ZIP_MAGIC) && containsAscii(bytes, XLSX_WORKBOOK_PART)) {
    return 'xlsx';
  }
  return isJsonDocument(bytes) ? 'json' : null;
}
