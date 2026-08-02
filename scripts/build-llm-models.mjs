// SPDX-License-Identifier: MIT
// Runs one `vite build --config vite.llm.config.ts` pass per local-assistant
// model in scripts/model-catalog.mjs (see package.json's `build` script),
// but skips a model's pass — and reuses its last output instead — when
// nothing that pass reads has changed since the last successful build.
//
// Each vendored model's payload is 100-350 MB (see scripts/embed-model.mjs),
// and reprocessing it with Rollup is the majority of `npm run build`'s
// wall-clock time even when the model itself never changed (Issue #175).
// This is a pure speed optimization: skipping a pass never changes what ends
// up in dist/, only whether it is recomputed. The cache lives in
// .llm-build-cache/ (gitignored, like .model-cache/) rather than dist/
// itself, because the main `vite build` pass (vite.config.ts) empties
// dist/ on every run (Vite's default `emptyOutDir` for an in-root outDir) —
// so a previous pass's dist/ output never survives to be compared against.
//
// "Up to date" compares mtimes only (no content hashing of the multi-hundred-
// MB payloads): a model's pass is skipped when its cached output is newer
// than every input the pass reads. A fresh checkout has no
// .llm-build-cache/, so the first build after `npm ci` always runs every
// pass, exactly as before this script existed.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODELS } from './model-catalog.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cacheRoot = join(root, '.llm-build-cache');
const vite = join(root, 'node_modules', '.bin', 'vite');

// Build-time inputs shared by every model's pass, beyond the model's own
// generated payload and entry point.
const SHARED_INPUTS = [
  'vite.llm.config.ts',
  'src/app/llm/model-catalog.ts',
  'src/app/llm/engine.ts',
  'src/app/llm/wllama-engine.ts',
  'src/app/llm/model-file-entry.ts',
  'package-lock.json',
].map((p) => join(root, p));

export function newestMtimeMs(path) {
  const stat = statSync(path);
  if (!stat.isDirectory()) {
    return stat.mtimeMs;
  }
  let newest = stat.mtimeMs;
  for (const entry of readdirSync(path)) {
    const childMs = newestMtimeMs(join(path, entry));
    if (childMs > newest) newest = childMs;
  }
  return newest;
}

/**
 * `cachedInputMs` is the fingerprinted input timestamp recorded the last
 * time this model was built (`null` when there is no usable cache entry).
 * `newestInputMs` is the same measurement freshly recomputed now.
 */
export function isCacheFresh(cachedInputMs, newestInputMs) {
  return cachedInputMs !== null && cachedInputMs >= newestInputMs;
}

function buildOne(model) {
  const entryFile = join(root, 'src', 'app', 'llm', `engine-entry.${model.key}.ts`);
  const genOutDir = join(root, 'src', 'llm-gen', model.genDirName ?? '.');
  const manifestFile = join(genOutDir, 'model-manifest.ts');
  const payloadDir = join(genOutDir, 'model-payload');

  const outputFileName = `llm-engine.${model.key}.js`;
  const distOutput = join(root, 'dist', 'assets', outputFileName);
  const cacheDir = join(cacheRoot, model.key);
  const cacheOutput = join(cacheDir, outputFileName);
  const fingerprintFile = join(cacheDir, 'fingerprint.json');

  const newestInputMs = Math.max(
    ...[entryFile, manifestFile, payloadDir, ...SHARED_INPUTS].map(newestMtimeMs),
  );

  let cachedInputMs = null;
  if (existsSync(cacheOutput) && existsSync(fingerprintFile)) {
    try {
      cachedInputMs = JSON.parse(readFileSync(fingerprintFile, 'utf8')).newestInputMs;
    } catch {
      cachedInputMs = null;
    }
  }

  if (isCacheFresh(cachedInputMs, newestInputMs)) {
    console.warn(`build-llm-models: [${model.key}] up to date, reusing cached build`);
    mkdirSync(dirname(distOutput), { recursive: true });
    copyFileSync(cacheOutput, distOutput);
    return;
  }

  console.warn(`build-llm-models: [${model.key}] building...`);
  execFileSync(vite, ['build', '--config', 'vite.llm.config.ts'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=8192', LLM_MODEL_KEY: model.key },
  });

  mkdirSync(cacheDir, { recursive: true });
  copyFileSync(distOutput, cacheOutput);
  writeFileSync(fingerprintFile, JSON.stringify({ newestInputMs }) + '\n');
}

// Only run as the build CLI when invoked directly (e.g.
// `node scripts/build-llm-models.mjs`), not when imported — this lets tests
// exercise pure helpers like isCacheFresh without triggering real builds.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const model of MODELS) {
    buildOne(model);
  }
}
