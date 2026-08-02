// SPDX-License-Identifier: MIT
// Shared registry of every vendored local-assistant model, read by both
// scripts/fetch-model.mjs and scripts/embed-model.mjs so the two stay in
// sync. See docs/llm-model.md for what "vendoring" means here and why it
// needs explicit human sign-off per model. The runtime-side mirror of this
// data (used by the app itself, not these Node scripts) is
// src/app/llm/model-catalog.ts — hand-written, not generated, since it must
// not depend on Node built-ins; keep the two in sync by hand when adding a
// model.
//
// `cacheDirName`/`genDirName` of `null` means the legacy flat layout used by
// the original model, predating this catalog: `.model-cache/` and
// `src/llm-gen/` directly, rather than a per-model subdirectory. Left as-is
// so re-running these scripts for that model never recommits byte-identical
// content under a new path.

export const MODELS = [
  {
    key: 'gemma3-270m-ja',
    cacheDirName: null,
    genDirName: null,
    // https://huggingface.co/UMASHIKA/gemma3-270m-japanese-webllm-04
    huggingFaceRepo: 'UMASHIKA/gemma3-270m-japanese-webllm-04',
    // Only 8 of the upstream repo's files — see scripts/embed-model.mjs for
    // why `tokenizer.model`, `tokenizer_config.json`, `added_tokens.json`,
    // and the `bf16` tensor-cache manifest are not vendored. The compiled
    // WASM kernel is published in this same repo, so it is just the last
    // entry in `files` rather than a separate `wasmUrl`.
    files: [
      'mlc-chat-config.json',
      'tensor-cache.json',
      'params_shard_0.bin',
      'params_shard_1.bin',
      'params_shard_2.bin',
      'params_shard_3.bin',
      'tokenizer.json',
      'gemma3-270m-japanese-q4f32_1-ctx4k-webgpu.wasm',
    ],
    wasmFileName: 'gemma3-270m-japanese-q4f32_1-ctx4k-webgpu.wasm',
    wasmUrl: null,
  },
  {
    key: 'smollm2-135m-instruct',
    cacheDirName: 'smollm2-135m-instruct',
    genDirName: 'smollm2-135m-instruct',
    // https://huggingface.co/mlc-ai/SmolLM2-135M-Instruct-q0f16-MLC
    huggingFaceRepo: 'mlc-ai/SmolLM2-135M-Instruct-q0f16-MLC',
    // `mlc-chat-config.json`'s `tokenizer_files` lists `tokenizer.json`
    // first, and `@mlc-ai/web-llm`'s `asyncLoadTokenizer()` (read from its
    // published lib/index.js, same as gemma3-270m-ja) uses `tokenizer.json`
    // whenever it is listed — so `vocab.json`, `merges.txt`, and
    // `tokenizer_config.json` (also listed, for non-WebLLM MLC runtimes)
    // are never requested at runtime and are not vendored.
    files: [
      'mlc-chat-config.json',
      'tensor-cache.json',
      'params_shard_0.bin',
      'params_shard_1.bin',
      'params_shard_2.bin',
      'params_shard_3.bin',
      'params_shard_4.bin',
      'params_shard_5.bin',
      'params_shard_6.bin',
      'params_shard_7.bin',
      'tokenizer.json',
    ],
    // Unlike gemma3-270m-ja, this repo does not publish its own compiled
    // WASM kernel — MLC ships prebuilt WebGPU kernels separately, keyed by
    // WebLLM release, in mlc-ai/binary-mlc-llm-libs. This exact URL is read
    // from @mlc-ai/web-llm@0.2.84's own published `prebuiltAppConfig`
    // (lib/index.js: `modelLibURLPrefix + modelVersion + "/<name>.wasm"`,
    // where modelVersion is `"v0_2_84/base"`), the same file
    // docs/llm-model.md already reads for cache-lookup internals.
    wasmFileName: 'SmolLM2-135M-Instruct-q0f16_cs1k-webgpu.wasm',
    wasmUrl:
      'https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/SmolLM2-135M-Instruct-q0f16_cs1k-webgpu.wasm',
  },
];
