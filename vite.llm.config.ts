// SPDX-License-Identifier: MIT
import { defineConfig } from 'vite';
import { MODEL_CATALOG } from './src/app/llm/model-catalog';

/**
 * Independent build pass for one local-assistant model's engine
 * (src/app/llm/engine-entry.<key>.ts), which embeds that model's vendored
 * payload. Kept out of the main build (vite.config.ts) entirely, as its own
 * classic script (`dist/assets/llm-engine.<key>.js`), so the initial page
 * load never includes it — src/ui/ai-panel.ts loads the selected model's
 * script at runtime, only once the user installs it.
 *
 * Run once per model in src/app/llm/model-catalog.ts (see the `build`
 * script in package.json, one `vite build --config vite.llm.config.ts`
 * invocation per model, selected via the `LLM_MODEL_KEY` env var) with
 * `emptyOutDir: false` so later passes don't remove earlier ones' output.
 * Each pass is a single-entry build, output as one `iife` script (rather
 * than one multi-entry build covering every model) because Rollup's
 * `inlineDynamicImports` — required so each output stays a single
 * `file://`-safe classic script, no separate chunk files — only supports a
 * single entry point per build. This also means selecting one model in the
 * UI never downloads or parses another model's embedded payload. See
 * src/app/llm/engine-entry.*.ts and docs/llm-model.md for why this needs a
 * separate Rollup invocation rather than a dynamic `import()` inside the
 * main build.
 */
const modelKey = process.env.LLM_MODEL_KEY ?? MODEL_CATALOG[0].key;
const model = MODEL_CATALOG.find((entry) => entry.key === modelKey);
if (!model) {
  throw new Error(
    `vite.llm.config.ts: LLM_MODEL_KEY "${modelKey}" is not in src/app/llm/model-catalog.ts's MODEL_CATALOG`,
  );
}
const entryFileName = model.engineScript.replace(/^\.\/assets\//, '');

export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    outDir: 'dist',
    emptyOutDir: false,
    modulePreload: false,
    // Minification buys nothing here — the bulk of this bundle is already
    // dense Base64 text, not minifiable source — and running esbuild's
    // minifier over a single ~250-350 MB module has been observed to exceed
    // Node's default V8 heap (OOM) for the larger vendored models. See
    // docs/llm-model.md.
    minify: false,
    rollupOptions: {
      input: `src/app/llm/engine-entry.${model.key}.ts`,
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: `assets/${entryFileName}`,
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
