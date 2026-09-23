// SPDX-License-Identifier: MIT
// Build the Rust/WASM core and embed it (`npm run build:wasm`).
//
// Runs `wasm-pack build` and then scripts/embed-wasm.mjs. The one thing this
// wrapper adds is path remapping: dependency sources live under the cargo
// home (e.g. /root/.cargo/registry/src/…), and rustc embeds those absolute
// paths in panic-location strings inside the binary. Without remapping, the
// same sources and pinned toolchain produce different bytes on machines with
// a different home directory, and .github/workflows/wasm.yml's byte-for-byte
// rebuild check could never pass. The crate's own sources are already
// compiled with relative paths; std uses /rustc/<commit>/ paths.

import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cargoHome = process.env.CARGO_HOME || join(homedir(), '.cargo');
const rustflags = [process.env.RUSTFLAGS, `--remap-path-prefix=${cargoHome}=/cargo`]
  .filter(Boolean)
  .join(' ');

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', env });
  if (result.error) {
    console.error(`build-wasm: FAIL: could not run ${command}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run('wasm-pack', ['build', 'wasm', '--release', '--target', 'web', '--no-pack', '--out-dir', 'pkg'], {
  ...process.env,
  RUSTFLAGS: rustflags,
});
run(process.execPath, [join(root, 'scripts', 'embed-wasm.mjs')]);
