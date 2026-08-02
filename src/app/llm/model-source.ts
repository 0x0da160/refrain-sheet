// SPDX-License-Identifier: MIT
/**
 * Builds a vendored local-assistant model's identity and the exact URLs
 * `@mlc-ai/web-llm` will look up while loading it, from a small per-model
 * config (see src/app/llm/model-catalog.ts for the two vendored models).
 *
 * The base URL is synthetic — nothing is ever fetched from it. WebLLM
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
 * Each model gets its own path segment (its catalog `key`) so two vendored
 * models' Cache Storage entries never collide, even though in practice only
 * one model's engine bundle (see engine-entry.*.ts) is ever loaded at a time.
 */
import type { AppConfig, ChatOptions } from '@mlc-ai/web-llm';

/** Cache Storage scopes WebLLM's `ArtifactCache` reads from — its fixed names, not configurable, and shared by every model. */
export const CACHE_SCOPES = {
  config: 'webllm/config',
  wasm: 'webllm/wasm',
  model: 'webllm/model',
} as const;

export interface ModelSourceConfig {
  /** Matches the model's entry in src/app/llm/model-catalog.ts and scripts/model-catalog.mjs. */
  readonly key: string;
  /** Passed to `CreateMLCEngine()` to select this model. */
  readonly modelId: string;
  /** The compiled WebGPU/WASM kernel's file name, as vendored under this model's src/llm-gen/ manifest. */
  readonly wasmFileName: string;
  /** Merged over the vendored `mlc-chat-config.json` at load time (`ModelRecord.overrides`) — see model-catalog.ts for why each model needs (or doesn't need) one. */
  readonly overrides?: ChatOptions;
}

export interface ModelSource {
  readonly modelId: string;
  readonly modelLibUrl: string;
  readonly configUrl: string;
  readonly tensorCacheUrl: string;
  readonly tokenizerUrl: string;
  /** Resolve a params shard's file name (from `tensor-cache.json`'s `dataPath`) to its cache key. */
  shardUrl(dataPath: string): string;
  /** `appConfig` for `CreateMLCEngine()`. Replaces (not merges with) WebLLM's built-in `prebuiltAppConfig` model list, so lookups only ever see this one vendored model. */
  readonly appConfig: AppConfig;
}

/**
 * `cacheBackend` is set explicitly even though `"cache"` (the Cache Storage
 * API, as opposed to IndexedDB) is already WebLLM's default — the
 * cache-prepopulation trick depends specifically on that backend, so a
 * silent default change upstream must not go unnoticed.
 */
export function createModelSource(config: ModelSourceConfig): ModelSource {
  const baseUrl = `https://refrain-sheet.invalid/models/${config.key}/resolve/main/`;
  const modelLibUrl = new URL(config.wasmFileName, baseUrl).href;
  const configUrl = new URL('mlc-chat-config.json', baseUrl).href;
  const tensorCacheUrl = new URL('tensor-cache.json', baseUrl).href;
  const tokenizerUrl = new URL('tokenizer.json', baseUrl).href;

  return {
    modelId: config.modelId,
    modelLibUrl,
    configUrl,
    tensorCacheUrl,
    tokenizerUrl,
    shardUrl: (dataPath: string) => new URL(dataPath, baseUrl).href,
    appConfig: {
      cacheBackend: 'cache',
      model_list: [
        {
          model: baseUrl,
          model_id: config.modelId,
          model_lib: modelLibUrl,
          overrides: config.overrides ?? {},
        },
      ],
    },
  };
}
