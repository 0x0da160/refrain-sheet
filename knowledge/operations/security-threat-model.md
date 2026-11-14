---
type: operations-concept
title: Security threat model
description: The offline-by-design guarantee, the Google Drive sync exception's exact scope, the trust-boundary/control table, and how the formula engine treats every input as hostile.
sources:
  - resource: ../../src/app/recent-files.ts
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
  disabled there but **compiled out**: `src/app/commands/index.ts` gates it on the
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
  directive. `scripts/check/dist.mjs` rejects any `'unsafe-*'` the built
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

## Exception: opt-in AI assistant (hosted build only)

The hosted build also offers an **opt-in** AI assistant (View > AI
Assistant): a small language model run inside the browser. A browser with
WebGPU (Safari on macOS, iOS and iPadOS 26, Chrome, Edge) runs the default
model, gemma3-270m-japanese-webllm-04 (q4f32_1, Gemma Terms of Use), with
`@mlc-ai/web-llm` (`src/app/ai/webllm-engine.ts`). Any other browser runs
Qwen2.5-0.5B-Instruct (GGUF Q4_K_M) with `@wllama/wllama` (llama.cpp
compiled to WebAssembly, in a Web Worker; `src/app/ai/engine.ts`).

- **Nothing is fetched until the user asks.** Page load and opening the
  panel make no request; the panel only lists what the browser already
  stores. The model is downloaded from Hugging Face only when the user
  presses Download AI Model. The WebLLM model's download first reads the
  repository's file list (`huggingface.co/api/models/…/tree/main`) to find
  its compiled WebGPU library, then fetches the model's files into Cache
  Storage; the Qwen model is kept in the Origin Private File System. Later
  visits start the stored model with no download: the WebLLM engine refuses
  to start unless every file is stored, so a start never fetches. Delete AI
  Model removes it.
- **The runtime is served by the app, not a CDN.** wllama's WebAssembly and
  the WebLLM script (several MB, built from `src/app/ai/webllm-runtime.ts`)
  are versioned files in `ai-runtime/` next to the hosted app, loaded only
  when a model is downloaded or started — never at page load.
- **The sheet never leaves the browser.** Inference runs locally; the only
  remote host is the model download. The model's replies are rendered as
  text, and a proposed edit is a list of `cell → value` pairs the user must
  approve; it is applied through the command layer as one undoable
  `bulkEdit`, under the usual write guards (`src/app/commands/ai-assistant.ts`).
- **Hosted build only, compiled out of the offline build.** The panel and
  runtimes are gated on `__OFFLINE_BUILD__`; `npm run check:dist` fails if the
  offline bundle contains `wllama`, `webllm`, or a Hugging Face host, or
  ships any `ai-runtime/` file.
- **CSP.** The hosted policy gains `connect-src 'self' https://huggingface.co
https://*.hf.co` (the runtime's own WebAssembly from `ai-runtime/`, the
  model, and Hugging Face's download CDN) and `worker-src blob:` (wllama's
  worker). `script-src` gains nothing: the WebLLM script comes from
  `'self'`. `check:dist:hosted` allows exactly the four versioned
  `ai-runtime/` files and nothing else there.
- **Model integrity.** The files are fetched by fixed Hugging Face URLs over
  HTTPS from the models' repositories; the app does not pin a checksum. The
  WebLLM model's compiled library is WebAssembly that runs with the page's
  privileges (under the same CSP), so the repository is trusted the way a
  dependency is. A tampered model can otherwise only produce bad text or bad
  proposals, which the user reviews before anything is applied.

### The hosted / offline build split

The two artifacts are built separately so a hosted-only CSP relaxation can
never reach the offline build or the release ZIP:

| Build                   | Output          | Ships as                                  |
| ----------------------- | --------------- | ----------------------------------------- |
| `npm run build`         | `dist/`         | the `file://` build and the release ZIP   |
| `npm run build:hosted`  | `dist-hosted/`  | the GitHub Pages deploy (the hosted site) |
| `npm run build:minimal` | `dist-minimal/` | not shipped yet: the CSV-only edition     |

`scripts/lib/csp.mjs` is the single source of truth for the policy — one CSP
per build mode, substituted into `index.html`'s `__CSP__` placeholder by
`vite.config.ts`. `npm run check:dist` validates `dist/` in offline mode
(requires `connect-src 'none'`, no `http:`/`https:` source anywhere);
`npm run check:dist:hosted` validates `dist-hosted/` in hosted mode
(rejects any origin absent from `HOSTED_ALLOWLIST`). The CSV-only minimal
edition (`src/app/edition.ts`) uses the offline policy, and
`npm run check:dist:minimal` validates `dist-minimal/` exactly as `dist/`.
All assert the built
CSP matches `scripts/lib/csp.mjs` byte-for-byte. `.github/workflows/ci.yml` and
`.github/workflows/release.yml` build and validate both artifacts on every
change.

## Exception: offline support for the hosted build (service worker)

