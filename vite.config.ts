// SPDX-License-Identifier: MIT
import { readFileSync } from 'node:fs';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { assertBuildMode, buildCsp } from './scripts/lib/csp.mjs';

/**
 * The build must work when dist/index.html is opened directly via file://.
 * ES module scripts are blocked by CORS on file:// in Chromium, so the bundle
 * is emitted as a single classic IIFE script and the injected tags are
 * rewritten to plain <script defer> / <link> without crossorigin attributes.
 *
 * Two build modes share everything below except their output directory and the
 * Content-Security-Policy injected into index.html (see scripts/lib/csp.mjs):
 *
 *   vite build                → offline, dist/        (file:// + release ZIP)
 *   vite build --mode hosted  → hosted,  dist-hosted/ (app.refrain-sheet.com)
 *
 * The two policies are byte-identical today. The split exists so that a future
 * hosted-only CSP relaxation for the opt-in cloud sync described in
 * knowledge/operations/security-threat-model.md can never reach the offline artifact or the release ZIP.
 */
/** The favicon master; the build emits it as dist/favicon.svg (no copy is kept in the repo). */
const FAVICON_MASTER = 'design-system/v2/foundations/icons/favicon.svg';

export default defineConfig(({ command, mode }) => {
  // Vite's own defaults — 'development' for `vite dev`, 'production' for
  // `vite build` — both mean the offline policy. Only an explicit
  // `--mode hosted` selects the hosted one.
  const buildMode = assertBuildMode(mode === 'hosted' ? 'hosted' : 'offline');
  const csp = buildCsp(buildMode);

  // Google Drive credentials reach the bundle only in the hosted build. The
  // offline build is hardcoded to empty strings whatever the environment
  // holds, so the release ZIP can never carry a credential or a code path that
  // would reach the network; scripts/check/dist.mjs asserts that mechanically.
  // These are public identifiers delivered as repository *variables*, never
  // secrets — see knowledge/operations/security-supply-chain.md.
  const hostedEnv = (name: string) => JSON.stringify(buildMode === 'hosted' ? (process.env[name] ?? '') : '');

  return {
    base: './',
    // No public/ directory: the only static file (the favicon) comes from the
    // design-system master through the brand-favicon plugin below.
    publicDir: false,
    define: {
      // Lets the offline production build compile the Drive client out
      // entirely (see src/app/commands/index.ts). Only `vite build` in offline mode;
      // dev and Vitest keep it false so the Drive code stays testable.
      __OFFLINE_BUILD__: JSON.stringify(command === 'build' && buildMode === 'offline'),
      __DRIVE_CLIENT_ID__: hostedEnv('VITE_GOOGLE_OAUTH_CLIENT_ID'),
      __DRIVE_API_KEY__: hostedEnv('VITE_GOOGLE_DRIVE_API_KEY'),
    },
    build: {
      outDir: buildMode === 'hosted' ? 'dist-hosted' : 'dist',
      target: 'es2020',
      modulePreload: false,
      cssCodeSplit: false,
      rolldownOptions: {
        output: {
          format: 'iife' as const,
          // One classic script: IIFE output cannot be split into chunks.
          codeSplitting: false,
          entryFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]',
        },
      },
    },
    plugins: [
      tailwindcss(),
      {
        name: 'brand-favicon',
        configureServer(server) {
          server.middlewares.use('/favicon.svg', (_req, res) => {
            res.setHeader('Content-Type', 'image/svg+xml');
            res.end(readFileSync(FAVICON_MASTER));
          });
        },
        generateBundle() {
          this.emitFile({ type: 'asset', fileName: 'favicon.svg', source: readFileSync(FAVICON_MASTER) });
        },
      },
      {
        name: 'csp-inject',
        enforce: 'post' as const,
        transformIndexHtml(html: string) {
          if (!html.includes('__CSP__')) {
            throw new Error('index.html is missing the __CSP__ placeholder (see scripts/lib/csp.mjs)');
          }
          return html.replace('__CSP__', csp);
        },
      },
      {
        name: 'file-protocol-compat',
        enforce: 'post' as const,
        transformIndexHtml(html: string) {
          return html
            .replace(
              /<script type="module"[^>]*? src="([^"]+)"><\/script>/g,
              '<script defer src="$1"></script>',
            )
            .replace(/<link rel="stylesheet"[^>]*? href="([^"]+)">/g, '<link rel="stylesheet" href="$1">');
        },
      },
    ],
    test: {
      environment: 'node',
      include: ['tests/**/*.test.ts'],
      benchmark: {
        include: ['bench/**/*.bench.ts'],
      },
      // `npm run test:coverage`. The thresholds are a floor, not a target: a
      // restructuring change must not leave code less tested than before.
      coverage: {
        provider: 'v8',
        include: ['src/**/*.ts'],
        exclude: ['src/generated/**'],
        reporter: ['text-summary', 'json-summary'],
        thresholds: { statements: 81, branches: 75, functions: 79, lines: 82 },
      },
    },
  };
});
