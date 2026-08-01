// SPDX-License-Identifier: MIT
// Download the vendored local-assistant model into .model-cache/ (gitignored).
//
// Source: https://huggingface.co/UMASHIKA/gemma3-270m-japanese-webllm-04
// A Japanese fine-tune of Google's Gemma 3 270M, converted to MLC-LLM/WebLLM
// format. The base model is distributed under Google's Gemma Terms of Use
// (https://ai.google.dev/gemma/terms), not a standard OSS license — see
// docs/llm-model.md for the attribution and usage-policy obligations this
// carries into the app.
//
// This script only fetches the 8 files `scripts/embed-model.mjs` actually
// needs (see that script for why `tokenizer.model`, `tokenizer_config.json`,
// `added_tokens.json` and `tensor-cache-b16.json` are not vendored). It is
// not run in CI — the generated src/llm-gen/ output is committed, mirroring
// how src/wasm-gen/ is produced by scripts/embed-wasm.mjs from a local Rust
// build rather than rebuilt on every CI run.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, '.model-cache');

const REPO = 'UMASHIKA/gemma3-270m-japanese-webllm-04';
const BASE = `https://huggingface.co/${REPO}/resolve/main`;

const FILES = [
  'mlc-chat-config.json',
  'tensor-cache.json',
  'params_shard_0.bin',
  'params_shard_1.bin',
  'params_shard_2.bin',
  'params_shard_3.bin',
  'tokenizer.json',
  'gemma3-270m-japanese-q4f32_1-ctx4k-webgpu.wasm',
];

mkdirSync(outDir, { recursive: true });

for (const file of FILES) {
  const url = `${BASE}/${file}`;
  console.warn(`fetch-model: downloading ${file}...`);
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`fetch-model: failed to fetch ${url}: ${res.status} ${res.statusText}`);
    process.exit(1);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  writeFileSync(join(outDir, file), bytes);
  console.warn(`fetch-model: wrote ${file} (${bytes.length} bytes)`);
}

console.warn(`fetch-model: done. Run \`npm run embed:model\` next.`);
