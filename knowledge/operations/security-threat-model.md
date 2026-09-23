---
type: operations-concept
title: Security threat model
description: The offline-by-design guarantee, the Google Drive sync exception's exact scope, the trust-boundary/control table, and how the formula engine treats every input as hostile.
sources:
  - resource: docs/security.md (migrated content; file removed after migration — see knowledge/log.md)
status: stable
generated:
  by: claude-code/claude-sonnet-5
  at: 2026-09-22T12:00:58Z
---

# Security threat model

Refrain Sheet is a **local-first, fully offline** CSV/spreadsheet editor. It
runs from a single static HTML file (or GitHub Pages), executes entirely in
the browser, and makes **no network requests at runtime** — no analytics,
no remote APIs, no CDNs, no remote fonts, no telemetry.

## Scope of the no-network guarantee

This applies to the CSV/spreadsheet editor itself — the hosted build served
at app.refrain-sheet.com, and the offline build shipped in the release
ZIPs — which continues to make zero network connections of any kind at
runtime, enforced by `npm run check:dist` / `npm run check:dist:hosted` and
their `connect-src 'none'` CSP. It does not extend to the separate
marketing landing page (`site/`, built by `npm run build:landing`,
served at refrain-sheet.com), which is static informational content, not
the editor. The landing page may load Google Analytics (`gtag.js`), and
only after the visitor explicitly accepts a cookie-consent banner —
declining or ignoring the banner loads nothing (`site/consent.js`).

## Exception: opt-in Google Drive sync (hosted build only)

