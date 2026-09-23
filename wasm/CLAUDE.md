# wasm/CLAUDE.md

Local supplement to the root [`CLAUDE.md`](../CLAUDE.md), which still governs.
This file exists because `wasm/` is a Rust crate with its own toolchain,
dependency-pinning rules, and risk profile that the root file's Node-centric
command table does not cover — read this before touching anything here.

## What this crate is

`refrain-csv-core` (`wasm/Cargo.toml`): byte-level CSV parsing/validation/
sniffing/indexing/serialization planning, plus the three RSF compression
codecs, compiled to `wasm32-unknown-unknown` and embedded into the app as
Base64 (never fetched at runtime — see
[`knowledge/operations/security-threat-model.md`](../knowledge/operations/security-threat-model.md)).
The codec implementations and their container framing are documented in
[`knowledge/formats/rsf/index.md`](../knowledge/formats/rsf/index.md); this
file does not repeat that spec.

## High risk — extra care required

The root `CLAUDE.md` names this crate and the RSF binary format explicitly
under "High-risk changes — escalate, do not autonomously implement." A bug
here can corrupt a user's saved document or make it unreadable, with no
in-app way to recover. Before changing anything under `wasm/src/`:

- Run `npm run test:rust` (`cargo test --manifest-path wasm/Cargo.toml`), not
  just the JS test suite — the JS tests exercise the WASM boundary but not
  every Rust-level edge case.
- Preserve exact wire compatibility: an existing `.rsf` file must still open
  correctly after the change, and the container/body version-gating rules in
  [`knowledge/formats/rsf/compatibility.md`](../knowledge/formats/rsf/compatibility.md)
  must stay intact. A new field or behavior needs a new version number, never
  a silent reinterpretation of an old one.
- A change to compression output (even a byte-identical-content, different-
  encoding change) can shift file sizes across the whole benchmark suite —
  re-run `npm run bench` if `npm run test:rust` alone would not catch that.

## Toolchain notes specific to this crate

- **No C/C++ toolchain.** `wasm32-unknown-unknown` cannot link `cc`-based
  crates. This is why compression uses `miniz_oxide` / `ruzstd` / `lz4_flex`
  (pure Rust) instead of `zstd`/`flate2`'s C bindings — do not reach for a
  C-backed crate here, even one that looks simpler.
- **Dependency versions are pinned exactly** (`=x.y.z` in `Cargo.toml`), each
  with an inline comment explaining why (wasm-bindgen CLI version matching,
  minimum Rust toolchain compatibility). Do not relax a pin without reading
  its comment and re-verifying the reason still holds.
- **Rebuilding the embedded artifact is a separate, explicit step:**
  `npm run build:wasm` runs `wasm-pack build` then `scripts/embed-wasm.mjs`
  to re-embed the Base64 payload into the JS bundle. A `wasm/src/` change
  that isn't followed by `build:wasm` has no effect on the running app —
  `npm run build` alone does not rebuild it.
- **The build is reproducible, and CI checks it.** With the toolchain pinned
  in the root `rust-toolchain.toml` (1.84.1), wasm-pack 0.13.1, and
  wasm-bindgen-cli 0.2.100, `build:wasm` is byte-deterministic.
  `.github/workflows/wasm.yml` runs `test:rust`, rebuilds, and fails if
  `src/wasm-gen/` differs from the committed files — so always rebuild with
  exactly those versions (the Docker image has them) and commit the result.
  The frozen `.rsf` fixtures (`tests/rsf-fixtures.test.ts`) pin the codecs'
  compressed output byte-for-byte on the JS side.
- `wasm-opt` is deliberately disabled in the release profile (see the comment
  in `Cargo.toml`) so the build never needs to download binaryen; don't
  re-enable it to chase a size win without checking why it was turned off.
