// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * The WebLLM engine (the default Gemma model on WebGPU) against a fake Cache
 * Storage and a fake WebLLM runtime: checking for and deleting a stored model
 * contacts nothing, only Download reaches the network, and a stored model
 * starts from storage.
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { MLCEngine } from '@mlc-ai/web-llm';
import { isAbortError } from '../../src/app/ai/engine';
import {
  aiModel,
  aiRuntimeFiles,
  GEMMA_MODEL,
  QWEN_MODEL,
  setAiModelForTests,
  webGpuAvailable,
} from '../../src/app/ai/model';
import { WebLlmEngine } from '../../src/app/ai/webllm-engine';

const BASE = `https://huggingface.co/${GEMMA_MODEL.repo}/resolve/main/`;
const LIB = `${BASE}gemma3-270m-japanese-q4f32_1-ctx4k-webgpu.wasm`;

/** A Cache Storage that keeps JSON bodies in memory, keyed by URL. */
function fakeCaches(): { storage: CacheStorage; scopes: Map<string, Map<string, string>> } {
  const scopes = new Map<string, Map<string, string>>();
  const open = (name: string): Cache => {
    let entries = scopes.get(name);
    if (!entries) {
      entries = new Map();
      scopes.set(name, entries);
    }
    const store = entries;
    return {
      keys: async () => [...store.keys()].map((url) => ({ url }) as Request),
      match: async (url: string) =>
        store.has(url)
          ? ({ json: async () => JSON.parse(store.get(url)!) as unknown } as Response)
          : undefined,
      delete: async (url: string) => store.delete(url),
    } as unknown as Cache;
  };
  const storage = {
    has: async (name: string) => scopes.has(name),
    open: async (name: string) => open(name),
  } as unknown as CacheStorage;
  return { storage, scopes };
}

/** Put every file of a complete download into the fake storage. */
function storeModel(scopes: Map<string, Map<string, string>>, options: { skipShard?: boolean } = {}): void {
  scopes.set(
    'webllm/config',
    new Map([[`${BASE}mlc-chat-config.json`, JSON.stringify({ tokenizer_files: ['tokenizer.json'] })]]),
  );
  scopes.set('webllm/wasm', new Map([[LIB, '0']]));
  const model = new Map([
    [
      `${BASE}tensor-cache.json`,
      JSON.stringify({ records: [{ dataPath: 'params_shard_0.bin' }, { dataPath: 'params_shard_1.bin' }] }),
    ],
    [`${BASE}tokenizer.model`, '0'],
    // Used away from iPhone and iPad; an iPhone deletes it on download.
    [`${BASE}tokenizer.json`, '0'],
    [`${BASE}params_shard_0.bin`, '0'],
  ]);
  if (!options.skipShard) {
    model.set(`${BASE}params_shard_1.bin`, '0');
  }
  // An earlier model's leftover file.
  model.set('https://huggingface.co/other/model/resolve/main/tokenizer.json', '0');
  scopes.set('webllm/model', model);
}

interface FakeMlc {
  engine: MLCEngine;
  unload: ReturnType<typeof vi.fn>;
  interruptGenerate: ReturnType<typeof vi.fn>;
}

function fakeMlc(pieces: string[] = []): FakeMlc {
  const unload = vi.fn(async () => undefined);
  const interruptGenerate = vi.fn(async () => undefined);
  const engine = {
    unload,
    interruptGenerate,
    chat: {
      completions: {
        create: vi.fn(async () =>
          (async function* () {
            for (const piece of pieces) {
              yield { choices: [{ delta: { content: piece } }] };
            }
          })(),
        ),
      },
    },
  } as unknown as MLCEngine;
  return { engine, unload, interruptGenerate };
}

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
const DESKTOP_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';

let caches: ReturnType<typeof fakeCaches>;
let fetchMock: ReturnType<typeof vi.fn>;
type Create = NonNullable<Window['__refrainSheetWebLlm']>['CreateMLCEngine'];
let create: Mock<Create>;
let mlc: FakeMlc;

beforeEach(() => {
  caches = fakeCaches();
  vi.stubGlobal('caches', caches.storage);
  fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => [
      { path: 'README.md' },
      { path: 'mlc-chat-config.json' },
      { path: 'gemma3-270m-japanese-q4f32_1-ctx4k-webgpu.wasm' },
    ],
  }));
  vi.stubGlobal('fetch', fetchMock);
  mlc = fakeMlc();
  create = vi.fn<Create>(async () => mlc.engine);
  window.__refrainSheetWebLlm = { CreateMLCEngine: create };
  // The phone the default model is sized for; one test below is a desktop.
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(IPHONE_UA);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete window.__refrainSheetWebLlm;
  setAiModelForTests(null);
  document.head.textContent = '';
});

