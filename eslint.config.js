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
  // its sources under `site/` are linted by the block further below.
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
      // A type-only import is erased at build time, so marking it keeps the
      // runtime import graph honest (e.g. AppState <-> src/app/state/* is a
      // type-only back-reference, not a runtime cycle).
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports', disallowTypeAnnotations: false },
      ],
      // `import { type A }` with only type specifiers still leaves an empty
      // runtime import under some emit settings; require `import type { A }`.
      '@typescript-eslint/no-import-type-side-effects': 'error',
    },
  },
  {
    // Layering (knowledge/architecture/module-boundaries.md): dependencies
    // flow inward only, ui -> app -> core. Core is DOM-free so it runs
    // unchanged in Node for tests and benchmarks.
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/app/**', '**/app', '**/ui/**', '**/ui'],
              message: 'src/core must not import src/app or src/ui.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        ...['window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'requestAnimationFrame'].map(
          (name) => ({ name, message: 'src/core is DOM-free; take the value from the app or UI layer.' }),
        ),
      ],
    },
  },
  {
    files: ['src/app/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['**/ui/**', '**/ui'], message: 'src/app must not import src/ui; add a port instead.' },
          ],
        },
      ],
    },
  },
  {
    // The landing site (`site/`) is a self-contained static marketing
    // site in plain browser JS, not part of the TypeScript app. `main.js` and
    // `consent.js` load as classic <script> tags; `i18n.js` is an ES module
    // read only at build time by scripts/build-landing.mjs.
    files: ['site/**/*.js'],
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
    files: ['site/main.js', 'site/consent.js'],
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
