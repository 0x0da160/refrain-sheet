// SPDX-License-Identifier: MIT
/**
 * Writes the embedded model (src/llm-gen/) into the browser's Cache Storage
 * under the exact scopes and URLs `@mlc-ai/web-llm` reads from — before the
 * engine ever starts — so its own fetch path always hits an existing cache
 * entry and never calls `fetch()`. `Cache.match()`/`put()` are storage
 * operations, not network requests, so this needs no `connect-src` CSP
 * relaxation: `index.html`'s `connect-src 'none'` stays untouched.
 *
 * This relies on `@mlc-ai/web-llm@0.2.84` internals that are not part of its
 * public/documented API (the fixed cache scope names, and that
 * `ArtifactCache.addToCache()` checks `cache.match()` before ever calling
 * `cache.add()`/`fetch()` — read directly from its published
 * `lib/index.js`). If a future dependency upgrade changes that behavior,
 * the failure is a runtime error when installing the model, not something
 * `npm run check:dist` can catch — see docs/llm-model.md.
 */
import { CACHE_SCOPES, CONFIG_URL, MODEL_LIB_URL, TENSOR_CACHE_URL, TOKENIZER_URL, shardUrl } from './model-source';
import { MODEL_FILES, type ModelFileEntry } from '../../llm-gen/model-manifest';

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

/** Decode and concatenate every chunk for one source file, then verify it against its recorded SHA-256. */
async function reassembleAndVerify(entry: ModelFileEntry): Promise<Uint8Array> {
  const bytes = new Uint8Array(entry.byteLength);
  let offset = 0;
  for (const chunk of entry.chunks) {
    const decoded = decodeBase64(chunk);
    bytes.set(decoded, offset);
    offset += decoded.length;
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

/** The Cache Storage scope and request URL WebLLM expects for one vendored file. */
function cacheTargetFor(fileName: string): { scope: string; url: string } {
  if (fileName === 'mlc-chat-config.json') {
    return { scope: CACHE_SCOPES.config, url: CONFIG_URL };
  }
  if (fileName === 'tensor-cache.json') {
    return { scope: CACHE_SCOPES.model, url: TENSOR_CACHE_URL };
  }
  if (fileName === 'tokenizer.json') {
    return { scope: CACHE_SCOPES.model, url: TOKENIZER_URL };
  }
  if (fileName.endsWith('.wasm')) {
    return { scope: CACHE_SCOPES.wasm, url: MODEL_LIB_URL };
  }
  if (fileName.startsWith('params_shard_')) {
    return { scope: CACHE_SCOPES.model, url: shardUrl(fileName) };
  }
  throw new Error(`refrain-sheet: no known cache target for embedded model file "${fileName}"`);
}

export interface PrepopulateProgress {
  readonly fileName: string;
  readonly filesDone: number;
  readonly filesTotal: number;
}

/**
 * Reassemble and verify every embedded model file, then write each into the
 * Cache Storage scope/URL WebLLM will look it up from. Idempotent: safe to
 * call again (e.g. a retried install) — `cache.put()` simply overwrites.
 */
export async function prepopulateModelCache(onProgress?: (progress: PrepopulateProgress) => void): Promise<void> {
  const opened = new Map<string, Cache>();
  const openScope = async (scope: string): Promise<Cache> => {
    const existing = opened.get(scope);
    if (existing) return existing;
    const cache = await caches.open(scope);
    opened.set(scope, cache);
    return cache;
  };

  for (let i = 0; i < MODEL_FILES.length; i++) {
    const entry = MODEL_FILES[i];
    const bytes = await reassembleAndVerify(entry);
    const { scope, url } = cacheTargetFor(entry.name);
    const cache = await openScope(scope);
    await cache.put(new Request(url), new Response(bytes));
    onProgress?.({ fileName: entry.name, filesDone: i + 1, filesTotal: MODEL_FILES.length });
  }
}
