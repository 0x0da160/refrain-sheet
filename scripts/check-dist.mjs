// SPDX-License-Identifier: MIT
// Build validation for the embedded-WASM distribution.
//
// Asserts that dist/ is self-contained for file:// usage, for both embedded
// WASM binaries — the Rust performance core (refrain_csv_core) and the
// sql.js (SQLite) engine behind Data > Run SQL Query…:
//   1. no .wasm file is shipped or referenced — the WASM binaries must be
//      embedded in the JS bundle as Base64,
//   2. each embedded payload and its local instantiation path are present,
//   3. no URL-based WASM fallback survived into the bundle,
//   4. the CSP allows WebAssembly ('wasm-unsafe-eval') but no real network
//      origin (no 'http:'/'https:' in connect-src, worker-src, or script-src).

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

// Checks 2 and 3 below are about the two embedded WASM binaries, both bundled
// into the main application bundle (vite.config.ts): the Rust/WASM core and
// the sql.js (SQLite) engine.
const jsFiles = files.filter((f) => f.endsWith('.js'));
if (jsFiles.length === 0) {
  fail('no JS bundle found in dist/');
}
const bundle = jsFiles.map((f) => readFileSync(f, 'utf8')).join('\n');

// 2. Each embedded Base64 payload must be present in the bundle.
function checkEmbeddedPayload(label, payloadPath, base64Marker) {
  const payload = readFileSync(join(root, ...payloadPath), 'utf8');
  const base64 = new RegExp(`${base64Marker}\\s*=\\s*\\n?\\s*'([^']+)'`).exec(payload)?.[1];
  if (!base64) {
    fail(`could not read the Base64 payload from ${payloadPath.join('/')}`);
  } else if (!bundle.includes(base64.slice(0, 512)) || !bundle.includes(base64.slice(-512))) {
    fail(`the embedded ${label} Base64 payload is missing from the JS bundle`);
  } else {
    ok(`embedded ${label} payload present in the bundle (${base64.length} Base64 chars)`);
  }
}
checkEmbeddedPayload('WASM', ['src', 'wasm-gen', 'wasm-payload.ts'], 'WASM_BASE64');
checkEmbeddedPayload('sql.js WASM', ['src', 'wasm-gen', 'sqljs-wasm-payload.ts'], 'SQLJS_WASM_BASE64');

// 3. No URL-based .wasm reference may survive in the bundle, for the Rust
// core's own generated glue code (unlike sql.js below, wasm-bindgen's
// `--target web` output has no URL-fallback path at all once bytes are
// passed directly, so this string's mere presence is a reliable signal).
if (/_bg\.wasm/.test(bundle)) {
  fail('the bundle still references a refrain_csv_core_bg.wasm URL');
} else {
  ok('no URL reference to a .wasm file in the bundle');
}

// 3b. sql.js's vendored runtime (node_modules/sql.js/dist/sql-wasm.js) keeps
// a `locateFile()`/fetch fallback path for when no `wasmBinary` is supplied,
// so the literal string "sql-wasm.wasm" is always present in the bundle
// regardless of how we call it — scanning the bundle for it would be a
// false positive, not a real signal. What actually matters is that *our*
// call site never takes that fallback path: it must pass `wasmBinary` and
// must never pass `locateFile`.
const sqlEngineSource = readFileSync(join(root, 'src', 'core', 'sql-engine.ts'), 'utf8');
if (!/initSqlJs\(\{\s*wasmBinary:/.test(sqlEngineSource)) {
  fail(
    'src/core/sql-engine.ts no longer calls initSqlJs with wasmBinary — sql.js could fall back to a network fetch',
  );
} else if (/\blocateFile\s*:/.test(sqlEngineSource)) {
  fail(
    'src/core/sql-engine.ts sets locateFile() — sql.js must only load the embedded wasmBinary, never a URL',
  );
} else {
  ok('sql.js is instantiated only from the embedded wasmBinary (no locateFile fallback)');
}

// 4. index.html: CSP must allow WebAssembly locally and forbid connections.
const indexHtml = readFileSync(join(dist, 'index.html'), 'utf8');
if (!indexHtml.includes('wasm-unsafe-eval')) {
  fail("index.html CSP is missing 'wasm-unsafe-eval' (WebAssembly would be blocked)");
} else {
  ok("CSP allows local WebAssembly compilation ('wasm-unsafe-eval')");
}
// `connect-src` must forbid every real network origin.
const cspMatch = /content="([^"]*)"/.exec(indexHtml);
const csp = cspMatch?.[1] ?? '';
const connectSrcMatch = /connect-src\s+([^;]+);/.exec(csp);
const connectSrc = connectSrcMatch?.[1]?.trim();
if (connectSrc !== "'none'") {
  fail(`index.html CSP's connect-src is "${connectSrc ?? '(missing)'}", expected "'none'"`);
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
