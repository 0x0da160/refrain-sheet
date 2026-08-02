// SPDX-License-Identifier: MIT
import { afterEach, describe, expect, it } from 'vitest';
import { checkLlmAvailability } from '../src/app/llm/availability';

describe('checkLlmAvailability', () => {
  afterEach(() => {
    delete (globalThis as { caches?: unknown }).caches;
    delete (globalThis as { navigator?: unknown }).navigator;
    delete (globalThis as { Worker?: unknown }).Worker;
  });

  describe("engine: 'webllm'", () => {
    it('reports no-cache-storage when Cache Storage is unavailable', () => {
      delete (globalThis as { caches?: unknown }).caches;
      expect(checkLlmAvailability('webllm')).toBe('no-cache-storage');
    });

    it('reports no-webgpu when Cache Storage exists but navigator.gpu does not', () => {
      (globalThis as unknown as { caches: unknown }).caches = {};
      (globalThis as unknown as { navigator: unknown }).navigator = {};
      expect(checkLlmAvailability('webllm')).toBe('no-webgpu');
    });

    it('reports available when both Cache Storage and navigator.gpu exist', () => {
      (globalThis as unknown as { caches: unknown }).caches = {};
      (globalThis as unknown as { navigator: unknown }).navigator = { gpu: {} };
      expect(checkLlmAvailability('webllm')).toBe('available');
    });
  });

  describe("engine: 'wllama'", () => {
    it('reports no-wasm-worker when Worker is unavailable, regardless of WebGPU/Cache Storage', () => {
      delete (globalThis as { Worker?: unknown }).Worker;
      expect(checkLlmAvailability('wllama')).toBe('no-wasm-worker');
    });

    it('reports available when WebAssembly and Worker both exist, even without WebGPU/Cache Storage', () => {
      delete (globalThis as { caches?: unknown }).caches;
      delete (globalThis as { navigator?: unknown }).navigator;
      (globalThis as unknown as { Worker: unknown }).Worker = class {};
      expect(checkLlmAvailability('wllama')).toBe('available');
    });
  });
});
