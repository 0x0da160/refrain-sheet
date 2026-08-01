// SPDX-License-Identifier: MIT
/**
 * Standalone entry point for the local AI assistant engine.
 *
 * `engine.ts` transitively embeds the ~190 MB vendored model payload
 * (`src/llm-gen/`, via `cache-prepopulate.ts`). If the main application
 * bundle imported it — even via a dynamic `import()` — Vite's
 * `inlineDynamicImports` setting (required so `dist/index.html` keeps
 * working when opened directly via `file://`, see vite.config.ts) inlines
 * every dynamically-imported module into the same single script and
 * evaluates it eagerly at startup, defeating the deferral entirely: the
 * whole payload would still download and execute on every page load.
 *
 * This file is instead built as its own separate classic script (see
 * vite.llm.config.ts, `assets/llm-engine.js`) and loaded at runtime only
 * once the user opens the AI Assistant dialog's install/chat flow
 * (`src/ui/dialogs.ts`, `loadLlmEngine()`) by inserting a `<script>` tag —
 * the same same-origin, `file://`-safe loading path `index.html` already
 * uses for the main bundle, and explicitly allowed by the CSP
 * (`script-src 'self' file:`). This keeps the initial page load small
 * regardless of the model's size. See docs/llm-model.md.
 */
import * as engine from './engine';

declare global {
  interface Window {
    __refrainSheetLlmEngine?: typeof engine;
  }
}

window.__refrainSheetLlmEngine = engine;
