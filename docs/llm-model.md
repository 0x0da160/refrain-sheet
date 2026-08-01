# The local AI assistant model

Refrain Sheet ships a small, Japanese-capable language model that runs
entirely in the browser (via [`@mlc-ai/web-llm`](https://github.com/mlc-ai/web-llm),
WebGPU inference) to help answer questions about spreadsheet operations. This
document records what it is, how it is embedded, what is and is not verified,
and how to refresh it. It is a deliberate, explicitly human-approved exception
to the single-dependency policy in `docs/security.md` — read that document
first for the general dependency and offline rules this feature had to fit.

## What is vendored

- **Model:** [`UMASHIKA/gemma3-270m-japanese-webllm-04`](https://huggingface.co/UMASHIKA/gemma3-270m-japanese-webllm-04)
  (Gemma 3 270M, Japanese fine-tune, `q4f32_1` quantization, pre-compiled for
  WebLLM/WebGPU). License: Gemma Terms of Use (see the model card).
- **Size:** the vendored payload (`mlc-chat-config.json`, `tensor-cache.json`,
  four `params_shard_*.bin` files, `tokenizer.json`, and the compiled
  `.wasm` inference kernel) totals **≈190 MB** raw / **≈253 MB** as the
  Base64 text committed under `src/llm-gen/`. This is materially larger than
  the ≤100 MB the Issue originally asked for; the repository owner was told
  the actual size before approving it (see Issue #112 history) and chose to
  proceed anyway rather than a smaller model.
- **Why only 8 of the upstream repo's files:** `mlc-chat-config.json`'s
  `tokenizer_files` lists `tokenizer.json`, and WebLLM's tokenizer loader
  prefers it over `tokenizer.model` whenever both are listed, so
  `tokenizer.model`, `tokenizer_config.json`, `added_tokens.json`, and the
  alternate `bf16` tensor-cache manifest are never requested at runtime and
  are not vendored.

## How it is embedded (and why it needs no network access)

The same pattern `scripts/embed-wasm.mjs` uses for the Rust/WASM core
(`src/wasm-gen/`), applied to a much larger, multi-file artifact:

1. `npm run fetch:model` (`scripts/fetch-model.mjs`, **not run in CI**)
   downloads the 8 source files into `.model-cache/` (gitignored).
2. `npm run embed:model` (`scripts/embed-model.mjs`, **not run in CI**) reads
   `.model-cache/`, Base64-encodes each file, splits it into ≤8 MiB raw
   (≈10.7 MB Base64) chunks — comfortably under GitHub's 100 MB single-file
   push limit — and writes `src/llm-gen/model-payload/*.part*.ts` plus
   `src/llm-gen/model-manifest.ts` (each file's byte length, SHA-256, and its
   ordered chunk list). These generated files are committed, like
   `src/wasm-gen/`, so the app builds and tests without a network fetch or
   the Python/TVM model-compilation toolchain that produced the upstream
   artifact.

At runtime, `src/app/llm/cache-prepopulate.ts` decodes and concatenates each
file's chunks, verifies it against the recorded SHA-256
(`ModelPayloadIntegrityError` if it does not match), and writes it directly
into the browser's Cache Storage under the exact scope/URL
`@mlc-ai/web-llm`'s `ArtifactCache` reads from (`src/app/llm/model-source.ts`).
Because `ArtifactCache.addToCache()` checks `cache.match()` before ever
calling `fetch()`, pre-populating the cache means the engine's own loading
path always hits and never reaches a real network request. `index.html`'s
Content-Security-Policy (`connect-src 'none'`) and `scripts/check-dist.mjs`
are unchanged — this feature does not weaken either.

`MODEL_BASE_URL` in `model-source.ts` uses the `.invalid` TLD (IANA-reserved,
RFC 2606, guaranteed never to resolve) precisely because it must never
actually be dereferenced; the URL exists only as a cache key.

## What this agent could **not** verify

This was implemented and type-checked in a sandbox with no WebGPU-capable
browser and no way to exercise `caches`/`navigator.gpu` end-to-end. None of
the following were run against a real browser:

- That `installLlm()` actually installs and starts the model successfully.
- That `askLlm()` returns a coherent, useful Japanese (or English) response.
- That the SHA-256 values recorded in `model-manifest.ts` match what
  `scripts/embed-model.mjs` actually wrote (they were computed by that
  script from the fetched files, but the embed step itself was not re-run
  in this session).

The cache-prepopulation trick also relies on **undocumented internals** of
`@mlc-ai/web-llm@0.2.84` — the fixed Cache Storage scope names and the
match-before-fetch order in `ArtifactCache.addToCache()` — read directly from
its published `lib/index.js`, not from its public API surface. If a future
version of the dependency changes that behavior, the failure mode is a
runtime error when a user clicks Install (caught and shown inline by the
AI Assistant dialog — see `src/ui/dialogs.ts`), not something
`npm run check:dist` or `npm run build` can catch. **Do not bump
`@mlc-ai/web-llm` without re-reading its cache-lookup path and re-testing
install end-to-end in a real WebGPU browser.**

## Refreshing the model

```
npm run fetch:model    # downloads into .model-cache/ (not committed)
npm run embed:model    # regenerates src/llm-gen/
```

Re-run both, review the regenerated `src/llm-gen/` diff, and commit it as its
own change — never hand-edit anything under `src/llm-gen/` (every file there
is marked `@generated`).
