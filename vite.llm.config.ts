// SPDX-License-Identifier: MIT
import { defineConfig } from 'vite';

/**
 * Second, independent build pass for the local AI assistant engine
 * (src/app/llm/engine-entry.ts), which embeds the ~190 MB vendored model
 * payload. Kept out of the main build (vite.config.ts) entirely, as its
 * own classic script (`dist/assets/llm-engine.js`), so the initial page
 * load never includes it — src/ui/dialogs.ts loads this file at runtime,
 * only once the user opens the install/chat flow. See
 * src/app/llm/engine-entry.ts and docs/llm-model.md for why this needs a
 * separate Rollup invocation rather than a dynamic `import()` inside the
 * main build: Rollup's `iife` output format (required so the main bundle
 * stays a single `file://`-safe classic script) does not support
 * code-splitting within one build.
 *
 * Run after the main build (see the `build` script in package.json) with
 * `emptyOutDir: false` so it does not remove the main build's output.
 */
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    outDir: 'dist',
    emptyOutDir: false,
    modulePreload: false,
    rollupOptions: {
      input: 'src/app/llm/engine-entry.ts',
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'assets/llm-engine.js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
