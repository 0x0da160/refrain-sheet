// SPDX-License-Identifier: MIT
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  // `.claude/` holds agent scratch space and git worktrees (already excluded
  // from version control). Linting a checked-out worktree would lint a second
  // copy of the project — including its built `dist/` — and fail the run for
  // reasons that have nothing to do with the tree being checked.
  // `landing/` is a self-contained static marketing site (plain browser JS,
  // built by `landing/build.py`), not part of the TypeScript app — same
  // reasoning as excluding `wasm/`.
  // `.llm-build-cache/` (gitignored) holds `scripts/build-llm-models.mjs`'s
  // cached copies of the built `llm-engine.<key>.js` bundles — built output,
  // like `dist/`, not source.
  {
    ignores: [
      'dist/',
      'node_modules/',
      'coverage/',
      'src/wasm-gen/',
      'src/llm-gen/',
      'wasm/',
      '.claude/',
      'landing/',
      '.llm-build-cache/',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Node build/verification scripts run outside the browser.
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly', fetch: 'readonly' },
    },
  },
);
