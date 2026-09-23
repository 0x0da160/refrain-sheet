// SPDX-License-Identifier: MIT
// Provenance check for the committed sql.js payload in src/wasm-gen/.
//
// src/wasm-gen/sqljs-wasm-payload.ts embeds node_modules/sql.js's compiled
// SQLite WASM binary as Base64 (scripts/embed-sqljs.mjs). Nothing tied the two
// together, so bumping the pinned `sql.js` version without re-running
// `npm run build:sqljs` would silently ship the old binary against the new JS
// runtime. This fails when the embedded bytes differ from the installed
// package's. Needs only `npm ci`; the Rust payload is checked separately by
// rebuilding it (.github/workflows/wasm.yml).

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const payloadSource = readFileSync(join(root, 'src', 'wasm-gen', 'sqljs-wasm-payload.ts'), 'utf8');
const installed = readFileSync(join(root, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'));

const match = payloadSource.match(/SQLJS_WASM_BASE64 =\s*'([A-Za-z0-9+/=]+)'/);
if (!match) {
  console.error(
    'check-generated: FAIL: could not find SQLJS_WASM_BASE64 in src/wasm-gen/sqljs-wasm-payload.ts',
  );
  process.exit(1);
}
const embedded = Buffer.from(match[1], 'base64');
if (!embedded.equals(installed)) {
  console.error(
    `check-generated: FAIL: the embedded sql.js WASM (${embedded.length} bytes) differs from ` +
      `node_modules/sql.js/dist/sql-wasm.wasm (${installed.length} bytes) — run \`npm run build:sqljs\`.`,
  );
  process.exit(1);
}
console.warn(
  `check-generated: ok: embedded sql.js WASM matches the installed sql.js (${installed.length} bytes)`,
);
