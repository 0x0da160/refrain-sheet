// SPDX-License-Identifier: MIT
/**
 * Capability check for the local AI assistant, kept dependency-free and
 * separate from engine.ts so callers can decide whether to show the
 * install UI without pulling in the embedded model payload — see
 * src/app/llm/engine.ts and docs/llm-model.md.
 */

export type LlmAvailability = 'available' | 'no-webgpu' | 'no-cache-storage';

/** Whether this browser can plausibly run the local assistant, without starting it. */
export function checkLlmAvailability(): LlmAvailability {
  if (typeof caches === 'undefined') {
    return 'no-cache-storage';
  }
  if (typeof navigator === 'undefined' || !('gpu' in navigator) || !navigator.gpu) {
    return 'no-webgpu';
  }
  return 'available';
}
