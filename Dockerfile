# syntax=docker/dockerfile:1
# Reproducible development environment for Refrain CSV HTML.
#
#   docker compose run --rm app npm ci
#   docker compose run --rm app npm run test
#   docker compose run --rm app npm run build

FROM node:22-bookworm-slim

ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false

WORKDIR /app

# Install dependencies first so Docker layer caching keeps npm ci fast when
# only source files change.
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; fi

COPY . .

CMD ["npm", "run", "build"]
