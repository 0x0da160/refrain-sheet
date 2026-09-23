# syntax=docker/dockerfile:1
# Reproducible development environment for Refrain Sheet.
#
#   docker compose run --rm app npm ci
#   docker compose run --rm app npm run test:rust    # Rust unit tests
#   docker compose run --rm app npm run build:wasm   # Rust -> WASM -> embedded payload
#   docker compose run --rm app npm run test
#   docker compose run --rm app npm run build
#   docker compose run --rm app npm run ui:check     # headless-browser UI check

FROM node:22-bookworm-slim

ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:$PATH

# Rust toolchain (pinned) with the wasm32 target, plus wasm-pack and
# wasm-bindgen-cli (pinned). These three versions are exactly what makes
# `npm run build:wasm` byte-reproducible; keep them in sync with
# rust-toolchain.toml and .github/workflows/wasm.yml, which verifies the
# committed payload against a rebuild with the same versions. Every download
# is checked against a recorded SHA-256 before it runs (no `curl | sh`).
# gcc/libc are required to build proc-macro crates for the host; git lets the
# one-command release script (scripts/release.mjs) run inside the container.
ARG RUSTUP_VERSION=1.28.2
ARG RUSTUP_INIT_SHA256=20a06e644b0d9bd2fbdbfd52d42540bdde820ea7df86e92e533c073da0cdd43c
ARG RUST_TOOLCHAIN=1.84.1
ARG WASM_PACK_VERSION=v0.13.1
ARG WASM_PACK_SHA256=c539d91ccab2591a7e975bcf82c82e1911b03335c80aa83d67ad25ed2ad06539
ARG WASM_BINDGEN_VERSION=0.2.100
ARG WASM_BINDGEN_SHA256=63d6a38deb65bd7023c02bdf382ab66b0d2c0241c8582fd3413b5a808b8aeb5b
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl gcc git libc6-dev \
    && rm -rf /var/lib/apt/lists/* \
    && cd /tmp \
    && curl --proto '=https' --tlsv1.2 -sSfLo rustup-init \
       "https://static.rust-lang.org/rustup/archive/${RUSTUP_VERSION}/x86_64-unknown-linux-gnu/rustup-init" \
    && echo "${RUSTUP_INIT_SHA256}  rustup-init" | sha256sum -c - \
    && chmod +x rustup-init \
    && ./rustup-init -y --no-modify-path --profile minimal --default-toolchain "${RUST_TOOLCHAIN}" --target wasm32-unknown-unknown \
    && curl --proto '=https' --tlsv1.2 -sSfLO \
       "https://github.com/rustwasm/wasm-pack/releases/download/${WASM_PACK_VERSION}/wasm-pack-${WASM_PACK_VERSION}-x86_64-unknown-linux-musl.tar.gz" \
    && echo "${WASM_PACK_SHA256}  wasm-pack-${WASM_PACK_VERSION}-x86_64-unknown-linux-musl.tar.gz" | sha256sum -c - \
    && tar -xzf "wasm-pack-${WASM_PACK_VERSION}-x86_64-unknown-linux-musl.tar.gz" -C /usr/local/cargo/bin --strip-components=1 \
       "wasm-pack-${WASM_PACK_VERSION}-x86_64-unknown-linux-musl/wasm-pack" \
    && curl --proto '=https' --tlsv1.2 -sSfLO \
       "https://github.com/rustwasm/wasm-bindgen/releases/download/${WASM_BINDGEN_VERSION}/wasm-bindgen-${WASM_BINDGEN_VERSION}-x86_64-unknown-linux-musl.tar.gz" \
    && echo "${WASM_BINDGEN_SHA256}  wasm-bindgen-${WASM_BINDGEN_VERSION}-x86_64-unknown-linux-musl.tar.gz" | sha256sum -c - \
    && tar -xzf "wasm-bindgen-${WASM_BINDGEN_VERSION}-x86_64-unknown-linux-musl.tar.gz" -C /usr/local/cargo/bin --strip-components=1 \
       "wasm-bindgen-${WASM_BINDGEN_VERSION}-x86_64-unknown-linux-musl/wasm-bindgen" \
    && rm -rf /tmp/rustup-init /tmp/*.tar.gz \
    && chmod -R a+rwX /usr/local/rustup /usr/local/cargo

WORKDIR /app

# Install dependencies first so Docker layer caching keeps npm ci fast when
# only source files change. `--ignore-scripts` blocks dependency lifecycle
# scripts (postinstall/preinstall) as a supply-chain hardening measure; this
# project's toolchain needs none. A committed .npmrc also enforces this.
COPY package.json package-lock.json* .npmrc* ./
RUN if [ -f package-lock.json ]; then npm ci --ignore-scripts; fi

# Headless Chromium for `npm run ui:check` (scripts/ui-check.mjs), used to
# visually verify UI changes. Fetched with an explicit RUN step rather than
# an npm postinstall/lifecycle script (which --ignore-scripts always blocks)
# so the browser binary download stays outside npm's supply-chain surface,
# mirroring the Rust toolchain install above.
RUN npx --no-install playwright install --with-deps chromium

COPY . .

CMD ["npm", "run", "build"]
