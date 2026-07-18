# syntax=docker/dockerfile:1
# Reproducible development environment for Refrain CSV HTML.
#
#   docker compose run --rm app npm ci
#   docker compose run --rm app npm run test:rust    # Rust unit tests
#   docker compose run --rm app npm run build:wasm   # Rust -> WASM -> embedded payload
#   docker compose run --rm app npm run test
#   docker compose run --rm app npm run build

FROM node:22-bookworm-slim

ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:$PATH

# Rust toolchain (pinned) with the wasm32 target, plus wasm-pack (pinned).
# gcc/libc are required to build proc-macro crates for the host.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl gcc libc6-dev \
    && rm -rf /var/lib/apt/lists/* \
    && curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
       | sh -s -- -y --profile minimal --default-toolchain 1.84.1 --target wasm32-unknown-unknown \
    && curl --proto '=https' --tlsv1.2 -sSfL \
       https://github.com/rustwasm/wasm-pack/releases/download/v0.13.1/wasm-pack-v0.13.1-x86_64-unknown-linux-musl.tar.gz \
       | tar -xz -C /usr/local/cargo/bin --strip-components=1 wasm-pack-v0.13.1-x86_64-unknown-linux-musl/wasm-pack \
    && chmod -R a+rwX /usr/local/rustup /usr/local/cargo

WORKDIR /app

# Install dependencies first so Docker layer caching keeps npm ci fast when
# only source files change.
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; fi

COPY . .

CMD ["npm", "run", "build"]
