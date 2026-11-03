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
/** The `@wllama/wllama` version, which names its runtime files (vite.config.ts). */
declare const __WLLAMA_VERSION__: string;
/** The `@mlc-ai/web-llm` version, which names its runtime script (vite.config.ts). */
declare const __WEBLLM_VERSION__: string;

/** What the panel shows about a model before anything is downloaded. */
export interface AiModelInfo {
  /** Which runtime runs it: WebLLM needs WebGPU, wllama runs on the CPU. */
  readonly runtime: 'webllm' | 'wllama';
  readonly name: string;
  readonly quantization: string;
  /** The model's license, shown before the download. */
  readonly license: string;
  /** The model card, linked from the panel. */
  readonly pageUrl: string;
  /** Approximate download size in MB, shown before anything is fetched. */
  readonly approxSizeMb: number;
}

/**
 * The default model: a Japanese fine-tune of Gemma 3 270M compiled for
 * WebLLM. It runs on WebGPU, which Safari (macOS, iOS and iPadOS 26) offers,
 * and is small enough for a phone.
 */
export const GEMMA_MODEL = {
  runtime: 'webllm',
  name: 'gemma3-270m-japanese-webllm-03',
  quantization: 'q4f32_1',
  license: 'Gemma Terms of Use',
  pageUrl: 'https://huggingface.co/UMASHIKA/gemma3-270m-japanese-webllm-03',
  /** The Hugging Face repository; WebLLM reads every file from `resolve/main/`. */
  repo: 'UMASHIKA/gemma3-270m-japanese-webllm-03',
  approxSizeMb: 190,
} as const satisfies AiModelInfo & { repo: string };

/** The model for browsers without WebGPU: a GGUF file run by llama.cpp on the CPU. */
export const QWEN_MODEL = {
  runtime: 'wllama',
  name: 'Qwen2.5-0.5B-Instruct',
  quantization: 'Q4_K_M',
  license: 'Apache-2.0',
  pageUrl: 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF',
  /** The file the Download button fetches; also its key in the browser's model storage. */
  fileUrl:
    'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf',
  approxSizeMb: 490,
} as const satisfies AiModelInfo & { fileUrl: string };

/**
 * True when this browser can run the WebLLM model: WebGPU, and the Cache
 * Storage WebLLM keeps the model in (both need a secure context). Only reads
 * what the browser exposes; contacts nothing and starts no GPU.
 */
export function webGpuAvailable(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'gpu' in navigator &&
    Boolean((navigator as Navigator & { gpu?: unknown }).gpu) &&
    typeof caches !== 'undefined'
  );
}

let modelOverride: AiModelInfo | null = null;

/** The model this browser uses: the Gemma model on WebGPU, otherwise the Qwen model. */
export function aiModel(): AiModelInfo {
  return modelOverride ?? (webGpuAvailable() ? GEMMA_MODEL : QWEN_MODEL);
}

/** Test seam: force the model (null restores the browser check). */
export function setAiModelForTests(model: AiModelInfo | null): void {
  modelOverride = model;
}

/**
 * The inference runtimes' own files, served next to the hosted app from
 * `ai-runtime/` (vite.config.ts copies or builds them). Fetched only when a
 * model is downloaded or started, never on page load.
 */
export function aiRuntimeFiles(): {
  wasm: string;
  compatWasm: string;
  compatWorker: string;
  webllmScript: string;
} {
  const v = __WLLAMA_VERSION__;
  return {
    wasm: `ai-runtime/wllama-${v}.wasm`,
    compatWasm: `ai-runtime/wllama-compat-${v}.wasm`,
    compatWorker: `ai-runtime/wllama-compat-${v}.js`,
    webllmScript: `ai-runtime/webllm-${__WEBLLM_VERSION__}.js`,
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
