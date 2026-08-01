// SPDX-License-Identifier: MIT
import { afterEach, describe, expect, it } from 'vitest';
import { ModelPayloadIntegrityError, prepopulateModelCache } from '../src/app/llm/cache-prepopulate';
import {
  CACHE_SCOPES,
  CONFIG_URL,
  MODEL_LIB_URL,
  TENSOR_CACHE_URL,
  TOKENIZER_URL,
  shardUrl,
} from '../src/app/llm/model-source';
import { MODEL_FILES } from '../src/llm-gen/model-manifest';

/** Minimal in-memory stand-in for the browser's Cache Storage API. */
class FakeCache {
  readonly store = new Map<string, Response>();
  async put(request: Request, response: Response): Promise<void> {
    this.store.set(request.url, response);
  }
}

class FakeCacheStorage {
  readonly scopes = new Map<string, FakeCache>();
  async open(name: string): Promise<FakeCache> {
    let cache = this.scopes.get(name);
    if (!cache) {
      cache = new FakeCache();
      this.scopes.set(name, cache);
    }
    return cache;
  }
}

describe('prepopulateModelCache', () => {
  afterEach(() => {
    delete (globalThis as { caches?: unknown }).caches;
  });

  it('reassembles, verifies, and caches every embedded model file at its expected scope and URL', async () => {
    const fakeCaches = new FakeCacheStorage();
    (globalThis as unknown as { caches: FakeCacheStorage }).caches = fakeCaches;

    const progress: number[] = [];
    await prepopulateModelCache((p) => progress.push(p.filesDone));
    expect(progress).toEqual(MODEL_FILES.map((_, i) => i + 1));

    const expectedTargets: Record<string, { scope: string; url: string }> = {
      'mlc-chat-config.json': { scope: CACHE_SCOPES.config, url: CONFIG_URL },
      'tensor-cache.json': { scope: CACHE_SCOPES.model, url: TENSOR_CACHE_URL },
      'tokenizer.json': { scope: CACHE_SCOPES.model, url: TOKENIZER_URL },
      'gemma3-270m-japanese-q4f32_1-ctx4k-webgpu.wasm': { scope: CACHE_SCOPES.wasm, url: MODEL_LIB_URL },
    };

    for (const entry of MODEL_FILES) {
      const target = entry.name.startsWith('params_shard_')
        ? { scope: CACHE_SCOPES.model, url: shardUrl(entry.name) }
        : expectedTargets[entry.name];
      expect(target, `no expected cache target for ${entry.name}`).toBeDefined();
      const cache = fakeCaches.scopes.get(target.scope);
      expect(cache, `scope "${target.scope}" was never opened for ${entry.name}`).toBeDefined();
      const stored = cache!.store.get(target.url);
      expect(stored, `${entry.name} was not written to ${target.url}`).toBeDefined();
      const bytes = new Uint8Array(await stored!.arrayBuffer());
      expect(bytes.length, `byte length mismatch for ${entry.name}`).toBe(entry.byteLength);
    }
  });

  it('is idempotent: a second call overwrites the same cache entries without error', async () => {
    const fakeCaches = new FakeCacheStorage();
    (globalThis as unknown as { caches: FakeCacheStorage }).caches = fakeCaches;

    await prepopulateModelCache();
    await expect(prepopulateModelCache()).resolves.toBeUndefined();

    const totalEntries = [...fakeCaches.scopes.values()].reduce((n, c) => n + c.store.size, 0);
    // Every vendored file has exactly one cache entry; a second run must not duplicate them.
    expect(totalEntries).toBe(MODEL_FILES.length);
  });
});

describe('ModelPayloadIntegrityError', () => {
  it('names the file that failed verification', () => {
    const err = new ModelPayloadIntegrityError('tokenizer.json');
    expect(err.name).toBe('ModelPayloadIntegrityError');
    expect(err.message).toContain('tokenizer.json');
  });
});
