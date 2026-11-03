// SPDX-License-Identifier: MIT
/**
 * Entry of the WebLLM runtime script, `ai-runtime/webllm-<version>.js`.
 * vite.config.ts builds it on its own, as one classic script that sets the
 * global `__refrainSheetWebLlm`, for the hosted build only. It is never part
 * of the app's script: ./webllm-engine.ts adds it to the page when the user
 * downloads or starts the model.
 *
 * `@mlc-ai/web-llm` is pinned to 0.2.84 (package.json; Dependabot ignores it).
 * A model's compiled WebGPU library links against the runtime it was built
 * for, and the default model's library imports TVM's threading functions
 * (such as `tvm::runtime::threading::ResetThreadPool`), which the runtime
 * stopped providing in 0.2.85. With a newer runtime the model fails to start
 * with "import function env:_ZN3tvm7runtime9threading15ResetThreadPoolEv must
 * be callable". Upgrade only together with a model rebuilt for that runtime.
 */
export { CreateMLCEngine } from '@mlc-ai/web-llm';
