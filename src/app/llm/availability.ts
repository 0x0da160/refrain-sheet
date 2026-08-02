// SPDX-License-Identifier: MIT
/**
 * Capability check for the local AI assistant, kept dependency-free and
 * separate from engine.ts / wllama-engine.ts so callers can decide whether
 * to show the install UI without pulling in either engine's embedded model
 * payload — see src/app/llm/model-catalog.ts and docs/llm-model.md.
 *
 * Takes which engine a model uses (see `ModelCatalogEntry.engine`) because
 * the two runtimes need different browser capabilities: `'webllm'` models
 * need WebGPU (`navigator.gpu`) and the Cache Storage API (the trick
 * src/app/llm/cache-prepopulate.ts relies on); `'wllama'` models
 * (src/app/llm/wllama-engine.ts) run on plain WebAssembly inside a Worker
 * and need neither.
 */

export type LlmEngineKind = 'webllm' | 'wllama';

export type LlmAvailability = 'available' | 'no-webgpu' | 'no-cache-storage' | 'no-wasm-worker';

/** Whether this browser can plausibly run the local assistant with the given engine, without starting it. */
export function checkLlmAvailability(engine: LlmEngineKind): LlmAvailability {
  if (engine === 'wllama') {
    if (typeof WebAssembly === 'undefined' || typeof Worker === 'undefined') {
      return 'no-wasm-worker';
    }
    return 'available';
  }
  if (typeof caches === 'undefined') {
    return 'no-cache-storage';
  }
  if (typeof navigator === 'undefined' || !('gpu' in navigator) || !navigator.gpu) {
    return 'no-webgpu';
  }
  return 'available';
}
