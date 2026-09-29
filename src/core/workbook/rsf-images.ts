// SPDX-License-Identifier: MIT
/**
 * The file's `images` key in `.rsf` (knowledge/formats/rsf/json-document.md):
 * the pictures image objects show, each stored once and named by id,
 * `{ "<id>": { "type": "image/png", "data": "<Base64>" } }`. Like every
 * key in the codec, a known key with the wrong shape fails the whole file.
 */
import {
  base64ToBytes,
  bytesToBase64,
  IMAGE_ID_PATTERN,
  MAX_FILE_IMAGES,
  MAX_IMAGE_BYTES,
  SHEET_IMAGE_TYPES,
  sniffImageType,
  type SheetImageEntry,
} from './sheet-images';
import type { SheetObject } from './sheet-objects';

/** The file's pictures; absent or empty when it has none. */
export interface RsfImageList {
  images?: SheetImageEntry[];
}

type Fail = (reason?: 'too-large') => never;

/** The file's `images` key, left out when it has none. */
export function imagesToJson(data: RsfImageList): {
  images?: { [id: string]: { type: string; data: string } };
} {
  if (!data.images || data.images.length === 0) {
    return {};
  }
  const images: { [id: string]: { type: string; data: string } } = {};
  for (const image of data.images.slice(0, MAX_FILE_IMAGES)) {
    images[image.id] = { type: image.type, data: bytesToBase64(image.bytes) };
  }
  return { images };
}

/**
 * Reads the file's `images`: each id well-formed, each type one of the
 * accepted ones and matching the picture's bytes, each picture within the
 * size limit.
 */
export function imagesFromJson(value: unknown, fail: Fail): RsfImageList {
  if (value === undefined) {
    return {};
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail();
  }
  const ids = Object.keys(value);
  if (ids.length > MAX_FILE_IMAGES) {
    return fail('too-large');
  }
  const images = ids.map((id): SheetImageEntry => {
    const entry = (value as { [key: string]: unknown })[id];
    if (!IMAGE_ID_PATTERN.test(id) || typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return fail();
    }
    const { type, data } = entry as { [key: string]: unknown };
    if (typeof type !== 'string' || !(SHEET_IMAGE_TYPES as readonly string[]).includes(type)) {
      return fail();
    }
    if (typeof data !== 'string') {
      return fail();
    }
    // Base64 is 4 characters per 3 bytes.
    if ((data.length / 4) * 3 > MAX_IMAGE_BYTES + 3) {
      return fail('too-large');
    }
    const bytes = base64ToBytes(data);
    if (!bytes || sniffImageType(bytes) !== type) {
      return fail();
    }
    if (bytes.length > MAX_IMAGE_BYTES) {
      return fail('too-large');
    }
    return { id, type: type as SheetImageEntry['type'], bytes };
  });
  return images.length > 0 ? { images } : {};
}

/** Fails the file when an image object names a picture the file does not hold. */
export function checkImageReferences(
  data: RsfImageList,
  sheets: ReadonlyArray<{ objects?: readonly SheetObject[] }>,
  fail: Fail,
): void {
  const ids = new Set((data.images ?? []).map((image) => image.id));
  for (const sheet of sheets) {
    for (const o of sheet.objects ?? []) {
      if (o.image !== undefined && !ids.has(o.image)) {
        fail();
      }
    }
  }
}
