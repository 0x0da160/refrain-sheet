// SPDX-License-Identifier: MIT
/**
 * Decode, concatenate, and integrity-verify one vendored model file's
 * chunked Base64 payload (`ModelFileEntry`, see model-file-entry.ts). Shared
 * by every engine that installs a vendored model — src/app/llm/
 * cache-prepopulate.ts (writes the result into Cache Storage for
 * `@mlc-ai/web-llm`) and src/app/llm/wllama-engine.ts (assembles it directly
 * into a `Blob` for `@wllama/wllama`) — so the decode/verify step is
 * implemented, and can be trusted, exactly once.
 */
import type { ModelFileEntry } from './model-file-entry';
import { yieldToBrowser } from '../../core/scheduler';

/** Decode a Base64 chunk into raw bytes (mirrors `decodeEmbeddedWasm` in src/core/csv-engine.ts). */
function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Thrown when a reassembled file's SHA-256 does not match what `scripts/embed-model.mjs` recorded. */
export class ModelPayloadIntegrityError extends Error {
  constructor(fileName: string) {
    super(`refrain-sheet: embedded model payload for "${fileName}" failed integrity verification`);
    this.name = 'ModelPayloadIntegrityError';
  }
}

/**
 * Decode and concatenate every chunk for one source file, then verify it against its recorded
 * SHA-256. Yields to the browser between chunks (see src/core/scheduler.ts) so a large file's
 * many-megabyte `atob()`/byte-copy decode never blocks the main thread in one uninterrupted
 * stretch — on the largest vendored files that stretch was long enough to starve the page of
 * input/paint time for the whole decode, which is indistinguishable from a hang and, under a
 * dev server's HMR WebSocket, can trip its disconnect-and-reload recovery — see issue #140.
 */
export async function reassembleAndVerify(entry: ModelFileEntry): Promise<Uint8Array<ArrayBuffer>> {
  const bytes = new Uint8Array(entry.byteLength);
  let offset = 0;
  for (const chunk of entry.chunks) {
    const decoded = decodeBase64(chunk);
    bytes.set(decoded, offset);
    offset += decoded.length;
    await yieldToBrowser();
  }
  if (offset !== entry.byteLength) {
    throw new ModelPayloadIntegrityError(entry.name);
  }
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  if (bytesToHex(digest) !== entry.sha256) {
    throw new ModelPayloadIntegrityError(entry.name);
  }
  return bytes;
}
