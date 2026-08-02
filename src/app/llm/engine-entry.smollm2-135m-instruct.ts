// SPDX-License-Identifier: MIT
/**
 * Standalone entry point for the "smollm2-135m-instruct" local-assistant
 * model — see engine-entry.gemma3-270m-ja.ts for why this needs to be its
 * own separate classic script rather than a dynamic `import()`, and why
 * every vendored model gets its own such entry point. See docs/llm-model.md
 * and issue #166.
 */
import { createLlmEngine } from './engine';
import { createModelSource } from './model-source';
import { MODEL_FILES } from '../../llm-gen/smollm2-135m-instruct/model-manifest';

/**
 * `@mlc-ai/web-llm@0.2.84`'s own published `prebuiltAppConfig` (read from
 * its `lib/index.js`, the same file docs/llm-model.md already reads for
 * cache-lookup internals) lists this exact model with
 * `low_resource_required: true` and overrides its context window down from
 * the vendored `mlc-chat-config.json`'s native 8192 to 4096 — mirrored here
 * since this model was added specifically as a lighter-weight alternative
 * (see issue #166). The vendored config's `sliding_window_size` is already
 * `-1`, so no `WindowSizeConfigurationError` workaround is needed here
 * (contrast gemma3-270m-ja's override, above).
 */
const modelSource = createModelSource({
  key: 'smollm2-135m-instruct',
  modelId: 'SmolLM2-135M-Instruct-q0f16-MLC',
  wasmFileName: 'SmolLM2-135M-Instruct-q0f16_cs1k-webgpu.wasm',
  overrides: { context_window_size: 4096 },
});

const engine = createLlmEngine(modelSource, MODEL_FILES);

declare global {
  interface Window {
    __refrainSheetLlmEngine?: typeof engine;
  }
}

window.__refrainSheetLlmEngine = engine;
