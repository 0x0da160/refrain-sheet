// SPDX-License-Identifier: MIT
/**
 * The vendored local-assistant model's identity and the exact URLs
 * `@mlc-ai/web-llm` will look up while loading it.
 *
 * `MODEL_BASE_URL` is synthetic — nothing is ever fetched from it. WebLLM
 * resolves every file it needs relative to a model's `model` URL (via
 * `cleanModelUrl()`, which appends `resolve/main/` unless already present —
 * matched here so the literal string passes through unchanged) and reads
 * `model_lib` (the compiled WASM kernel) verbatim. See
 * src/app/llm/cache-prepopulate.ts: every one of these URLs is pre-populated
 * in Cache Storage from the embedded model before the engine starts, so
 * WebLLM's cache-lookup-before-fetch path (`ArtifactCache.addToCache()`)
 * always hits and never reaches a real `fetch()` — the app's CSP keeps
 * `connect-src 'none'` unchanged.
 *
 * `.invalid` is the IANA-reserved TLD for names that are guaranteed never to
 * resolve (RFC 2606) — deliberate, since this URL must never be dereferenced.
 */
const MODEL_BASE_URL = 'https://refrain-sheet.invalid/models/gemma3-270m-ja/resolve/main/';

/** Passed to `CreateMLCEngine()` to select this model. */
export const MODEL_ID = 'gemma3-270m-japanese-webllm-04-q4f32_1';

/** The compiled WebGPU/WASM kernel WebLLM loads for this model. */
export const MODEL_LIB_URL = new URL('gemma3-270m-japanese-q4f32_1-ctx4k-webgpu.wasm', MODEL_BASE_URL).href;

/** Cache Storage scopes WebLLM's `ArtifactCache` reads from (its fixed names, not configurable). */
export const CACHE_SCOPES = {
  config: 'webllm/config',
  wasm: 'webllm/wasm',
  model: 'webllm/model',
} as const;

/** The exact Cache Storage request URL WebLLM uses for `mlc-chat-config.json`. */
export const CONFIG_URL = new URL('mlc-chat-config.json', MODEL_BASE_URL).href;

/** The exact Cache Storage request URL WebLLM uses for `tensor-cache.json`. */
export const TENSOR_CACHE_URL = new URL('tensor-cache.json', MODEL_BASE_URL).href;

/** The exact Cache Storage request URL WebLLM uses for `tokenizer.json`. */
export const TOKENIZER_URL = new URL('tokenizer.json', MODEL_BASE_URL).href;

/** Resolve a params shard's file name (from `tensor-cache.json`'s `dataPath`) to its cache key. */
export function shardUrl(dataPath: string): string {
  return new URL(dataPath, MODEL_BASE_URL).href;
}

/**
 * `appConfig` for `CreateMLCEngine()`. Replaces (not merges with) WebLLM's
 * built-in `prebuiltAppConfig` model list, so lookups only ever see this one
 * vendored model. `cacheBackend` is set explicitly even though `"cache"`
 * (the Cache Storage API, as opposed to IndexedDB) is already WebLLM's
 * default — the pre-population trick above depends specifically on that
 * backend, so a silent default change upstream must not go unnoticed.
 */
export const MODEL_APP_CONFIG = {
  cacheBackend: 'cache' as const,
  model_list: [
    {
      model: MODEL_BASE_URL,
      model_id: MODEL_ID,
      model_lib: MODEL_LIB_URL,
    },
  ],
};
