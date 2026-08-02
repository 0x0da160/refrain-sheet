// SPDX-License-Identifier: MIT
/**
 * Standalone entry point for the "gemma3-270m-ja" local-assistant model.
 *
 * This file transitively embeds that model's ~190 MB vendored payload
 * (`src/llm-gen/`, via `cache-prepopulate.ts`). If the main application
 * bundle imported it — even via a dynamic `import()` — Vite's
 * `inlineDynamicImports` setting (required so `dist/index.html` keeps
 * working when opened directly via `file://`, see vite.config.ts) inlines
 * every dynamically-imported module into the same single script and
 * evaluates it eagerly at startup, defeating the deferral entirely: the
 * whole payload would still download and execute on every page load.
 *
 * Instead this is built as its own separate classic script (see
 * vite.llm.config.ts, `assets/llm-engine.gemma3-270m-ja.js`) and loaded at
 * runtime only once the user selects this model in the AI Assistant
 * panel's install flow (`src/ui/ai-panel.ts`, `loadLlmEngine()`) by
 * inserting a `<script>` tag — the same same-origin, `file://`-safe loading
 * path `index.html` already uses for the main bundle, and explicitly
 * allowed by the CSP (`script-src 'self' file:'`). Each vendored model gets
 * its own such entry point (see engine-entry.smollm2-135m-instruct.ts) so
 * selecting one model never downloads or parses another's payload. See
 * docs/llm-model.md and issue #116.
 */
import { createLlmEngine } from './engine';
import { createModelSource } from './model-source';
import { MODEL_FILES } from '../../llm-gen/model-manifest';

/**
 * Corrects a defect in the vendored `mlc-chat-config.json`: the upstream
 * file sets both `context_window_size` (8192) and `sliding_window_size`
 * (512) to positive values, which WebLLM's `LLMChatPipeline` rejects
 * outright with `WindowSizeConfigurationError` ("Only one of
 * context_window_size and sliding_window_size can be positive"), since it
 * only supports a single KV cache strategy per model. `ModelRecord.overrides`
 * is merged over the fetched config at load time — WebLLM's own error
 * message points here — so disabling the sliding window (`-1`) keeps the
 * full 8192-token `context_window_size`, which already matches
 * `prefill_chunk_size`.
 */
const modelSource = createModelSource({
  key: 'gemma3-270m-ja',
  modelId: 'gemma3-270m-japanese-webllm-04-q4f32_1',
  wasmFileName: 'gemma3-270m-japanese-q4f32_1-ctx4k-webgpu.wasm',
  overrides: { sliding_window_size: -1 },
});

const engine = createLlmEngine(modelSource, MODEL_FILES);

declare global {
  interface Window {
    __refrainSheetLlmEngine?: typeof engine;
  }
}

window.__refrainSheetLlmEngine = engine;
