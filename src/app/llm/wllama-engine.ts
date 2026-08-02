// SPDX-License-Identifier: MIT
/**
 * Builds a lifecycle wrapper around `@wllama/wllama`'s `Wllama` (a
 * WebAssembly binding for llama.cpp), for models distributed as a plain
 * `.gguf` file rather than a pre-compiled WebGPU kernel — see engine.ts for
 * the `@mlc-ai/web-llm`-backed equivalent this mirrors, and
 * docs/llm-model.md for why the two runtimes coexist.
 *
 * No network access at any point: the GGUF model's chunked Base64 payload
 * (see src/app/llm/reassemble-model-file.ts) is decoded directly into a
 * `Blob` and handed to `wllama.loadModel()`, never fetched by URL; the
 * `@wllama/wllama` WASM runtime itself is embedded the same way (see
 * scripts/embed-wllama-wasm.mjs / src/wllama-gen/) and turned into a
 * `blob:` URL only because `Wllama`'s constructor requires one, never a real
 * network origin (`index.html`'s CSP still forbids `http:`/`https:`
 * anywhere).
 *
 * `@wllama/wllama` creates its inference Worker from a `Blob` it builds from
 * its own bundled source (`URL.createObjectURL(new Blob([...]))`), which
 * `index.html`'s `worker-src 'self' blob:` exists specifically to allow —
 * see docs/security.md.
 *
 * Forces single-thread WASM (`n_threads: 1`) and a small context/response
 * budget (`n_ctx: 512`, `max_tokens: 64`) per issue #169's iOS Safari
 * memory-consciousness — multi-thread WASM needs `SharedArrayBuffer`, gated
 * behind cross-origin-isolation (`COOP`/`COEP`) response headers a static
 * file opened via `file://` or GitHub Pages cannot set.
 */
import { Wllama, WllamaError, WllamaRuntimeError, type AssetsPathConfig } from '@wllama/wllama';
import { WLLAMA_WASM_BASE64 } from '../../wllama-gen/wllama-wasm-payload';
import type { LlmEngine, LlmInstallProgress } from './engine';
import type { ModelFileEntry } from './model-file-entry';
import { reassembleAndVerify } from './reassemble-model-file';

/** Mirrors `n_predict` from issue #169's iOS-memory-conscious defaults, in the OpenAI-compatible `max_tokens` field `createChatCompletion` expects. */
const MAX_TOKENS = 64;
const N_CTX = 512;
const N_THREADS = 1;

function decodeBase64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Re-throws a `wllama.loadModel()` failure with a cause distinguished for
 * the user (see `aiAssistant.installFailed` in the panel) — WebAssembly
 * runtime failures (`WllamaRuntimeError`, e.g. an emscripten `abort()`) are
 * the closest signal this engine has to "out of memory", since browsers do
 * not expose a dedicated OOM error type to WebAssembly callers.
 */
function describeLoadError(err: unknown): Error {
  if (err instanceof WllamaRuntimeError) {
    return new Error(
      `refrain-sheet: the WebAssembly runtime aborted while initializing the model, possibly due to insufficient memory: ${err.message}`,
    );
  }
  if (err instanceof WllamaError) {
    return new Error(`refrain-sheet: model initialization failed (${err.type}): ${err.message}`);
  }
  return err instanceof Error ? err : new Error(String(err));
}

export function createWllamaEngine(files: readonly ModelFileEntry[]): LlmEngine {
  let wllama: Wllama | undefined;
  let wasmBlobUrl: string | undefined;
  let installPromise: Promise<void> | undefined;

  function installLlm(onProgress?: (progress: LlmInstallProgress) => void): Promise<void> {
    if (wllama) {
      return Promise.resolve();
    }
    if (installPromise) {
      return installPromise;
    }

    installPromise = (async () => {
      try {
        // Stage 1: decode and integrity-verify every chunk of the vendored
        // GGUF file straight into memory — never written to Cache Storage
        // (unlike engine.ts's WebLLM path), since wllama.loadModel() takes
        // the bytes directly.
        const ggufBlobs: Blob[] = [];
        for (let i = 0; i < files.length; i++) {
          const entry = files[i];
          const bytes = await reassembleAndVerify(entry);
          ggufBlobs.push(new Blob([bytes], { type: 'application/octet-stream' }));
          onProgress?.({
            stage: 'preparing',
            progress: (i + 1) / files.length,
            text: `${entry.name} (${i + 1}/${files.length})`,
          });
        }

        // Stage 2: decode this engine's own embedded WASM runtime and turn
        // it into a `blob:` URL — the only shape `Wllama`'s constructor
        // accepts, and never a real network origin (see module docs above).
        onProgress?.({ stage: 'loading', progress: 0, text: 'wllama.wasm' });
        const wasmBytes = decodeBase64ToBytes(WLLAMA_WASM_BASE64);
        wasmBlobUrl = URL.createObjectURL(new Blob([wasmBytes], { type: 'application/wasm' }));
        const pathConfig: AssetsPathConfig = {
          default: wasmBlobUrl,
          'single-thread/wllama.wasm': wasmBlobUrl,
        };

        const instance = new Wllama(pathConfig, { suppressNativeLog: true });
        try {
          await instance.loadModel(ggufBlobs, { n_threads: N_THREADS, n_ctx: N_CTX });
        } catch (err) {
          throw describeLoadError(err);
        }
        wllama = instance;
        onProgress?.({ stage: 'loading', progress: 1, text: 'wllama.wasm' });
      } catch (err) {
        if (wasmBlobUrl) {
          URL.revokeObjectURL(wasmBlobUrl);
          wasmBlobUrl = undefined;
        }
        throw err;
      }
    })();

    installPromise.catch(() => {
      // Allow a subsequent installLlm() call to retry from scratch.
      installPromise = undefined;
    });

    return installPromise;
  }

  function isLlmInstalled(): boolean {
    return wllama !== undefined;
  }

  async function askLlm(
    message: string,
    system?: string,
    onToken?: (delta: string) => void,
  ): Promise<string> {
    if (!wllama) {
      throw new Error('refrain-sheet: installLlm() must complete before askLlm()');
    }
    let full = '';
    await wllama.createChatCompletion({
      messages: [
        ...(system ? [{ role: 'system' as const, content: system }] : []),
        { role: 'user' as const, content: message },
      ],
      max_tokens: MAX_TOKENS,
      stream: true,
      onData: (chunk) => {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          full += delta;
          onToken?.(delta);
        }
      },
    });
    return full;
  }

  async function uninstallLlm(): Promise<void> {
    if (wllama) {
      await wllama.exit();
      wllama = undefined;
    }
    if (wasmBlobUrl) {
      URL.revokeObjectURL(wasmBlobUrl);
      wasmBlobUrl = undefined;
    }
    installPromise = undefined;
  }

  return { installLlm, isLlmInstalled, askLlm, uninstallLlm };
}
