// SPDX-License-Identifier: MIT
/**
 * The AI assistant's engine on WebGPU: `@mlc-ai/web-llm` running the default
 * Gemma model (./model.ts). Safari has WebGPU on macOS, iOS and iPadOS 26,
 * so this is the engine that makes the assistant work there.
 *
 * WebLLM itself is large, so it is not part of the app's script. The hosted
 * build serves it from this origin as `ai-runtime/webllm-<version>.js`
 * (vite.config.ts), and this module adds that script to the page only when
 * the user downloads or starts the model.
 *
 * Every network request follows an explicit user action:
 *
 * - `download()` (the panel's Download button) lists the model repository on
 *   Hugging Face to find its compiled WebGPU library, then lets WebLLM fetch
 *   the model files into the browser's Cache Storage and start the model.
 * - `load()` starts a stored model. WebLLM looks in Cache Storage before it
 *   fetches anything, and `load()` refuses to run unless every file is
 *   stored, so a start never downloads.
 *
 * `isDownloaded()` and `deleteModel()` read and clear Cache Storage directly,
 * without WebLLM, so opening the panel contacts nothing and loads nothing.
 */
import type { AppConfig, ChatOptions, InitProgressReport, MLCEngine } from '@mlc-ai/web-llm';
import type { AiChatMessage } from '../../core/ai-prompt';
import type { AiEngine } from './engine';
import { aiRuntimeFiles, GEMMA_MODEL } from './model';

/** What the WebLLM runtime script puts on the page (src/app/ai/webllm-runtime.ts). */
interface WebLlmRuntime {
  CreateMLCEngine(
    modelId: string,
    config: { appConfig: AppConfig; initProgressCallback?: (report: InitProgressReport) => void },
  ): Promise<MLCEngine>;
}

declare global {
  interface Window {
    __refrainSheetWebLlm?: WebLlmRuntime;
  }
}

/** Upper bound on one reply, so a rambling model stops. */
const MAX_REPLY_TOKENS = 512;
/** Low temperature: answers about the sheet should be steady, not creative. */
const TEMPERATURE = 0.2;

/** WebLLM's own Cache Storage names (fixed by WebLLM, shared by every model). */
const CACHE_SCOPES = ['webllm/config', 'webllm/wasm', 'webllm/model'] as const;

// The model's URLs are built when used, not at module load: a property read
// at the top level would keep the model's details in the offline bundle,
// which must not mention the assistant at all (scripts/check/dist.mjs).

/** The name WebLLM knows the model by; any string, as long as it is used consistently. */
function modelId(): string {
  return GEMMA_MODEL.name;
}

/** Every model file lives under this URL, which is also its Cache Storage key prefix. */
function modelBaseUrl(): string {
  return `https://huggingface.co/${GEMMA_MODEL.repo}/resolve/main/`;
}

/** The repository's file list, read once at download to find the compiled library. */
function modelTreeUrl(): string {
  return `https://huggingface.co/api/models/${GEMMA_MODEL.repo}/tree/main`;
}

/** The library's name in the earlier builds of this model, used when the list cannot be read. */
const FALLBACK_MODEL_LIB = 'gemma3-270m-japanese-q4f32_1-ctx4k-webgpu.wasm';

/**
 * Used when the model's own config sets both a context window and a
 * sliding window, which WebLLM refuses (earlier builds of this model did):
 * keep the context window and turn the sliding window off.
 */
const WINDOW_OVERRIDES: ChatOptions = { sliding_window_size: -1 };

function abortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError');
}

function appConfig(modelLib: string, overrides: ChatOptions = {}): AppConfig {
  return {
    // Cache Storage, which Safari, Chrome and Firefox all offer. Named here
    // rather than left to WebLLM's default so the stored-model check below
    // keeps reading the right place.
    cacheBackend: 'cache',
    model_list: [{ model: modelBaseUrl(), model_id: modelId(), model_lib: modelLib, overrides }],
  };
}

