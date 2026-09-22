// SPDX-License-Identifier: MIT
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { assertBuildMode, buildCsp } from './scripts/csp.mjs';

/**
 * The build must work when dist/index.html is opened directly via file://.
 * ES module scripts are blocked by CORS on file:// in Chromium, so the bundle
 * is emitted as a single classic IIFE script and the injected tags are
 * rewritten to plain <script defer> / <link> without crossorigin attributes.
 *
 * Two build modes share everything below except their output directory and the
 * Content-Security-Policy injected into index.html (see scripts/csp.mjs):
 *
 *   vite build                → offline, dist/        (file:// + release ZIP)
 *   vite build --mode hosted  → hosted,  dist-hosted/ (app.refrain-sheet.com)
 *
 * The two policies are byte-identical today. The split exists so that a future
 * hosted-only CSP relaxation for the opt-in cloud sync described in
 * knowledge/operations/security-threat-model.md can never reach the offline artifact or the release ZIP.
 */
export default defineConfig(({ mode }) => {
  // Vite's own defaults — 'development' for `vite dev`, 'production' for
  // `vite build` — both mean the offline policy. Only an explicit
  // `--mode hosted` selects the hosted one.
  const buildMode = assertBuildMode(mode === 'hosted' ? 'hosted' : 'offline');
  const csp = buildCsp(buildMode);

  // Google Drive credentials reach the bundle only in the hosted build. The
  // offline build is hardcoded to empty strings whatever the environment
  // holds, so the release ZIP can never carry a credential or a code path that
  // would reach the network; scripts/check-dist.mjs asserts that mechanically.
  // These are public identifiers delivered as repository *variables*, never
  // secrets — see knowledge/operations/security-supply-chain.md.
  const hostedEnv = (name: string) => JSON.stringify(buildMode === 'hosted' ? (process.env[name] ?? '') : '');

  return {
    base: './',
    define: {
      __DRIVE_CLIENT_ID__: hostedEnv('VITE_GOOGLE_OAUTH_CLIENT_ID'),
      __DRIVE_API_KEY__: hostedEnv('VITE_GOOGLE_DRIVE_API_KEY'),
    },
    build: {
      outDir: buildMode === 'hosted' ? 'dist-hosted' : 'dist',
      target: 'es2020',
      modulePreload: false,
      cssCodeSplit: false,
      rollupOptions: {
        output: {
          format: 'iife' as const,
          inlineDynamicImports: true,
          entryFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]',
        },
      },
    },
    plugins: [
      tailwindcss(),
      {
        name: 'csp-inject',
        enforce: 'post' as const,
        transformIndexHtml(html: string) {
          if (!html.includes('__CSP__')) {
            throw new Error('index.html is missing the __CSP__ placeholder (see scripts/csp.mjs)');
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
    },
  };
});
