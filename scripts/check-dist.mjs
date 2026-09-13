// SPDX-License-Identifier: MIT
// Build validation for the embedded-WASM distribution.
//
// Asserts that the built artifact is self-contained, for both embedded WASM
// binaries — the Rust performance core (refrain_csv_core) and the sql.js
// (SQLite) engine behind Data > Run SQL Query…:
//   1. no .wasm file is shipped or referenced — the WASM binaries must be
//      embedded in the JS bundle as Base64,
//   2. each embedded payload and its local instantiation path are present,
//   3. no URL-based WASM fallback survived into the bundle,
//   4. the CSP matches scripts/csp.mjs byte-for-byte for the build mode, allows
//      WebAssembly ('wasm-unsafe-eval'), and names no origin beyond what that
//      file permits for the mode.
//
// Usage:
//   node scripts/check-dist.mjs [--dir <path>] [--mode offline|hosted]
//
// The defaults (dist/, offline) are the historical behaviour, so a bare
// `npm run check:dist` still validates the offline artifact exactly as before.
// In offline mode the no-network guarantee is absolute: connect-src must be
// 'none' and no http:/https: source may appear anywhere, and the bundle must
// carry no Google OAuth client id. In hosted mode every origin the policy names
// must appear in scripts/csp.mjs's HOSTED_ALLOWLIST, and a bare http:/https:
// scheme source is rejected in either mode.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allowedOrigins, assertBuildMode, buildCsp } from './csp.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function readOption(flag, fallback) {
  const at = process.argv.indexOf(flag);
  if (at === -1) return fallback;
  const value = process.argv[at + 1];
  if (!value || value.startsWith('--')) {
    console.error(`check-dist: FAIL: ${flag} requires a value`);
    process.exit(1);
  }
  return value;
}

const targetDir = readOption('--dir', 'dist');
const dist = isAbsolute(targetDir) ? targetDir : join(root, targetDir);

let mode;
try {
  mode = assertBuildMode(readOption('--mode', 'offline'));
} catch (error) {
  console.error(`check-dist: FAIL: ${error.message}`);
  process.exit(1);
}

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
  fail(`found .wasm files in ${targetDir}: ${wasmFiles.join(', ')} — the binary must be embedded`);
} else {
  ok(`no separate .wasm asset in ${targetDir}`);
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

// 4. index.html: the CSP must be exactly what scripts/csp.mjs defines for this
// build mode, so the two modes can never silently drift apart.
const indexHtml = readFileSync(join(dist, 'index.html'), 'utf8');
if (indexHtml.includes('__CSP__')) {
  fail('index.html still contains the __CSP__ placeholder — the build injected no policy');
}
const cspMatch = /content="([^"]*)"/.exec(indexHtml);
const csp = cspMatch?.[1] ?? '';
const expectedCsp = buildCsp(mode);
if (csp !== expectedCsp) {
  fail(
    `index.html CSP does not match scripts/csp.mjs for mode "${mode}"\n` +
      `    expected: ${expectedCsp}\n` +
      `    actual:   ${csp}`,
  );
} else {
  ok(`CSP matches scripts/csp.mjs byte-for-byte (mode: ${mode})`);
}

if (!csp.includes('wasm-unsafe-eval')) {
  fail("index.html CSP is missing 'wasm-unsafe-eval' (WebAssembly would be blocked)");
} else {
  ok("CSP allows local WebAssembly compilation ('wasm-unsafe-eval')");
}

const connectSrc = /connect-src\s+([^;]+);/.exec(csp)?.[1]?.trim();
if (mode === 'offline') {
  // The offline artifact — file:// and the release ZIP — must keep making zero
  // network connections of any kind. This pair of assertions is the mechanical
  // form of that guarantee and must never be relaxed (docs/security.md).
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
} else {
  // The hosted artifact may name origins, but only ones scripts/csp.mjs lists.
  // Widening that list is therefore a visible, reviewable edit to one file.
  const allowed = new Set(allowedOrigins(mode));
  const named = [...csp.matchAll(/\bhttps?:\/\/[^\s;]+/g)].map((m) => m[0]);
  const unexpected = named.filter((origin) => !allowed.has(origin));
  if (unexpected.length > 0) {
    fail(
      `index.html CSP names origin(s) absent from HOSTED_ALLOWLIST in scripts/csp.mjs: ${unexpected.join(', ')}`,
    );
  } else {
    ok(`CSP names only allowlisted origins (${allowed.size} allowed, ${named.length} used)`);
  }
  // A bare `https:` source would permit every origin — never acceptable, even
  // in the hosted build. Origins must always be spelled out.
  if (/(?:connect|worker|script)-src[^;]*\bhttps?:(?!\/\/)/.test(csp)) {
    fail('index.html CSP names a bare http:/https: scheme source — origins must be explicit');
  } else {
    ok('CSP names no bare http:/https: scheme source');
  }
  if (allowed.size === 0 && connectSrc !== "'none'") {
    fail(
      `HOSTED_ALLOWLIST is empty, so connect-src must still be "'none'" — found "${connectSrc ?? '(missing)'}"`,
    );
  }
}
// 5. The offline artifact must carry no Google credential. The client id is
// injected only in the hosted build (vite.config.ts), so finding one here
// would mean the offline release ZIP had shipped a credential and a live code
// path with it. This is the mechanical form of that guarantee — see #416.
if (mode === 'offline') {
  const credential = /[A-Za-z0-9-_.]+\.apps\.googleusercontent\.com/.exec(bundle)?.[0];
  if (credential) {
    fail('the offline bundle contains a Google OAuth client id — it must only ever reach the hosted build');
  } else {
    ok('offline bundle carries no Google OAuth client id');
  }
}

if (/<script[^>]*type="module"/.test(indexHtml)) {
  fail('index.html still uses a module script (breaks file:// in Chromium)');
} else {
  ok('index.html uses classic scripts (file:// compatible)');
}

if (failures > 0) {
  console.error(`check-dist: ${failures} failure(s) in ${targetDir} (mode: ${mode})`);
  process.exit(1);
}
console.warn(
  `check-dist: ${targetDir} is self-contained (embedded WASM, mode: ${mode}, CSP matches scripts/csp.mjs)`,
);
