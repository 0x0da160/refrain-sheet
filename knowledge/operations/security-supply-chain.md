---
type: operations-concept
title: Security supply-chain controls
description: Dependency policy, lockfile enforcement, npm hardening, CI permission model, Actions pinning, and release security controls.
sources:
  - resource: docs/security.md (migrated content; file removed after migration — see knowledge/log.md)
status: stable
generated:
  by: claude-code/claude-sonnet-5
  at: 2026-09-22T12:00:58Z
---

# Security supply-chain controls

## Dependency policy

- **Keep the count minimal.** Do not add a dependency for convenience;
  prefer a platform/browser API or a small local implementation. The
  production runtime has four dependencies, all with **zero transitive
  dependencies**: `encoding-japanese` (Shift_JIS/EUC-JP encoding, which
  `TextEncoder` cannot produce), `lucide` (UI icons; only the individual
  icon modules actually imported are bundled, nothing is fetched at
  runtime), `sql.js` (SQLite compiled to WebAssembly, behind Data > Run SQL
  Query… — see [system-overview.md](../architecture/system-overview.md)),
  and `yaml` (a pure-JavaScript YAML 1.1/1.2 parser/stringifier behind the
  YAML worksheet kind's auto-format action; a hand-rolled parser was
  rejected as a correctness/maintenance risk). Every one of them has a
  section in `THIRD-PARTY-NOTICES.md` (enforced by
  `tests/third-party-notices.test.ts`). Everything else is dev-only
  build/test tooling.
- **Keep current.** Patch weekly, review end of life quarterly — see
  [dependency-lifecycle.md](dependency-lifecycle.md).
- **Audit before adding.** New dependencies are reviewed for necessity,
  maintenance status, permission surface (install scripts, network
  access), and transitive footprint.
- **Pin exactly for reproducibility.** `.npmrc` sets `save-exact=true`;
  Rust crates are pinned with `=x.y.z` in `wasm/Cargo.toml`.
- **No arbitrary execution.** Never `curl | sh`, unpinned third-party
  binaries, unverified downloaded executables, or arbitrary package
  scripts.

## Lockfile policy

- `package-lock.json` and `wasm/Cargo.lock` are **committed and
  enforced**.
- CI, Docker, and all reproducible build instructions use `npm ci` — never
  `npm install`.
- `npm run check:versions` verifies `package.json` and
  `package-lock.json` agree; CI fails if any install/build/test step
  leaves a tracked file — including the lockfile — modified.

## npm hardening

The committed `.npmrc` applies to every npm invocation in the repo:

- `ignore-scripts=true` — dependency lifecycle scripts (`preinstall`,
  `install`, `postinstall`) never run. This is the single largest npm
  supply-chain attack surface; this project's toolchain needs none. CI and
  the Dockerfile also pass `--ignore-scripts` explicitly.
- `save-exact=true` — pin new dependencies to an exact version.
- The file holds **configuration only** — never an `_authToken` or
  registry credential.

## CI permission model

- **Read-only by default.** Every workflow declares top-level
  `permissions: contents: read`; a job widens scope only when it must.
- **`ci.yml`** (pull requests + pushes to `main`) is entirely read-only.
  Runs install (`--ignore-scripts`), version-consistency, format, lint,
  test, build, `check:dist`, the `npm audit` gate, and a clean-tree
  assertion, split across parallel jobs that an aggregate `ci` job gates.
  Fork PRs run here with no secrets and no write access.
- **`dependency-review.yml`** runs on `pull_request` and fails a PR that
  introduces a high/critical-severity or disallowed-license dependency.
  Uses `pull_request`, not `pull_request_target`, so untrusted PR code
  never runs with secrets or write access.
- **`maintenance.yml`** (weekly schedule + `workflow_dispatch`) is
  read-only: the full `npm audit`, the date-driven EOL gate, and the full
  SBOM as an artifact — see [dependency-lifecycle.md](dependency-lifecycle.md).
  Dependabot (`.github/dependabot.yml`) proposes weekly update pull
  requests that go through the same CI and review as any other.
- **`release-docs.yml`** (`workflow_dispatch` only) holds
  `contents: write` and `pull-requests: write`, but never writes to `main`
  directly — it pushes a rolling `chore/release-docs` branch (with an
  explicit `--force-with-lease=<ref>:<sha>`, so the branch is only ever
  advanced from where this workflow itself left it) and opens a PR reviewed
  like any other. It installs no npm dependencies: `cloc` comes from the
  signed Ubuntu archive, and the only scripts it executes are the committed
  `scripts/changelog.mjs` and `scripts/code-stats.mjs`. Releases normally
  update the same two files inside the release commit (`scripts/release.mjs`),
  so this is a manual catch-up only.
- **`release.yml`** is the only workflow that writes to the repository
  **without review**, and only on a pushed strict-SemVer tag. The
  `release` job holds `contents: write`, `id-token: write`, and
  `attestations: write`; the `deploy-pages` job holds only `pages: write`
  and `id-token: write`. Neither uses any repository secret — the
  built-in `GITHUB_TOKEN` and OIDC are sufficient.
- **No `pull_request_target`** anywhere.

### GitHub Actions pinning policy

Every **official GitHub-maintained `actions/*`** action is pinned to a
major-version tag (e.g. `actions/checkout@v7`) — an explicit, documented
exception for first-party actions.

**Any third-party (non-`actions/*`) action MUST be pinned to a full commit
SHA**, not a mutable tag, with the release it corresponds to kept visible as
a trailing comment. No third-party action is currently in use: the only one,
`anthropics/claude-code-action`, left with the Issue-driven agent-loop
workflows (see [the agent loop index](../agent-loop/index.md)).

## Release security controls

The tag workflow (`release.yml`) runs only for a strict
`vMAJOR.MINOR.PATCH` tag, and:

1. re-validates the tag format and that it exactly matches
   `package.json`,
2. runs the full check suite (version consistency, format, lint, test,
   build, `check:dist`, `npm audit`) before producing any artifact,
3. builds the release ZIP and a **SHA-256** checksum,
4. generates a **CycloneDX SBOM** (`npm sbom`, pinned built-in tooling) and
   attaches it to the release (and bundles it in the ZIP),
5. produces a signed **SLSA-style build-provenance attestation** via
   `actions/attest-build-provenance` (OIDC, no long-lived secret),
6. deploys `dist/` to GitHub Pages only after all of the above succeed.

`scripts/release.mjs` runs the complete local check suite — including
**Rust tests** and the security audit — before it will create or push a
tag, so a tag only ever exists because the checks passed. It refuses to
run from a detached HEAD, the wrong branch, a dirty tree, or when behind
upstream, and it never force-pushes or overwrites tags.

## Local developer expectations

- Use the Docker toolchain (`docker compose run --rm app …`); it pins
  Node, the Rust toolchain, and `wasm-pack` for reproducible builds.
- Never commit credentials, tokens, private keys, `.npmrc` auth tokens, or
  `.env` files.
- Run `npm run check:versions` and the full verification suite before
  proposing a release.
- Report suspected vulnerabilities privately to the maintainer rather than
  in a public issue.
