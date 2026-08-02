// SPDX-License-Identifier: MIT
/**
 * Shape of one entry in a vendored model's generated manifest
 * (`src/llm-gen/<model>/model-manifest.ts`, written by
 * scripts/embed-model.mjs). Hand-written and shared so every per-model
 * manifest imports the same type instead of each redeclaring it, and so
 * generic code (src/app/llm/cache-prepopulate.ts) can depend on this shape
 * without importing any specific model's generated payload.
 */
export interface ModelFileEntry {
  readonly name: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly chunks: readonly string[];
}
