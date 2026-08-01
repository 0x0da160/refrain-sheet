# Security & supply-chain policy

Refrain Sheet is a **local-first, fully offline** CSV / spreadsheet editor. It
runs from a single static HTML file (or GitHub Pages), executes entirely in the
browser, and makes **no network requests at runtime** — no analytics, no remote
APIs, no CDNs, no remote fonts, no telemetry. This document describes the threat
model, the dependency and lockfile policy, the CI permission model, the release
security controls, and what is expected of local developers.

## Threat model

The assets we protect and the boundaries we treat as untrusted:

| Trust boundary                         | Threat                                                                                        | Control                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Opened CSV / `.rsf` / `.rcsv` files    | Malicious content (formula injection, XSS, decompression bombs, malformed frames)             | Cell values are always rendered as text (never HTML); formulas run in a sandboxed evaluator (no `eval` / `new Function`); the binary container is strictly validated (magic, version, CRC-32, shape, bounds) with a 512 MiB decompression ceiling.                                                                                         |
| Opened `.xlsx` files                   | Malicious ZIP/OOXML content (decompression bombs, malformed archives/XML, oversized grids)    | Only calculated/display values are read (no formulas, styles, or macros); the ZIP central directory and every part are strictly validated with a 512 MiB per-entry decompression ceiling and a bound on total materialized cells; any structural failure aborts the whole import (never a partial document) and reports a message instead. |
| npm dependencies (direct + transitive) | Malicious package or a compromised release ("Shai-Hulud"-style postinstall worms)             | Minimal dependency count; committed lockfile; `npm ci` (never `npm install`) in CI/Docker; **all install lifecycle scripts disabled** (`.npmrc` `ignore-scripts=true` + explicit `--ignore-scripts`); `npm audit` gate; PR dependency review.                                                                                              |
| Rust / WASM dependencies               | Malicious or vulnerable crate                                                                 | Few, exactly-pinned (`=x.y.z`) pure-Rust crates; committed `Cargo.lock`; no build downloads (`wasm-opt` disabled); reproducible pinned toolchain.                                                                                                                                                                                          |
| GitHub Actions                         | A compromised action stealing secrets, writing to the repo, or publishing a malicious release | Read-only default permissions; write scopes granted only to the one job that needs them; `pull_request` (never `pull_request_target`) so fork PRs get no secrets/write; official GitHub-maintained actions only (see the pinning policy).                                                                                                  |
| Release artifacts                      | Tampering / supply-chain substitution                                                         | SHA-256 checksum, CycloneDX SBOM, and a signed SLSA-style build-provenance attestation, all published with the release.                                                                                                                                                                                                                    |
| Developer machine / secrets            | Leaked credentials                                                                            | No credentials are ever committed; `.gitignore` blocks env files and key material; the committed `.npmrc` holds config only (never an auth token).                                                                                                                                                                                         |

### The formula engine treats every input as hostile

Formula text, function arguments, criteria strings, ranges, worksheet names,
and everything decoded from a `.rsf` file are untrusted. Three properties keep
a crafted formula — in a file a user was sent, not just one they typed — from
becoming a denial of service or worse.

**No code execution, ever.** The engine is a hand-written tokenizer, parser,
and tree-walking evaluator. There is no `eval`, no `new Function`, no dynamic
JavaScript or Rust generation, no macros, no external or remote references, and
no runtime network access. Loading a document evaluates data, never code.

**No regular expressions built from user input.** Criteria wildcards (`*`,
`?`) are matched by a hand-written two-pointer scan that remembers only the
most recent `*` as a backtrack point. Its worst case is proportional to pattern
length × subject length, so a pattern such as `"*a*a*a*a*a*b"` — the shape that
makes a backtracking regular-expression engine take exponential time — costs
milliseconds. A test asserts the bound directly.

**Everything is bounded.** Formula length (8,192), call arguments (255),
parser nesting depth (400 units), cells per range argument (2,000,000),
dynamic-array rows / columns / cells (100,000 / 16,384 / 1,000,000), spill
anchors per worksheet (512), spilled cells per worksheet (1,000,000), text
result length (32,767), criteria length (512), criteria pairs (32), and sort
keys (8). `docs/rsf-format.md` carries the same table with each bound's
rationale. Exceeding one produces an ordinary formula error in that one cell —
`#NUM!`, `#VALUE!`, or `#SPILL!` — not a crash, a hang, or an
unresponsive-page dialog. Parsing and evaluation are iterative or
depth-limited, so no attacker-controlled input can overflow the stack, and a
function that throws unexpectedly is caught and reported as `#VALUE!` in its
own cell rather than taking the tab down.

Two further properties are correctness controls that happen to matter for
safety: evaluation is deterministic and host-independent (UTC-only dates,
locale-independent case folding, code-point text units), so a file cannot be
made to compute different values on a different machine; and dynamic-array
results are never persisted, so a file can never carry a pre-computed value
that disagrees with the formula that claims to produce it.

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
  has two dependencies: `encoding-japanese` (Shift_JIS / EUC-JP encoding, which
  the browser's `TextEncoder` cannot produce; **zero transitive dependencies**),
  and `@mlc-ai/web-llm` (the local AI assistant's in-browser inference engine;
  see `docs/llm-model.md` for why this large, multi-transitive-dependency
  exception was explicitly approved and how it is kept consistent with the
  offline guarantee below). Everything else is dev-only build/test tooling.
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

Every **official GitHub-maintained `actions/*`** action is pinned to a
major-version tag (e.g. `actions/checkout@v4`). This is an explicit, documented
exception permitted for first-party actions.

**Any third-party (non-`actions/*`) action MUST be pinned to a full commit
SHA**, not a mutable tag. One third-party action, `anthropics/claude-code-action`,
is currently in use — 10 times across `close-loop.yml`, `implement-issue.yml`,
`issue-triage.yml`, `prepare-issue-spec.yml`, and `review-pr.yml` (twice per
file) — and every call site is pinned to the same full commit SHA, with the
release it corresponds to kept visible as a trailing comment. Moving to a newer
release is therefore a reviewable diff, not a silent upstream change. Any newly
introduced third-party action must be pinned by SHA with a comment naming the
version, and should prefer an official GitHub-maintained alternative where one
exists.

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
