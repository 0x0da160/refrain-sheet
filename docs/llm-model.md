# The local AI assistant model

Refrain Sheet ships a choice of small language models that run entirely in
the browser (via [`@mlc-ai/web-llm`](https://github.com/mlc-ai/web-llm),
WebGPU inference) to help answer questions about spreadsheet operations. This
document records what is vendored, how each model is embedded, what is and is
not verified, and how to refresh or add one. Vendoring even the first model
was a deliberate, explicitly human-approved exception to the single-dependency
policy in `docs/security.md` — read that document first for the general
dependency and offline rules this feature had to fit. Adding a second model
(issue #166) extends that same exception; it does not introduce a new one.

## What is vendored

The full list of vendored models — their upstream repo, which files are
fetched, and why — lives in `scripts/model-catalog.mjs` (read by both
`fetch-model.mjs` and `embed-model.mjs`); the runtime-side mirror the app
itself reads is `src/app/llm/model-catalog.ts` (hand-written, kept in sync by
hand when adding a model, since it must not depend on Node built-ins). This
section summarizes each entry; see those two files for the exact file lists.

- **`gemma3-270m-ja`:** [`UMASHIKA/gemma3-270m-japanese-webllm-04`](https://huggingface.co/UMASHIKA/gemma3-270m-japanese-webllm-04)
  (Gemma 3 270M, Japanese fine-tune, `q4f32_1` quantization, pre-compiled for
  WebLLM/WebGPU). License: Gemma Terms of Use (see the model card). The
  default model, selected first in the catalog. Vendored payload (`mlc-chat-config.json`,
  `tensor-cache.json`, four `params_shard_*.bin` files, `tokenizer.json`, and
  the compiled `.wasm` inference kernel) totals **≈190 MB** raw / **≈253 MB**
  as the Base64 text committed under `src/llm-gen/`. This is materially
  larger than the ≤100 MB the original Issue (#112) asked for; the repository
  owner was told the actual size before approving it and chose to proceed
  anyway rather than a smaller model. Only 8 of the upstream repo's files are
  vendored: `mlc-chat-config.json`'s `tokenizer_files` lists `tokenizer.json`,
  and WebLLM's tokenizer loader prefers it over `tokenizer.model` whenever
  both are listed, so `tokenizer.model`, `tokenizer_config.json`,
  `added_tokens.json`, and the alternate `bf16` tensor-cache manifest are
  never requested at runtime and are not vendored.
- **`smollm2-135m-instruct`:** [`mlc-ai/SmolLM2-135M-Instruct-q0f16-MLC`](https://huggingface.co/mlc-ai/SmolLM2-135M-Instruct-q0f16-MLC)
  (SmolLM2 135M, general-purpose instruction-tuned, `q0f16` quantization,
  pre-compiled for WebLLM/WebGPU). License: Apache 2.0 (see the model card).
  Offered as an additional, user-selectable option alongside `gemma3-270m-ja`
  — lighter, faster, and primarily English rather than Japanese-tuned. Added
  for issue #166. Vendored payload (`mlc-chat-config.json`, `tensor-cache.json`,
  eight `params_shard_*.bin` files, `tokenizer.json`, and the compiled `.wasm`
  inference kernel, fetched separately since this repo does not publish its
  own compiled kernel) totals **≈264 MiB (≈277 MB)** raw, roughly doubling
  the total embedded payload alongside `gemma3-270m-ja`. `vocab.json`,
  `merges.txt`, and `tokenizer_config.json` are listed upstream but never
  requested at runtime (WebLLM's tokenizer loader uses `tokenizer.json`) and
  are not vendored.

## How it is embedded (and why it needs no network access)

The same pattern `scripts/embed-wasm.mjs` uses for the Rust/WASM core
(`src/wasm-gen/`), applied to much larger, multi-file artifacts — one per
vendored model:

1. `npm run fetch:model` (`scripts/fetch-model.mjs`, **not run in CI**)
   downloads each model's source files (per `scripts/model-catalog.mjs`) into
   `.model-cache/` (gitignored) — pass a model `key` as the first argument to
   fetch only that one. `gemma3-270m-ja` uses the original flat layout
   (`.model-cache/` directly); every model added since (starting with
   `smollm2-135m-instruct`, issue #166) gets its own `.model-cache/<key>/`
   subdirectory.
2. `npm run embed:model` (`scripts/embed-model.mjs`, **not run in CI**, same
   optional single-model `key` argument) reads `.model-cache/`,
   Base64-encodes each file, splits it into ≤8 MiB raw (≈10.7 MB Base64)
   chunks — comfortably under GitHub's 100 MB single-file push limit — and
   writes `src/llm-gen/<key>/model-payload/*.part*.ts` plus
   `src/llm-gen/<key>/model-manifest.ts` (each file's byte length, SHA-256,
   and its ordered chunk list); `gemma3-270m-ja` again keeps the original
   flat `src/llm-gen/` layout rather than moving to a subdirectory, so
   re-running the script for it never recommits byte-identical content under
   a new path. These generated files are committed, like `src/wasm-gen/`, so
   the app builds and tests without a network fetch or the Python/TVM
   model-compilation toolchain that produced the upstream artifacts.

Adding a model to the catalog means: an entry in `scripts/model-catalog.mjs`
(Node-side fetch/embed registry) and a matching entry in
`src/app/llm/model-catalog.ts` (runtime-side, hand-written since it must not
depend on Node built-ins — the two are kept in sync by hand), a new
`src/app/llm/engine-entry.<key>.ts` (see below), and `labelKey`/`descriptionKey`
strings added to **both** `src/locales/en.json` and `src/locales/ja.json`.

Each vendored model's engine (`src/app/llm/engine.ts`, which imports
`cache-prepopulate.ts`, and therefore that model's whole embedded payload) is
never pulled into the main application bundle — not even via a dynamic
`import()`, since `vite.config.ts` sets `inlineDynamicImports: true` so
`dist/index.html` keeps working when opened directly via `file://`, and that
setting inlines and eagerly evaluates every dynamically-imported module into
the same single script anyway. Instead, each model gets its own standalone
entry point (`src/app/llm/engine-entry.<key>.ts`), built as its own separate
classic script by its own `vite.llm.config.ts` pass (`LLM_MODEL_KEY=<key>
vite build --config vite.llm.config.ts`, one pass per catalog entry — see the
`build` script in `package.json` — producing `dist/assets/llm-engine.<key>.js`).
`src/ui/ai-panel.ts`'s `loadLlmEngine(modelKey)` loads the selected model's
script at runtime by inserting a `<script>` tag, only once the user installs
or chats with that model, so selecting one model never downloads or parses
another's payload. This is the same same-origin, `file://`-safe classic
script loading path `index.html` already uses for the main bundle, and is
explicitly allowed by the CSP (`script-src 'self' file:`) without any
change to it. See issue #116 (single-model split into its own script) and
issue #166 (per-model selection and the second model).

Each `vite.llm.config.ts` pass runs with `NODE_OPTIONS=--max-old-space-size=8192`
(set in the `build` script itself, not the developer's environment): Rollup
holding one model's ~250–350 MB Base64 payload in memory as it bundles a
single-entry IIFE has been observed to exceed Node's default V8 heap and
abort with an out-of-memory crash once a model's payload gets large enough —
first reproduced when adding `smollm2-135m-instruct` (issue #166), whose
build failed under the default heap even though the smaller `gemma3-270m-ja`
pass did not. `minify: false` in `vite.llm.config.ts` also reduces peak
memory use for the same reason: minifying dense, already-compact Base64 text
buys nothing and costs a second large in-memory copy of the bundle. If a
future model's build still fails with this budget, raise
`--max-old-space-size` further — the ceiling is the CI runner's available
memory, not anything in this codebase.

`npm run test` (`vitest run`) sets the same `NODE_OPTIONS=--max-old-space-size=8192`
for the same underlying reason: `tests/llm-model-source.test.ts` and
`tests/llm-cache-prepopulate.test.ts` import real generated manifests (one or
both models) to exercise the actual embedded payload rather than a fixture,
and a Vitest worker holding multiple such manifests at once has also been
observed to exceed the default heap.

At runtime, `src/app/llm/cache-prepopulate.ts` decodes and concatenates each
file's chunks, verifies it against the recorded SHA-256
(`ModelPayloadIntegrityError` if it does not match), and writes it directly
into the browser's Cache Storage under the exact scope/URL
`@mlc-ai/web-llm`'s `ArtifactCache` reads from (`src/app/llm/model-source.ts`,
`createModelSource()`). Because `ArtifactCache.addToCache()` checks
`cache.match()` before ever calling `fetch()`, pre-populating the cache means
the engine's own loading path always hits and never reaches a real network
request. `index.html`'s Content-Security-Policy (`connect-src 'none'`) and
`scripts/check-dist.mjs` are unchanged — this feature does not weaken either.

`createModelSource()`'s synthetic base URL (`https://refrain-sheet.invalid/models/<key>/resolve/main/`)
uses the `.invalid` TLD (IANA-reserved, RFC 2606, guaranteed never to
resolve) precisely because it must never actually be dereferenced; the URL
exists only as a cache key. Each model's own `key` is part of the path, so
two vendored models' Cache Storage entries never collide, even though in
practice only one model's engine bundle is ever loaded at a time.

## What this agent could **not** verify

This was implemented and type-checked in a sandbox with no WebGPU-capable
browser and no way to exercise `caches`/`navigator.gpu` end-to-end. None of
the following were run against a real browser, for either vendored model:

- That `installLlm()` actually installs and starts the model successfully.
- That `askLlm()` returns a coherent, useful response — in Japanese for
  `gemma3-270m-ja`, in English for `smollm2-135m-instruct`.
- That the SHA-256 values recorded in each model's `model-manifest.ts` match
  what `scripts/embed-model.mjs` actually wrote (they were computed by that
  script from the fetched files, but the fetch/embed steps were run by an
  earlier session with outbound network access, not re-verified against a
  fresh download in this one).
- That `ai-panel.ts`'s runtime `<script>`-tag loading of
  `assets/llm-engine.<key>.js` (added for issue #116, extended to multiple
  models for issue #166) actually succeeds in a real browser, under both
  `https://` and `file://`, for both models. It was verified only at the
  build level: `npm run build` produces one `dist/assets/llm-engine.<key>.js`
  per catalog model, the main `dist/assets/index-*.js` contains neither
  model's embedded payload, and `npm run check:dist` still passes.
- That `smollm2-135m-instruct`'s `mlc-chat-config.json` overrides
  (`context_window_size: 4096`, mirroring `@mlc-ai/web-llm`'s own
  `prebuiltAppConfig` entry for this model) actually avoid a runtime error —
  contrast `gemma3-270m-ja`'s `sliding_window_size: -1` override, which
  fixes a `WindowSizeConfigurationError` observed and documented when that
  model was added.
- That the plan-proposal flow added for issue #122 (parsing a `PLAN: {...}`
  line out of the model's reply, previewing it, and applying it through
  `Commands.applyAiPlan()`) produces a usable plan from either real model —
  only the parser (`src/core/ai-plan.ts`) and the apply step
  (`Commands.applyAiPlan()`) have unit tests; the system prompt's actual
  effect on either small on-device model's output was not exercised
  end-to-end.

The cache-prepopulation trick also relies on **undocumented internals** of
`@mlc-ai/web-llm@0.2.84` — the fixed Cache Storage scope names and the
match-before-fetch order in `ArtifactCache.addToCache()` — read directly from
its published `lib/index.js`, not from its public API surface. If a future
version of the dependency changes that behavior, the failure mode is a
runtime error when a user clicks Install (caught and shown inline by the
AI Assistant panel — see `src/ui/ai-panel.ts`), not something
`npm run check:dist` or `npm run build` can catch. **Do not bump
`@mlc-ai/web-llm` without re-reading its cache-lookup path and re-testing
install end-to-end in a real WebGPU browser.**

## Refreshing or adding a model

```
npm run fetch:model    # downloads every model in scripts/model-catalog.mjs into .model-cache/ (not committed)
npm run embed:model    # regenerates src/llm-gen/ for every model
```

Pass a model `key` as the first argument to either command to refresh (or
newly fetch/embed) only that one model, e.g. `npm run fetch:model --
smollm2-135m-instruct`.

Re-run both, review the regenerated `src/llm-gen/` diff, and commit it as its
own change — never hand-edit anything under `src/llm-gen/` (every file there
is marked `@generated`).

To add a new model to the catalog: add an entry to `scripts/model-catalog.mjs`
(upstream repo, file list, WASM kernel source), fetch and embed it as above,
add the matching entry to `src/app/llm/model-catalog.ts`, add a new
`src/app/llm/engine-entry.<key>.ts` (copy an existing one and adjust the
`modelId`/`wasmFileName`/`overrides`), add the model's `LLM_MODEL_KEY=<key>
vite build --config vite.llm.config.ts` pass to the `build` script in
`package.json`, and add `aiAssistant.model.<key>.label` /
`aiAssistant.model.<key>.description` to both `src/locales/en.json` and
`src/locales/ja.json`. Per the size/scope precedent in "What is vendored"
above, get explicit owner sign-off on the new model's size and license before
vendoring it — this policy is not limited to the first model.