describe('which model the browser gets', () => {
  it('uses the Gemma model where WebGPU is available, and Qwen elsewhere', () => {
    vi.stubGlobal('navigator', { ...navigator, gpu: {} });
    expect(webGpuAvailable()).toBe(true);
    expect(aiModel()).toBe(GEMMA_MODEL);
    vi.stubGlobal('navigator', { ...navigator, gpu: undefined });
    expect(webGpuAvailable()).toBe(false);
    expect(aiModel()).toBe(QWEN_MODEL);
  });

  it('needs Cache Storage too, which only a secure context offers', () => {
    vi.stubGlobal('navigator', { ...navigator, gpu: {} });
    vi.stubGlobal('caches', undefined);
    expect(aiModel()).toBe(QWEN_MODEL);
  });

  it("bundles a WebLLM runtime that still links the default model's library", () => {
    // The model's compiled library imports TVM's threading functions; WebLLM
    // 0.2.85 and later no longer provide them, and the model then fails to
    // start ("import function env:_ZN3tvm7runtime9threading15ResetThreadPoolEv
    // must be callable"). See src/app/ai/webllm-runtime.ts.
    const runtime = readFileSync('node_modules/@mlc-ai/web-llm/lib/index.js', 'utf8');
    expect(runtime).toContain('_ZN3tvm7runtime9threading15ResetThreadPoolEv:');
    expect(runtime).toContain('_ZN3tvm7runtime9threading10NumThreadsEv:');
  });

  it('names the WebLLM runtime script by version under ai-runtime/', () => {
    expect(aiRuntimeFiles().webllmScript).toMatch(/^(\.\/|\/)?ai-runtime\/webllm-\d+\.\d+\.\d+\.js$/);
  });
});

