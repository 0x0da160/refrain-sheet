# Security & supply-chain policy

Refrain Sheet is a **local-first, fully offline** CSV / spreadsheet editor. It
runs from a single static HTML file (or GitHub Pages), executes entirely in the
browser, and makes **no network requests at runtime** — no analytics, no remote
APIs, no CDNs, no remote fonts, no telemetry. This document describes the threat
model, the dependency and lockfile policy, the CI permission model, the release
security controls, and what is expected of local developers.

## Threat model

The assets we protect and the boundaries we treat as untrusted:

| Trust boundary                         | Threat                                                                                        | Control                                                                                                                                                                                                                                            |
| -------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Opened CSV / `.rsf` / `.rcsv` files    | Malicious content (formula injection, XSS, decompression bombs, malformed frames)             | Cell values are always rendered as text (never HTML); formulas run in a sandboxed evaluator (no `eval` / `new Function`); the binary container is strictly validated (magic, version, CRC-32, shape, bounds) with a 512 MiB decompression ceiling. |
| npm dependencies (direct + transitive) | Malicious package or a compromised release ("Shai-Hulud"-style postinstall worms)             | Minimal dependency count; committed lockfile; `npm ci` (never `npm install`) in CI/Docker; **all install lifecycle scripts disabled** (`.npmrc` `ignore-scripts=true` + explicit `--ignore-scripts`); `npm audit` gate; PR dependency review.      |
| Rust / WASM dependencies               | Malicious or vulnerable crate                                                                 | Few, exactly-pinned (`=x.y.z`) pure-Rust crates; committed `Cargo.lock`; no build downloads (`wasm-opt` disabled); reproducible pinned toolchain.                                                                                                  |
| GitHub Actions                         | A compromised action stealing secrets, writing to the repo, or publishing a malicious release | Read-only default permissions; write scopes granted only to the one job that needs them; `pull_request` (never `pull_request_target`) so fork PRs get no secrets/write; official GitHub-maintained actions only (see the pinning policy).          |
| Release artifacts                      | Tampering / supply-chain substitution                                                         | SHA-256 checksum, CycloneDX SBOM, and a signed SLSA-style build-provenance attestation, all published with the release.                                                                                                                            |
| Developer machine / secrets            | Leaked credentials                                                                            | No credentials are ever committed; `.gitignore` blocks env files and key material; the committed `.npmrc` holds config only (never an auth token).                                                                                                 |

### Runtime is offline by construction

The built `dist/` embeds the WebAssembly core as Base64 (never fetched) and
ships a Content-Security-Policy with `connect-src 'none'`. `npm run check:dist`
fails the build if a `.wasm` asset, a network fetch, or a module `<script>`
(which would break `file://`) sneaks in. This offline guarantee is a security
property, not just a convenience: there is no runtime channel to exfiltrate a
user's file contents.

## Dependency policy

