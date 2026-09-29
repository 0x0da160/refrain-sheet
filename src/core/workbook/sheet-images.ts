// SPDX-License-Identifier: MIT
/**
 * The pictures a workbook holds for its image objects (`SheetObject.image`,
 * see `sheet-objects.ts`). Each picture's bytes are kept once per file and
 * every image object that shows it names it by id, so the same picture
 * placed twice (or on two sheets) is stored once.
 *
 * Saved in the RSF container as the file's `images` key
 * (knowledge/formats/rsf/json-document.md). Only PNG, JPEG, WebP and SVG are
 * accepted, and a picture's declared type must match its bytes. Pictures are
 * only ever shown through an `<img>` element, where an SVG's scripts and
 * external references do not run or load.
 */

export const SHEET_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'] as const;
export type SheetImageType = (typeof SHEET_IMAGE_TYPES)[number];

/** A picture's bytes and type. Treat the bytes as immutable. */
export interface SheetImage {
  type: SheetImageType;
  bytes: Uint8Array;
}

/** A picture with the id objects name it by. */
export interface SheetImageEntry extends SheetImage {
  id: string;
}

/** Largest picture a file may hold, in bytes. */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
/** Most pictures one file may hold. */
export const MAX_FILE_IMAGES = 1000;

export const IMAGE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function startsWith(bytes: Uint8Array, prefix: readonly number[], at = 0): boolean {
  return bytes.length >= at + prefix.length && prefix.every((b, i) => bytes[at + i] === b);
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];

/** The SVG text of `bytes`, or null when they are not UTF-8 text holding an `<svg` element. */
function svgText(bytes: Uint8Array): string | null {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  return /<svg[\s>/]/i.test(text) ? text : null;
}

/** The type the bytes are, by their first bytes (SVG by its `<svg` element), or null for anything else. */
export function sniffImageType(bytes: Uint8Array): SheetImageType | null {
  if (startsWith(bytes, PNG)) return 'image/png';
  if (startsWith(bytes, JPEG)) return 'image/jpeg';
  if (startsWith(bytes, RIFF) && startsWith(bytes, WEBP, 8)) return 'image/webp';
  return svgText(bytes) !== null ? 'image/svg+xml' : null;
}

function u16be(b: Uint8Array, at: number): number {
  return (b[at] << 8) | b[at + 1];
}
function u32be(b: Uint8Array, at: number): number {
  return ((b[at] << 24) >>> 0) + ((b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]);
}
function u24le(b: Uint8Array, at: number): number {
  return b[at] | (b[at + 1] << 8) | (b[at + 2] << 16);
}

function jpegSize(b: Uint8Array): { width: number; height: number } | null {
  let at = 2;
  while (at + 9 < b.length) {
    if (b[at] !== 0xff) {
      return null;
    }
    const marker = b[at + 1];
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    // Start-of-frame markers (not DHT, JPG or DAC) carry the size.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: u16be(b, at + 5), width: u16be(b, at + 7) };
    }
    at += 2 + u16be(b, at + 2);
  }
  return null;
}

function webpSize(b: Uint8Array): { width: number; height: number } | null {
  const chunk = String.fromCharCode(b[12], b[13], b[14], b[15]);
  if (chunk === 'VP8 ' && b.length >= 30) {
    return { width: (b[26] | (b[27] << 8)) & 0x3fff, height: (b[28] | (b[29] << 8)) & 0x3fff };
  }
  if (chunk === 'VP8L' && b.length >= 25) {
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X' && b.length >= 30) {
    return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  }
  return null;
}

function svgLength(value: string | undefined): number | null {
  const match = value ? /^\s*([0-9]*\.?[0-9]+)\s*(px)?\s*$/.exec(value) : null;
  return match ? Number(match[1]) : null;
}

function svgSize(bytes: Uint8Array): { width: number; height: number } | null {
  const text = svgText(bytes);
  const tag = text ? /<svg\b[^>]*>/i.exec(text)?.[0] : undefined;
  if (!tag) {
    return null;
  }
  const attr = (name: string): string | undefined =>
    new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i')
      .exec(tag)
      ?.slice(2, 4)
      .find((v) => v !== undefined);
  const width = svgLength(attr('width'));
  const height = svgLength(attr('height'));
  if (width && height) {
    return { width, height };
  }
  const box = attr('viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if (box && box.length === 4 && box[2] > 0 && box[3] > 0) {
    return { width: box[2], height: box[3] };
  }
  return null;
}

