// SPDX-License-Identifier: MIT
// Build validation for the embedded-WASM distribution.
//
// Asserts that dist/ is self-contained for file:// usage:
//   1. no .wasm file is shipped or referenced — the WASM binary must be
//      embedded in the JS bundle as Base64,
//   2. the embedded payload and the local instantiation path are present,
//   3. no URL-based WASM fallback survived into the bundle,
//   4. the CSP allows WebAssembly ('wasm-unsafe-eval') and the in-memory
//      'blob:' scheme the @wllama/wllama local-assistant engine needs
//      (see index.html and docs/llm-model.md), but no real network origin
//      (no 'http:'/'https:' in connect-src, worker-src, or script-src).

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

let failures = 0;
const fail = (msg) => {
  failures += 1;
  console.error(`check-dist: FAIL: ${msg}`);
};
const ok = (msg) => console.warn(`check-dist: ok: ${msg}`);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      out.push(...walk(path));
    } else {
      out.push(path);
    }
  }
  return out;
}

const files = walk(dist);

// 1. No .wasm asset may ship with the distribution.
const wasmFiles = files.filter((f) => f.endsWith('.wasm'));
if (wasmFiles.length > 0) {
  fail(`found .wasm files in dist/: ${wasmFiles.join(', ')} — the binary must be embedded`);
} else {
  ok('no separate .wasm asset in dist/');
}

// Checks 2 and 3 below are about the Rust/WASM core, which is only ever
// embedded in the main application bundle (vite.config.ts) — never in a
// per-model `llm-engine.<key>.js` bundle (vite.llm.config.ts, see
// docs/llm-model.md), which embeds a vendored AI model's own Base64 payload
// instead. Those are excluded here: concatenating every vendored model's
// multi-hundred-MB bundle alongside the main one is unnecessary for these
// checks and, with more than one large model, has exceeded V8's maximum
// string length (`RangeError: Invalid string length`).
const jsFiles = files.filter((f) => f.endsWith('.js') && !/[/\\]llm-engine\./.test(f));
if (jsFiles.length === 0) {
  fail('no JS bundle found in dist/');
}
const bundle = jsFiles.map((f) => readFileSync(f, 'utf8')).join('\n');

// 2. The embedded Base64 payload and instantiation markers must be present.
const payload = readFileSync(join(root, 'src', 'wasm-gen', 'wasm-payload.ts'), 'utf8');
const base64 = /WASM_BASE64\s*=\s*\n?\s*'([^']+)'/.exec(payload)?.[1];
if (!base64) {
  fail('could not read the Base64 payload from src/wasm-gen/wasm-payload.ts');
} else if (!bundle.includes(base64.slice(0, 512)) || !bundle.includes(base64.slice(-512))) {
  fail('the embedded WASM Base64 payload is missing from the JS bundle');
} else {
  ok(`embedded WASM payload present in the bundle (${base64.length} Base64 chars)`);
}

// 3. No URL-based .wasm reference may survive in the bundle.
if (/_bg\.wasm/.test(bundle)) {
  fail('the bundle still references a refrain_csv_core_bg.wasm URL');
} else {
  ok('no URL reference to a .wasm file in the bundle');
}

// 4. index.html: CSP must allow WebAssembly locally and forbid connections.
const indexHtml = readFileSync(join(dist, 'index.html'), 'utf8');
if (!indexHtml.includes('wasm-unsafe-eval')) {
  fail("index.html CSP is missing 'wasm-unsafe-eval' (WebAssembly would be blocked)");
} else {
  ok("CSP allows local WebAssembly compilation ('wasm-unsafe-eval')");
}
// `connect-src` must permit only the in-memory 'blob:' scheme (needed by the
// @wllama/wllama engine's own Worker/WASM/model loading, all built from
// embedded bytes this app already vendored — never fetched) and no real
// network origin. A bare `connect-src 'none'` would also be a pass by this
// same logic, so this check accepts either exact directive rather than
// hard-coding one, as long as neither ever names an 'http:'/'https:' source.
const cspMatch = /content="([^"]*)"/.exec(indexHtml);
const csp = cspMatch?.[1] ?? '';
const connectSrcMatch = /connect-src\s+([^;]+);/.exec(csp);
const connectSrc = connectSrcMatch?.[1]?.trim();
if (connectSrc !== "'none'" && connectSrc !== 'blob:') {
  fail(`index.html CSP's connect-src is "${connectSrc ?? '(missing)'}", expected "'none'" or "blob:"`);
} else {
  ok(`CSP forbids real network connections (connect-src ${connectSrc})`);
}
if (/(?:connect|worker|script)-src[^;]*\bhttps?:/.test(csp)) {
  fail('index.html CSP names an http:/https: source — the offline guarantee requires none');
} else {
  ok('CSP names no http:/https: source anywhere');
}
if (/<script[^>]*type="module"/.test(indexHtml)) {
  fail('index.html still uses a module script (breaks file:// in Chromium)');
} else {
  ok('index.html uses classic scripts (file:// compatible)');
}

if (failures > 0) {
  console.error(`check-dist: ${failures} failure(s)`);
  process.exit(1);
}
console.warn('check-dist: distribution is self-contained (embedded WASM, no external fetches)');
