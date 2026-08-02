// SPDX-License-Identifier: MIT
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModelFileEntry } from '../src/app/llm/model-file-entry';

// A tiny stand-in for @wllama/wllama's embedded WASM payload (see
// scripts/embed-wllama-wasm.mjs) — the real one is ~10 MB of Base64 and
// would only slow this test down without exercising anything new.
vi.mock('../src/wllama-gen/wllama-wasm-payload', () => ({
  WLLAMA_WASM_BYTE_LENGTH: 4,
  WLLAMA_WASM_BASE64: 'ZmFrZQ==', // "fake"
}));

class FakeWllamaError extends Error {
  constructor(
    message: string,
    public type: string = 'unknown',
  ) {
    super(message);
    this.name = 'WllamaError';
  }
}

class FakeWllamaRuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WllamaRuntimeError';
  }
}

let loadModelImpl: (blobs: Blob[]) => Promise<void> = async () => {};
let exitImpl: () => Promise<void> = async () => {};

class FakeWllama {
  loadModel = vi.fn(async (blobs: Blob[]) => loadModelImpl(blobs));
  exit = vi.fn(async () => exitImpl());
  createChatCompletion = vi.fn(async (options: { onData?: (chunk: unknown) => void; stream?: boolean }) => {
    options.onData?.({ choices: [{ delta: { content: 'Hel' } }] });
    options.onData?.({ choices: [{ delta: { content: 'lo' } }] });
  });
}

vi.mock('@wllama/wllama', () => ({
  Wllama: FakeWllama,
  WllamaError: FakeWllamaError,
  WllamaRuntimeError: FakeWllamaRuntimeError,
}));

const { createWllamaEngine } = await import('../src/app/llm/wllama-engine');

// Base64 for "hello wllama gguf test payload" (30 bytes), matching the
// fixture used by tests/llm-reassemble-model-file.test.ts.
const MODEL_FILES: readonly ModelFileEntry[] = [
  {
    name: 'fixture.gguf',
    byteLength: 30,
    sha256: '39da836158336b9e939eba4aab2b6283be32d5ddbdc893c647b9f450cfe7b047',
    chunks: ['aGVsbG8gd2xsYW1hIGdndWYg', 'dGVzdCBwYXlsb2Fk'],
  },
];

describe('createWllamaEngine', () => {
  afterEach(() => {
    loadModelImpl = async () => {};
    exitImpl = async () => {};
    vi.restoreAllMocks();
  });

  it('is not installed until installLlm() resolves, then reports installed', async () => {
    const engine = createWllamaEngine(MODEL_FILES);
    expect(engine.isLlmInstalled()).toBe(false);
    await engine.installLlm();
    expect(engine.isLlmInstalled()).toBe(true);
  });

  it('reports reassembly progress before loading, then the wasm runtime', async () => {
    const engine = createWllamaEngine(MODEL_FILES);
    const stages: string[] = [];
    await engine.installLlm((p) => stages.push(`${p.stage}:${p.text}`));
    expect(stages).toEqual(['preparing:fixture.gguf (1/1)', 'loading:wllama.wasm', 'loading:wllama.wasm']);
  });

  it('streams tokens via onToken and resolves with the full reply', async () => {
    const engine = createWllamaEngine(MODEL_FILES);
    await engine.installLlm();
    const deltas: string[] = [];
    const reply = await engine.askLlm('hi', undefined, (delta) => deltas.push(delta));
    expect(deltas).toEqual(['Hel', 'lo']);
    expect(reply).toBe('Hello');
  });

  it('rejects askLlm() before installLlm() has completed', async () => {
    const engine = createWllamaEngine(MODEL_FILES);
    await expect(engine.askLlm('hi')).rejects.toThrow(/installLlm/);
  });

  it('revokes the wasm Blob URL on uninstallLlm() and allows reinstalling', async () => {
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');
    const engine = createWllamaEngine(MODEL_FILES);
    await engine.installLlm();
    expect(revokeSpy).not.toHaveBeenCalled();

    await engine.uninstallLlm?.();
    expect(engine.isLlmInstalled()).toBe(false);
    expect(revokeSpy).toHaveBeenCalledTimes(1);

    await engine.installLlm();
    expect(engine.isLlmInstalled()).toBe(true);
  });

  it('describes a WllamaRuntimeError as a possible out-of-memory failure', async () => {
    loadModelImpl = async () => {
      throw new FakeWllamaRuntimeError('abort()');
    };
    const engine = createWllamaEngine(MODEL_FILES);
    await expect(engine.installLlm()).rejects.toThrow(/insufficient memory/);
  });

  it('describes a WllamaError with its type', async () => {
    loadModelImpl = async () => {
      throw new FakeWllamaError('bad gguf header', 'load-error');
    };
    const engine = createWllamaEngine(MODEL_FILES);
    await expect(engine.installLlm()).rejects.toThrow(/load-error/);
  });

  it('allows retrying installLlm() after a failed attempt', async () => {
    loadModelImpl = async () => {
      throw new Error('transient failure');
    };
    const engine = createWllamaEngine(MODEL_FILES);
    await expect(engine.installLlm()).rejects.toThrow('transient failure');
    expect(engine.isLlmInstalled()).toBe(false);

    loadModelImpl = async () => {};
    await engine.installLlm();
    expect(engine.isLlmInstalled()).toBe(true);
  });
});
