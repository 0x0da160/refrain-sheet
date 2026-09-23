// SPDX-License-Identifier: MIT
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  // `.claude/` holds agent scratch space and git worktrees (already excluded
  // from version control). Linting a checked-out worktree would lint a second
  // copy of the project — including its built `dist/` — and fail the run for
  // reasons that have nothing to do with the tree being checked.
  // `landing/` is the gitignored build output of `scripts/build-landing.mjs`;
  // its sources under `src/landing/` are linted by the block further below.
  {
    ignores: [
      'dist/',
      'dist-hosted/',
      'node_modules/',
      'coverage/',
      'src/wasm-gen/',
      'wasm/',
      '.claude/',
      'landing/',
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
    // The landing site (`src/landing/`) is a self-contained static marketing
    // site in plain browser JS, not part of the TypeScript app. `main.js` and
    // `consent.js` load as classic <script> tags; `i18n.js` is an ES module
    // read only at build time by scripts/build-landing.mjs.
    files: ['src/landing/**/*.js'],
    languageOptions: {
      globals: {
        window: 'readonly',
        document: 'readonly',
        localStorage: 'readonly',
        IntersectionObserver: 'readonly',
      },
    },
  },
  {
    files: ['src/landing/main.js', 'src/landing/consent.js'],
    languageOptions: { sourceType: 'script' },
    // Written in conservative ES5-style JS for older browsers, so a
    // `catch (e)` binding stays even when unused (no optional catch binding).
    rules: { '@typescript-eslint/no-unused-vars': ['error', { caughtErrors: 'none' }] },
  },
  {
    // Node build/verification scripts run outside the browser.
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly', fetch: 'readonly', Buffer: 'readonly' },
    },
  },
);
