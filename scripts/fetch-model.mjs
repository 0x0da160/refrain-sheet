// SPDX-License-Identifier: MIT
// Download every vendored local-assistant model into .model-cache/
// (gitignored). See scripts/model-catalog.mjs for the list of models, their
// upstream repos, and why each file is or isn't fetched; see
// docs/llm-model.md for the attribution and usage-policy obligations each
// model's license carries into the app.
//
// Not run in CI — the generated src/llm-gen/ output (see
// scripts/embed-model.mjs) is committed, mirroring how src/wasm-gen/ is
// produced by scripts/embed-wasm.mjs from a local Rust build rather than
// rebuilt on every CI run.
//
// Fetches every model in scripts/model-catalog.mjs by default; pass a
// model `key` as the first CLI argument to fetch only that one (useful when
// refreshing a single model without re-downloading every other one already
// vendored).

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODELS } from './model-catalog.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const onlyKey = process.argv[2];
const targets = onlyKey ? MODELS.filter((m) => m.key === onlyKey) : MODELS;
if (onlyKey && targets.length === 0) {
  console.error(`fetch-model: no model with key "${onlyKey}" in scripts/model-catalog.mjs`);
  process.exit(1);
}

async function fetchFile(url, outPath) {
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`fetch-model: failed to fetch ${url}: ${res.status} ${res.statusText}`);
    process.exit(1);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  writeFileSync(outPath, bytes);
  console.warn(`fetch-model: wrote ${outPath} (${bytes.length} bytes)`);
}

for (const model of targets) {
  const outDir = join(root, '.model-cache', model.cacheDirName ?? '.');
  mkdirSync(outDir, { recursive: true });
  const base = `https://huggingface.co/${model.huggingFaceRepo}/resolve/main`;

  console.warn(
    `fetch-model: [${model.key}] downloading ${model.files.length} file(s) from ${model.huggingFaceRepo}...`,
  );
  for (const file of model.files) {
    await fetchFile(`${base}/${file}`, join(outDir, file));
  }

  if (model.wasmUrl) {
    console.warn(`fetch-model: [${model.key}] downloading compiled WASM kernel...`);
    await fetchFile(model.wasmUrl, join(outDir, model.wasmFileName));
  }
}

console.warn(`fetch-model: done. Run \`npm run embed:model\` next.`);
