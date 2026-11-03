// SPDX-License-Identifier: MIT
/**
 * Entry of the WebLLM runtime script, `ai-runtime/webllm-<version>.js`.
 * vite.config.ts builds it on its own, as one classic script that sets the
 * global `__refrainSheetWebLlm`, for the hosted build only. It is never part
 * of the app's script: ./webllm-engine.ts adds it to the page when the user
 * downloads or starts the model.
 */
export { CreateMLCEngine } from '@mlc-ai/web-llm';
