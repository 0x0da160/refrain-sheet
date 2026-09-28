// SPDX-License-Identifier: MIT
/**
 * Plain-text files that open straight into an editor worksheet (Markdown,
 * JSON, YAML, text) and save back to the same file. The file's text becomes
 * the worksheet's single cell with `\n` line breaks; how the bytes were laid
 * out (encoding, BOM, line endings) is remembered so a save writes the same
 * layout back. Text that was not changed is written back byte for byte.
 */
import type { WorksheetKind } from '../workbook/worksheet';
import { isWorkbook, type EditorDocument } from '../editor-document';
import {
  decodeBytes,
  detectEncoding,
  encodeText,
  hasUtf8Bom,
  UTF8_BOM,
  type EncodingId,
} from '../csv/encoding';

/** The worksheet kinds a plain-text file can open as. */
export type TextFileKind = Exclude<WorksheetKind, 'grid'>;

type LineEnding = 'lf' | 'crlf' | 'cr';

/** How a text file's bytes were laid out, plus the last text read or written. */
export interface TextFileFormat {
  kind: TextFileKind;
  encoding: EncodingId;
  bom: boolean;
  lineEnding: LineEnding;
  /** The text (with `\n` line breaks) the file on disk holds, as of the last open or save. */
  savedText: string;
  /** The bytes of that file, written back unchanged while the text is unchanged. */
  savedBytes: Uint8Array;
}

const EXTENSION_KINDS: ReadonlyArray<readonly [string, TextFileKind]> = [
  ['.md', 'markdown'],
  ['.markdown', 'markdown'],
  ['.json', 'json'],
  ['.yaml', 'yaml'],
  ['.yml', 'yaml'],
  ['.txt', 'text'],
];

/** The editor a file with this name opens in, or null when it is not a plain-text file. */
export function textFileKindOf(name: string): TextFileKind | null {
  const lower = name.toLowerCase();
  for (const [ext, kind] of EXTENSION_KINDS) {
    if (lower.endsWith(ext)) {
      return kind;
    }
  }
  return null;
}

/** The file name without its plain-text extension. */
export function textFileBaseName(name: string): string {
  const lower = name.toLowerCase();
  for (const [ext] of EXTENSION_KINDS) {
    if (lower.endsWith(ext)) {
      return name.slice(0, -ext.length);
    }
  }
  return name;
}

function dominantLineEnding(text: string): LineEnding {
  let crlf = 0;
  let lf = 0;
  let cr = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    if (ch === 13) {
      if (text.charCodeAt(i + 1) === 10) {
        crlf++;
        i++;
      } else {
        cr++;
      }
    } else if (ch === 10) {
      lf++;
    }
  }
  if (crlf > lf && crlf >= cr) {
    return 'crlf';
  }
  return cr > lf && cr > crlf ? 'cr' : 'lf';
}

/**
 * Decode a text file's bytes. The encoding is detected the same way a CSV's
 * is; line breaks of every kind become `\n` for editing.
 */
export function decodeTextFile(
  bytes: Uint8Array,
  kind: TextFileKind,
): { text: string; format: TextFileFormat; detection: ReturnType<typeof detectEncoding> } {
  const detection = detectEncoding(bytes);
  const bom = detection.encoding === 'utf-8' && hasUtf8Bom(bytes);
  const raw = decodeBytes(bom ? bytes.subarray(UTF8_BOM.length) : bytes, detection.encoding);
  const text = raw.replace(/\r\n?/g, '\n');
  return {
    text,
    detection,
    format: {
      kind,
      encoding: detection.encoding,
      bom,
      lineEnding: dominantLineEnding(raw),
      savedText: text,
      savedBytes: bytes,
    },
  };
}

/**
 * Encode editor text back into the file's layout. Unchanged text returns the
 * bytes last read or written, so opening and saving never rewrites a file.
 * Characters the encoding cannot hold must be dealt with before this call
 * (see `findUnrepresentableChars`).
 */
export function encodeTextFile(text: string, format: TextFileFormat): Uint8Array {
  if (text === format.savedText) {
    return format.savedBytes;
  }
  const lines =
    format.lineEnding === 'lf' ? text : text.replace(/\n/g, format.lineEnding === 'crlf' ? '\r\n' : '\r');
  const body = encodeText(lines, format.encoding);
  if (!format.bom) {
    return body;
  }
  const out = new Uint8Array(UTF8_BOM.length + body.length);
  out.set(UTF8_BOM, 0);
  out.set(body, UTF8_BOM.length);
  return out;
}

/**
 * The text a document opened from a text file saves back, or null when it
 * no longer fits that file: it must still be a workbook of exactly one
 * worksheet of the kind the file opened as.
 */
export function textFileSource(doc: EditorDocument, format: TextFileFormat): string | null {
  if (!isWorkbook(doc) || doc.sheets.length !== 1 || doc.sheets[0].kind !== format.kind) {
    return null;
  }
  return doc.sheets[0].getValue(0, 0);
}