async function cachedUrls(scope: string): Promise<string[]> {
  if (!(await caches.has(scope))) {
    return [];
  }
  const cache = await caches.open(scope);
  return (await cache.keys()).map((request) => request.url).filter((url) => url.startsWith(modelBaseUrl()));
}

async function cachedJson(scope: string, url: string): Promise<unknown> {
  const response = await (await caches.open(scope)).match(url);
  return response ? ((await response.json()) as unknown) : undefined;
}

/**
 * The stored compiled library's URL, when every file the model needs is in
 * Cache Storage: its config, its library, its tokenizer, and each weight
 * shard its tensor list names. Reads storage only.
 */
async function storedModelLib(): Promise<string | null> {
  if (typeof caches === 'undefined') {
    return null;
  }
  const [config, wasm, model] = await Promise.all(CACHE_SCOPES.map(cachedUrls));
  const lib = wasm.find((url) => url.endsWith('.wasm'));
  const configUrl = `${modelBaseUrl()}mlc-chat-config.json`;
  const tensorsUrl = `${modelBaseUrl()}tensor-cache.json`;
  if (!lib || !config.includes(configUrl) || !model.includes(tensorsUrl)) {
    return null;
  }
  const chatConfig = (await cachedJson('webllm/config', configUrl)) as
    { tokenizer_files?: unknown } | undefined;
  const tokenizerFiles = Array.isArray(chatConfig?.tokenizer_files) ? chatConfig.tokenizer_files : [];
  const tokenizer = tokenizerFiles.includes('tokenizer.json') ? 'tokenizer.json' : 'tokenizer.model';
  const tensors = (await cachedJson('webllm/model', tensorsUrl)) as
    { records?: { dataPath?: unknown }[] } | undefined;
  const shards = (tensors?.records ?? []).map((record) => String(record.dataPath));
  const needed = [tokenizer, ...shards].map((file) => new URL(file, modelBaseUrl()).href);
  return shards.length > 0 && needed.every((url) => model.includes(url)) ? lib : null;
}

/** The compiled WebGPU library's URL, from the repository's file list. */
async function remoteModelLib(signal: AbortSignal): Promise<string> {
  let name = FALLBACK_MODEL_LIB;
  try {
    const response = await fetch(modelTreeUrl(), { signal });
    if (response.ok) {
      const files = ((await response.json()) as { path?: unknown }[])
        .map((file) => String(file.path))
        .filter((path) => path.endsWith('.wasm'));
      name = files.find((path) => path.includes('webgpu')) ?? files[0] ?? name;
    }
  } catch {
    if (signal.aborted) {
      throw abortError();
    }
    // An unreadable list leaves the known name; WebLLM reports a missing file.
  }
  return new URL(name, modelBaseUrl()).href;
}

let runtimeLoading: Promise<WebLlmRuntime> | null = null;

/** Add the WebLLM script (served from this origin) to the page, once. */
function webLlmRuntime(): Promise<WebLlmRuntime> {
  if (window.__refrainSheetWebLlm) {
    return Promise.resolve(window.__refrainSheetWebLlm);
  }
  runtimeLoading ??= new Promise<WebLlmRuntime>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL(aiRuntimeFiles().webllmScript, document.baseURI).href;
    script.addEventListener('load', () => {
      const runtime = window.__refrainSheetWebLlm;
      if (runtime) {
        resolve(runtime);
      } else {
        reject(new Error('The AI runtime did not start.'));
      }
    });
    script.addEventListener('error', () => reject(new Error('The AI runtime could not be loaded.')));
    document.head.append(script);
  }).catch((error: unknown) => {
    runtimeLoading = null;
    throw error;
  });
  return runtimeLoading;
}

/** The engine backed by WebLLM. Created on first use, never at page load. */
export class WebLlmEngine implements AiEngine {
  private engine: MLCEngine | null = null;
  private loading: Promise<void> | null = null;

  async isDownloaded(): Promise<boolean> {
    return (await storedModelLib()) !== null;
  }

