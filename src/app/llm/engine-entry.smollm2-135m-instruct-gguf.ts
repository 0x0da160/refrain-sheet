// SPDX-License-Identifier: MIT
/**
 * Standalone entry point for the "smollm2-135m-instruct-gguf" local-assistant
 * model — see engine-entry.gemma3-270m-ja.ts for why this needs to be its
 * own separate classic script rather than a dynamic `import()`, and why
 * every vendored model gets its own such entry point. Unlike the other two
 * entry points, this one is backed by `@wllama/wllama` (see
 * src/app/llm/wllama-engine.ts) rather than `@mlc-ai/web-llm`, since this
 * model is a plain GGUF file rather than a pre-compiled WebGPU kernel — see
 * docs/llm-model.md and issue #169.
 */
import { createWllamaEngine } from './wllama-engine';
import { MODEL_FILES } from '../../llm-gen/smollm2-135m-instruct-gguf/model-manifest';

const engine = createWllamaEngine(MODEL_FILES);

declare global {
  interface Window {
    __refrainSheetLlmEngine?: typeof engine;
  }
}

window.__refrainSheetLlmEngine = engine;
