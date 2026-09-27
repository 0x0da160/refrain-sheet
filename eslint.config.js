// SPDX-License-Identifier: MIT
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/**
 * Files that still hold a function over the size/complexity limits below.
 * A ratchet (docs/proposals/structural-refactoring-plan.md): entries are only
 * ever removed, and a file leaves the list once it passes the limits.
 */
const COMPLEXITY_RATCHET = [
  'src/app/commands/filter.ts',
  'src/app/commands/paste-fill.ts',
  'src/core/csv/byte-csv-parser.ts',
  'src/core/diff-engine.ts',
  'src/core/workbook/filter.ts',
  'src/core/flash-fill.ts',
  'src/core/markdown.ts',
  'src/core/workbook/rsf-codec.ts',
  'src/core/sql-engine.ts',
  'src/core/interchange/xlsx-import.ts',
  'src/main.ts',
  'src/ui/column-menu.ts',
  'src/ui/dialogs/app-settings.ts',
  'src/ui/dialogs/diff.ts',
  'src/ui/dialogs/format.ts',
  'src/ui/dialogs/sheet-ops.ts',
  'src/ui/dialogs/sql.ts',
  'src/ui/grid/index.ts',
  'src/ui/menu-bar.ts',
  'src/ui/status-bar.ts',
  'src/ui/viewport-debug.ts',
];

export default tseslint.config(
  // `.claude/` holds agent scratch space and git worktrees (already excluded
  // from version control). Linting a checked-out worktree would lint a second
  // copy of the project — including its built `dist/` — and fail the run for
  // reasons that have nothing to do with the tree being checked.
  // `landing/` is the gitignored build output of `scripts/build/landing.mjs`;
  // its sources under `site/` are linted by the block further below.
  {
    ignores: [
      'dist/',
      'dist-hosted/',
      'node_modules/',
      'coverage/',
      'src/generated/',
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
    // Keep functions small enough to review and test on their own.
    files: ['src/**/*.ts'],
    rules: {
      complexity: ['error', 30],
      'max-lines-per-function': ['error', { max: 120, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    files: COMPLEXITY_RATCHET,
    rules: { complexity: 'off', 'max-lines-per-function': 'off' },
  },
  {
    // CSV vs workbook is a capability question answered in one place
    // (src/core/editor-document.ts: isWorkbook / isCsv / workbookOf /
    // activeSheetOf), never by comparing a document's `kind` directly.
    files: ['src/**/*.ts'],
    ignores: ['src/core/editor-document.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "BinaryExpression[operator=/^[!=]==$/][left.property.name='kind'][right.value=/^(rsf|csv)$/]",
          message: 'Use isWorkbook()/isCsv()/workbookOf() from src/core/editor-document.ts.',
        },
      ],
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
    // read only at build time by scripts/build/landing.mjs.
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