  async download(
    onProgress: (progress: { loaded: number; total: number }) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const modelLib = await remoteModelLib(signal);
    // WebLLM reports one fraction for fetching and starting together; it is
    // shown against the model's approximate size.
    const total = GEMMA_MODEL.approxSizeMb * 1_000_000;
    await this.start(modelLib, signal, (report) => {
      onProgress({ loaded: Math.round(report.progress * total), total });
    });
    // Ask the browser not to evict the model under storage pressure. A
    // refusal is fine: the model then stays until the browser needs the room.
    try {
      await navigator.storage?.persist?.();
    } catch {
      // Not every browser offers persistent storage.
    }
  }

  isLoaded(): boolean {
    return this.engine !== null;
  }

  load(): Promise<void> {
    if (this.engine) {
      return Promise.resolve();
    }
    this.loading ??= (async () => {
      const modelLib = await storedModelLib();
      if (!modelLib) {
        throw new Error('The model is not downloaded.');
      }
      await this.start(modelLib, new AbortController().signal);
    })().finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  /** Create the WebLLM engine; files already in Cache Storage are not fetched again. */
  private async start(
    modelLib: string,
    signal: AbortSignal,
    onProgress?: (report: InitProgressReport) => void,
  ): Promise<void> {
    if (signal.aborted) {
      throw abortError();
    }
    const runtime = await webLlmRuntime();
    const create = (overrides?: ChatOptions) =>
      runtime.CreateMLCEngine(modelId(), {
        appConfig: appConfig(modelLib, overrides),
        initProgressCallback: onProgress,
      });
    let pending: Promise<MLCEngine> = create();
    let engine: MLCEngine;
    try {
      engine = await this.untilAborted(pending, signal);
    } catch (error) {
      if (signal.aborted || !/sliding_window_size/i.test(String(error))) {
        throw error;
      }
      pending = create(WINDOW_OVERRIDES);
      engine = await this.untilAborted(pending, signal);
    }
    if (signal.aborted) {
      await engine.unload();
      throw abortError();
    }
    this.engine = engine;
  }

  /**
   * Wait for the engine, stopping its download when `signal` aborts. WebLLM
   * offers no signal of its own; an engine that is still loading is stopped
   * by unloading it once it exists.
   */
  private async untilAborted(pending: Promise<MLCEngine>, signal: AbortSignal): Promise<MLCEngine> {
    const aborted = new Promise<never>((_, reject) => {
      signal.addEventListener('abort', () => reject(abortError()), { once: true });
    });
    try {
      return await Promise.race([pending, aborted]);
    } catch (error) {
      if (signal.aborted) {
        void pending.then((engine) => engine.unload()).catch(() => undefined);
      }
      throw error;
    }
  }

  async chat(
    messages: AiChatMessage[],
    onText: (text: string) => void,
    signal: AbortSignal,
  ): Promise<string> {
    const engine = this.engine;
    if (!engine) {
      throw new Error('The model is not started.');
    }
    const stop = (): void => {
      void engine.interruptGenerate();
    };
    signal.addEventListener('abort', stop, { once: true });
    let reply = '';
    try {
      const chunks = await engine.chat.completions.create({
        messages,
        max_tokens: MAX_REPLY_TOKENS,
        temperature: TEMPERATURE,
        stream: true,
      });
      for await (const chunk of chunks) {
        const piece = chunk.choices[0]?.delta?.content;
        if (piece) {
          reply += piece;
          onText(piece);
        }
      }
    } finally {
      signal.removeEventListener('abort', stop);
    }
    if (signal.aborted) {
      throw abortError();
    }
    return reply;
  }

  async deleteModel(): Promise<void> {
    const engine = this.engine;
    this.engine = null;
    try {
      await engine?.unload();
    } catch {
      // An engine that lost its GPU has nothing to stop.
    }
    if (typeof caches === 'undefined') {
      return;
    }
    for (const scope of CACHE_SCOPES) {
      const urls = await cachedUrls(scope);
      if (urls.length > 0) {
        const cache = await caches.open(scope);
        await Promise.all(urls.map((url) => cache.delete(url)));
      }
    }
  }
}