- **Keep the count minimal.** Do not add a dependency for convenience. Prefer a
  platform/browser API or a small local implementation. The production runtime
  currently has a **single** dependency, `encoding-japanese` (Shift_JIS / EUC-JP
  encoding, which the browser's `TextEncoder` cannot produce), and it has **zero
  transitive dependencies**. Everything else is dev-only build/test tooling.
- **Audit before adding.** New dependencies are reviewed for necessity,
  maintenance status, permission surface (install scripts, network access), and
  transitive footprint. Abandoned, over-permissive, or avoidable packages are
  rejected or removed.
- **Pin exactly for reproducibility.** `.npmrc` sets `save-exact=true` so new
  installs are pinned; Rust crates are pinned with `=x.y.z` in `wasm/Cargo.toml`.
- **No arbitrary execution.** We never run `curl | sh`, unpinned third-party
  binaries, unverified downloaded executables, or arbitrary package scripts.
  Dependency install scripts are disabled globally (see below).

## Lockfile policy

- `package-lock.json` and `wasm/Cargo.lock` are **committed and enforced**.
- CI, Docker, and all reproducible build instructions use `npm ci` (which
  installs strictly from the lockfile and fails if it disagrees with
  `package.json`) — never `npm install`.
- `npm run check:versions` verifies `package.json` and `package-lock.json` agree
  (root and `packages[""]`), and CI fails if any install/build/test step leaves
  a tracked file — including the lockfile — modified.

## npm hardening

The committed [`.npmrc`](../.npmrc) applies to every npm invocation in the repo:

- `ignore-scripts=true` — dependency lifecycle scripts (`preinstall`,
  `install`, `postinstall`) never run. This is the single largest npm
  supply-chain attack surface. This project's toolchain needs none, so blocking
  them is free. CI and the Dockerfile also pass `--ignore-scripts` explicitly.
- `save-exact=true` — pin new dependencies to an exact version.
- The file holds **configuration only**. Never add an `_authToken` or any
  registry credential to it; auth belongs in an untracked machine-local
  `~/.npmrc`.

## CI permission model

- **Read-only by default.** Every workflow declares top-level
  `permissions: contents: read`. A job widens scope only when it must, and only
  to what it needs.
- **`ci.yml`** (pull requests + pushes to `main`) is entirely read-only. It runs
  install (`--ignore-scripts`), version-consistency, format, lint, test, build,
  `check:dist`, the `npm audit` gate, and a clean-tree assertion. Fork PRs run
  here with no secrets and no write access.
- **`dependency-review.yml`** runs on `pull_request` and fails a PR that
  introduces a high/critical-severity or disallowed-license dependency. It is
  read-only aside from an optional PR summary comment, and — because it uses
  `pull_request`, not `pull_request_target` — untrusted PR code never runs with
  secrets or write access.
- **`release.yml`** is the only workflow with write access, and only on a pushed
  strict-SemVer tag. The `release` job holds `contents: write` (Release assets)
  plus `id-token: write` + `attestations: write` (provenance); the `deploy-pages`
  job holds only `pages: write` + `id-token: write`. Neither uses any repository
  secret — the built-in `GITHUB_TOKEN` and OIDC are sufficient.
- **No `pull_request_target`.** We use `pull_request` everywhere so untrusted
  fork code cannot gain secrets or write access.

### GitHub Actions pinning policy

Every action used is an **official GitHub-maintained `actions/*`** action,
pinned to a major-version tag (e.g. `actions/checkout@v4`). This is an explicit,
documented exception permitted for first-party actions.

**Any third-party (non-`actions/*`) action MUST be pinned to a full commit
SHA**, not a mutable tag. There are currently no third-party actions in this
repository. If one is ever introduced, pin it by SHA with a comment naming the
version, and prefer an official GitHub-maintained alternative where one exists.

## Release security controls

The tag workflow (`release.yml`) runs only for a strict `vMAJOR.MINOR.PATCH`
tag, and:

1. re-validates the tag format and that it exactly matches `package.json`,
2. runs the full check suite (version consistency, format, lint, test, build,
   `check:dist`, `npm audit`) before producing any artifact,
3. builds the release ZIP and a **SHA-256** checksum,
4. generates a **CycloneDX SBOM** (`npm sbom`, pinned built-in tooling) and
   attaches it to the release (and bundles it in the ZIP),
5. produces a signed **SLSA-style build-provenance attestation** for the ZIP via
   `actions/attest-build-provenance` (OIDC, no long-lived secret),
6. deploys `dist/` to GitHub Pages only after all of the above succeed.

The one-command release script ([`scripts/release.mjs`](../scripts/release.mjs))
runs the complete local check suite — including **Rust tests** and the security
audit — before it will create or push a tag, so a tag only ever exists because
the checks passed. It refuses to run from a detached HEAD, the wrong branch, a
dirty tree, or when behind upstream, and it never force-pushes or overwrites
tags.

## Local developer expectations

- Use the Docker toolchain (`docker compose run --rm app …`); it pins Node, the
  Rust toolchain, and `wasm-pack` for reproducible builds.
- Never commit credentials, tokens, private keys, `.npmrc` auth tokens, or
  `.env` files. `.gitignore` blocks the common cases; do not override it.
- Run `npm run check:versions` and the full verification suite before proposing
  a release.
- Report suspected vulnerabilities privately to the maintainer rather than in a
  public issue.
