#!/bin/bash
# SPDX-License-Identifier: MIT
#
# SessionStart hook for Claude Code on the web. Installs the npm dependencies
# and the pinned WASM toolchain directly on the session container, so every
# command in CLAUDE.md (including `npm run build:wasm`) runs without Docker.
#
# The WASM output is byte-identical to the Docker and CI builds because the
# same three versions are used: the Rust channel from rust-toolchain.toml,
# wasm-pack and wasm-bindgen-cli. The versions and SHA-256 sums below must
# match `.github/workflows/wasm.yml` and the Dockerfile.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

WASM_PACK_VERSION=v0.13.1
WASM_PACK_SHA256=c539d91ccab2591a7e975bcf82c82e1911b03335c80aa83d67ad25ed2ad06539
WASM_BINDGEN_VERSION=0.2.100
WASM_BINDGEN_SHA256=63d6a38deb65bd7023c02bdf382ab66b0d2c0241c8582fd3413b5a808b8aeb5b

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}"

# npm dependencies: lockfile-strict and without lifecycle scripts (see CLAUDE.md).
# Skipped when node_modules already matches the lockfile.
if [ ! -f node_modules/.package-lock.json ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  npm ci --ignore-scripts >&2
fi

if [ "$(uname -sm)" != "Linux x86_64" ]; then
  echo "session-start: skipping the WASM toolchain (only x86_64 Linux binaries are pinned)" >&2
  exit 0
fi

# Rust toolchain pinned in rust-toolchain.toml, with the wasm32 target.
channel="$(sed -n 's/^channel = "\(.*\)"$/\1/p' rust-toolchain.toml)"
rustup toolchain install "$channel" --profile minimal --target wasm32-unknown-unknown >&2

# wasm-pack and wasm-bindgen-cli: release binaries, checksum-verified.
bin="${CARGO_HOME:-$HOME/.cargo}/bin"
mkdir -p "$bin"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

install_tool() {
  local name=$1 version=$2 sha256=$3 url=$4 archive
  if [ "$("$bin/$name" --version 2>/dev/null || true)" = "$name ${version#v}" ]; then
    return
  fi
  archive="$(basename "$url")"
  curl --proto '=https' --tlsv1.2 -sSfL -o "$tmp/$archive" "$url"
  echo "$sha256  $tmp/$archive" | sha256sum -c - >&2
  tar -xzf "$tmp/$archive" -C "$bin" --strip-components=1 "${archive%.tar.gz}/$name"
}

install_tool wasm-pack "$WASM_PACK_VERSION" "$WASM_PACK_SHA256" \
  "https://github.com/rustwasm/wasm-pack/releases/download/${WASM_PACK_VERSION}/wasm-pack-${WASM_PACK_VERSION}-x86_64-unknown-linux-musl.tar.gz"
install_tool wasm-bindgen "$WASM_BINDGEN_VERSION" "$WASM_BINDGEN_SHA256" \
  "https://github.com/rustwasm/wasm-bindgen/releases/download/${WASM_BINDGEN_VERSION}/wasm-bindgen-${WASM_BINDGEN_VERSION}-x86_64-unknown-linux-musl.tar.gz"

if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export PATH=\"$bin:\$PATH\"" >>"$CLAUDE_ENV_FILE"
fi