/** The picture's size in pixels as its file states it, or null when it does not (or is unreadable). */
export function imageSize(image: SheetImage): { width: number; height: number } | null {
  const b = image.bytes;
  let size: { width: number; height: number } | null = null;
  if (image.type === 'image/png' && b.length >= 24) {
    size = { width: u32be(b, 16), height: u32be(b, 20) };
  } else if (image.type === 'image/jpeg') {
    size = jpegSize(b);
  } else if (image.type === 'image/webp') {
    size = webpSize(b);
  } else if (image.type === 'image/svg+xml') {
    size = svgSize(b);
  }
  return size && size.width > 0 && size.height > 0 ? size : null;
}

/** An id for a picture from its bytes, so the same picture gets the same id in every file. */
function contentId(image: SheetImage): string {
  // cyrb53-style mixing over the bytes, seeded by the type.
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < image.type.length; i++) {
    h1 = Math.imul(h1 ^ image.type.charCodeAt(i), 2654435761);
    h2 = Math.imul(h2 ^ image.type.charCodeAt(i), 1597334677);
  }
  const b = image.bytes;
  for (let i = 0; i < b.length; i++) {
    h1 = Math.imul(h1 ^ b[i], 2654435761);
    h2 = Math.imul(h2 ^ b[i], 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hex = (n: number): string => (n >>> 0).toString(16).padStart(8, '0');
  return `img-${hex(h2)}${hex(h1)}-${b.length.toString(36)}`;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a === b || (a.length === b.length && a.every((v, i) => v === b[i]));
}

/**
 * A workbook's pictures by id. Adding never removes: an image object undone
 * away can come back, so a picture stays here for the whole session and the
 * file keeps only the pictures some object still shows (see
 * `RsfDocument.toBytesFromSheetCells`).
 */
export class ImageStore {
  private readonly byId = new Map<string, SheetImage>();

  get(id: string): SheetImage | undefined {
    return this.byId.get(id);
  }

  /** Add a picture (or find the same one already here) and return its id. */
  add(image: SheetImage): string {
    const base = contentId(image);
    let id = base;
    for (let n = 2; ; n++) {
      const held = this.byId.get(id);
      if (!held) {
        this.byId.set(id, image);
        return id;
      }
      if (held.type === image.type && sameBytes(held.bytes, image.bytes)) {
        return id;
      }
      id = `${base}-${n}`;
    }
  }

  /** Replace every picture with `entries` (a file just read). */
  load(entries: readonly SheetImageEntry[]): void {
    this.byId.clear();
    for (const { id, type, bytes } of entries) {
      this.byId.set(id, { type, bytes });
    }
  }

  /**
   * Add pictures read from elsewhere (a restored version) and return the ids
   * that had to change: an id already here for different bytes gets a new one.
   */
  merge(entries: readonly SheetImageEntry[]): Map<string, string> {
    const renamed = new Map<string, string>();
    for (const { id, type, bytes } of entries) {
      const held = this.byId.get(id);
      if (!held) {
        this.byId.set(id, { type, bytes });
      } else if (held.type !== type || !sameBytes(held.bytes, bytes)) {
        renamed.set(id, this.add({ type, bytes }));
      }
    }
    return renamed;
  }

  /** The pictures named by `ids` that are here, in the order given. */
  entries(ids: Iterable<string>): SheetImageEntry[] {
    const out: SheetImageEntry[] = [];
    for (const id of ids) {
      const image = this.byId.get(id);
      if (image) {
        out.push({ id, ...image });
      }
    }
    return out;
  }
}

// ----- Base64 (the file stores picture bytes as Base64 text) -----

export function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK)));
  }
  return btoa(parts.join(''));
}

/** The bytes of canonical Base64 text (padded, no whitespace), or null for anything else. */
export function base64ToBytes(text: string): Uint8Array | null {
  if (text.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) {
    return null;
  }
  let binary: string;
  try {
    binary = atob(text);
  } catch {
    return null;
  }
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}
