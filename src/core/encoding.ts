// SPDX-License-Identifier: MIT
import Encoding from 'encoding-japanese';

/** Text encodings supported by Refrain Sheet. */
export type EncodingId = 'utf-8' | 'shift_jis' | 'euc-jp';

export const UTF8_BOM = new Uint8Array([0xef, 0xbb, 0xbf]);

export interface EncodingDetection {
  encoding: EncodingId;
  hasBom: boolean;
  /** Detection confidence was low; CP932 is presented as a candidate. */
  uncertain: boolean;
  /** The input looks like an encoding outside the supported range (e.g. UTF-16, ISO-2022-JP). */
  unsupportedCandidate: string | null;
}

export function hasUtf8Bom(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
}

export function isValidUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect the likely encoding of a file. UTF-8 validity is checked strictly;
 * Japanese legacy encodings are detected heuristically via encoding-japanese.
 * Detection never alters the input bytes.
 */
export function detectEncoding(bytes: Uint8Array): EncodingDetection {
  if (hasUtf8Bom(bytes)) {
    return { encoding: 'utf-8', hasBom: true, uncertain: false, unsupportedCandidate: null };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { encoding: 'shift_jis', hasBom: false, uncertain: true, unsupportedCandidate: 'UTF-16LE' };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { encoding: 'shift_jis', hasBom: false, uncertain: true, unsupportedCandidate: 'UTF-16BE' };
  }
  if (isValidUtf8(bytes)) {
    return { encoding: 'utf-8', hasBom: false, uncertain: false, unsupportedCandidate: null };
  }
  const detected = Encoding.detect(bytes);
  switch (detected) {
    case 'SJIS':
      return { encoding: 'shift_jis', hasBom: false, uncertain: false, unsupportedCandidate: null };
    case 'EUCJP':
      return { encoding: 'euc-jp', hasBom: false, uncertain: false, unsupportedCandidate: null };
    case 'JIS':
      return { encoding: 'shift_jis', hasBom: false, uncertain: true, unsupportedCandidate: 'ISO-2022-JP' };
    case 'UTF16':
    case 'UTF32':
    case 'UNICODE':
      return { encoding: 'shift_jis', hasBom: false, uncertain: true, unsupportedCandidate: 'UTF-16/UTF-32' };
    default:
      // Undecodable or ambiguous content: present CP932 as the candidate.
      return { encoding: 'shift_jis', hasBom: false, uncertain: true, unsupportedCandidate: null };
  }
}

const DECODER_LABEL: Record<EncodingId, string> = {
  'utf-8': 'utf-8',
  shift_jis: 'shift_jis',
  'euc-jp': 'euc-jp',
};

/** Decode bytes for display. Undecodable bytes become U+FFFD replacement characters. */
export function decodeBytes(bytes: Uint8Array, encoding: EncodingId): string {
  return new TextDecoder(DECODER_LABEL[encoding]).decode(bytes);
}

/** True when the byte sequence decodes without any invalid sequences. */
export function decodesCleanly(bytes: Uint8Array, encoding: EncodingId): boolean {
  try {
    new TextDecoder(DECODER_LABEL[encoding], { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/**
 * Encode text into the target encoding.
 * Characters that cannot be represented are reported instead of being replaced;
 * see findUnrepresentableChars / replaceUnrepresentableChars for the explicit
 * numeric-character-reference fallback.
 */
export function encodeText(text: string, encoding: EncodingId): Uint8Array {
  if (encoding === 'utf-8') {
    return new TextEncoder().encode(text);
  }
  const to = encoding === 'shift_jis' ? 'SJIS' : 'EUCJP';
  const codes = Encoding.convert(Encoding.stringToCode(text), { to, from: 'UNICODE' });
  return new Uint8Array(codes);
}

/** List the distinct characters of `text` that cannot be represented in `encoding`. */
export function findUnrepresentableChars(text: string, encoding: EncodingId): string[] {
  if (encoding === 'utf-8') {
    return [];
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const ch of text) {
    if (seen.has(ch)) {
      continue;
    }
    seen.add(ch);
    const roundTrip = decodeBytes(encodeText(ch, encoding), encoding);
    if (roundTrip !== ch) {
      result.push(ch);
    }
  }
  return result;
}

export interface NcrReplacement {
  text: string;
  count: number;
}

/**
 * Replace every character that `encoding` cannot represent with a numeric
 * character reference such as `&#128512;`. Only used when the user explicitly
 * chooses to continue after an unrepresentable-character warning.
 */
export function replaceUnrepresentableChars(text: string, encoding: EncodingId): NcrReplacement {
  const bad = new Set(findUnrepresentableChars(text, encoding));
  if (bad.size === 0) {
    return { text, count: 0 };
  }
  let out = '';
  let count = 0;
  for (const ch of text) {
    if (bad.has(ch)) {
      out += `&#${ch.codePointAt(0)};`;
      count += 1;
    } else {
      out += ch;
    }
  }
  return { text: out, count };
}