The hosted build also works offline after its first visit. A service worker
(`sw.js`) and a web app manifest make that possible. Both are generated at build
time by `scripts/lib/pwa.mjs` and written only into `dist-hosted/`. The offline
`file://` build and the release ZIP carry neither, and they never register a
worker: a service worker cannot be registered from `file://` at all.

- **CSP, hosted only.** `worker-src` gains `'self'` so the worker script can come
  from the app's own origin, and `manifest-src 'self'` is added for the manifest.
  `connect-src` is unchanged, so the worker opens no connection of its own.
- **Same-origin requests only.** The worker answers this app's own `GET`
  requests from its precache. Everything else, including Google Drive, the
  Picker, and Hugging Face, passes straight to the network.
- **What is precached.** The app shell, its assets, the icons, and the manifest.
  The AI runtime is excluded: it is large, and it loads only when the person
  starts the assistant. The worker never caches itself.
- **Versions.** Each build has a content version, so the worker file changes
  whenever a precached file changes. A newer version waits until the person
  chooses to update. Only caches under this app's prefix are ever deleted, so
  the assistant's model cache is left alone.
- **Checked by** `npm run check:dist` (the offline artifact has no worker,
  manifest, or icons, and registers no worker) and `npm run check:dist:hosted`
  (every precached file exists, and the AI runtime is never precached).

## Threat model

| Trust boundary                         | Threat                                                                                        | Control                                                                                                                                                                                                                                                |
| -------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Opened CSV / `.rsf` files              | Malicious content (formula injection, XSS, decompression bombs, malformed frames)             | Cell values always render as text (never HTML); formulas run in a sandboxed evaluator (no `eval`/`new Function`); the container and its JSON are strictly validated (identifier, version, CRC-32, types, bounds) with a 512 MiB decompression ceiling. |
| Opened `.xlsx` files                   | Malicious ZIP/OOXML content (decompression bombs, malformed archives/XML, oversized grids)    | Only calculated/display values are read (no formulas, styles, or macros); strictly validated with a 512 MiB per-entry decompression ceiling and a bound on total materialized cells; any structural failure aborts the whole import.                   |
| npm dependencies (direct + transitive) | Malicious package or a compromised release ("Shai-Hulud"-style postinstall worms)             | Minimal dependency count; committed lockfile; `npm ci` (never `npm install`); all install lifecycle scripts disabled; `npm audit` gate; PR dependency review.                                                                                          |
| Rust / WASM dependencies               | Malicious or vulnerable crate                                                                 | Few, exactly-pinned (`=x.y.z`) pure-Rust crates; committed `Cargo.lock`; no build downloads; reproducible pinned toolchain.                                                                                                                            |
| GitHub Actions                         | A compromised action stealing secrets, writing to the repo, or publishing a malicious release | Read-only default permissions; write scopes granted only to the one job that needs them; `pull_request` (never `pull_request_target`); official GitHub-maintained actions only.                                                                        |
| Release artifacts                      | Tampering / supply-chain substitution                                                         | SHA-256 checksum, CycloneDX SBOM, signed SLSA-style build-provenance attestation, all published with the release.                                                                                                                                      |
| Developer machine / secrets            | Leaked credentials                                                                            | No credentials ever committed; `.gitignore` blocks env files and key material; the committed `.npmrc` holds config only.                                                                                                                               |

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

### What the app keeps in the browser

Besides preferences in `localStorage` (theme, font, language, size limit,
and similar), the one thing the app stores is the **recently opened files
list** behind File > Open Recent… (`src/app/recent-files.ts`, #598). It
lives in this origin's IndexedDB and holds, per file, only its name, when
it was last opened or saved, and the File System Access API handle — an
opaque, browser-managed reference, not a path. File contents are never
stored, nothing in it is ever sent anywhere, and the list is capped at 10
entries. A stored handle grants nothing by itself: reopening asks the
browser for read permission again in each session. Only browsers with the
File System Access API record anything; the dialog's Clear List button
empties it. In the hosted build with Google Drive, the same dialog also
lists the last 10 Drive files opened or saved (`src/app/recent-drive-files.ts`):
per file only its name, its Drive file id, and when it was opened, in
`localStorage`. The id grants nothing by itself: reopening needs the user's
Google sign-in and the app's per-file `drive.file` access. Clear List
empties this list too. The offline build has no Drive, so it never
writes it.

**Opened from `file://`, storage is shared with other local files.**
Chromium-based browsers give every local HTML file one storage origin
(verified 2026-09-26: a page in another folder read both `localStorage`
and this IndexedDB database). So when the app runs from `file://`
(`storageSharedWithOtherLocalFiles()` in `src/app/storage.ts`), the
recently opened files list and the SQL query history / saved queries are
kept in memory only, and copies an earlier release stored are deleted at
startup. Plain preferences (theme, zoom, size limit…) stay in
`localStorage` there: they reveal nothing about the user's data and every
read is validated and clamped. The hosted build has its own origin and is
unaffected.
