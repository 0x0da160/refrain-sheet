// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { createModelSource } from '../src/app/llm/model-source';
import { MODEL_FILES as GEMMA3_FILES } from '../src/llm-gen/model-manifest';
import { MODEL_FILES as SMOLLM2_FILES } from '../src/llm-gen/smollm2-135m-instruct/model-manifest';

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Reassemble one embedded model file's chunks back into its original text, as `cache-prepopulate.ts` does. */
function readEmbeddedFile(
  files: readonly { name: string; chunks: readonly string[] }[],
  name: string,
): string {
  const entry = files.find((file) => file.name === name);
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

describe('createModelSource', () => {
  it('scopes every URL under a base URL keyed by the model, so two models never collide', () => {
    const gemma3 = createModelSource({
      key: 'gemma3-270m-ja',
      modelId: 'gemma3-270m-japanese-webllm-04-q4f32_1',
      wasmFileName: 'gemma3-270m-japanese-q4f32_1-ctx4k-webgpu.wasm',
    });
    const smollm2 = createModelSource({
      key: 'smollm2-135m-instruct',
      modelId: 'SmolLM2-135M-Instruct-q0f16-MLC',
      wasmFileName: 'SmolLM2-135M-Instruct-q0f16_cs1k-webgpu.wasm',
    });
    expect(gemma3.configUrl).not.toBe(smollm2.configUrl);
    expect(gemma3.modelLibUrl).not.toBe(smollm2.modelLibUrl);
    expect(gemma3.appConfig.model_list[0]?.model_id).toBe('gemma3-270m-japanese-webllm-04-q4f32_1');
    expect(smollm2.appConfig.model_list[0]?.model_id).toBe('SmolLM2-135M-Instruct-q0f16-MLC');
  });

  it('replaces (not merges with) the built-in prebuilt model list, exposing exactly one model', () => {
    const source = createModelSource({
      key: 'gemma3-270m-ja',
      modelId: 'gemma3-270m-japanese-webllm-04-q4f32_1',
      wasmFileName: 'gemma3-270m-japanese-q4f32_1-ctx4k-webgpu.wasm',
    });
    expect(source.appConfig.model_list).toHaveLength(1);
    expect(source.appConfig.cacheBackend).toBe('cache');
  });

  it('overrides sliding_window_size to -1 for gemma3-270m-ja, correcting the vendored config defect', () => {
    const source = createModelSource({
      key: 'gemma3-270m-ja',
      modelId: 'gemma3-270m-japanese-webllm-04-q4f32_1',
      wasmFileName: 'gemma3-270m-japanese-q4f32_1-ctx4k-webgpu.wasm',
      overrides: { sliding_window_size: -1 },
    });
    expect(source.appConfig.model_list[0]?.overrides?.sliding_window_size).toBe(-1);

    // Mirrors how `@mlc-ai/web-llm`'s engine merges the fetched mlc-chat-config.json with
    // `ModelRecord.overrides` before validating it (`Object.assign({}, config, overrides)`,
    // see `LLMChatPipeline`'s constructor). Both fields positive at once throws
    // `WindowSizeConfigurationError` at model-load time — see issue #147.
    const vendoredConfig = JSON.parse(readEmbeddedFile(GEMMA3_FILES, 'mlc-chat-config.json')) as {
      context_window_size: number;
      sliding_window_size: number;
    };
    const merged = { ...vendoredConfig, ...source.appConfig.model_list[0]?.overrides };
    const positiveWindowCount = [merged.context_window_size, merged.sliding_window_size].filter(
      (size) => size !== -1,
    ).length;
    expect(positiveWindowCount).toBe(1);
    expect(merged.context_window_size).toBe(8192);
    expect(merged.sliding_window_size).toBe(-1);
  });

  it('needs no sliding_window_size override for smollm2-135m-instruct, whose vendored config already has exactly one positive window size', () => {
    const vendoredConfig = JSON.parse(readEmbeddedFile(SMOLLM2_FILES, 'mlc-chat-config.json')) as {
      context_window_size: number;
      sliding_window_size: number;
    };
    const positiveWindowCount = [
      vendoredConfig.context_window_size,
      vendoredConfig.sliding_window_size,
    ].filter((size) => size !== -1).length;
    expect(positiveWindowCount).toBe(1);
  });
});
