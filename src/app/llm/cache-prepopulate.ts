// SPDX-License-Identifier: MIT
/**
 * Builds a function that writes one embedded model (src/llm-gen/) into the
 * browser's Cache Storage under the exact scopes and URLs `@mlc-ai/web-llm`
 * reads from — before the engine ever starts — so its own fetch path always
 * hits an existing cache entry and never calls `fetch()`. `Cache.match()`/
 * `put()` are storage operations, not network requests, so this needs no
 * `connect-src` CSP relaxation: `index.html`'s `connect-src 'none'` stays
 * untouched.
 *
 * Parametrized by a `ModelSource` (src/app/llm/model-source.ts) and that
 * model's manifest (`src/llm-gen/<model>/model-manifest.ts`) rather than a
 * single hardcoded model, so each model's engine-entry.*.ts (see
 * src/app/llm/engine.ts) gets its own independent prepopulator bound to
 * exactly one vendored model.
 *
 * This relies on `@mlc-ai/web-llm@0.2.84` internals that are not part of its
 * public/documented API (the fixed cache scope names, and that
 * `ArtifactCache.addToCache()` checks `cache.match()` before ever calling
 * `cache.add()`/`fetch()` — read directly from its published
 * `lib/index.js`). If a future dependency upgrade changes that behavior,
 * the failure is a runtime error when installing the model, not something
 * `npm run check:dist` can catch — see docs/llm-model.md.
 */
import { CACHE_SCOPES, type ModelSource } from './model-source';
import type { ModelFileEntry } from './model-file-entry';
import { reassembleAndVerify } from './reassemble-model-file';

export { ModelPayloadIntegrityError } from './reassemble-model-file';

/** The Cache Storage scope and request URL WebLLM expects for one vendored file. */
function cacheTargetFor(modelSource: ModelSource, fileName: string): { scope: string; url: string } {
  if (fileName === 'mlc-chat-config.json') {
    return { scope: CACHE_SCOPES.config, url: modelSource.configUrl };
  }
  if (fileName === 'tensor-cache.json') {
    return { scope: CACHE_SCOPES.model, url: modelSource.tensorCacheUrl };
  }
  if (fileName === 'tokenizer.json') {
    return { scope: CACHE_SCOPES.model, url: modelSource.tokenizerUrl };
  }
  if (fileName.endsWith('.wasm')) {
    return { scope: CACHE_SCOPES.wasm, url: modelSource.modelLibUrl };
  }
  if (fileName.startsWith('params_shard_')) {
    return { scope: CACHE_SCOPES.model, url: modelSource.shardUrl(fileName) };
  }
  throw new Error(`refrain-sheet: no known cache target for embedded model file "${fileName}"`);
}

export interface PrepopulateProgress {
  readonly fileName: string;
  readonly filesDone: number;
  readonly filesTotal: number;
}

/**
 * Returns a function that reassembles and verifies every file in `files`,
 * then writes each into the Cache Storage scope/URL WebLLM will look it up
 * from for `modelSource`. Idempotent: safe to call again (e.g. a retried
 * install) — `cache.put()` simply overwrites.
 */
export function createCachePrepopulator(
  modelSource: ModelSource,
  files: readonly ModelFileEntry[],
): (onProgress?: (progress: PrepopulateProgress) => void) => Promise<void> {
  return async (onProgress) => {
    const opened = new Map<string, Cache>();
    const openScope = async (scope: string): Promise<Cache> => {
      const existing = opened.get(scope);
      if (existing) return existing;
      const cache = await caches.open(scope);
      opened.set(scope, cache);
      return cache;
    };

    for (let i = 0; i < files.length; i++) {
      const entry = files[i];
      const bytes = await reassembleAndVerify(entry);
      const { scope, url } = cacheTargetFor(modelSource, entry.name);
      const cache = await openScope(scope);
      await cache.put(new Request(url), new Response(bytes));
      onProgress?.({ fileName: entry.name, filesDone: i + 1, filesTotal: files.length });
    }
  };
}
