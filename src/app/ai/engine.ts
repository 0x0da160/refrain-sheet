// SPDX-License-Identifier: MIT
/**
 * The AI assistant's inference engine: `@wllama/wllama` (llama.cpp compiled
 * to WebAssembly) running the model in a Web Worker inside the browser.
 *
 * Every network request this module makes follows an explicit user action:
 *
 * - `download()` (the panel's Download button) fetches the model file from
 *   Hugging Face into the browser's own storage (Origin Private File System,
 *   through wllama's cache manager) and asks the browser to keep it.
 * - `load()` reads the stored model and fetches the runtime's WebAssembly
 *   file from the app's own origin (`ai-runtime/`, see ./model.ts). It never
 *   downloads the model: with no stored copy it fails instead.
 *
 * `isDownloaded()` only lists what is stored, so opening the panel contacts
 * nothing. A stored model is reused on every later visit.
 */
import { LoggerWithoutDebug, Wllama, WllamaAbortError, type Model } from '@wllama/wllama';
import type { AiChatMessage } from '../../core/ai-prompt';
import { AI_MODEL, aiRuntimeFiles } from './model';

/** Context window in tokens: the system prompt, the sheet view, a few turns, and the reply. */
const N_CTX = 4096;
/** Upper bound on one reply, so a rambling model stops. */
const MAX_REPLY_TOKENS = 512;
/** Low temperature: answers about the sheet should be steady, not creative. */
const TEMPERATURE = 0.2;

interface AiDownloadProgress {
  /** Bytes received so far. */
  loaded: number;
  /** Total bytes, or 0 while unknown. */
  total: number;
}

/** What the panel needs from the engine; a fake implements it in tests. */
export interface AiEngine {
  /** Whether the model is stored in this browser. Contacts nothing. */
  isDownloaded(): Promise<boolean>;
  /** Download the model into browser storage. Rejects with an AbortError when `signal` aborts. */
  download(onProgress: (progress: AiDownloadProgress) => void, signal: AbortSignal): Promise<void>;
  /** Start the stored model. Safe to call again; concurrent calls share one load. */
  load(): Promise<void>;
  isLoaded(): boolean;
  /** Generate a reply, passing each new piece of text to `onText`. Resolves with the whole reply. */
  chat(messages: AiChatMessage[], onText: (text: string) => void, signal: AbortSignal): Promise<string>;
  /** Stop the model and delete the stored copy. */
  deleteModel(): Promise<void>;
}

/** True for the error a cancelled download or reply rejects with. */
export function isAbortError(error: unknown): boolean {
  return (
    error instanceof WllamaAbortError ||
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

function absolute(path: string): string {
  return new URL(path, document.baseURI).href;
}

/** The engine backed by wllama. Created on first use, never at page load. */
class WllamaEngine implements AiEngine {
  private instance: Wllama | null = null;
  private loading: Promise<void> | null = null;

  /**
   * The wllama object. Building it touches no network: it only checks the
   * browser's WebAssembly features and opens the model storage.
   */
  private wllama(): Wllama {
    if (!this.instance) {
      const files = aiRuntimeFiles();
      const instance = new Wllama({ default: absolute(files.wasm) }, { logger: LoggerWithoutDebug });
      // Browsers without JSPI or Memory64 (Safari) use the compat build. Its
      // files are served from this origin too, never from a CDN.
      instance.setCompat({ worker: absolute(files.compatWorker), wasm: absolute(files.compatWasm) });
      this.instance = instance;
    }
    return this.instance;
  }

  private async storedModel(): Promise<Model | undefined> {
    const models = await this.wllama().modelManager.getModels();
    return models.find((model) => model.url === AI_MODEL.fileUrl);
  }

  async isDownloaded(): Promise<boolean> {
    return (await this.storedModel()) !== undefined;
  }

  async download(onProgress: (progress: AiDownloadProgress) => void, signal: AbortSignal): Promise<void> {
    await this.wllama().modelManager.downloadModel(AI_MODEL.fileUrl, {
      signal,
      progressCallback: ({ loaded, total }) => onProgress({ loaded, total }),
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
    return this.instance?.isModelLoaded() ?? false;
  }

  load(): Promise<void> {
    if (this.isLoaded()) {
      return Promise.resolve();
    }
    this.loading ??= this.loadStored().finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  private async loadStored(): Promise<void> {
    const model = await this.storedModel();
    if (!model) {
      throw new Error('The model is not downloaded.');
    }
    try {
      await this.wllama().loadModel(model, { n_ctx: N_CTX });
    } catch (error) {
      // WebGPU is used when the browser offers it. Some GPUs and drivers
      // fail there, so a failed start is retried once on the CPU.
      await this.reset();
      try {
        await this.wllama().loadModel(model, { n_ctx: N_CTX, n_gpu_layers: 0 });
      } catch {
        await this.reset();
        throw error;
      }
    }
  }

  async chat(
    messages: AiChatMessage[],
    onText: (text: string) => void,
    signal: AbortSignal,
  ): Promise<string> {
    if (!this.instance || !this.isLoaded()) {
      throw new Error('The model is not started.');
    }
    let reply = '';
    await this.instance.createChatCompletion({
      messages,
      max_tokens: MAX_REPLY_TOKENS,
      temperature: TEMPERATURE,
      stream: true,
      abortSignal: signal,
      onData: (chunk) => {
        const piece = chunk.choices[0]?.delta?.content;
        if (piece) {
          reply += piece;
          onText(piece);
        }
      },
    });
    return reply;
  }

  async deleteModel(): Promise<void> {
    const model = await this.storedModel();
    await this.reset();
    await model?.remove();
  }

  /** Stop the worker and forget the wllama object, so the next use starts clean. */
  private async reset(): Promise<void> {
    const instance = this.instance;
    this.instance = null;
    if (instance) {
      try {
        await instance.exit();
      } catch {
        // A worker that failed to start has nothing to stop.
      }
    }
  }
}

let engine: AiEngine | null = null;

/** The one engine for the page, created on first use. */
export function aiEngine(): AiEngine {
  engine ??= new WllamaEngine();
  return engine;
}

/** Test seam: replace the engine (null restores the real one on next use). */
export function setAiEngineForTests(fake: AiEngine | null): void {
  engine = fake;
}
