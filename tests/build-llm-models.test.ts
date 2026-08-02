// SPDX-License-Identifier: MIT
// Guards the LLM model build cache's freshness check (Issue #175): each
// vendored model's `vite.llm.config.ts` pass should be skipped only when a
// previous build's fingerprinted input timestamp is at least as new as the
// freshly recomputed one.
import { describe, expect, it } from 'vitest';
import { isCacheFresh } from '../scripts/build-llm-models.mjs';

describe('isCacheFresh', () => {
  it('is stale when there is no cache entry', () => {
    expect(isCacheFresh(null, 100)).toBe(false);
  });

  it('is fresh when the cached input timestamp is at least as new as the current one', () => {
    expect(isCacheFresh(100, 100)).toBe(true);
    expect(isCacheFresh(200, 100)).toBe(true);
  });

  it('is stale when an input changed after the cached build', () => {
    expect(isCacheFresh(100, 200)).toBe(false);
  });
});
