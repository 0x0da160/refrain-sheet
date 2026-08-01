// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { MODEL_APP_CONFIG, MODEL_ID } from '../src/app/llm/model-source';
import { MODEL_FILES } from '../src/llm-gen/model-manifest';

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Reassemble one embedded model file's chunks back into its original text, as `cache-prepopulate.ts` does. */
function readEmbeddedFile(name: string): string {
  const entry = MODEL_FILES.find((file) => file.name === name);
  if (!entry) throw new Error(`no embedded model file named "${name}"`);
  const parts = entry.chunks.map((chunk) => decodeBase64(chunk));
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const bytes = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return new TextDecoder().decode(bytes);
}

describe('MODEL_APP_CONFIG', () => {
  it('overrides sliding_window_size to -1 for the vendored model', () => {
    const entry = MODEL_APP_CONFIG.model_list.find((model) => model.model_id === MODEL_ID);
    expect(entry?.overrides.sliding_window_size).toBe(-1);
  });

  it('produces a merged chat config with exactly one positive window size, as `@mlc-ai/web-llm` requires', () => {
    // Mirrors how `@mlc-ai/web-llm`'s engine merges the fetched mlc-chat-config.json with
    // `ModelRecord.overrides` before validating it (`Object.assign({}, config, overrides)`,
    // see `LLMChatPipeline`'s constructor). Both fields positive at once throws
    // `WindowSizeConfigurationError` at model-load time — see issue #147.
    const vendoredConfig = JSON.parse(readEmbeddedFile('mlc-chat-config.json')) as {
      context_window_size: number;
      sliding_window_size: number;
    };
    const entry = MODEL_APP_CONFIG.model_list.find((model) => model.model_id === MODEL_ID);
    const merged = { ...vendoredConfig, ...entry?.overrides };

    const positiveWindowCount = [merged.context_window_size, merged.sliding_window_size].filter(
      (size) => size !== -1,
    ).length;
    expect(positiveWindowCount).toBe(1);
    expect(merged.context_window_size).toBe(8192);
    expect(merged.sliding_window_size).toBe(-1);
  });
});
