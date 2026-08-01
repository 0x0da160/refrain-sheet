// SPDX-License-Identifier: MIT
import { afterEach, describe, expect, it } from 'vitest';
import { checkLlmAvailability } from '../src/app/llm/availability';

describe('checkLlmAvailability', () => {
  afterEach(() => {
    delete (globalThis as { caches?: unknown }).caches;
    delete (globalThis as { navigator?: unknown }).navigator;
  });

  it('reports no-cache-storage when Cache Storage is unavailable', () => {
    delete (globalThis as { caches?: unknown }).caches;
    expect(checkLlmAvailability()).toBe('no-cache-storage');
  });

  it('reports no-webgpu when Cache Storage exists but navigator.gpu does not', () => {
    (globalThis as unknown as { caches: unknown }).caches = {};
    (globalThis as unknown as { navigator: unknown }).navigator = {};
    expect(checkLlmAvailability()).toBe('no-webgpu');
  });

  it('reports available when both Cache Storage and navigator.gpu exist', () => {
    (globalThis as unknown as { caches: unknown }).caches = {};
    (globalThis as unknown as { navigator: unknown }).navigator = { gpu: {} };
    expect(checkLlmAvailability()).toBe('available');
  });
});