describe('WebLLM engine', () => {
  it('reports no stored model, contacting nothing and loading no runtime', async () => {
    delete window.__refrainSheetWebLlm;
    expect(await new WebLlmEngine().isDownloaded()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.querySelector('script')).toBeNull();
  });

  it('reports a stored model only when every file is in storage', async () => {
    storeModel(caches.scopes, { skipShard: true });
    expect(await new WebLlmEngine().isDownloaded()).toBe(false);
    storeModel(caches.scopes);
    expect(await new WebLlmEngine().isDownloaded()).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('needs the SentencePiece tokenizer, so a copy stored with only tokenizer.json downloads it', async () => {
    storeModel(caches.scopes);
    caches.scopes.get('webllm/model')!.delete(`${BASE}tokenizer.model`);
    expect(await new WebLlmEngine().isDownloaded()).toBe(false);
  });

  it('downloads with the compiled library named in the repository', async () => {
    const engine = new WebLlmEngine();
    const progress = vi.fn();
    create.mockImplementationOnce(async (_id, config) => {
      config.initProgressCallback?.({ progress: 0.5, timeElapsed: 1, text: '' });
      return mlc.engine;
    });
    await engine.download(progress, new AbortController().signal);
    expect(fetchMock).toHaveBeenCalledWith(
      `https://huggingface.co/api/models/${GEMMA_MODEL.repo}/tree/main`,
      expect.anything(),
    );
    const [modelId, { appConfig }] = create.mock.calls[0];
    expect(modelId).toBe(GEMMA_MODEL.name);
    expect(appConfig.cacheBackend).toBe('cache');
    expect(appConfig.model_list).toEqual([
      {
        model: BASE,
        model_id: GEMMA_MODEL.name,
        model_lib: LIB,
        overrides: {
          context_window_size: 4096,
          sliding_window_size: -1,
          tokenizer_files: ['tokenizer.model'],
        },
      },
    ]);
    expect(progress).toHaveBeenCalledWith({
      loaded: GEMMA_MODEL.approxSizeMb * 500_000,
      total: GEMMA_MODEL.approxSizeMb * 1_000_000,
    });
    expect(engine.isLoaded()).toBe(true);
  });

  it('keeps the known library name when the repository list cannot be read', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await new WebLlmEngine().download(vi.fn(), new AbortController().signal);
    expect(create.mock.calls[0][1].appConfig.model_list[0].model_lib).toBe(LIB);
  });

  it('starts a stored model without contacting anything', async () => {
    storeModel(caches.scopes);
    const engine = new WebLlmEngine();
    await engine.load();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(create.mock.calls[0][1].appConfig.model_list[0].model_lib).toBe(LIB);
    expect(engine.isLoaded()).toBe(true);
  });

  it('refuses to start a model that is not fully stored, so a start never downloads', async () => {
    storeModel(caches.scopes, { skipShard: true });
    await expect(new WebLlmEngine().load()).rejects.toThrow('not downloaded');
    expect(create).not.toHaveBeenCalled();
  });

  it('caps the context window so the KV cache fits a phone', async () => {
    storeModel(caches.scopes);
    await new WebLlmEngine().load();
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][1].appConfig.model_list[0].overrides).toEqual({
      context_window_size: 4096,
      sliding_window_size: -1,
      tokenizer_files: ['tokenizer.model'],
    });
  });

  it("uses the model's tokenizer.json away from iPhone and iPad, and drops the unused SentencePiece copy", async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(DESKTOP_UA);
    storeModel(caches.scopes);
    expect(await new WebLlmEngine().isDownloaded()).toBe(true);
    caches.scopes.get('webllm/model')!.delete(`${BASE}tokenizer.json`);
    expect(await new WebLlmEngine().isDownloaded()).toBe(false);
    await new WebLlmEngine().download(vi.fn(), new AbortController().signal);
    expect(create.mock.calls[0][1].appConfig.model_list[0].overrides).toEqual({
      context_window_size: 4096,
      sliding_window_size: -1,
      tokenizer_files: ['tokenizer.json'],
    });
    expect([...caches.scopes.get('webllm/model')!.keys()]).not.toContain(`${BASE}tokenizer.model`);
  });

  it('stops a download when cancelled', async () => {
    let finish: (engine: MLCEngine) => void = () => undefined;
    create.mockImplementationOnce(() => new Promise<MLCEngine>((resolve) => (finish = resolve)));
    const abort = new AbortController();
    const engine = new WebLlmEngine();
    const download = engine.download(vi.fn(), abort.signal);
    await vi.waitFor(() => expect(create).toHaveBeenCalled());
    abort.abort();
    const error = await download.catch((e: unknown) => e);
    expect(isAbortError(error)).toBe(true);
    finish(mlc.engine);
    await vi.waitFor(() => expect(mlc.unload).toHaveBeenCalled());
    expect(engine.isLoaded()).toBe(false);
  });

  it('streams a reply, and stops generating when asked', async () => {
    storeModel(caches.scopes);
    mlc = fakeMlc(['Hello', ' world']);
    create.mockResolvedValue(mlc.engine);
    const engine = new WebLlmEngine();
    await engine.load();
    const pieces: string[] = [];
    const reply = await engine.chat(
      [{ role: 'user', content: 'hi' }],
      (p) => pieces.push(p),
      new AbortController().signal,
    );
    expect(reply).toBe('Hello world');
    expect(pieces).toEqual(['Hello', ' world']);

    const abort = new AbortController();
    abort.abort();
    const error = await engine
      .chat([{ role: 'user', content: 'hi' }], () => undefined, abort.signal)
      .catch((e: unknown) => e);
    expect(isAbortError(error)).toBe(true);
  });

  it('interrupts generation when the reply is stopped mid-way', async () => {
    storeModel(caches.scopes);
    const engine = new WebLlmEngine();
    await engine.load();
    const abort = new AbortController();
    const reply = engine.chat([{ role: 'user', content: 'hi' }], () => undefined, abort.signal);
    abort.abort();
    await reply.catch(() => undefined);
    expect(mlc.interruptGenerate).toHaveBeenCalled();
  });

  it('deletes everything WebLLM stored, and stops the model', async () => {
    storeModel(caches.scopes);
    const engine = new WebLlmEngine();
    await engine.load();
    await engine.deleteModel();
    expect(mlc.unload).toHaveBeenCalled();
    expect(engine.isLoaded()).toBe(false);
    expect(await engine.isDownloaded()).toBe(false);
    for (const scope of caches.scopes.values()) {
      expect(scope.size).toBe(0);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("clears an earlier model's leftovers before downloading, keeping this model's files", async () => {
    storeModel(caches.scopes, { skipShard: true });
    await new WebLlmEngine().download(vi.fn(), new AbortController().signal);
    const model = [...caches.scopes.get('webllm/model')!.keys()];
    expect(model).not.toContain('https://huggingface.co/other/model/resolve/main/tokenizer.json');
    expect(model).not.toContain(`${BASE}tokenizer.json`);
    expect(model).toContain(`${BASE}tokenizer.model`);
    expect(model).toContain(`${BASE}params_shard_0.bin`);
  });

  it('adds the runtime script from this origin only when the model is started', async () => {
    delete window.__refrainSheetWebLlm;
    storeModel(caches.scopes);
    const engine = new WebLlmEngine();
    const loading = engine.load();
    await vi.waitFor(() => expect(document.querySelector('script')).not.toBeNull());
    const script = document.querySelector('script')!;
    expect(script.src).toBe(new URL(aiRuntimeFiles().webllmScript, document.baseURI).href);
    window.__refrainSheetWebLlm = { CreateMLCEngine: create };
    script.dispatchEvent(new Event('load'));
    await loading;
    expect(engine.isLoaded()).toBe(true);
  });
});