The maintainer approved a narrow exception to the guarantee above (issues
#413 and #416): the hosted build at app.refrain-sheet.com offers **opt-in**
Google Drive sync.

- **Opt-in, off by default.** No cloud-sync network request may occur
  unless a user has explicitly enabled the feature.
- **Hosted build only.** The offline `file://` build and the downloadable
  release ZIP are **not** covered and must keep making zero network
  connections of any kind — `npm run check:dist`'s `connect-src 'none'`
  assertion continues to apply, unchanged. The Drive client is not merely
  disabled there but **compiled out**: `src/app/commands.ts` gates it on the
  `__OFFLINE_BUILD__` define (`vite.config.ts`), and `check:dist` fails if
  the offline bundle contains any Google endpoint.
- **Nothing loads until the user asks.** Google's scripts are fetched
  lazily, on the first Drive command.

### How Drive sync is scoped

- **`drive.file` only.** The app may touch files it created itself, or
  files the user handed it through the Google Picker — never the rest of
  the user's Drive. It cannot list, share, or delete anything. This is a
  _non-sensitive_ scope, so publishing the app needs only basic OAuth
  verification.
- **No stored credential.** Sign-in uses the Google Identity Services
  _token_ model: an access token only, roughly one hour, with **no refresh
  token and no offline access requested**. The token lives in a
  module-local variable and is gone on reload — never `localStorage`, a
  cookie, or IndexedDB.
- **The client id is a public identifier, not a secret.** Delivered as the
  `GOOGLE_OAUTH_CLIENT_ID` repository _variable_ (never `secrets.*`),
  injected at build time, and reaches the hosted build only.
  `npm run check:dist` fails if the offline bundle ever contains one.
- **Origins and keyword grants are separated.** The hosted policy names the
  specific Google origins the Picker and Drive API need, in
  `HOSTED_ALLOWLIST`. Keyword grants live in a second list,
  `HOSTED_KEYWORD_GRANTS`, because they are categorically more dangerous —
  an origin permits one host, a keyword applies to every source in its
  directive. `scripts/check-dist.mjs` rejects any `'unsafe-*'` the built
  policy uses that is not declared there.
- **`style-src 'unsafe-inline'` is granted, to the hosted build only.**
  Google's `api.js` styles the picker dialog with inline style attributes
  and injected `<style>` elements in the parent page; there is no nonce or
  hash alternative since Google's script generates the markup at runtime.
  It grants no script capability — cell values are still rendered as text,
  never HTML, and there is no `eval`/`new Function` anywhere.
  `'unsafe-eval'` is never granted, and the offline build never sees any of
  this.
- **Same encoders as a local save.** An upload reuses the ordinary save
  path, so CSV fidelity is not weakened by the network path.

### The hosted / offline build split

The two artifacts are built separately so a hosted-only CSP relaxation can
never reach the offline build or the release ZIP:

| Build                  | Output         | Ships as                                  |
| ---------------------- | -------------- | ----------------------------------------- |
| `npm run build`        | `dist/`        | the `file://` build and the release ZIP   |
| `npm run build:hosted` | `dist-hosted/` | the GitHub Pages deploy (the hosted site) |

`scripts/csp.mjs` is the single source of truth for the policy — one CSP
per build mode, substituted into `index.html`'s `__CSP__` placeholder by
`vite.config.ts`. `npm run check:dist` validates `dist/` in offline mode
(requires `connect-src 'none'`, no `http:`/`https:` source anywhere);
`npm run check:dist:hosted` validates `dist-hosted/` in hosted mode
(rejects any origin absent from `HOSTED_ALLOWLIST`). Both assert the built
CSP matches `scripts/csp.mjs` byte-for-byte. `.github/workflows/ci.yml` and
`.github/workflows/release.yml` build and validate both artifacts on every
change.

## Threat model

| Trust boundary                         | Threat                                                                                        | Control                                                                                                                                                                                                                                    |
| -------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Opened CSV / `.rsf` / `.rcsv` files    | Malicious content (formula injection, XSS, decompression bombs, malformed frames)             | Cell values always render as text (never HTML); formulas run in a sandboxed evaluator (no `eval`/`new Function`); the binary container is strictly validated (magic, version, CRC-32, shape, bounds) with a 512 MiB decompression ceiling. |
| Opened `.xlsx` files                   | Malicious ZIP/OOXML content (decompression bombs, malformed archives/XML, oversized grids)    | Only calculated/display values are read (no formulas, styles, or macros); strictly validated with a 512 MiB per-entry decompression ceiling and a bound on total materialized cells; any structural failure aborts the whole import.       |
| npm dependencies (direct + transitive) | Malicious package or a compromised release ("Shai-Hulud"-style postinstall worms)             | Minimal dependency count; committed lockfile; `npm ci` (never `npm install`); all install lifecycle scripts disabled; `npm audit` gate; PR dependency review.                                                                              |
| Rust / WASM dependencies               | Malicious or vulnerable crate                                                                 | Few, exactly-pinned (`=x.y.z`) pure-Rust crates; committed `Cargo.lock`; no build downloads; reproducible pinned toolchain.                                                                                                                |
| GitHub Actions                         | A compromised action stealing secrets, writing to the repo, or publishing a malicious release | Read-only default permissions; write scopes granted only to the one job that needs them; `pull_request` (never `pull_request_target`); official GitHub-maintained actions only.                                                            |
| Release artifacts                      | Tampering / supply-chain substitution                                                         | SHA-256 checksum, CycloneDX SBOM, signed SLSA-style build-provenance attestation, all published with the release.                                                                                                                          |
| Developer machine / secrets            | Leaked credentials                                                                            | No credentials ever committed; `.gitignore` blocks env files and key material; the committed `.npmrc` holds config only.                                                                                                                   |

### The formula engine treats every input as hostile

Formula text, function arguments, criteria strings, ranges, worksheet
names, and everything decoded from a `.rsf` file are untrusted.

**No code execution, ever.** The engine is a hand-written tokenizer,
parser, and tree-walking evaluator — no `eval`, no `new Function`, no
dynamic JavaScript or Rust generation, no macros, no external or remote
references, no runtime network access.

**No regular expressions built from user input.** Criteria wildcards (`*`,
`?`) are matched by a hand-written two-pointer scan that remembers only the
most recent `*` as a backtrack point, so a pattern shaped like
`"*a*a*a*a*a*b"` — the shape that makes a backtracking regex engine take
exponential time — costs milliseconds instead.

**Everything is bounded.** Formula length (8,192), call arguments (255),
parser nesting depth (400 units), cells per range argument (2,000,000),
dynamic-array rows/columns/cells (100,000 / 16,384 / 1,000,000), spill
anchors per worksheet (512), spilled cells per worksheet (1,000,000), text
result length (32,767), criteria length (512), criteria pairs (32), and
sort keys (8) — [formats/rsf/dynamic-arrays.md](../formats/rsf/dynamic-arrays.md)
carries the same table with each bound's rationale. Exceeding one produces
an ordinary formula error in that one cell (`#NUM!`, `#VALUE!`, `#SPILL!`),
never a crash or hang.

Two further correctness controls that happen to matter for safety:
evaluation is deterministic and host-independent (UTC-only dates,
locale-independent case folding, code-point text units), and dynamic-array
results are never persisted, so a file can never carry a pre-computed value
that disagrees with the formula that claims to produce it.

### Runtime is offline by construction

The built `dist/` embeds the WebAssembly core as Base64 (never fetched)
and ships a CSP with `connect-src 'none'`. `npm run check:dist` fails the
build if a `.wasm` asset, a network fetch to a real `http:`/`https:`
origin, or a module `<script>` (which would break `file://`) sneaks in.
This is a security property, not just a convenience: there is no runtime
channel to exfiltrate a user's file contents.
