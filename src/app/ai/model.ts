// SPDX-License-Identifier: MIT
/**
 * The AI assistant's model and where the assistant exists at all.
 *
 * The assistant is a hosted-build feature (app.refrain-sheet.com). The
 * offline build and the release ZIP never contain it: `__OFFLINE_BUILD__`
 * (vite.config.ts) compiles the panel and the inference runtime out, and
 * `scripts/check/dist.mjs` fails if any of it survives there. In the hosted
 * build nothing is downloaded until the user presses Download in the panel;
 * see knowledge/operations/security-threat-model.md.
 */

/** `true` only in the offline production build, injected by vite.config.ts. */
declare const __OFFLINE_BUILD__: boolean;
/** The `@wllama/wllama` version, which names the runtime files (vite.config.ts). */
declare const __WLLAMA_VERSION__: string;

/** The default (and, for now, only) model. */
export const AI_MODEL = {
  name: 'Qwen2.5-0.5B-Instruct',
  quantization: 'Q4_K_M',
  /** The model's license, shown before the download. */
  license: 'Apache-2.0',
  /** The model card, linked from the panel. */
  pageUrl: 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF',
  /** The file the Download button fetches; also its key in the browser's model storage. */
  fileUrl:
    'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf',
  /** Approximate download size in MB, shown before anything is fetched. */
  approxSizeMb: 490,
} as const;

/**
 * The inference runtime's own files, served next to the hosted app from
 * `ai-runtime/` (vite.config.ts copies them out of node_modules). Fetched
 * only when the model is loaded, never on page load.
 */
export function aiRuntimeFiles(): { wasm: string; compatWasm: string; compatWorker: string } {
  const v = __WLLAMA_VERSION__;
  return {
    wasm: `ai-runtime/wllama-${v}.wasm`,
    compatWasm: `ai-runtime/wllama-compat-${v}.wasm`,
    compatWorker: `ai-runtime/wllama-compat-${v}.js`,
  };
}

/** True when this build includes the assistant at all (every build but the offline one). */
export function aiAssistantBuilt(): boolean {
  return !__OFFLINE_BUILD__;
}

let availableOverride: boolean | null = null;

/**
 * True when the assistant can be offered: a build that includes it, served
 * over http(s) rather than opened from a local file.
 */
export function aiAssistantAvailable(): boolean {
  if (!aiAssistantBuilt()) {
    return false;
  }
  if (availableOverride !== null) {
    return availableOverride;
  }
  const protocol = typeof location === 'undefined' ? '' : location.protocol;
  return protocol === 'https:' || protocol === 'http:';
}

/** Test seam: force availability on or off (null restores the real check). */
export function setAiAssistantAvailableForTests(value: boolean | null): void {
  availableOverride = value;
}
