// SPDX-License-Identifier: MIT
/**
 * Every local-assistant model the user can choose to install. Mirrors
 * scripts/model-catalog.mjs (the Node-side fetch/embed registry) — keep the
 * two in sync by hand when adding a model, since this one must stay
 * DOM/i18n-free-of-Node-built-ins and the Node one must not depend on
 * browser globals.
 *
 * Each model is built as its own separate classic script
 * (`assets/llm-engine.<key>.js`, see vite.llm.config.ts, one build pass per
 * model) rather than one shared bundle, so choosing one model never
 * downloads or parses another model's embedded Base64 payload — see
 * src/app/llm/engine-entry.*.ts and docs/llm-model.md.
 */

export interface ModelCatalogEntry {
  /** Matches the model's entry in scripts/model-catalog.mjs and its src/llm-gen/<key>/ output directory. */
  readonly key: string;
  /** i18n key for the model's display name (src/locales/en.json / ja.json). */
  readonly labelKey: string;
  /** i18n key for a short size/language blurb shown next to the name. */
  readonly descriptionKey: string;
  /** The classic `<script>` this model's engine is loaded from — see src/ui/ai-panel.ts's `loadLlmEngine()`. */
  readonly engineScript: string;
}

export const MODEL_CATALOG: readonly ModelCatalogEntry[] = [
  {
    key: 'gemma3-270m-ja',
    labelKey: 'aiAssistant.model.gemma3270mJa.label',
    descriptionKey: 'aiAssistant.model.gemma3270mJa.description',
    engineScript: './assets/llm-engine.gemma3-270m-ja.js',
  },
  {
    key: 'smollm2-135m-instruct',
    labelKey: 'aiAssistant.model.smollm2135mInstruct.label',
    descriptionKey: 'aiAssistant.model.smollm2135mInstruct.description',
    engineScript: './assets/llm-engine.smollm2-135m-instruct.js',
  },
];

export const DEFAULT_MODEL_KEY: string = MODEL_CATALOG[0].key;

export function getModelCatalogEntry(key: string): ModelCatalogEntry {
  return MODEL_CATALOG.find((entry) => entry.key === key) ?? MODEL_CATALOG[0];
}
